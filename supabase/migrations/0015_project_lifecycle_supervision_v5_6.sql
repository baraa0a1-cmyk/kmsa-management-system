-- KMSA v5.6: lifecycle + delegation follow-through. Apply once, after all v5.5 migrations.
-- Execution actions are implemented in the workflow edge function, not directly from the browser.
BEGIN;
ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS lifecycle_decided_at timestamptz;
ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS lifecycle_decided_by uuid;
ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS lifecycle_summary text;
ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS resume_review_at timestamptz;
CREATE TABLE IF NOT EXISTS public.project_closure_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE CASCADE,
 requested_by uuid NOT NULL REFERENCES public.profiles(id), requested_at timestamptz NOT NULL DEFAULT now(),
 type text NOT NULL CHECK(type IN ('SUCCEEDED','CANCELLED','POSTPONED')),
 reason text NOT NULL CHECK(length(btrim(reason))>0), resume_review_at timestamptz,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 decided_by uuid REFERENCES public.profiles(id), decided_at timestamptz, decision_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS kmsa_project_closure_one_pending ON public.project_closure_requests(initiative_id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS kmsa_project_closure_by_project ON public.project_closure_requests(initiative_id,requested_at DESC);
CREATE TABLE IF NOT EXISTS public.project_supervision_followups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE CASCADE,
 source_activity_id uuid NOT NULL REFERENCES public.project_activity_entries(id) ON DELETE CASCADE,
 delegated_supervisor_id uuid NOT NULL REFERENCES public.profiles(id), secretary_id uuid NOT NULL REFERENCES public.profiles(id),
 action_kind text NOT NULL CHECK(action_kind IN ('REMIND','REASSIGN','DIRECT_REVIEW','CLARIFY')),
 note text NOT NULL CHECK(length(btrim(note))>0), followup_due_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (source_activity_id,secretary_id,created_at)
);
CREATE INDEX IF NOT EXISTS kmsa_followups_by_initiative ON public.project_supervision_followups(initiative_id,created_at DESC);
ALTER TABLE public.project_closure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_supervision_followups ENABLE ROW LEVEL SECURITY;
-- Read records through ordinary RLS scoped to the same secretariat or GS.
DROP POLICY IF EXISTS project_closure_read_v56 ON public.project_closure_requests;
CREATE POLICY project_closure_read_v56 ON public.project_closure_requests FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.initiatives i JOIN public.profiles p ON p.auth_user_id=auth.uid()
  WHERE i.id=initiative_id AND (p.role IN ('GS','PRESIDENT','ADMIN') OR i.secretary_id=p.id OR i.owner_id=p.id OR p.secretariat_id=i.secretariat_id AND p.role='SECRETARY' OR EXISTS(SELECT 1 FROM public.project_supervision_assignments a WHERE a.initiative_id=i.id AND a.supervisor_id=p.id))));
DROP POLICY IF EXISTS project_followups_read_v56 ON public.project_supervision_followups;
CREATE POLICY project_followups_read_v56 ON public.project_supervision_followups FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.initiatives i JOIN public.profiles p ON p.auth_user_id=auth.uid()
  WHERE i.id=initiative_id AND (p.role IN ('GS','PRESIDENT','ADMIN') OR i.secretary_id=p.id OR p.id=delegated_supervisor_id)));
CREATE OR REPLACE FUNCTION public.kmsa_v56_guard_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF auth.role()='authenticated' AND
  (NEW.status IS DISTINCT FROM OLD.status OR NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state OR
   NEW.lifecycle_decided_at IS DISTINCT FROM OLD.lifecycle_decided_at OR NEW.lifecycle_decided_by IS DISTINCT FROM OLD.lifecycle_decided_by) THEN
  RAISE EXCEPTION 'Use the authorized project lifecycle workflow';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kmsa_v56_lifecycle_guard ON public.initiatives;
CREATE TRIGGER kmsa_v56_lifecycle_guard BEFORE UPDATE ON public.initiatives
 FOR EACH ROW EXECUTE FUNCTION public.kmsa_v56_guard_lifecycle();
-- The following functions are only callable with service_role; all user authorization lives in workflow.
CREATE OR REPLACE FUNCTION public.kmsa_v56_transfer_project_owner(p_initiative uuid,p_new_owner uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_current uuid;
BEGIN
 SELECT owner_id INTO v_current FROM public.initiatives WHERE id=p_initiative FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_new_owner AND active=true) THEN RAISE EXCEPTION 'Inactive or missing new owner'; END IF;
 UPDATE public.initiatives SET owner_id=p_new_owner WHERE id=p_initiative;
 UPDATE public.results SET owner_id=p_new_owner WHERE initiative_id=p_initiative;
 UPDATE public.milestones SET owner_id=p_new_owner WHERE result_id IN (SELECT id FROM public.results WHERE initiative_id=p_initiative);
 UPDATE public.project_permissions SET requested_for=p_new_owner WHERE initiative_id=p_initiative AND requested_for=v_current AND permission_type='STANDARD';
 -- Special permissions are NOT inherited automatically by a new lead. Prior approvals remain historical, not active.
 UPDATE public.project_permissions SET status='REVOKED' WHERE initiative_id=p_initiative AND requested_for=v_current AND permission_type='SPECIAL' AND status IN ('ACTIVE','PENDING');
END $$;
REVOKE ALL ON FUNCTION public.kmsa_v56_transfer_project_owner(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kmsa_v56_transfer_project_owner(uuid,uuid) TO service_role;
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
