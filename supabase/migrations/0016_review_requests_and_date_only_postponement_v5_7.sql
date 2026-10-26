-- KMSA v5.7: auditable, bounded review requests and date-only postponement.
-- Apply after v5.6 (one time). Do not reset existing history.
BEGIN;
ALTER TABLE public.project_supervision_followups ADD COLUMN IF NOT EXISTS review_request_attempt smallint;
ALTER TABLE public.project_supervision_followups DROP CONSTRAINT IF EXISTS kmsa_v57_review_attempt_range;
ALTER TABLE public.project_supervision_followups ADD CONSTRAINT kmsa_v57_review_attempt_range
  CHECK (review_request_attempt IS NULL OR (review_request_attempt BETWEEN 1 AND 2 AND action_kind='REMIND'));
CREATE UNIQUE INDEX IF NOT EXISTS kmsa_v57_review_request_unique
  ON public.project_supervision_followups(source_activity_id, delegated_supervisor_id, review_request_attempt)
  WHERE review_request_attempt IS NOT NULL;
CREATE INDEX IF NOT EXISTS kmsa_v57_review_requests_due
  ON public.project_supervision_followups(followup_due_at) WHERE review_request_attempt IS NOT NULL;
-- A postponed project is reviewed by calendar date, without a time of day.
ALTER TABLE public.project_closure_requests ADD COLUMN IF NOT EXISTS postpone_until_date date;
ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS postpone_until_date date;
-- Keep resume_review_at in sync for v5.6 consumers until all dashboards migrate.
CREATE OR REPLACE FUNCTION public.kmsa_v56_decide_closure(p_request uuid,p_actor uuid,p_approve boolean,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE q public.project_closure_requests%ROWTYPE; v_status text;
BEGIN
 SELECT * INTO q FROM public.project_closure_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR q.status<>'PENDING' THEN RAISE EXCEPTION 'Closure request is not pending'; END IF;
 UPDATE public.project_closure_requests SET status=CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
 decided_by=p_actor,decided_at=now(),decision_note=nullif(btrim(p_note),'') WHERE id=q.id;
 IF p_approve THEN
  v_status=CASE q.type WHEN 'SUCCEEDED' THEN 'COMPLETED' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'ACTIVE' END;
  UPDATE public.initiatives SET lifecycle_state=q.type,status=v_status,
   lifecycle_decided_at=now(),lifecycle_decided_by=p_actor,lifecycle_summary=q.reason,
   postpone_until_date=CASE WHEN q.type='POSTPONED' THEN COALESCE(q.postpone_until_date,(q.resume_review_at AT TIME ZONE 'Africa/Khartoum')::date) ELSE NULL END,
   resume_review_at=CASE WHEN q.type='POSTPONED' THEN q.resume_review_at ELSE NULL END,
   completed_at=CASE WHEN q.type='SUCCEEDED' THEN now() ELSE NULL END
  WHERE id=q.initiative_id;
  IF q.type IN ('SUCCEEDED','CANCELLED') THEN
   UPDATE public.proposals SET execution_status=CASE WHEN q.type='SUCCEEDED' THEN 'COMPLETED'::public.execution_status ELSE 'CANCELLED'::public.execution_status END
    WHERE id=(SELECT proposal_id FROM public.initiatives WHERE id=q.initiative_id) AND status='APPROVED';
  END IF;
 END IF;
 RETURN q.initiative_id;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_v56_decide_closure(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_v56_decide_closure(uuid,uuid,boolean,text) TO service_role;
COMMIT;
