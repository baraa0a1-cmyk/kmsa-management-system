-- KMSA v6.2 — graduation state, cycle-scoped executive appointment, improved CSV identity checks.
-- Requires migrations 0017, 0018, 0019, 0020. No cycle, project or person is deleted.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.kmsa_batches') IS NULL OR to_regclass('public.cycle_batches') IS NULL
  OR to_regprocedure('public.kmsa_admin_replace_leader(uuid,text,uuid,uuid)') IS NULL
  OR to_regprocedure('public.kmsa_admin_find_people(text,integer,integer,integer)') IS NULL
 THEN RAISE EXCEPTION 'KMSA_V6_2_PREREQUISITE_MISSING: apply v5.8, v5.9, v6 and v6.1 migrations first'; END IF;
END $$;
ALTER TABLE public.kmsa_batches ADD COLUMN IF NOT EXISTS graduated boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS kmsa_batches_graduated_idx ON public.kmsa_batches(graduated,batch_number);

CREATE OR REPLACE FUNCTION public.kmsa_admin_set_batch_graduated(p_batch integer,p_graduated boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.kmsa_admin_actor() IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_graduated IS NULL THEN RAISE EXCEPTION 'GRADUATION_STATUS_REQUIRED'; END IF;
 UPDATE public.kmsa_batches SET graduated=p_graduated,updated_at=now() WHERE batch_number=p_batch;
 IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_admin_set_batch_graduated(integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_set_batch_graduated(integer,boolean) TO authenticated;

-- Do not rely on UI-only filtering: candidates must belong to one included, non-graduated batch.
CREATE OR REPLACE FUNCTION public.kmsa_office_candidate_allowed(p_cycle uuid,p_person uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.profiles p
  JOIN public.cycle_batches cb ON cb.batch_number=p.batch_number AND cb.cycle_id=p_cycle
  JOIN public.kmsa_batches b ON b.batch_number=cb.batch_number
  WHERE p.id=p_person AND p.active=true AND p.role<>'ADMIN' AND b.active=true AND b.graduated=false
 );
$$;
REVOKE ALL ON FUNCTION public.kmsa_office_candidate_allowed(uuid,uuid) FROM PUBLIC,anon;
-- Called by protected security-definer administration functions, not exposed to members.

CREATE OR REPLACE FUNCTION public.kmsa_admin_office_candidates(
 p_cycle uuid,p_query text DEFAULT '',p_batch integer DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 25
) RETURNS TABLE(id uuid,full_name text,university_id text,email text,batch_number integer,
 role public.app_role,active boolean,must_change_password boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE q text:=trim(coalesce(p_query,''));
BEGIN
 IF public.kmsa_admin_actor() IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF length(q)>100 OR p_offset<0 OR p_limit NOT BETWEEN 1 AND 50 OR p_batch IS NOT NULL AND p_batch NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'INVALID_SEARCH'; END IF;
 IF p_batch IS NULL AND length(q)<2 THEN RETURN; END IF;
 RETURN QUERY SELECT p.id,p.full_name,p.university_id,p.email,p.batch_number,p.role,p.active,p.must_change_password
  FROM public.profiles p JOIN public.cycle_batches cb ON cb.batch_number=p.batch_number AND cb.cycle_id=p_cycle
  JOIN public.kmsa_batches b ON b.batch_number=cb.batch_number
  WHERE p.active=true AND p.role<>'ADMIN' AND b.active=true AND b.graduated=false
    AND (p_batch IS NULL OR p.batch_number=p_batch)
    AND (q='' OR p.full_name ILIKE ('%'||q||'%') OR p.university_id ILIKE ('%'||q||'%'))
  ORDER BY CASE WHEN p.university_id=q THEN 0 ELSE 1 END,p.full_name,p.id
  LIMIT p_limit OFFSET p_offset;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_admin_office_candidates(uuid,text,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_office_candidates(uuid,text,integer,integer,integer) TO authenticated;

-- Replace legacy leadership writers with a guarded transaction that logs all succession.
CREATE OR REPLACE FUNCTION public.kmsa_admin_replace_leader(
 p_cycle uuid,p_role text,p_secretariat uuid,p_new_profile uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid;former uuid;target_cycle public.cycles%ROWTYPE; candidate public.profiles%ROWTYPE;
BEGIN
 actor:=public.kmsa_admin_actor(); IF actor IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_role NOT IN('PRESIDENT','GS','SECRETARY') THEN RAISE EXCEPTION 'LEADERSHIP_ROLE_INVALID'; END IF;
 IF (p_role='SECRETARY' AND p_secretariat IS NULL) OR (p_role<>'SECRETARY' AND p_secretariat IS NOT NULL) THEN RAISE EXCEPTION 'SECRETARIAT_SEAT_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(74631929);
 SELECT * INTO target_cycle FROM public.cycles WHERE id=p_cycle FOR UPDATE;
 IF NOT FOUND OR target_cycle.status NOT IN('DRAFT','OPEN') THEN RAISE EXCEPTION 'CYCLE_NOT_EDITABLE'; END IF;
 SELECT * INTO candidate FROM public.profiles WHERE id=p_new_profile AND active=true FOR UPDATE;
 IF NOT FOUND OR candidate.role='ADMIN' THEN RAISE EXCEPTION 'CANDIDATE_NOT_AVAILABLE'; END IF;
 IF NOT public.kmsa_office_candidate_allowed(p_cycle,p_new_profile) THEN RAISE EXCEPTION 'CANDIDATE_BATCH_NOT_INCLUDED_OR_GRADUATED'; END IF;
 IF EXISTS(SELECT 1 FROM public.kmsa_cycle_gs_assistants WHERE cycle_id=p_cycle AND profile_id=p_new_profile)
 THEN RAISE EXCEPTION 'CANDIDATE_ALREADY_ASSISTANT'; END IF;
 IF EXISTS(SELECT 1 FROM public.cycle_memberships m WHERE m.cycle_id=p_cycle AND m.profile_id=p_new_profile
  AND m.role IN ('PRESIDENT','GS','SECRETARY') AND m.ended_at IS NULL
  AND NOT(m.role=p_role AND m.secretariat_id IS NOT DISTINCT FROM p_secretariat))
 THEN RAISE EXCEPTION 'CANDIDATE_HOLDS_ANOTHER_EXECUTIVE_SEAT'; END IF;
 SELECT m.profile_id INTO former FROM public.cycle_memberships m
  WHERE m.cycle_id=p_cycle AND m.role=p_role AND m.ended_at IS NULL
  AND m.secretariat_id IS NOT DISTINCT FROM p_secretariat LIMIT 1 FOR UPDATE;
 IF former=p_new_profile THEN RETURN jsonb_build_object('ok',true,'unchanged',true); END IF;
 IF former IS NOT NULL THEN
  UPDATE public.cycle_memberships SET role='MEMBER',secretariat_id=NULL,ended_at=NULL
   WHERE cycle_id=p_cycle AND profile_id=former;
 END IF;
 INSERT INTO public.cycle_memberships(cycle_id,profile_id,role,secretariat_id,ended_at)
 VALUES(p_cycle,p_new_profile,p_role::public.app_role,p_secretariat,NULL)
 ON CONFLICT(cycle_id,profile_id) DO UPDATE SET role=excluded.role,secretariat_id=excluded.secretariat_id,ended_at=NULL;
 INSERT INTO public.kmsa_leadership_changes(cycle_id,seat_role,secretariat_id,old_profile_id,new_profile_id,performed_by)
 VALUES(p_cycle,p_role,p_secretariat,former,p_new_profile,actor);
 IF target_cycle.is_current THEN
  IF former IS NOT NULL THEN UPDATE public.profiles SET role='MEMBER',secretariat_id=NULL WHERE id=former AND role<>'ADMIN'; END IF;
  UPDATE public.profiles SET role=p_role::public.app_role,
   secretariat_id=CASE WHEN p_role='SECRETARY' THEN p_secretariat ELSE NULL END
   WHERE id=p_new_profile AND role<>'ADMIN';
 END IF;
 RETURN jsonb_build_object('ok',true,'old',former,'new',p_new_profile);
END $$;
REVOKE ALL ON FUNCTION public.kmsa_admin_replace_leader(uuid,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_replace_leader(uuid,text,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.kmsa_admin_replace_assistant(p_cycle uuid,p_profile uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; old_profile uuid;c public.cycles%ROWTYPE;
BEGIN
 actor:=public.kmsa_admin_actor(); IF actor IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(74631929);
 SELECT * INTO c FROM public.cycles WHERE id=p_cycle FOR UPDATE;
 IF NOT FOUND OR c.status NOT IN('DRAFT','OPEN') THEN RAISE EXCEPTION 'CYCLE_NOT_EDITABLE'; END IF;
 IF NOT public.kmsa_office_candidate_allowed(p_cycle,p_profile) THEN RAISE EXCEPTION 'CANDIDATE_BATCH_NOT_INCLUDED_OR_GRADUATED'; END IF;
 IF EXISTS(SELECT 1 FROM public.cycle_memberships WHERE cycle_id=p_cycle AND profile_id=p_profile
  AND role IN('PRESIDENT','GS','SECRETARY') AND ended_at IS NULL) THEN RAISE EXCEPTION 'CANDIDATE_HOLDS_ANOTHER_EXECUTIVE_SEAT'; END IF;
 SELECT profile_id INTO old_profile FROM public.kmsa_cycle_gs_assistants WHERE cycle_id=p_cycle FOR UPDATE;
 IF old_profile=p_profile THEN RETURN jsonb_build_object('ok',true,'unchanged',true); END IF;
 INSERT INTO public.kmsa_cycle_gs_assistants(cycle_id,profile_id) VALUES(p_cycle,p_profile)
 ON CONFLICT(cycle_id) DO UPDATE SET profile_id=excluded.profile_id,assigned_at=now();
 INSERT INTO public.kmsa_leadership_changes(cycle_id,seat_role,old_profile_id,new_profile_id,performed_by)
 VALUES(p_cycle,'GS_ASSISTANT',old_profile,p_profile,actor);
 RETURN jsonb_build_object('ok',true,'old',old_profile,'new',p_profile);
END $$;
REVOKE ALL ON FUNCTION public.kmsa_admin_replace_assistant(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_replace_assistant(uuid,uuid) TO authenticated;

-- Structured CSV identity matching: same university ID => review/update; same email and different ID => conflict.
CREATE OR REPLACE FUNCTION public.kmsa_check_import_people(p_people jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e jsonb; output jsonb:='[]'::jsonb; uid text;mail text;person_name text;
 uid_person public.profiles%ROWTYPE; email_person public.profiles%ROWTYPE; result_status text;why text;
BEGIN
 IF public.kmsa_admin_actor() IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF jsonb_typeof(p_people)<>'array' OR jsonb_array_length(p_people)>500 THEN RAISE EXCEPTION 'INVALID_BATCH_SIZE_MAX_500'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p_people) LOOP
  uid:=nullif(trim(coalesce(e->>'universityId','')),'');mail:=nullif(lower(trim(coalesce(e->>'email',''))),'');person_name:=trim(coalesce(e->>'name',''));
  uid_person:=NULL; email_person:=NULL; result_status:='READY';why:='';
  IF uid IS NOT NULL THEN SELECT * INTO uid_person FROM public.profiles WHERE trim(university_id)=uid LIMIT 1; END IF;
  IF mail IS NOT NULL THEN SELECT * INTO email_person FROM public.profiles WHERE lower(trim(email))=mail LIMIT 1; END IF;
  IF uid_person.id IS NOT NULL AND email_person.id IS NOT NULL AND uid_person.id<>email_person.id THEN result_status:='CONFLICT';why:='EMAIL_IN_USE_BY_ANOTHER_MEMBER';
  ELSIF uid_person.id IS NOT NULL THEN result_status:='EXISTS';why:='MATCHING_UNIVERSITY_ID';
  ELSIF email_person.id IS NOT NULL THEN result_status:='CONFLICT';why:='EMAIL_ALREADY_USED_BY_DIFFERENT_ID';
  ELSIF uid IS NULL OR mail IS NULL OR length(person_name)<3 THEN result_status:='NEEDS_REVIEW';why:='MISSING_IDENTITY_FIELD';
  ELSIF mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN result_status:='NEEDS_REVIEW';why:='INVALID_EMAIL'; END IF;
  output:=output||jsonb_build_array(jsonb_build_object('row',e->'row','status',result_status,'reason',why,
   'existingId',case when uid_person.id IS NOT NULL then uid_person.id when email_person.id IS NOT NULL then email_person.id else null end,
   'existingName',case when uid_person.id IS NOT NULL then uid_person.full_name when email_person.id IS NOT NULL then email_person.full_name else null end,
   'existingBatch',case when uid_person.id IS NOT NULL then uid_person.batch_number when email_person.id IS NOT NULL then email_person.batch_number else null end,
   'existingEmail',case when uid_person.id IS NOT NULL then uid_person.email when email_person.id IS NOT NULL then email_person.email else null end,
   'existingUniversityId',case when uid_person.id IS NOT NULL then uid_person.university_id when email_person.id IS NOT NULL then email_person.university_id else null end
  ));
 END LOOP;
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_check_import_people(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_check_import_people(jsonb) TO authenticated;

-- Old workflow paths must not allow bypassing office eligibility via service-role writes.
-- Decommissioned in v6.2 workflow (server-deployed alongside this migration).

-- Correct batch identity and graduation state atomically (preserve historic cohort memberships).
CREATE OR REPLACE FUNCTION public.kmsa_admin_save_batch_v62(
 p_old_number integer,p_new_number integer,p_new_name text,p_new_level smallint,p_graduated boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF public.kmsa_admin_actor() IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_graduated IS NULL THEN RAISE EXCEPTION 'GRADUATION_STATUS_REQUIRED'; END IF;
 result:=public.kmsa_admin_correct_batch(p_old_number,p_new_number,p_new_name,p_new_level);
 UPDATE public.kmsa_batches SET graduated=p_graduated,updated_at=now() WHERE batch_number=p_new_number;
 IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
 RETURN result||jsonb_build_object('graduated',p_graduated);
END $$;
REVOKE ALL ON FUNCTION public.kmsa_admin_save_batch_v62(integer,integer,text,smallint,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_save_batch_v62(integer,integer,text,smallint,boolean) TO authenticated;

COMMIT;
