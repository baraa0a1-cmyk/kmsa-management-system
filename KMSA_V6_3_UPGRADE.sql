-- KMSA v6.3: repair app_role/text comparisons and display unassigned member profiles.
-- Apply AFTER 0021; no existing member, batch, cycle, or project is deleted or moved.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.kmsa_admin_replace_leader(uuid,text,uuid,uuid)') IS NULL OR
    to_regprocedure('public.kmsa_admin_find_people(text,integer,integer,integer)') IS NULL OR
    to_regprocedure('public.kmsa_admin_batch_sizes()') IS NULL OR
    to_regclass('public.cycle_memberships') IS NULL
 THEN RAISE EXCEPTION 'V6_3_PREREQUISITES_MISSING: apply all migrations through 0021 before v6.3'; END IF;
END $$;

-- Main reason for: operator does not exist: app_role = text
-- p_role is a validated text parameter, but cycle_memberships.role is public.app_role.
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
  AND NOT(m.role=p_role::public.app_role AND m.secretariat_id IS NOT DISTINCT FROM p_secretariat))
 THEN RAISE EXCEPTION 'CANDIDATE_HOLDS_ANOTHER_EXECUTIVE_SEAT'; END IF;
 SELECT m.profile_id INTO former FROM public.cycle_memberships m
  WHERE m.cycle_id=p_cycle AND m.role=p_role::public.app_role AND m.ended_at IS NULL
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

-- Special p_batch=-1 means 'unassigned batch' in the admin interface only.
-- This is NOT a stored batch and does not alter any profile's batch_number.
CREATE OR REPLACE FUNCTION public.kmsa_admin_find_people(
 p_query text DEFAULT '',p_batch integer DEFAULT NULL,p_limit integer DEFAULT 30,p_offset integer DEFAULT 0
) RETURNS TABLE(
 id uuid,full_name text,university_id text,email text,batch_number integer,
 role public.app_role,active boolean,must_change_password boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE q text:=trim(coalesce(p_query,''));
BEGIN
 IF public.kmsa_admin_actor() IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_batch IS NULL AND length(q)<2 THEN RETURN;END IF;
 IF (p_batch IS NOT NULL AND (p_batch < -1 OR p_batch=0 OR p_batch>999)) OR length(q)>100 OR p_limit NOT BETWEEN 1 AND 50 OR p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'INVALID_SEARCH';END IF;
 RETURN QUERY SELECT p.id,p.full_name,p.university_id,p.email,p.batch_number,p.role,p.active,p.must_change_password
 FROM public.profiles p
 WHERE p.role<>'ADMIN'
 AND (p_batch IS NULL OR (p_batch=-1 AND p.batch_number IS NULL) OR (p_batch>0 AND p.batch_number=p_batch))
 AND (q='' OR p.university_id ILIKE ('%'||q||'%') OR p.full_name ILIKE ('%'||q||'%') OR p.email ILIKE ('%'||q||'%'))
 ORDER BY CASE WHEN p.university_id=q THEN 0 ELSE 1 END,p.full_name,p.id
 LIMIT p_limit OFFSET p_offset;
END $$;

REVOKE ALL ON FUNCTION public.kmsa_admin_find_people(text,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_find_people(text,integer,integer,integer) TO authenticated;

-- Add one sentinel row for profiles where batch_number IS NULL.
CREATE OR REPLACE FUNCTION public.kmsa_admin_batch_sizes()
RETURNS TABLE(batch_number integer, members bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT b.batch_number,count(p.id) AS members
 FROM public.kmsa_batches b LEFT JOIN public.profiles p ON p.batch_number=b.batch_number AND p.role<>'ADMIN'
 WHERE public.kmsa_admin_actor() IS NOT NULL GROUP BY b.batch_number
 UNION ALL
 SELECT (-1)::integer, count(p.id) AS members
 FROM public.profiles p
 WHERE p.batch_number IS NULL AND p.role<>'ADMIN'
 HAVING public.kmsa_admin_actor() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.kmsa_admin_batch_sizes() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_batch_sizes() TO authenticated;
COMMIT;
