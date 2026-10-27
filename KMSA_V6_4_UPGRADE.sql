-- KMSA v6.4 — accountable milestone check-ins. Apply after 0022 (v6.3).
-- All writes through the service-role workflow. No client INSERT/UPDATE grants.
BEGIN;
CREATE TABLE IF NOT EXISTS public.milestone_followup_schedules (
  milestone_id uuid PRIMARY KEY REFERENCES public.milestones(id) ON DELETE CASCADE,
  initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE CASCADE,
  anchor_at timestamptz NOT NULL,
  interval_hours integer NOT NULL CHECK(interval_hours BETWEEN 6 AND 168),
  next_due_at timestamptz NOT NULL,
  last_report_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kmsa_v64_followup_due_idx ON public.milestone_followup_schedules(next_due_at, initiative_id);
ALTER TABLE public.milestone_followup_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kmsa_v64_read_schedule ON public.milestone_followup_schedules;
CREATE POLICY kmsa_v64_read_schedule ON public.milestone_followup_schedules FOR SELECT TO authenticated
  USING (public.can_read_initiative(initiative_id));
GRANT SELECT ON public.milestone_followup_schedules TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.milestone_followup_schedules FROM PUBLIC, anon, authenticated;

-- The starting schedule is fixed in advance; writing an arbitrary update never pushes a deadline forward.
-- The interval is based on remaining milestone duration at activation, not completion percentage.
CREATE OR REPLACE FUNCTION public.kmsa_v64_ensure_followup(p_initiative uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start timestamptz := now();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.initiatives i WHERE i.id=p_initiative
      AND i.setup_status='ACTIVE' AND i.approval_status='APPROVED' AND i.status NOT IN ('COMPLETED','CANCELLED')
      AND coalesce(i.lifecycle_state,'ACTIVE')='ACTIVE') THEN RETURN; END IF;
  INSERT INTO public.milestone_followup_schedules
      (milestone_id, initiative_id, anchor_at, interval_hours, next_due_at)
  SELECT m.id, i.id, v_start,
    CASE WHEN m.due_at <= v_start + interval '24 hours' THEN 8
         WHEN m.due_at <= v_start + interval '3 days' THEN 24
         WHEN m.due_at <= v_start + interval '7 days' THEN 48
         ELSE 72 END,
    CASE WHEN m.due_at <= v_start THEN v_start + interval '8 hours' ELSE LEAST(m.due_at, v_start +
      (CASE WHEN m.due_at <= v_start + interval '24 hours' THEN interval '8 hours'
            WHEN m.due_at <= v_start + interval '3 days' THEN interval '24 hours'
            WHEN m.due_at <= v_start + interval '7 days' THEN interval '48 hours'
            ELSE interval '72 hours' END)) END
  FROM public.milestones m JOIN public.results r ON r.id=m.result_id
  JOIN public.initiatives i ON i.id=r.initiative_id
  WHERE i.id=p_initiative AND m.design_status<>'REJECTED'
    AND m.status NOT IN ('READY_FOR_VERIFICATION','VERIFIED','CANCELLED')
    AND m.due_at IS NOT NULL
    AND (
      m.status IN ('IN_PROGRESS','AT_RISK','BLOCKED')
      OR (m.status='NOT_STARTED'
        AND NOT EXISTS (
          SELECT 1 FROM public.milestones working JOIN public.results wr ON wr.id=working.result_id
          WHERE wr.initiative_id=i.id AND working.design_status<>'REJECTED'
            AND working.status IN ('IN_PROGRESS','AT_RISK','BLOCKED')
        )
        AND m.id=(
          SELECT upcoming.id FROM public.milestones upcoming
          JOIN public.results ur ON ur.id=upcoming.result_id
          WHERE ur.initiative_id=i.id AND upcoming.design_status<>'REJECTED'
            AND upcoming.status='NOT_STARTED'
          ORDER BY upcoming.due_at ASC NULLS LAST, upcoming.sequence_no ASC, upcoming.id ASC LIMIT 1
        )
      )
    )
  ON CONFLICT(milestone_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_v64_ensure_followup(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_v64_ensure_followup(uuid) TO service_role;

-- Called once after the activity is durably recorded. Only a timely check-in close to
-- its checkpoint, or a late check-in, advances the anchored schedule.
CREATE OR REPLACE FUNCTION public.kmsa_v64_register_followup(p_milestone uuid, p_reported_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.milestone_followup_schedules%ROWTYPE;
DECLARE v_next timestamptz;
BEGIN
  SELECT * INTO v FROM public.milestone_followup_schedules WHERE milestone_id=p_milestone FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_next := v.next_due_at;
  IF p_reported_at >= v.next_due_at - make_interval(hours => greatest(2,v.interval_hours/4)) THEN
    -- Keep the original cadence. Never reset from report time.
    v_next := v.next_due_at + make_interval(hours => v.interval_hours *
      (greatest(0,floor(extract(epoch from (p_reported_at - v.next_due_at)) /
        (3600.0 * v.interval_hours))::integer) + 1));
  END IF;
  UPDATE public.milestone_followup_schedules
    SET last_report_at=p_reported_at, next_due_at=v_next, updated_at=now()
    WHERE milestone_id=p_milestone;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_v64_register_followup(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_v64_register_followup(uuid,timestamptz) TO service_role;

-- A vague report is not the same as verified insufficient progress.
ALTER TABLE public.milestone_supervision_events DROP CONSTRAINT IF EXISTS milestone_supervision_events_event_type_check;
ALTER TABLE public.milestone_supervision_events ADD CONSTRAINT milestone_supervision_events_event_type_check
  CHECK (event_type IN (
    'COMPLETION_READ','PROGRESS_REVIEW','UPDATE_REQUEST','REQUEST_ANSWERED',
    'PROGRESS_OK','PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_OK','RESULT_REVISION'
  ));

-- Corrective follow-up belongs to a particular evaluated update, not to a loose project note.
ALTER TABLE public.milestone_supervision_events ADD COLUMN IF NOT EXISTS correction_due_at timestamptz;
ALTER TABLE public.milestone_supervision_events DROP CONSTRAINT IF EXISTS kmsa_v64_correction_deadline_check;
ALTER TABLE public.milestone_supervision_events ADD CONSTRAINT kmsa_v64_correction_deadline_check
  CHECK (correction_due_at IS NULL OR event_type IN ('PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_REVISION'));

-- Existing projects start a NEW observation schedule at migration time.
-- No retrospective accusations of missed check-ins are created.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT id FROM public.initiatives WHERE setup_status='ACTIVE' AND approval_status='APPROVED'
      AND status NOT IN ('COMPLETED','CANCELLED') AND coalesce(lifecycle_state,'ACTIVE')='ACTIVE'
  LOOP PERFORM public.kmsa_v64_ensure_followup(p.id); END LOOP;
END $$;
COMMIT;
