-- KMSA 7.3 | additive oversight evidence, after migration 0028.
-- This is an observation of a documented lateness, never a substitute for a supervisor check.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.kmsa_flow_checks') IS NULL OR to_regclass('public.project_supervision_assignments') IS NULL
 THEN RAISE EXCEPTION 'KMSA_V73_REQUIRES_V72'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.kmsa_supervision_oversight (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE RESTRICT,
 supervisor_id uuid NOT NULL REFERENCES public.profiles(id),
 secretary_id uuid NOT NULL REFERENCES public.profiles(id),
 late_due_at timestamptz NOT NULL,
 review_kind text NOT NULL CHECK (review_kind IN ('REVIEWED_RECORD','CONTACTED_SUPERVISOR')),
 note text,
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 follow_up_due_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
 UNIQUE (initiative_id,supervisor_id,late_due_at),
 CHECK (note IS NULL OR length(note) <= 1000)
);
CREATE INDEX IF NOT EXISTS kmsa_oversight_project_time ON public.kmsa_supervision_oversight(initiative_id,reviewed_at DESC);
ALTER TABLE public.kmsa_supervision_oversight ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kmsa_supervision_oversight FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.kmsa_supervision_oversight TO authenticated;
DROP POLICY IF EXISTS kmsa_oversight_scoped_read ON public.kmsa_supervision_oversight;
CREATE POLICY kmsa_oversight_scoped_read ON public.kmsa_supervision_oversight
 FOR SELECT TO authenticated USING (public.can_read_initiative(initiative_id));

CREATE OR REPLACE FUNCTION public.kmsa_v73_record_supervision_review(
 p_initiative uuid,p_secretary uuid,p_supervisor uuid,p_late_due_at timestamptz,
 p_review_kind text,p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_init public.initiatives%ROWTYPE; v_assigned uuid; v_id uuid; v_existing timestamptz;
BEGIN
 SELECT * INTO v_init FROM public.initiatives WHERE id=p_initiative FOR UPDATE;
 IF NOT FOUND OR v_init.secretary_id<>p_secretary OR v_init.owner_id=p_secretary
  OR v_init.approval_status<>'APPROVED' OR v_init.setup_status<>'ACTIVE'
  OR v_init.status IN ('COMPLETED','CANCELLED') OR COALESCE(v_init.lifecycle_state,'ACTIVE')<>'ACTIVE'
  THEN RAISE EXCEPTION 'SECRETARY_OVERSIGHT_NOT_ALLOWED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.cycles WHERE id=v_init.cycle_id AND is_current=true) THEN
  RAISE EXCEPTION 'ARCHIVED_CYCLE_READ_ONLY'; END IF;
 SELECT supervisor_id INTO v_assigned FROM public.project_supervision_assignments WHERE initiative_id=p_initiative;
 IF v_assigned IS NULL OR v_assigned<>p_supervisor OR p_secretary=p_supervisor
  THEN RAISE EXCEPTION 'NO_CURRENT_DELEGATED_SUPERVISOR'; END IF;
 IF p_review_kind NOT IN ('REVIEWED_RECORD','CONTACTED_SUPERVISOR')
  OR p_late_due_at IS NULL OR p_late_due_at >= now()
  OR length(COALESCE(p_note,''))>1000 THEN RAISE EXCEPTION 'INVALID_SUPERVISION_REVIEW'; END IF;
 INSERT INTO public.kmsa_supervision_oversight (initiative_id,supervisor_id,secretary_id,late_due_at,review_kind,note)
 VALUES (p_initiative,p_supervisor,p_secretary,p_late_due_at,p_review_kind,nullif(trim(p_note),''))
 ON CONFLICT (initiative_id,supervisor_id,late_due_at) DO NOTHING
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN
   SELECT id INTO v_id FROM public.kmsa_supervision_oversight
   WHERE initiative_id=p_initiative AND supervisor_id=p_supervisor AND late_due_at=p_late_due_at;
 ELSE
   INSERT INTO public.audit_log(actor_id,action,entity_type,entity_id,meta)
   VALUES(p_secretary,'SUPERVISION_DELAY_REVIEWED','INITIATIVE',p_initiative,
    jsonb_build_object('supervisor_id',p_supervisor,'late_due_at',p_late_due_at,'review_kind',p_review_kind));
 END IF;
 RETURN jsonb_build_object('ok',true,'reviewId',v_id);
END $$;
REVOKE ALL ON FUNCTION public.kmsa_v73_record_supervision_review(uuid,uuid,uuid,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_v73_record_supervision_review(uuid,uuid,uuid,timestamptz,text,text) TO service_role;
-- Allow one executive report to include all active stages of a complex project (up to 30).
CREATE OR REPLACE FUNCTION public.kmsa_flow_batch_progress(
 p_initiative uuid,p_author uuid,p_request_key uuid,p_note text,p_next_step text,p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_i public.initiatives%ROWTYPE;v_m public.milestones%ROWTYPE;v_item jsonb;
 v_result uuid;v_status text;v_outcome text;v_count integer;v_done integer;
 v_batch uuid;v_saved jsonb:='[]'::jsonb;v_summary text:=trim(COALESCE(p_note,''));
 v_next text:=trim(COALESCE(p_next_step,''));v_station_note text;v_station_next text;v_time timestamptz:=now();v_seen uuid[]:=ARRAY[]::uuid[];v_paused boolean:=false;
BEGIN
 IF p_request_key IS NULL OR p_author IS NULL OR p_initiative IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED'; END IF;
 IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'SELECT_1_TO_30_MILESTONES'; END IF;
 IF length(v_summary) NOT BETWEEN 8 AND 3000 THEN RAISE EXCEPTION 'DESCRIBE_ACTUAL_PROGRESS_8_TO_3000'; END IF;
 SELECT * INTO v_i FROM public.initiatives WHERE id=p_initiative FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_FOUND'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cycles WHERE id=v_i.cycle_id AND is_current=true) THEN RAISE EXCEPTION 'ARCHIVED_CYCLE_READ_ONLY'; END IF;
 IF v_i.approval_status <> 'APPROVED' OR v_i.setup_status <> 'ACTIVE'
    OR v_i.status IN ('COMPLETED','CANCELLED') OR COALESCE(v_i.lifecycle_state,'ACTIVE') <> 'ACTIVE' THEN
   RAISE EXCEPTION 'PROJECT_NOT_ACTIVE';
 END IF;
 -- Under an approved temporary pause, progress reporting is disabled so the student is not asked to work.
 IF to_regclass('public.project_execution_pauses') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.project_execution_pauses WHERE initiative_id=$1 AND status=''APPROVED'' AND pause_until_date>=(now() AT TIME ZONE ''Africa/Khartoum'')::date)' INTO v_paused USING p_initiative;
  IF v_paused THEN RAISE EXCEPTION 'PROJECT_TEMPORARILY_PAUSED'; END IF;
 END IF;
 INSERT INTO public.kmsa_flow_batches(initiative_id,author_id,request_key,summary,next_step,changed_milestones)
 VALUES(p_initiative,p_author,p_request_key,v_summary,NULLIF(v_next,''),p_items)
 ON CONFLICT(initiative_id,author_id,request_key) DO NOTHING RETURNING id INTO v_batch;
 IF v_batch IS NULL THEN RETURN jsonb_build_object('ok',true,'alreadySaved',true); END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF (v_item->>'milestoneId') IS NULL OR (v_item->>'milestoneId') !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'MILESTONE_ID_INVALID'; END IF;
  IF (v_item->>'milestoneId')::uuid = ANY(v_seen) THEN RAISE EXCEPTION 'DUPLICATE_MILESTONE'; END IF;
  v_seen:=array_append(v_seen,(v_item->>'milestoneId')::uuid);
  SELECT m.* INTO v_m FROM public.milestones m JOIN public.results r ON r.id=m.result_id
    WHERE m.id=(v_item->>'milestoneId')::uuid AND r.initiative_id=p_initiative FOR UPDATE OF m;
  IF NOT FOUND OR v_m.owner_id<>p_author THEN RAISE EXCEPTION 'NOT_PROJECT_MILESTONE_OWNER'; END IF;
  IF v_m.status IN ('VERIFIED','CANCELLED') OR v_m.design_status='REJECTED' THEN RAISE EXCEPTION 'MILESTONE_CLOSED'; END IF;
  v_status:=COALESCE(NULLIF(v_item->>'status',''),v_m.status::text);
  IF v_status NOT IN ('NOT_STARTED','IN_PROGRESS','AT_RISK','BLOCKED','READY_FOR_VERIFICATION') THEN RAISE EXCEPTION 'MILESTONE_STATUS_INVALID'; END IF;
  v_station_note:=trim(COALESCE(NULLIF(v_item->>'note',''),v_summary));
  v_station_next:=trim(COALESCE(NULLIF(v_item->>'nextStep',''),v_next));
  IF length(v_station_note)<8 THEN RAISE EXCEPTION 'EACH_STATION_NEEDS_REAL_PROGRESS'; END IF;
  v_outcome:=NULLIF(trim(COALESCE(v_item->>'outcome','')),'');
  IF v_status='READY_FOR_VERIFICATION' AND COALESCE(v_outcome,v_m.outcome_text,'')='' THEN RAISE EXCEPTION 'COMPLETION_REQUIRES_OUTCOME'; END IF;
  IF v_status<>'READY_FOR_VERIFICATION' AND v_station_next='' THEN RAISE EXCEPTION 'NEXT_STEP_REQUIRED'; END IF;
  UPDATE public.milestones SET status=v_status::public.milestone_status,lead_note=v_station_note,
    outcome_text=COALESCE(v_outcome,outcome_text),status_updated_at=v_time,
    completed_reported_at=CASE WHEN v_status='READY_FOR_VERIFICATION' THEN COALESCE(completed_reported_at,v_time) ELSE completed_reported_at END
  WHERE id=v_m.id;
  IF v_status='READY_FOR_VERIFICATION' AND v_m.status<>'READY_FOR_VERIFICATION' THEN
   UPDATE public.milestones SET due_at=v_time + make_interval(days=>coalesce(relative_days,0),hours=>coalesce(relative_hours,0)),status_updated_at=v_time
    WHERE relative_to_milestone_id=v_m.id AND deadline_mode='RELATIVE' AND status NOT IN ('VERIFIED','CANCELLED');
  END IF;
  INSERT INTO public.project_activity_entries(initiative_id,milestone_id,author_id,kind,note,status_after,details,created_at)
   VALUES(p_initiative,v_m.id,p_author,'MILESTONE_UPDATE',v_station_note,v_status,
    jsonb_build_object('batch_id',v_batch,'next_step',v_station_next,'outcome',v_outcome,'update_type','PROJECT_BATCH','previous_status',v_m.status),v_time);
  IF to_regprocedure('public.kmsa_v64_register_followup(uuid,timestamp with time zone)') IS NOT NULL THEN
   PERFORM public.kmsa_v64_register_followup(v_m.id,v_time);
  END IF;
  v_saved:=v_saved||jsonb_build_array(jsonb_build_object('id',v_m.id,'status',v_status));
 END LOOP;
 -- Milestone completion does not close a project. Only refresh the intermediate result's delivery state.
 FOR v_result IN SELECT id FROM public.results WHERE initiative_id=p_initiative LOOP
  SELECT count(*),count(*) FILTER(WHERE status IN ('READY_FOR_VERIFICATION','VERIFIED')) INTO v_count,v_done
  FROM public.milestones WHERE result_id=v_result AND design_status='APPROVED' AND status<>'CANCELLED';
  IF v_count>0 AND v_count=v_done THEN
   UPDATE public.results SET assignment_status='COMPLETED',completed_at=COALESCE(completed_at,v_time) WHERE id=v_result;
  ELSE
   UPDATE public.results SET assignment_status='ACTIVE',completed_at=NULL WHERE id=v_result AND assignment_status='COMPLETED';
  END IF;
 END LOOP;
 UPDATE public.initiatives SET health=CASE
   WHEN EXISTS(SELECT 1 FROM public.milestones m JOIN public.results r ON r.id=m.result_id WHERE r.initiative_id=p_initiative AND m.status='BLOCKED') THEN 'BLOCKED'
   WHEN EXISTS(SELECT 1 FROM public.milestones m JOIN public.results r ON r.id=m.result_id WHERE r.initiative_id=p_initiative AND m.status='AT_RISK') THEN 'AT_RISK'
   WHEN EXISTS(SELECT 1 FROM public.milestones m JOIN public.results r ON r.id=m.result_id WHERE r.initiative_id=p_initiative AND m.due_at<now() AND m.status NOT IN('VERIFIED','CANCELLED')) THEN 'AT_RISK'
   WHEN EXISTS(SELECT 1 FROM public.kmsa_flow_issues WHERE initiative_id=p_initiative AND status='OPEN') THEN 'AT_RISK'
   ELSE 'ON_TRACK' END WHERE id=p_initiative;
 INSERT INTO public.audit_log(actor_id,action,entity_type,entity_id,meta)
 VALUES(p_author,'KMSA_FLOW_BATCH_PROGRESS','INITIATIVE',p_initiative,jsonb_build_object('batch_id',v_batch,'milestones',v_saved));
 RETURN jsonb_build_object('ok',true,'batchId',v_batch,'milestones',v_saved);
END $$;
COMMIT;
