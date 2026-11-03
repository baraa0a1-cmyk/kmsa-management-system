-- KMSA FLOW 7.0 — additive project-first follow-up, requires existing KMSA v6.6.
-- Run after backing up the database. Does NOT delete old milestones, supervision, history or alerts.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.initiatives') IS NULL OR to_regclass('public.project_activity_entries') IS NULL
    OR to_regclass('public.milestone_followup_schedules') IS NULL
    OR to_regclass('public.project_supervision_assignments') IS NULL THEN
   RAISE EXCEPTION 'KMSA_FLOW_PREREQUISITES_MISSING: v6.4+ project tables required';
 END IF;
END $$;

-- Start the new cadence NOW, not at project creation: avoid retrospective blame on rollout.
CREATE TABLE IF NOT EXISTS public.kmsa_flow_baselines (
 initiative_id uuid PRIMARY KEY REFERENCES public.initiatives(id) ON DELETE CASCADE,
 started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.kmsa_flow_baselines(initiative_id)
 SELECT id FROM public.initiatives WHERE setup_status='ACTIVE' AND approval_status='APPROVED'
 ON CONFLICT(initiative_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.kmsa_flow_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE RESTRICT,
 author_id uuid NOT NULL REFERENCES public.profiles(id),
 request_key uuid NOT NULL,
 summary text NOT NULL,
 next_step text,
 changed_milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(initiative_id,author_id,request_key)
);
CREATE INDEX IF NOT EXISTS kmsa_flow_batches_project_time ON public.kmsa_flow_batches(initiative_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.kmsa_flow_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 actor_kind text NOT NULL CHECK(actor_kind IN ('DELEGATE','SECRETARY_DIRECT')),
 request_key uuid NOT NULL,
 assessment text NOT NULL CHECK(assessment IN ('ON_TRACK','SLOW','NO_WORK','BLOCKED','UNVERIFIED','WAITING_EXTERNAL')),
 channel text NOT NULL CHECK(channel IN ('TELEGRAM','OUTPUT','OTHER')),
 note text,
 next_review_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(initiative_id,actor_id,request_key),
 CHECK (assessment='ON_TRACK' OR length(trim(COALESCE(note,''))) >= 6)
);
CREATE INDEX IF NOT EXISTS kmsa_flow_checks_project_time ON public.kmsa_flow_checks(initiative_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.kmsa_flow_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE RESTRICT,
 milestone_id uuid REFERENCES public.milestones(id) ON DELETE SET NULL,
 opened_by uuid NOT NULL REFERENCES public.profiles(id),
 request_key uuid NOT NULL,
 responsible_id uuid NOT NULL REFERENCES public.profiles(id),
 check_id uuid REFERENCES public.kmsa_flow_checks(id),
 description text NOT NULL CHECK(length(trim(description)) >= 6),
 due_at timestamptz,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED','CANCELLED')),
 resolution_note text,
 closed_by uuid REFERENCES public.profiles(id),
 closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(initiative_id,opened_by,request_key)
);
CREATE INDEX IF NOT EXISTS kmsa_flow_issues_open ON public.kmsa_flow_issues(initiative_id,status,due_at);

CREATE TABLE IF NOT EXISTS public.kmsa_flow_secretary_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE RESTRICT,
 secretary_id uuid NOT NULL REFERENCES public.profiles(id),
 request_key uuid NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) >= 6),
 action_kind text NOT NULL CHECK(action_kind IN ('CONTACTED','REASSIGNED','TEMP_UNAVAILABLE','ESCALATED','OTHER')),
 outcome_note text NOT NULL CHECK(length(trim(outcome_note)) >= 6),
 review_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(initiative_id,secretary_id,request_key)
);
CREATE INDEX IF NOT EXISTS kmsa_flow_secretary_actions_project ON public.kmsa_flow_secretary_actions(initiative_id,created_at DESC);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['kmsa_flow_baselines','kmsa_flow_batches','kmsa_flow_checks','kmsa_flow_issues','kmsa_flow_secretary_actions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('DROP POLICY IF EXISTS kmsa_flow_scoped_read ON public.%I',t);
  EXECUTE format('CREATE POLICY kmsa_flow_scoped_read ON public.%I FOR SELECT TO authenticated USING (public.can_read_initiative(initiative_id))',t);
 END LOOP;
END $$;

-- Single PostgreSQL transaction for all selected milestones. The browser never writes these rows.
CREATE OR REPLACE FUNCTION public.kmsa_flow_batch_progress(
 p_initiative uuid,p_author uuid,p_request_key uuid,p_note text,p_next_step text,p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_i public.initiatives%ROWTYPE;v_m public.milestones%ROWTYPE;v_item jsonb;
 v_result uuid;v_status text;v_outcome text;v_count integer;v_done integer;
 v_batch uuid;v_saved jsonb:='[]'::jsonb;v_summary text:=trim(COALESCE(p_note,''));
 v_next text:=trim(COALESCE(p_next_step,''));v_time timestamptz:=now();v_seen uuid[]:=ARRAY[]::uuid[];v_paused boolean:=false;
BEGIN
 IF p_request_key IS NULL OR p_author IS NULL OR p_initiative IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED'; END IF;
 IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'SELECT_1_TO_8_MILESTONES'; END IF;
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
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.project_execution_pauses WHERE initiative_id=$1 AND status=''APPROVED'' AND pause_until_date>=current_date)' INTO v_paused USING p_initiative;
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
  v_outcome:=NULLIF(trim(COALESCE(v_item->>'outcome','')),'');
  IF v_status='READY_FOR_VERIFICATION' AND COALESCE(v_outcome,v_m.outcome_text,'')='' THEN RAISE EXCEPTION 'COMPLETION_REQUIRES_OUTCOME'; END IF;
  IF v_status<>'READY_FOR_VERIFICATION' AND v_next='' THEN RAISE EXCEPTION 'NEXT_STEP_REQUIRED'; END IF;
  UPDATE public.milestones SET status=v_status::public.milestone_status,lead_note=v_summary,
    outcome_text=COALESCE(v_outcome,outcome_text),status_updated_at=v_time,
    completed_reported_at=CASE WHEN v_status='READY_FOR_VERIFICATION' THEN COALESCE(completed_reported_at,v_time) ELSE completed_reported_at END
  WHERE id=v_m.id;
  IF v_status='READY_FOR_VERIFICATION' AND v_m.status<>'READY_FOR_VERIFICATION' THEN
   UPDATE public.milestones SET due_at=v_time + make_interval(days=>coalesce(relative_days,0),hours=>coalesce(relative_hours,0)),status_updated_at=v_time
    WHERE relative_to_milestone_id=v_m.id AND deadline_mode='RELATIVE' AND status NOT IN ('VERIFIED','CANCELLED');
  END IF;
  INSERT INTO public.project_activity_entries(initiative_id,milestone_id,author_id,kind,note,status_after,details,created_at)
   VALUES(p_initiative,v_m.id,p_author,'MILESTONE_UPDATE',v_summary,v_status,
    jsonb_build_object('batch_id',v_batch,'next_step',v_next,'outcome',v_outcome,'update_type','PROJECT_BATCH','previous_status',v_m.status),v_time);
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
   ELSE 'ON_TRACK' END WHERE id=p_initiative;
 INSERT INTO public.audit_log(actor_id,action,entity_type,entity_id,meta)
 VALUES(p_author,'KMSA_FLOW_BATCH_PROGRESS','INITIATIVE',p_initiative,jsonb_build_object('batch_id',v_batch,'milestones',v_saved));
 RETURN jsonb_build_object('ok',true,'batchId',v_batch,'milestones',v_saved);
END $$;
-- An approved completion is NOT inferred from checking all stations: every active station
-- must have a separately accepted RESULT_OK on the LATEST reported result. Old VERIFIED records remain valid.
CREATE OR REPLACE FUNCTION public.kmsa_flow_require_result_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m record; a uuid; n integer:=0;
BEGIN
 IF NEW.status='APPROVED' AND OLD.status='PENDING' AND NEW.type='SUCCEEDED' THEN
  FOR m IN SELECT ms.id,ms.title,ms.status FROM public.milestones ms JOIN public.results r ON r.id=ms.result_id
    WHERE r.initiative_id=NEW.initiative_id AND ms.design_status='APPROVED' AND ms.status<>'CANCELLED'
  LOOP
   n:=n+1;
   IF m.status NOT IN ('READY_FOR_VERIFICATION','VERIFIED') THEN
     RAISE EXCEPTION 'لا يمكن إغلاق المشروع بنجاح قبل اكتمال كل محطة: %',m.title;
   END IF;
   IF m.status<>'VERIFIED' THEN
     SELECT id INTO a FROM public.project_activity_entries WHERE milestone_id=m.id AND kind='MILESTONE_UPDATE'
       ORDER BY created_at DESC,id DESC LIMIT 1;
     IF a IS NULL OR NOT EXISTS(
       SELECT 1 FROM public.milestone_supervision_events e
       WHERE e.milestone_id=m.id AND e.source_activity_id=a AND e.event_type='RESULT_OK'
     ) THEN RAISE EXCEPTION 'لا يمكن إغلاق المشروع بنجاح قبل تقييم نتيجة المحطة: %',m.title;
     END IF;
   END IF;
  END LOOP;
  IF n=0 THEN RAISE EXCEPTION 'لا يمكن إغلاق المشروع بنجاح دون محطات إنجاز معتمدة.'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_flow_require_result_review() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS kmsa_flow_close_result_guard ON public.project_closure_requests;
CREATE TRIGGER kmsa_flow_close_result_guard BEFORE UPDATE OF status ON public.project_closure_requests
 FOR EACH ROW EXECUTE FUNCTION public.kmsa_flow_require_result_review();

REVOKE ALL ON FUNCTION public.kmsa_flow_batch_progress(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_flow_batch_progress(uuid,uuid,uuid,text,text,jsonb) TO service_role;
COMMIT;
