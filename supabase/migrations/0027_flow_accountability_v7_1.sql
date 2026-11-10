-- KMSA Flow v7.1: genuine verification, project-first obligations, no Telegram-contact ledger.
-- Requires v7.0 migration 0026 and existing v6.5 pause tables. Non-destructive.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.kmsa_flow_checks') IS NULL OR to_regclass('public.kmsa_flow_baselines') IS NULL
 THEN RAISE EXCEPTION 'INSTALL_FLOW_V7_FIRST'; END IF;
END $$;

ALTER TABLE public.kmsa_flow_checks ADD COLUMN IF NOT EXISTS milestone_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];
CREATE INDEX IF NOT EXISTS kmsa_flow_checks_scope ON public.kmsa_flow_checks USING gin(milestone_ids);
-- v7-era checks had no station scope. Start this more rigorous obligation from now,
-- rather than retroactively accusing deputies for pre-upgrade unscoped checks.
UPDATE public.kmsa_flow_baselines SET started_at=now() WHERE initiative_id IN (
 SELECT id FROM public.initiatives WHERE approval_status='APPROVED' AND setup_status='ACTIVE'
 AND status NOT IN ('COMPLETED','CANCELLED') AND COALESCE(lifecycle_state,'ACTIVE')='ACTIVE');

CREATE OR REPLACE FUNCTION public.kmsa_flow_start_baseline() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.approval_status='APPROVED' AND NEW.setup_status='ACTIVE'
 AND NEW.status NOT IN ('COMPLETED','CANCELLED') AND COALESCE(NEW.lifecycle_state,'ACTIVE')='ACTIVE' THEN
  INSERT INTO public.kmsa_flow_baselines(initiative_id,started_at) VALUES(NEW.id,now()) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_flow_start_baseline() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS kmsa_flow_v71_start_clock ON public.initiatives;
CREATE TRIGGER kmsa_flow_v71_start_clock AFTER INSERT OR UPDATE OF approval_status,setup_status,status,lifecycle_state
 ON public.initiatives FOR EACH ROW EXECUTE FUNCTION public.kmsa_flow_start_baseline();
INSERT INTO public.kmsa_flow_baselines(initiative_id,started_at)
 SELECT id,now() FROM public.initiatives WHERE approval_status='APPROVED' AND setup_status='ACTIVE'
 AND status NOT IN ('COMPLETED','CANCELLED') AND COALESCE(lifecycle_state,'ACTIVE')='ACTIVE'
 ON CONFLICT DO NOTHING;

-- Atomic verification + optional durable follow-up. One entry on KMSA, Telegram communication remains external.
CREATE FUNCTION public.kmsa_flow_record_check_v71(
 p_initiative uuid,p_actor uuid,p_kind text,p_request_key uuid,p_assessment text,p_channel text,
 p_note text,p_review_at timestamptz,p_milestone_ids uuid[],
 p_issue_text text,p_issue_due timestamptz,p_issue_responsible uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_init public.initiatives%ROWTYPE;v_id uuid;v_issue uuid;v_required uuid[];v_now timestamptz:=now();
 v_pause boolean;v_target uuid;v_earliest timestamptz;v_ms uuid;v_source uuid;v_status text;v_kind text;
BEGIN
 IF p_request_key IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'REQUEST_KEY_REQUIRED';END IF;
 SELECT * INTO v_init FROM public.initiatives WHERE id=p_initiative FOR UPDATE;
 IF NOT FOUND OR v_init.approval_status<>'APPROVED' OR v_init.setup_status<>'ACTIVE'
 OR v_init.status IN ('COMPLETED','CANCELLED') OR COALESCE(v_init.lifecycle_state,'ACTIVE')<>'ACTIVE' THEN
  RAISE EXCEPTION 'PROJECT_NOT_ACTIVE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cycles WHERE id=v_init.cycle_id AND is_current=true) THEN RAISE EXCEPTION 'ARCHIVED_CYCLE_READ_ONLY';END IF;
 IF to_regclass('public.project_execution_pauses') IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM public.project_execution_pauses WHERE initiative_id=p_initiative
   AND status='APPROVED' AND pause_until_date >= (now() AT TIME ZONE 'Africa/Khartoum')::date) INTO v_pause;
  IF v_pause THEN RAISE EXCEPTION 'PROJECT_TEMPORARILY_PAUSED';END IF;
 END IF;
 IF p_kind NOT IN('DELEGATE','SECRETARY_DIRECT') OR p_assessment NOT IN ('ON_TRACK','SLOW','NO_WORK','BLOCKED','UNVERIFIED','WAITING_EXTERNAL')
 OR p_channel NOT IN('TELEGRAM','OUTPUT','OTHER') OR length(trim(COALESCE(p_note,'')))<6 THEN
  RAISE EXCEPTION 'VERIFICATION_REQUIRES_SPECIFIC_FINDING';END IF;
 WITH stages AS (
   SELECT m.id,m.due_at,m.status FROM public.milestones m JOIN public.results r ON r.id=m.result_id
   WHERE r.initiative_id=p_initiative AND m.design_status<>'REJECTED' AND m.status<>'CANCELLED'
 ), work AS (SELECT id,due_at FROM stages WHERE status IN ('IN_PROGRESS','AT_RISK','BLOCKED','READY_FOR_VERIFICATION')),
 chosen AS (SELECT id,due_at FROM work UNION ALL
    SELECT id,due_at FROM (SELECT id,due_at FROM stages WHERE status='NOT_STARTED'
      ORDER BY due_at NULLS LAST,id LIMIT 1) first WHERE NOT EXISTS (SELECT 1 FROM work))
 SELECT coalesce(array_agg(id),ARRAY[]::uuid[]),min(due_at) INTO v_required,v_earliest FROM chosen;
 IF coalesce(cardinality(v_required),0)>0 AND coalesce(cardinality(p_milestone_ids),0)=0 THEN RAISE EXCEPTION 'SELECT_STATIONS_VERIFIED';END IF;
 IF (SELECT count(DISTINCT item) FROM unnest(coalesce(p_milestone_ids,ARRAY[]::uuid[])) AS t(item)) <> cardinality(coalesce(p_milestone_ids,ARRAY[]::uuid[]))
 OR NOT (coalesce(p_milestone_ids,ARRAY[]::uuid[]) <@ coalesce(v_required,ARRAY[]::uuid[])) THEN
  RAISE EXCEPTION 'INVALID_VERIFICATION_SCOPE';END IF;
 IF p_assessment='WAITING_EXTERNAL' AND (p_review_at IS NULL OR p_review_at<=v_now OR p_review_at>v_now+interval '7 days'
 OR (v_earliest IS NOT NULL AND v_earliest>v_now AND p_review_at>v_earliest)
 OR (v_earliest IS NOT NULL AND v_earliest<=v_now AND p_review_at>v_now+interval '12 hours')) THEN
  RAISE EXCEPTION 'EXTERNAL_REVIEW_MAX_7_DAYS_AND_BEFORE_DEADLINE';END IF;
 IF p_assessment IN('SLOW','NO_WORK','BLOCKED','UNVERIFIED') THEN
  IF length(trim(COALESCE(p_issue_text,'')))<6 OR p_issue_due IS NULL OR p_issue_due<=v_now OR p_issue_due>v_now+interval '7 days' THEN
   RAISE EXCEPTION 'NEGATIVE_FINDING_REQUIRES_ACTION_AND_REVIEW_DATE';END IF;
  v_target:=coalesce(p_issue_responsible,CASE WHEN p_assessment='UNVERIFIED' THEN p_actor ELSE v_init.owner_id END);
  IF NOT (v_target=ANY(ARRAY[v_init.owner_id,v_init.secretary_id,p_actor]) OR EXISTS(
   SELECT 1 FROM public.milestones m JOIN public.results r ON r.id=m.result_id WHERE r.initiative_id=p_initiative AND m.owner_id=v_target
  )) THEN RAISE EXCEPTION 'UNAUTHORIZED_ACTION_OWNER';END IF;
 END IF;
 SELECT id INTO v_id FROM public.kmsa_flow_checks WHERE initiative_id=p_initiative AND actor_id=p_actor AND request_key=p_request_key;
 IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'alreadySaved',true,'checkId',v_id);END IF;
 INSERT INTO public.kmsa_flow_checks(initiative_id,actor_id,actor_kind,request_key,assessment,channel,note,next_review_at,milestone_ids,created_at)
 VALUES(p_initiative,p_actor,p_kind,p_request_key,p_assessment,p_channel,trim(p_note),p_review_at,
  coalesce(p_milestone_ids,ARRAY[]::uuid[]),v_now) RETURNING id INTO v_id;
 IF p_assessment IN('SLOW','NO_WORK','BLOCKED','UNVERIFIED') THEN
  -- Keep one open follow-up per responsible person/station group. Repeated Telegram check-ins don't create copies.
  SELECT i.id INTO v_issue FROM public.kmsa_flow_issues i WHERE i.initiative_id=p_initiative
   AND i.status='OPEN' AND i.responsible_id=v_target
   AND i.milestone_id IS NOT DISTINCT FROM CASE WHEN cardinality(p_milestone_ids)=1 THEN p_milestone_ids[1] ELSE NULL END
   ORDER BY i.created_at DESC LIMIT 1;
  IF v_issue IS NULL THEN
   INSERT INTO public.kmsa_flow_issues(initiative_id,milestone_id,opened_by,request_key,responsible_id,description,due_at,check_id)
   VALUES(p_initiative,CASE WHEN cardinality(p_milestone_ids)=1 THEN p_milestone_ids[1] ELSE NULL END,
    p_actor,p_request_key,v_target,trim(p_issue_text),p_issue_due,v_id) RETURNING id INTO v_issue;
  END IF;
 END IF;
 -- A Flow check is the progress evaluation. Sync the selected latest updates into the
 -- legacy review ledger to prevent the old 48h evaluator from demanding the same review again.
 -- Do NOT mark a READY_FOR_VERIFICATION result approved here: that remains a separate decision.
 IF p_assessment<>'WAITING_EXTERNAL' THEN
  v_kind:=CASE WHEN p_assessment='ON_TRACK' THEN 'PROGRESS_OK'
   WHEN p_assessment IN('SLOW','NO_WORK','BLOCKED') THEN 'PROGRESS_FOLLOW_UP'
   ELSE 'PROGRESS_UNCLEAR' END;
  FOR v_ms IN SELECT unnest(coalesce(p_milestone_ids,ARRAY[]::uuid[])) LOOP
   SELECT m.status INTO v_status FROM public.milestones m WHERE m.id=v_ms;
   IF v_status NOT IN ('IN_PROGRESS','AT_RISK','BLOCKED') THEN CONTINUE;END IF;
   SELECT a.id INTO v_source FROM public.project_activity_entries a WHERE a.milestone_id=v_ms AND a.kind='MILESTONE_UPDATE'
    ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
   IF v_source IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.milestone_supervision_events e WHERE e.source_activity_id=v_source
     AND e.event_type IN('PROGRESS_OK','PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_OK','RESULT_REVISION')
   ) THEN
    INSERT INTO public.milestone_supervision_events(initiative_id,milestone_id,actor_id,event_type,source_activity_id,note,correction_due_at)
     VALUES(p_initiative,v_ms,p_actor,v_kind,v_source,trim(p_note),
      CASE WHEN v_kind IN('PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR') THEN p_issue_due ELSE NULL END);
   END IF;
  END LOOP;
 END IF;
 -- Honor v6.5 notification clock as well: no double penalty after saving a Flow check.
 IF to_regclass('public.project_supervision_schedule') IS NOT NULL THEN
  UPDATE public.project_supervision_schedule SET last_checked_at=v_now,next_due_at=v_now+interval '12 hours',updated_at=v_now
  WHERE initiative_id=p_initiative AND supervisor_id=p_actor
  AND (cardinality(v_required)=0 OR v_required <@ p_milestone_ids);
 END IF;
 INSERT INTO public.audit_log(actor_id,action,entity_type,entity_id,meta)
 VALUES(p_actor,'KMSA_FLOW_CHECK_V71','INITIATIVE',p_initiative,jsonb_build_object('check_id',v_id,'scope',p_milestone_ids,'assessment',p_assessment,'followup_issue_id',v_issue));
 RETURN jsonb_build_object('ok',true,'checkId',v_id,'issueId',v_issue);
END $$;
REVOKE ALL ON FUNCTION public.kmsa_flow_record_check_v71(uuid,uuid,text,uuid,text,text,text,timestamptz,uuid[],text,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_flow_record_check_v71(uuid,uuid,text,uuid,text,text,text,timestamptz,uuid[],text,timestamptz,uuid) TO service_role;
-- Updating a batch retains each selected station's own note and next step.
CREATE OR REPLACE FUNCTION public.kmsa_flow_batch_progress(
 p_initiative uuid,p_author uuid,p_request_key uuid,p_note text,p_next_step text,p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_i public.initiatives%ROWTYPE;v_m public.milestones%ROWTYPE;v_item jsonb;
 v_result uuid;v_status text;v_outcome text;v_count integer;v_done integer;
 v_batch uuid;v_saved jsonb:='[]'::jsonb;v_summary text:=trim(COALESCE(p_note,''));
 v_next text:=trim(COALESCE(p_next_step,''));v_station_note text;v_station_next text;v_time timestamptz:=now();v_seen uuid[]:=ARRAY[]::uuid[];v_paused boolean:=false;
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


-- A final RESULT_OK/RESULT_REVISION is a real supervisory verification. Do not demand
-- another "I checked" entry immediately after the same review was submitted.
CREATE OR REPLACE FUNCTION public.kmsa_flow_accept_result_as_check() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project public.initiatives%ROWTYPE;v_delegate uuid;v_scope uuid[];v_is_paused boolean;
BEGIN
 IF NEW.event_type NOT IN ('RESULT_OK','RESULT_REVISION') THEN RETURN NEW;END IF;
 SELECT * INTO v_project FROM public.initiatives WHERE id=NEW.initiative_id;
 IF NOT FOUND OR v_project.status IN('COMPLETED','CANCELLED') OR v_project.setup_status<>'ACTIVE' THEN RETURN NEW;END IF;
 SELECT supervisor_id INTO v_delegate FROM public.project_supervision_assignments WHERE initiative_id=NEW.initiative_id;
 IF NEW.actor_id IS DISTINCT FROM COALESCE(v_delegate,v_project.secretary_id) THEN RETURN NEW;END IF;
 IF to_regclass('public.project_execution_pauses') IS NOT NULL THEN
  SELECT EXISTS (SELECT 1 FROM public.project_execution_pauses WHERE initiative_id=NEW.initiative_id
   AND status='APPROVED' AND pause_until_date>=(now() AT TIME ZONE 'Africa/Khartoum')::date) INTO v_is_paused;
  IF v_is_paused THEN RETURN NEW;END IF;
 END IF;
 INSERT INTO public.kmsa_flow_checks(initiative_id,actor_id,actor_kind,request_key,assessment,channel,note,milestone_ids,created_at)
 VALUES(NEW.initiative_id,NEW.actor_id,CASE WHEN v_delegate IS NOT NULL AND v_delegate=NEW.actor_id
  AND NEW.actor_id<>v_project.secretary_id THEN 'DELEGATE' ELSE 'SECRETARY_DIRECT' END,
  NEW.id,CASE WHEN NEW.event_type='RESULT_OK' THEN 'ON_TRACK' ELSE 'SLOW' END,'OUTPUT',
  coalesce(nullif(trim(NEW.note),''),CASE WHEN NEW.event_type='RESULT_OK' THEN 'تم تقييم النتيجة وقبولها' ELSE 'النتيجة تحتاج مراجعة' END),
  ARRAY[NEW.milestone_id],NEW.created_at)
 ON CONFLICT(initiative_id,actor_id,request_key) DO NOTHING;
 -- Count the result review for the old supervisor clock if it covers all currently active stages.
 WITH current_stages AS (
  SELECT m.id FROM public.milestones m JOIN public.results r ON r.id=m.result_id
  WHERE r.initiative_id=NEW.initiative_id AND m.design_status<>'REJECTED'
    AND m.status IN('IN_PROGRESS','AT_RISK','BLOCKED','READY_FOR_VERIFICATION')
 ) SELECT array_agg(id) INTO v_scope FROM current_stages;
 IF v_scope IS NOT NULL AND v_scope<@ARRAY[NEW.milestone_id] THEN
  UPDATE public.project_supervision_schedule SET last_checked_at=NEW.created_at,
   next_due_at=NEW.created_at+interval '12 hours',updated_at=now()
   WHERE initiative_id=NEW.initiative_id AND supervisor_id=NEW.actor_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_flow_accept_result_as_check() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS kmsa_flow_v71_result_counts_as_check ON public.milestone_supervision_events;
CREATE TRIGGER kmsa_flow_v71_result_counts_as_check AFTER INSERT ON public.milestone_supervision_events
 FOR EACH ROW EXECUTE FUNCTION public.kmsa_flow_accept_result_as_check();

CREATE OR REPLACE FUNCTION public.kmsa_flow_adjust_pause_obligations() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_unused integer;
BEGIN
 IF OLD.status='PENDING' AND NEW.status='APPROVED' THEN
  UPDATE public.kmsa_flow_baselines SET started_at=
    (((NEW.pause_until_date+1)::timestamp + interval '9 hours') AT TIME ZONE 'Africa/Khartoum')
    WHERE initiative_id=NEW.initiative_id;
  UPDATE public.kmsa_flow_issues SET due_at=due_at+make_interval(days=>NEW.applied_days)
   WHERE initiative_id=NEW.initiative_id AND status='OPEN' AND due_at IS NOT NULL;
  UPDATE public.kmsa_flow_checks SET next_review_at=next_review_at+make_interval(days=>NEW.applied_days)
   WHERE initiative_id=NEW.initiative_id AND next_review_at IS NOT NULL AND next_review_at>=NEW.decided_at;
 ELSIF OLD.status='APPROVED' AND NEW.status='ENDED' THEN
  UPDATE public.kmsa_flow_baselines SET started_at=now() WHERE initiative_id=NEW.initiative_id;
  v_unused:=greatest(0,OLD.applied_days-NEW.applied_days);
  UPDATE public.kmsa_flow_issues SET due_at=due_at-make_interval(days=>v_unused)
   WHERE initiative_id=NEW.initiative_id AND status='OPEN' AND due_at IS NOT NULL;
  UPDATE public.kmsa_flow_checks SET next_review_at=next_review_at-make_interval(days=>v_unused)
   WHERE initiative_id=NEW.initiative_id AND next_review_at IS NOT NULL AND next_review_at>=now();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_flow_adjust_pause_obligations() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS kmsa_flow_v71_pause_due ON public.project_execution_pauses;
CREATE TRIGGER kmsa_flow_v71_pause_due AFTER UPDATE OF status ON public.project_execution_pauses
 FOR EACH ROW EXECUTE FUNCTION public.kmsa_flow_adjust_pause_obligations();

COMMIT;
