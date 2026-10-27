-- v6.5: one 24-hour responsible report per active station, one 12-hour supervisor verification per PROJECT.
-- A Telegram conversation is not stored; the supervisor records a concise verifiable finding.
BEGIN;
ALTER TABLE public.milestone_followup_schedules ALTER COLUMN interval_hours SET DEFAULT 24;
CREATE TABLE public.project_supervision_schedule (
 initiative_id uuid PRIMARY KEY REFERENCES public.initiatives(id) ON DELETE CASCADE,
 supervisor_id uuid NOT NULL REFERENCES public.profiles(id),
 anchor_at timestamptz NOT NULL DEFAULT now(),
 next_due_at timestamptz NOT NULL DEFAULT (now()+interval '12 hours'),
 last_checked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.project_supervision_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE CASCADE,
 supervisor_id uuid NOT NULL REFERENCES public.profiles(id),
 finding text NOT NULL CHECK(finding IN ('ON_TRACK','SLOW','NO_WORK','BLOCKED','UNVERIFIED')),
 verification_method text NOT NULL CHECK(verification_method IN ('TELEGRAM','OUTPUT','OTHER')),
 note text NOT NULL CHECK(length(trim(note))>=8),
 next_step text,
 followup_due_at timestamptz,
 milestone_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((finding='ON_TRACK') OR (next_step IS NOT NULL AND length(trim(next_step))>=5 AND followup_due_at IS NOT NULL))
);
CREATE INDEX kmsa_v65_checks_latest ON public.project_supervision_checks(initiative_id,created_at DESC);
CREATE TABLE public.project_supervision_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE CASCADE,
 source_check_id uuid NOT NULL REFERENCES public.project_supervision_checks(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED','REOPENED')),
 assigned_to uuid REFERENCES public.profiles(id),
 requirement text NOT NULL,
 due_at timestamptz NOT NULL,
 resolved_at timestamptz,
 resolved_by uuid REFERENCES public.profiles(id),
 resolution_note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX kmsa_v65_one_action_per_check ON public.project_supervision_actions(source_check_id);
CREATE TABLE public.project_supervision_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE CASCADE,
 requested_by uuid NOT NULL REFERENCES public.profiles(id),
 supervisor_id uuid NOT NULL REFERENCES public.profiles(id),
 due_at timestamptz NOT NULL,
 note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kmsa_v65_requests_last ON public.project_supervision_requests(initiative_id,created_at DESC);
CREATE TABLE public.project_execution_pauses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE CASCADE,
 requested_by uuid NOT NULL REFERENCES public.profiles(id),
 category text NOT NULL CHECK(category IN ('EXAMS','PRIORITY','OTHER')),
 explanation text NOT NULL CHECK(length(trim(explanation))>=12),
 pause_until_date date NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','ENDED')),
 decided_by uuid REFERENCES public.profiles(id),
 decided_at timestamptz,
 decision_note text,
 applied_days integer NOT NULL DEFAULT 0,
 ended_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX kmsa_v65_one_pending_pause ON public.project_execution_pauses(initiative_id) WHERE status='PENDING';
CREATE INDEX kmsa_v65_pause_latest ON public.project_execution_pauses(initiative_id,created_at DESC);

-- RLS: authenticated read only where the initiative itself is visible.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['project_supervision_schedule','project_supervision_checks','project_supervision_actions','project_supervision_requests','project_execution_pauses'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_read_initiative(initiative_id))','kmsa_v65_read_'||t,t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM PUBLIC, anon, authenticated',t);
 END LOOP;
END $$;

-- Set a fixed cadence for all existing ACTIVE milestone schedules, with a fresh start.
UPDATE public.milestone_followup_schedules f SET interval_hours=24,next_due_at=now()+interval '24 hours',anchor_at=now(),updated_at=now()
WHERE EXISTS (SELECT 1 FROM public.initiatives i WHERE i.id=f.initiative_id AND i.approval_status='APPROVED' AND i.setup_status='ACTIVE' AND i.status NOT IN ('COMPLETED','CANCELLED'));

CREATE OR REPLACE FUNCTION public.kmsa_v64_ensure_followup(p_initiative uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.initiatives i WHERE id=p_initiative AND setup_status='ACTIVE' AND approval_status='APPROVED' AND status NOT IN('COMPLETED','CANCELLED') AND coalesce(lifecycle_state,'ACTIVE')='ACTIVE') THEN RETURN; END IF;
 INSERT INTO public.milestone_followup_schedules(milestone_id,initiative_id,anchor_at,interval_hours,next_due_at)
 SELECT m.id,i.id,now(),24,now()+interval '24 hours'
 FROM public.milestones m JOIN public.results r ON r.id=m.result_id JOIN public.initiatives i ON i.id=r.initiative_id
 WHERE i.id=p_initiative AND m.design_status<>'REJECTED' AND m.status NOT IN('READY_FOR_VERIFICATION','VERIFIED','CANCELLED') AND m.due_at IS NOT NULL
 AND (m.status IN ('IN_PROGRESS','AT_RISK','BLOCKED') OR (m.status='NOT_STARTED'
   AND NOT EXISTS (SELECT 1 FROM public.milestones mm JOIN public.results rr ON rr.id=mm.result_id WHERE rr.initiative_id=i.id AND mm.design_status<>'REJECTED' AND mm.status IN('IN_PROGRESS','AT_RISK','BLOCKED'))
   AND m.id=(SELECT mm.id FROM public.milestones mm JOIN public.results rr ON rr.id=mm.result_id WHERE rr.initiative_id=i.id AND mm.design_status<>'REJECTED' AND mm.status='NOT_STARTED' ORDER BY mm.due_at ASC NULLS LAST,mm.sequence_no,mm.id LIMIT 1)))
 ON CONFLICT(milestone_id) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.kmsa_v65_ensure_supervision(p_initiative uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_supervisor uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.initiatives WHERE id=p_initiative AND setup_status='ACTIVE' AND approval_status='APPROVED' AND status NOT IN ('COMPLETED','CANCELLED') AND coalesce(lifecycle_state,'ACTIVE')='ACTIVE') THEN RETURN; END IF;
 SELECT coalesce((SELECT a.supervisor_id FROM public.project_supervision_assignments a WHERE a.initiative_id=p_initiative),i.secretary_id)
 INTO v_supervisor FROM public.initiatives i WHERE i.id=p_initiative;
 IF v_supervisor IS NULL THEN RETURN; END IF;
 INSERT INTO public.project_supervision_schedule(initiative_id,supervisor_id,anchor_at,next_due_at)
 VALUES(p_initiative,v_supervisor,now(),now()+interval '12 hours')
 ON CONFLICT(initiative_id) DO UPDATE SET supervisor_id=excluded.supervisor_id,anchor_at=now(),next_due_at=now()+interval '12 hours',last_checked_at=NULL,updated_at=now()
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
 THEN v.next_due_at+interval '12 hours' * (greatest(0,floor(extract(epoch FROM (p_checked_at-v.next_due_at))/43200)::integer)+1)
 ELSE v.next_due_at END,updated_at=now() WHERE initiative_id=p_project;
END $$;

-- DB-atomic pause decision: do not produce overdue reports during exams and shift outstanding deadlines.
CREATE FUNCTION public.kmsa_v65_decide_pause(p_id uuid,p_actor uuid,p_accept boolean,p_note text DEFAULT '')
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
 UPDATE public.project_supervision_schedule SET next_due_at=v_restart+interval '12 hours',anchor_at=v_restart,updated_at=now() WHERE initiative_id=v.initiative_id;
END $$;

CREATE FUNCTION public.kmsa_v65_end_pause(p_id uuid,p_actor uuid)
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
 UPDATE public.project_supervision_schedule SET next_due_at=now()+interval '12 hours',anchor_at=now(),updated_at=now() WHERE initiative_id=v.initiative_id;
END $$;

REVOKE ALL ON FUNCTION public.kmsa_v65_ensure_supervision(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kmsa_v65_register_check(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kmsa_v65_decide_pause(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kmsa_v65_end_pause(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_v65_ensure_supervision(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.kmsa_v65_register_check(uuid,uuid,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.kmsa_v65_decide_pause(uuid,uuid,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kmsa_v65_end_pause(uuid,uuid) TO service_role;

-- Atomic save of a responsible person's milestone status, activity and next 24h checkpoint.
-- Prevents "saved, then error" caused by writing state and activity separately.
CREATE FUNCTION public.kmsa_v65_save_milestone_progress(
 p_milestone uuid,p_author uuid,p_status text,p_note text,p_outcome text,p_update_type text,p_next_step text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_row public.milestones%ROWTYPE; after_row public.milestones%ROWTYPE; project_id uuid; activity_id uuid; activity_time timestamptz;
BEGIN
 SELECT * INTO before_row FROM public.milestones WHERE id=p_milestone FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MILESTONE_NOT_FOUND'; END IF;
 SELECT initiative_id INTO project_id FROM public.results WHERE id=before_row.result_id;
 IF p_status NOT IN ('IN_PROGRESS','BLOCKED','READY_FOR_VERIFICATION') THEN RAISE EXCEPTION 'INVALID_PROGRESS_STATUS'; END IF;
 IF p_status<>'READY_FOR_VERIFICATION' AND (length(trim(coalesce(p_note,'')))<3 OR length(trim(coalesce(p_next_step,'')))<3) THEN RAISE EXCEPTION 'REPORT_AND_NEXT_STEP_REQUIRED'; END IF;
 IF p_status='READY_FOR_VERIFICATION' AND length(trim(coalesce(p_outcome,'')))<3 THEN RAISE EXCEPTION 'RESULT_DESCRIPTION_REQUIRED'; END IF;
 UPDATE public.milestones SET status=p_status::public.milestone_status,
 lead_note=coalesce(nullif(trim(p_note),''),lead_note),outcome_text=p_outcome,
 status_updated_at=now(),completed_reported_at=CASE WHEN p_status='READY_FOR_VERIFICATION' AND before_row.status<>'READY_FOR_VERIFICATION' THEN now() ELSE completed_reported_at END
 WHERE id=p_milestone RETURNING * INTO after_row;
 INSERT INTO public.project_activity_entries(initiative_id,milestone_id,author_id,kind,note,status_after,details)
 VALUES(project_id,p_milestone,p_author,'MILESTONE_UPDATE',nullif(trim(p_note),''),p_status,
 jsonb_build_object('previous_status',before_row.status::text,'outcome',p_outcome,'update_type',p_update_type,'next_step',p_next_step))
 RETURNING id,created_at INTO activity_id,activity_time;
 PERFORM public.kmsa_v64_register_followup(p_milestone,activity_time);
 RETURN jsonb_build_object('milestone',to_jsonb(after_row),'activity_id',activity_id,'created_at',activity_time,'previous_status',before_row.status::text);
END $$;
REVOKE ALL ON FUNCTION public.kmsa_v65_save_milestone_progress(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_v65_save_milestone_progress(uuid,uuid,text,text,text,text,text) TO service_role;

-- No retroactive missed checks upon deployment of the new mandatory 12h cadence.
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT id FROM public.initiatives WHERE setup_status='ACTIVE' AND approval_status='APPROVED' AND status NOT IN ('COMPLETED','CANCELLED') AND coalesce(lifecycle_state,'ACTIVE')='ACTIVE' LOOP
  PERFORM public.kmsa_v65_ensure_supervision(p.id);
 END LOOP;
END $$;
COMMIT;
