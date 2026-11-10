-- KMSA Projects v7.2 — additive upgrade above v7.1. NEVER rerun/destructively edit older migrations.
-- Backup production data; run in Supabase SQL editor before deploying updated Edge Functions.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.kmsa_flow_checks') IS NULL OR to_regclass('public.project_supervision_schedule') IS NULL
  OR to_regclass('public.milestone_deadline_requests') IS NULL THEN
  RAISE EXCEPTION 'KMSA_V72_REQUIRES_ALL_V71_MIGRATIONS'; END IF;
END $$;

-- Align the first duty of a future-dated project with its true start.
CREATE OR REPLACE FUNCTION public.kmsa_flow_start_baseline() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.approval_status='APPROVED' AND NEW.setup_status='ACTIVE'
 AND NEW.status NOT IN ('COMPLETED','CANCELLED') AND COALESCE(NEW.lifecycle_state,'ACTIVE')='ACTIVE' THEN
  INSERT INTO public.kmsa_flow_baselines(initiative_id,started_at) VALUES(NEW.id,greatest(now(),COALESCE(NEW.assignment_start_at,now()))) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.kmsa_flow_record_check_v71(
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
 OR p_channel NOT IN('TELEGRAM','OUTPUT','OTHER') OR (p_assessment<>'ON_TRACK' AND length(trim(COALESCE(p_note,'')))<6) THEN
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
 OR (v_earliest IS NOT NULL AND v_earliest<=v_now AND p_review_at>v_now+interval '24 hours')) THEN
  RAISE EXCEPTION 'EXTERNAL_REVIEW_MAX_7_DAYS_AND_BEFORE_DEADLINE';END IF;
 -- An ON_TRACK confirmation may be concise only when current outputs exist for every checked stage.
 IF p_assessment='ON_TRACK' AND length(trim(COALESCE(p_note,'')))<6 AND
 (p_channel<>'OUTPUT' OR EXISTS (
   SELECT 1 FROM unnest(COALESCE(p_milestone_ids,ARRAY[]::uuid[])) checked(id)
   WHERE NOT EXISTS (SELECT 1 FROM public.project_activity_entries a
    WHERE a.milestone_id=checked.id AND a.kind='MILESTONE_UPDATE'
    AND a.created_at>=v_now-interval '7 days'
   )
 )) THEN RAISE EXCEPTION 'ON_TRACK_NEEDS_RECENT_OUTPUT_OR_SHORT_NOTE'; END IF;
 IF p_assessment IN('SLOW','NO_WORK','BLOCKED','UNVERIFIED') AND NULLIF(trim(COALESCE(p_issue_text,'')),'') IS NOT NULL THEN
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
 VALUES(p_initiative,p_actor,p_kind,p_request_key,p_assessment,p_channel,NULLIF(trim(COALESCE(p_note,'')),''),p_review_at,
  coalesce(p_milestone_ids,ARRAY[]::uuid[]),v_now) RETURNING id INTO v_id;
 IF p_assessment IN('SLOW','NO_WORK','BLOCKED','UNVERIFIED') AND NULLIF(trim(COALESCE(p_issue_text,'')),'') IS NOT NULL THEN
  -- Explicit issue requests are unique by their idempotency key, not by person/station.
  SELECT i.id INTO v_issue FROM public.kmsa_flow_issues i WHERE i.initiative_id=p_initiative
   AND i.opened_by=p_actor AND i.request_key=p_request_key LIMIT 1;
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
  UPDATE public.project_supervision_schedule SET last_checked_at=v_now,next_due_at=v_now+interval '24 hours',updated_at=v_now
  WHERE initiative_id=p_initiative AND supervisor_id=p_actor
  AND (cardinality(v_required)=0 OR NOT EXISTS (
   SELECT 1 FROM unnest(v_required) AS required(stage_id)
   WHERE NOT EXISTS (
    SELECT 1 FROM public.kmsa_flow_checks c
    WHERE c.initiative_id=p_initiative AND c.actor_id=p_actor
     AND c.created_at > GREATEST(COALESCE(public.project_supervision_schedule.last_checked_at,'-infinity'::timestamptz),v_now-interval '24 hours')
     AND required.stage_id=ANY(c.milestone_ids)
   )
  ));
 END IF;
 INSERT INTO public.audit_log(actor_id,action,entity_type,entity_id,meta)
 VALUES(p_actor,'KMSA_FLOW_CHECK_V71','INITIATIVE',p_initiative,jsonb_build_object('check_id',v_id,'scope',p_milestone_ids,'assessment',p_assessment,'followup_issue_id',v_issue));
 RETURN jsonb_build_object('ok',true,'checkId',v_id,'issueId',v_issue);
END $$;
CREATE OR REPLACE FUNCTION public.kmsa_flow_accept_result_as_check() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project public.initiatives%ROWTYPE;v_delegate uuid;v_scope uuid[];v_is_paused boolean;
BEGIN
 IF NEW.event_type NOT IN ('RESULT_OK','RESULT_REVISION') THEN RETURN NEW;END IF;
 SELECT * INTO v_project FROM public.initiatives WHERE id=NEW.initiative_id;
 IF NOT FOUND OR v_project.status IN('COMPLETED','CANCELLED') OR v_project.setup_status<>'ACTIVE' THEN RETURN NEW;END IF;
 SELECT supervisor_id INTO v_delegate FROM public.project_supervision_assignments WHERE initiative_id=NEW.initiative_id;
 IF NEW.actor_id IS DISTINCT FROM COALESCE(v_delegate,
   (SELECT s.supervisor_id FROM public.project_supervision_schedule s WHERE s.initiative_id=NEW.initiative_id),v_project.secretary_id)
 THEN RETURN NEW;END IF;
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
 IF v_scope IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM unnest(v_scope) AS required(stage_id)
  WHERE required.stage_id<>NEW.milestone_id AND NOT EXISTS (
   SELECT 1 FROM public.kmsa_flow_checks c WHERE c.initiative_id=NEW.initiative_id
   AND c.actor_id=NEW.actor_id AND c.created_at>coalesce((SELECT last_checked_at FROM public.project_supervision_schedule WHERE initiative_id=NEW.initiative_id),NEW.created_at-interval '24 hours')
   AND c.created_at>=NEW.created_at-interval '24 hours' AND required.stage_id=ANY(c.milestone_ids)
  )
 ) THEN
  UPDATE public.project_supervision_schedule SET last_checked_at=NEW.created_at,
   next_due_at=NEW.created_at+interval '24 hours',updated_at=now()
   WHERE initiative_id=NEW.initiative_id AND supervisor_id=NEW.actor_id;
 END IF;
 RETURN NEW;
END $$;

-- Secretary-executed projects must never have secretary as their own reviewer.
UPDATE public.project_supervision_schedule ss SET supervisor_id=gs.id,anchor_at=now(),
 next_due_at=now()+interval '24 hours',last_checked_at=NULL,updated_at=now()
 FROM public.initiatives i
 JOIN LATERAL (SELECT id FROM public.profiles WHERE role='GS' AND active=true ORDER BY id LIMIT 1) gs ON true
 WHERE ss.initiative_id=i.id AND i.owner_id=i.secretary_id AND ss.supervisor_id=i.secretary_id
 AND NOT EXISTS(SELECT 1 FROM public.project_supervision_assignments d WHERE d.initiative_id=i.id);

-- New cadence starts at rollout; no retroactive 12h supervisor penalties.
UPDATE public.kmsa_flow_baselines b SET started_at=GREATEST(b.started_at,i.assignment_start_at)
 FROM public.initiatives i WHERE b.initiative_id=i.id AND i.assignment_start_at IS NOT NULL
 AND b.started_at < i.assignment_start_at;
UPDATE public.project_supervision_schedule SET
 next_due_at=GREATEST(now(), COALESCE(last_checked_at,anchor_at,now()))+interval '24 hours',updated_at=now()
 WHERE next_due_at IS NOT NULL;

-- A milestone deadline may have only one pending request; legacy duplicates must be resolved
-- by the secretary before using this stricter constraint. No silent deletion of existing requests.
-- Requests use an advisory transaction lock in the new deadline RPC; existing pending rows are retained.


CREATE OR REPLACE FUNCTION public.kmsa_v65_ensure_supervision(p_initiative uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_supervisor uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.initiatives WHERE id=p_initiative AND setup_status='ACTIVE' AND approval_status='APPROVED' AND status NOT IN ('COMPLETED','CANCELLED') AND coalesce(lifecycle_state,'ACTIVE')='ACTIVE') THEN RETURN; END IF;
 SELECT coalesce((SELECT a.supervisor_id FROM public.project_supervision_assignments a WHERE a.initiative_id=p_initiative),
  CASE WHEN i.owner_id=i.secretary_id THEN (SELECT gp.id FROM public.profiles gp WHERE gp.role='GS' AND gp.active=true ORDER BY gp.id LIMIT 1)
  ELSE i.secretary_id END)
 INTO v_supervisor FROM public.initiatives i WHERE i.id=p_initiative;
 IF v_supervisor IS NULL THEN RETURN; END IF;
 INSERT INTO public.project_supervision_schedule(initiative_id,supervisor_id,anchor_at,next_due_at)
 VALUES(p_initiative,v_supervisor,now(),greatest(now(),coalesce((SELECT assignment_start_at FROM public.initiatives WHERE id=p_initiative),now()))+interval '24 hours')
 ON CONFLICT(initiative_id) DO UPDATE SET supervisor_id=excluded.supervisor_id,anchor_at=now(),next_due_at=greatest(now(),coalesce((SELECT assignment_start_at FROM public.initiatives WHERE id=p_initiative),now()))+interval '24 hours',last_checked_at=NULL,updated_at=now()
 WHERE public.project_supervision_schedule.supervisor_id IS DISTINCT FROM excluded.supervisor_id;
END $$;

CREATE OR REPLACE FUNCTION public.kmsa_v65_register_check(p_project uuid,p_supervisor uuid,p_checked_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.project_supervision_schedule%ROWTYPE;
BEGIN
 SELECT * INTO v FROM public.project_supervision_schedule WHERE initiative_id=p_project FOR UPDATE;
 IF NOT FOUND OR v.supervisor_id<>p_supervisor THEN RAISE EXCEPTION 'SUPERVISION_ASSIGNMENT_CHANGED'; END IF;
 UPDATE public.project_supervision_schedule SET last_checked_at=p_checked_at,
 next_due_at=CASE WHEN p_checked_at>=v.next_due_at-interval '3 hours'
 THEN v.next_due_at+interval '24 hours' * (greatest(0,floor(extract(epoch FROM (p_checked_at-v.next_due_at))/86400)::integer)+1)
 ELSE v.next_due_at END,updated_at=now() WHERE initiative_id=p_project;
END $$;

CREATE OR REPLACE FUNCTION public.kmsa_v65_decide_pause(p_id uuid,p_actor uuid,p_accept boolean,p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.project_execution_pauses%ROWTYPE; v_days integer; v_restart timestamptz;
BEGIN
 SELECT * INTO v FROM public.project_execution_pauses WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v.status<>'PENDING' THEN RAISE EXCEPTION 'PAUSE_NOT_PENDING'; END IF;
 IF EXISTS(SELECT 1 FROM public.project_execution_pauses WHERE initiative_id=v.initiative_id AND status='APPROVED' AND pause_until_date >= (now() at time zone 'Africa/Khartoum')::date) THEN RAISE EXCEPTION 'PROJECT_ALREADY_PAUSED'; END IF;
 IF NOT p_accept THEN UPDATE public.project_execution_pauses SET status='REJECTED',decided_by=p_actor,decided_at=now(),decision_note=p_note WHERE id=p_id;RETURN; END IF;
 v_days:=v.pause_until_date-(now() at time zone 'Africa/Khartoum')::date+1;
 IF v_days<1 OR v_days>30 THEN RAISE EXCEPTION 'PAUSE_MUST_BE_1_TO_30_DAYS'; END IF;
 v_restart:=((v.pause_until_date+1)::timestamp + interval '9 hours') AT TIME ZONE 'Africa/Khartoum';
 UPDATE public.project_execution_pauses SET status='APPROVED',decided_by=p_actor,decided_at=now(),decision_note=p_note,applied_days=v_days WHERE id=p_id;
 UPDATE public.milestones m SET due_at=m.due_at+make_interval(days=>v_days) FROM public.results r WHERE m.result_id=r.id AND r.initiative_id=v.initiative_id AND m.design_status<>'REJECTED' AND m.status NOT IN ('VERIFIED','CANCELLED','READY_FOR_VERIFICATION');
 UPDATE public.initiatives SET target_due_at=target_due_at+make_interval(days=>v_days) WHERE id=v.initiative_id AND target_due_at IS NOT NULL;
 UPDATE public.milestone_followup_schedules SET next_due_at=v_restart+interval '24 hours',anchor_at=v_restart,updated_at=now() WHERE initiative_id=v.initiative_id;
 UPDATE public.project_supervision_schedule SET next_due_at=v_restart+interval '24 hours',anchor_at=v_restart,updated_at=now() WHERE initiative_id=v.initiative_id;
END $$;

CREATE OR REPLACE FUNCTION public.kmsa_v65_end_pause(p_id uuid,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.project_execution_pauses%ROWTYPE; v_unused integer;
BEGIN
 SELECT * INTO v FROM public.project_execution_pauses WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v.status<>'APPROVED' THEN RAISE EXCEPTION 'NOT_PAUSED'; END IF;
 v_unused:=greatest(0,v.pause_until_date-(now() at time zone 'Africa/Khartoum')::date+1);
 UPDATE public.milestones m SET due_at=m.due_at-make_interval(days=>v_unused) FROM public.results r WHERE m.result_id=r.id AND r.initiative_id=v.initiative_id AND m.design_status<>'REJECTED' AND m.status NOT IN ('VERIFIED','CANCELLED','READY_FOR_VERIFICATION');
 UPDATE public.initiatives SET target_due_at=target_due_at-make_interval(days=>v_unused) WHERE id=v.initiative_id AND target_due_at IS NOT NULL;
 UPDATE public.project_execution_pauses SET status='ENDED',ended_at=now(),applied_days=applied_days-v_unused WHERE id=p_id;
 UPDATE public.milestone_followup_schedules SET next_due_at=now()+interval '24 hours',anchor_at=now(),updated_at=now() WHERE initiative_id=v.initiative_id;
 UPDATE public.project_supervision_schedule SET next_due_at=now()+interval '24 hours',anchor_at=now(),updated_at=now() WHERE initiative_id=v.initiative_id;
END $$;

-- Resuming a postponed project starts fresh project-level obligations, without deleting past checks.
CREATE OR REPLACE FUNCTION public.kmsa_v72_restart_flow_clocks(p_initiative uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.initiatives%ROWTYPE;v_start timestamptz;v_supervisor uuid;
BEGIN
 SELECT * INTO v FROM public.initiatives WHERE id=p_initiative FOR UPDATE;
 IF NOT FOUND OR v.lifecycle_state<>'ACTIVE' OR v.status IN('COMPLETED','CANCELLED') THEN
  RAISE EXCEPTION 'PROJECT_NOT_READY_TO_RESUME';END IF;
 v_start:=greatest(now(),coalesce(v.assignment_start_at,now()));
 INSERT INTO public.kmsa_flow_baselines(initiative_id,started_at) VALUES(v.id,v_start)
 ON CONFLICT(initiative_id) DO UPDATE SET started_at=excluded.started_at;
 SELECT coalesce((SELECT supervisor_id FROM public.project_supervision_assignments WHERE initiative_id=v.id),
  CASE WHEN v.owner_id=v.secretary_id THEN (SELECT id FROM public.profiles WHERE role='GS' AND active=true ORDER BY id LIMIT 1)
  ELSE v.secretary_id END) INTO v_supervisor;
 IF v_supervisor IS NOT NULL THEN
  INSERT INTO public.project_supervision_schedule(initiative_id,supervisor_id,anchor_at,next_due_at,last_checked_at,updated_at)
   VALUES(v.id,v_supervisor,v_start,v_start+interval '24 hours',NULL,now())
  ON CONFLICT(initiative_id) DO UPDATE SET supervisor_id=excluded.supervisor_id,
   anchor_at=v_start,next_due_at=v_start+interval '24 hours',last_checked_at=NULL,updated_at=now();
 END IF;
 UPDATE public.milestone_followup_schedules SET anchor_at=v_start,
  next_due_at=v_start+interval '24 hours',updated_at=now() WHERE initiative_id=v.id;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_v72_restart_flow_clocks(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_v72_restart_flow_clocks(uuid) TO service_role;

-- One transaction updates request, milestone, dependent relative dates, and history.
-- Called exclusively by the service-role workflow after checking authorisation.
CREATE OR REPLACE FUNCTION public.kmsa_v72_decide_milestone_deadline(
 p_request uuid,p_actor uuid,p_approve boolean,p_note text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_request public.milestone_deadline_requests%ROWTYPE;
 v_m public.milestones%ROWTYPE;v_project public.initiatives%ROWTYPE;
 v_anchor timestamptz;v_diff numeric;v_rel_days integer;v_rel_hours integer;
 v_child record;v_count integer:=0;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'ACTOR_REQUIRED';END IF;
 SELECT * INTO v_request FROM public.milestone_deadline_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR v_request.status<>'PENDING' THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING';END IF;
 SELECT * INTO v_m FROM public.milestones WHERE id=v_request.milestone_id FOR UPDATE;
 IF NOT FOUND OR v_m.due_at IS DISTINCT FROM v_request.original_due_at THEN
  RAISE EXCEPTION 'DEADLINE_REQUEST_STALE_REVIEW_AGAIN';END IF;
 SELECT i.* INTO v_project FROM public.initiatives i JOIN public.results r ON r.initiative_id=i.id
  WHERE r.id=v_m.result_id FOR UPDATE OF i;
 IF NOT FOUND OR v_request.initiative_id<>v_project.id THEN RAISE EXCEPTION 'PROJECT_SCOPE_MISMATCH';END IF;
 IF v_project.setup_status<>'ACTIVE' OR v_project.status IN('COMPLETED','CANCELLED') OR v_project.lifecycle_state='POSTPONED'
  OR v_m.status IN ('READY_FOR_VERIFICATION','VERIFIED','CANCELLED') THEN RAISE EXCEPTION 'MILESTONE_NOT_EDITABLE';END IF;
 IF p_approve THEN
  IF v_project.target_due_at IS NOT NULL AND v_request.proposed_due_at>v_project.target_due_at
   THEN RAISE EXCEPTION 'EXCEEDS_PROJECT_DEADLINE';END IF;
  IF v_m.deadline_mode='RELATIVE' THEN
   SELECT coalesce(completed_reported_at,due_at) INTO v_anchor FROM public.milestones WHERE id=v_m.relative_to_milestone_id FOR UPDATE;
   IF v_anchor IS NULL THEN RAISE EXCEPTION 'RELATIVE_PARENT_MISSING';END IF;
   v_diff:=extract(epoch FROM (v_request.proposed_due_at-v_anchor));
   IF v_diff<0 OR mod(v_diff,3600)<>0 THEN RAISE EXCEPTION 'RELATIVE_DEADLINE_REQUIRES_WHOLE_HOUR_OFFSET';END IF;
   v_rel_days:=floor(v_diff/86400)::integer;v_rel_hours:=(mod(v_diff/3600,24))::integer;
  END IF;
  -- Compute the transitive impact before changing anything; all child deadlines remain relative.
  IF EXISTS (
   WITH RECURSIVE changed(id,due_at) AS (
    SELECT v_m.id,v_request.proposed_due_at
    UNION ALL
    SELECT c.id,changed.due_at+make_interval(days=>coalesce(c.relative_days,0),hours=>coalesce(c.relative_hours,0))
    FROM public.milestones c JOIN changed ON c.relative_to_milestone_id=changed.id
    WHERE c.deadline_mode='RELATIVE' AND c.status NOT IN('VERIFIED','CANCELLED')
   ) SELECT 1 FROM changed WHERE v_project.target_due_at IS NOT NULL AND due_at>v_project.target_due_at
  ) THEN RAISE EXCEPTION 'DEPENDENT_MILESTONE_EXCEEDS_PROJECT_DEADLINE';END IF;
  UPDATE public.milestones SET due_at=v_request.proposed_due_at,
   relative_days=CASE WHEN deadline_mode='RELATIVE' THEN v_rel_days ELSE relative_days END,
   relative_hours=CASE WHEN deadline_mode='RELATIVE' THEN v_rel_hours ELSE relative_hours END,
   status_updated_at=now() WHERE id=v_m.id;
  FOR v_child IN WITH RECURSIVE descendants(id,due_at,depth) AS (
    SELECT c.id,v_request.proposed_due_at+make_interval(days=>coalesce(c.relative_days,0),hours=>coalesce(c.relative_hours,0)),1
    FROM public.milestones c WHERE c.relative_to_milestone_id=v_m.id AND c.deadline_mode='RELATIVE' AND c.status NOT IN('VERIFIED','CANCELLED')
    UNION ALL
    SELECT c.id,d.due_at+make_interval(days=>coalesce(c.relative_days,0),hours=>coalesce(c.relative_hours,0)),d.depth+1
    FROM public.milestones c JOIN descendants d ON c.relative_to_milestone_id=d.id
    WHERE c.deadline_mode='RELATIVE' AND c.status NOT IN('VERIFIED','CANCELLED') AND d.depth<40
   ) SELECT * FROM descendants ORDER BY depth LOOP
   UPDATE public.milestones SET due_at=v_child.due_at,status_updated_at=now() WHERE id=v_child.id;
   v_count:=v_count+1;
  END LOOP;
 END IF;
 UPDATE public.milestone_deadline_requests SET status=CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
  decided_by=p_actor,decided_at=now(),decision_note=NULLIF(trim(p_note),'') WHERE id=v_request.id;
 INSERT INTO public.audit_log(actor_id,action,entity_type,entity_id,meta)
 VALUES(p_actor,'KMSA_V72_MILESTONE_DEADLINE_DECISION','MILESTONE',v_m.id,
  jsonb_build_object('request_id',v_request.id,'original_due_at',v_request.original_due_at,
  'proposed_due_at',v_request.proposed_due_at,'approved',p_approve,'dependent_count',v_count));
 RETURN jsonb_build_object('ok',true,'approved',p_approve,'milestoneId',v_m.id,'dependentsUpdated',v_count);
END $$;
REVOKE ALL ON FUNCTION public.kmsa_v72_decide_milestone_deadline(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_v72_decide_milestone_deadline(uuid,uuid,boolean,text) TO service_role;

COMMIT;
