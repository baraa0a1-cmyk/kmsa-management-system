-- KMSA v6.1. Requires 0017, 0018, 0019. Additive; no project/cycle deletion.
-- Run in staging first. No legacy migration is re-run.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.kmsa_batches') IS NULL
 OR to_regclass('public.kmsa_import_review') IS NULL
 OR to_regclass('public.cycle_memberships') IS NULL
 OR to_regprocedure('public.kmsa_admin_actor()') IS NULL
 OR to_regprocedure('public.kmsa_switch_current_cycle(uuid,uuid,text,boolean,boolean)') IS NULL
 THEN RAISE EXCEPTION 'KMSA_V6_1_PREREQUISITES_MISSING_APPLY_0017_0018_0019_FIRST'; END IF;
END $$;

-- Correct an accidentally entered batch number without moving members individually.
-- Existing cross-references are preserved; every statement runs in one transaction.
CREATE TABLE IF NOT EXISTS public.kmsa_batch_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 old_number integer NOT NULL,
 new_number integer NOT NULL,
 old_name text NOT NULL,
 new_name text NOT NULL,
 old_level smallint,
 new_level smallint,
 changed_by uuid NOT NULL REFERENCES public.profiles(id),
 changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kmsa_batch_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kmsa_batch_corrections_admin_read ON public.kmsa_batch_corrections;
CREATE POLICY kmsa_batch_corrections_admin_read ON public.kmsa_batch_corrections FOR SELECT TO authenticated
 USING(public.kmsa_admin_actor() IS NOT NULL);
REVOKE ALL ON public.kmsa_batch_corrections FROM anon,authenticated;
GRANT SELECT ON public.kmsa_batch_corrections TO authenticated;

CREATE OR REPLACE FUNCTION public.kmsa_admin_correct_batch(
 p_old_number integer,p_new_number integer,p_new_name text,p_new_level smallint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; old_row public.kmsa_batches%ROWTYPE; actual_name text;
BEGIN
 actor:=public.kmsa_admin_actor();IF actor IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED';END IF;
 IF p_new_number IS NULL OR p_new_number NOT BETWEEN 1 AND 999
 OR p_new_level IS NOT NULL AND p_new_level NOT BETWEEN 1 AND 6
 THEN RAISE EXCEPTION 'INVALID_BATCH_DETAILS';END IF;
 actual_name:=trim(coalesce(p_new_name,''));
 IF length(actual_name)<3 OR length(actual_name)>90 THEN RAISE EXCEPTION 'INVALID_BATCH_NAME';END IF;
 PERFORM pg_advisory_xact_lock(74631930);
 SELECT * INTO old_row FROM public.kmsa_batches WHERE batch_number=p_old_number FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND';END IF;
 IF p_new_number<>p_old_number THEN
  IF EXISTS(SELECT 1 FROM public.kmsa_batches WHERE batch_number=p_new_number)
  THEN RAISE EXCEPTION 'TARGET_BATCH_ALREADY_EXISTS';END IF;
  INSERT INTO public.kmsa_batches(batch_number,display_name,academic_level,active)
   VALUES(p_new_number,'KMSA_TEMP_BATCH_'||gen_random_uuid()::text,p_new_level,old_row.active);
  UPDATE public.profiles SET batch_number=p_new_number WHERE batch_number=p_old_number;
  UPDATE public.cycle_batches SET batch_number=p_new_number WHERE batch_number=p_old_number;
  UPDATE public.kmsa_batch_transfers SET from_batch=p_new_number WHERE from_batch=p_old_number;
  UPDATE public.kmsa_batch_transfers SET to_batch=p_new_number WHERE to_batch=p_old_number;
  UPDATE public.kmsa_import_review SET batch_number=p_new_number WHERE batch_number=p_old_number;
  DELETE FROM public.kmsa_batches WHERE batch_number=p_old_number;
 END IF;
 UPDATE public.kmsa_batches SET display_name=actual_name,academic_level=p_new_level,updated_at=now()
 WHERE batch_number=p_new_number;
 INSERT INTO public.kmsa_batch_corrections(old_number,new_number,old_name,new_name,old_level,new_level,changed_by)
 VALUES(p_old_number,p_new_number,old_row.display_name,actual_name,old_row.academic_level,p_new_level,actor);
 RETURN jsonb_build_object('ok',true,'batch',p_new_number,'name',actual_name);
END $$;
REVOKE ALL ON FUNCTION public.kmsa_admin_correct_batch(integer,integer,text,smallint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_correct_batch(integer,integer,text,smallint) TO authenticated;

-- Admin-only paginated person search. Avoid loading 5000 profiles or picking officers from a long dropdown.
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
 IF length(q)>100 OR p_limit NOT BETWEEN 1 AND 50 OR p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'INVALID_SEARCH';END IF;
 RETURN QUERY SELECT p.id,p.full_name,p.university_id,p.email,p.batch_number,p.role,p.active,p.must_change_password
 FROM public.profiles p
 WHERE p.role<>'ADMIN'
 AND (p_batch IS NULL OR p.batch_number=p_batch)
 AND (q='' OR p.university_id ILIKE ('%'||q||'%') OR p.full_name ILIKE ('%'||q||'%') OR p.email ILIKE ('%'||q||'%'))
 ORDER BY CASE WHEN p.university_id=q THEN 0 ELSE 1 END,p.full_name,p.id
 LIMIT p_limit OFFSET p_offset;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_admin_find_people(text,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_find_people(text,integer,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.kmsa_admin_batch_sizes()
RETURNS TABLE(batch_number integer, members bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT b.batch_number,count(p.id) AS members
 FROM public.kmsa_batches b LEFT JOIN public.profiles p ON p.batch_number=b.batch_number AND p.role<>'ADMIN'
 WHERE public.kmsa_admin_actor() IS NOT NULL GROUP BY b.batch_number
$$;
REVOKE ALL ON FUNCTION public.kmsa_admin_batch_sizes() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_batch_sizes() TO authenticated;
COMMIT;
