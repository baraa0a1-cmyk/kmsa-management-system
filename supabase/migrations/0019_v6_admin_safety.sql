-- KMSA v6.0: additive management safety layer; requires v5.8 0017 and v5.9 0018.
-- No existing cycles, projects, proposals or user accounts are deleted.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.cycles') IS NULL OR to_regclass('public.cycle_memberships') IS NULL
    OR to_regclass('public.kmsa_batches') IS NULL OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.cycle_batches') IS NULL OR to_regclass('public.kmsa_cycle_gs_assistants') IS NULL THEN
    RAISE EXCEPTION 'KMSA_V6_PREREQUISITES_MISSING: install and verify v5.8 and v5.9 first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.kmsa_cycle_switch_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 from_cycle_id uuid REFERENCES public.cycles(id),
 to_cycle_id uuid NOT NULL REFERENCES public.cycles(id),
 switched_by uuid NOT NULL REFERENCES public.profiles(id),
 switched_at timestamptz NOT NULL DEFAULT now(),
 is_reversal boolean NOT NULL DEFAULT false,
 snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS kmsa_cycle_switch_log_time ON public.kmsa_cycle_switch_log(switched_at DESC);
ALTER TABLE public.kmsa_cycle_switch_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kmsa_cycle_switch_admin_read ON public.kmsa_cycle_switch_log;
CREATE POLICY kmsa_cycle_switch_admin_read ON public.kmsa_cycle_switch_log FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.auth_user_id=auth.uid() AND p.active AND p.role='ADMIN'));
REVOKE ALL ON public.kmsa_cycle_switch_log FROM anon,authenticated;
GRANT SELECT ON public.kmsa_cycle_switch_log TO authenticated;

CREATE OR REPLACE FUNCTION public.kmsa_admin_actor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public AS $$
 SELECT id FROM public.profiles WHERE auth_user_id=auth.uid() AND active AND role='ADMIN' LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.kmsa_admin_actor() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_actor() TO authenticated;

CREATE OR REPLACE FUNCTION public.kmsa_cycle_preview(p_target uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.cycles%ROWTYPE; old public.cycles%ROWTYPE; projects_old integer:=0;projects_target integer:=0;
proposals_old integer:=0;proposals_target integer:=0; presidents integer; secretaries integer; gs integer; has_previous boolean;
BEGIN
 IF public.kmsa_admin_actor() IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 SELECT * INTO c FROM public.cycles WHERE id=p_target;
 IF NOT FOUND THEN RAISE EXCEPTION 'CYCLE_NOT_FOUND'; END IF;
 SELECT * INTO old FROM public.cycles WHERE is_current=true LIMIT 1;
 SELECT count(*) INTO presidents FROM public.cycle_memberships WHERE cycle_id=c.id AND role='PRESIDENT' AND ended_at IS NULL;
 SELECT count(*) INTO gs FROM public.cycle_memberships WHERE cycle_id=c.id AND role='GS' AND ended_at IS NULL;
 SELECT count(*) INTO secretaries FROM public.cycle_memberships WHERE cycle_id=c.id AND role='SECRETARY' AND ended_at IS NULL;
 IF to_regclass('public.initiatives') IS NOT NULL THEN
  IF old.id IS NOT NULL THEN SELECT count(*) INTO projects_old FROM public.initiatives WHERE cycle_id=old.id; END IF;
  SELECT count(*) INTO projects_target FROM public.initiatives WHERE cycle_id=c.id;
 END IF;
 IF to_regclass('public.proposals') IS NOT NULL THEN
  IF old.id IS NOT NULL THEN SELECT count(*) INTO proposals_old FROM public.proposals WHERE cycle_id=old.id; END IF;
  SELECT count(*) INTO proposals_target FROM public.proposals WHERE cycle_id=c.id;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.kmsa_cycle_switch_log WHERE from_cycle_id=c.id AND to_cycle_id=old.id)
 INTO has_previous;
 RETURN jsonb_build_object(
  'current',CASE WHEN old.id IS NULL THEN NULL ELSE jsonb_build_object('id',old.id,'code',old.code,'name',old.name) END,
  'target',jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'status',c.status),
  'alreadyCurrent',COALESCE(old.id=c.id,false),
  'leadership',jsonb_build_object('president',presidents,'gs',gs,'secretaries',secretaries),
  'projectsInCurrent',projects_old,'projectsInTarget',projects_target,
  'proposalsInCurrent',proposals_old,'proposalsInTarget',proposals_target,
  'canRestorePrevious',has_previous,
  'warning','Records of both cycles remain in their original cycle. Nothing is deleted or automatically transferred. Visibility and current office privileges change.'
 );
END $$;
REVOKE ALL ON FUNCTION public.kmsa_cycle_preview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_cycle_preview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.kmsa_switch_current_cycle(
 p_target uuid,p_expected_current uuid,p_typed_code text,p_confirmed boolean,p_reversal boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; current_cycle public.cycles%ROWTYPE; next_cycle public.cycles%ROWTYPE;
mem_count integer; president_count integer; gs_count integer; history_id uuid;
BEGIN
 actor:=public.kmsa_admin_actor();
 IF actor IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(74631928);
 SELECT * INTO current_cycle FROM public.cycles WHERE is_current=true FOR UPDATE;
 IF current_cycle.id IS DISTINCT FROM p_expected_current THEN RAISE EXCEPTION 'CYCLE_CHANGED_RELOAD'; END IF;
 SELECT * INTO next_cycle FROM public.cycles WHERE id=p_target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_CYCLE_NOT_FOUND'; END IF;
 IF next_cycle.is_current THEN RAISE EXCEPTION 'CYCLE_ALREADY_CURRENT'; END IF;
 IF NOT p_confirmed OR trim(COALESCE(p_typed_code,'')) IS DISTINCT FROM next_cycle.code THEN
   RAISE EXCEPTION 'EXPLICIT_CONFIRMATION_REQUIRED';
 END IF;
 SELECT count(*) INTO president_count FROM public.cycle_memberships WHERE cycle_id=p_target AND role='PRESIDENT' AND ended_at IS NULL;
 SELECT count(*) INTO gs_count FROM public.cycle_memberships WHERE cycle_id=p_target AND role='GS' AND ended_at IS NULL;
 IF president_count<>1 OR gs_count<>1 THEN RAISE EXCEPTION 'CYCLE_LEADERSHIP_INCOMPLETE'; END IF;
 IF p_reversal THEN
   IF current_cycle.id IS NULL OR NOT EXISTS(
     SELECT 1 FROM public.kmsa_cycle_switch_log l
     WHERE l.to_cycle_id=current_cycle.id AND l.from_cycle_id=p_target
       AND l.id=(SELECT id FROM public.kmsa_cycle_switch_log ORDER BY switched_at DESC,id DESC LIMIT 1)
   ) THEN RAISE EXCEPTION 'ONLY_MOST_RECENT_SWITCH_CAN_BE_REVERSED'; END IF;
 END IF;
 IF current_cycle.id IS NOT NULL THEN
   UPDATE public.cycles SET is_current=false,status='CLOSED',closed_at=COALESCE(closed_at,now()) WHERE id=current_cycle.id;
 END IF;
 UPDATE public.cycles SET is_current=true,status='OPEN',closed_at=NULL,activation_at=now(),activated_by=actor WHERE id=p_target;
 -- The current leadership is recomputed; old-cycle membership rows remain unchanged.
 UPDATE public.profiles SET role='MEMBER',secretariat_id=NULL WHERE role<>'ADMIN';
 UPDATE public.profiles p SET role=m.role,
  secretariat_id=CASE WHEN m.role='SECRETARY' THEN m.secretariat_id ELSE NULL END
 FROM public.cycle_memberships m
 WHERE m.cycle_id=p_target AND m.profile_id=p.id AND m.ended_at IS NULL AND p.role<>'ADMIN'
   AND m.role IN('PRESIDENT','GS','SECRETARY');
 INSERT INTO public.system_settings(key,value,updated_by,updated_at)
 VALUES('current_cycle',to_jsonb(next_cycle.code),actor,now())
 ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 INSERT INTO public.kmsa_cycle_switch_log(from_cycle_id,to_cycle_id,switched_by,is_reversal,snapshot)
 VALUES(current_cycle.id,p_target,actor,p_reversal,
  jsonb_build_object('from',current_cycle.code,'to',next_cycle.code,'operation','cycle_context_switch_no_record_move'))
 RETURNING id INTO history_id;
 RETURN jsonb_build_object('ok',true,'logId',history_id,'oldCycle',current_cycle.code,'newCycle',next_cycle.code);
END $$;
REVOKE ALL ON FUNCTION public.kmsa_switch_current_cycle(uuid,uuid,text,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_switch_current_cycle(uuid,uuid,text,boolean,boolean) TO authenticated;
-- Old unguarded public RPC must not remain a parallel activation path.
DO $$ BEGIN
 IF to_regprocedure('public.activate_kmsa_cycle(uuid)') IS NOT NULL THEN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.activate_kmsa_cycle(uuid) FROM PUBLIC,anon,authenticated';
 END IF;
END $$;

-- Import review drafts, storing only the three basic identity fields (no CSV contact columns).
CREATE TABLE IF NOT EXISTS public.kmsa_import_review (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_number integer NOT NULL REFERENCES public.kmsa_batches(batch_number),
 full_name text NOT NULL,
 university_id text,
 email text,
 status text NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(status IN('NEEDS_REVIEW','READY','DISCARDED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES public.profiles(id)
);
CREATE INDEX IF NOT EXISTS kmsa_import_review_batch ON public.kmsa_import_review(batch_number,status);
CREATE UNIQUE INDEX IF NOT EXISTS kmsa_import_review_unique_entry ON public.kmsa_import_review(batch_number,lower(full_name),coalesce(university_id,''),coalesce(email,'')) WHERE status<>'DISCARDED';
ALTER TABLE public.kmsa_import_review ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kmsa_import_review_admin_read ON public.kmsa_import_review;
CREATE POLICY kmsa_import_review_admin_read ON public.kmsa_import_review FOR SELECT TO authenticated
 USING(public.kmsa_admin_actor() IS NOT NULL);
REVOKE ALL ON public.kmsa_import_review FROM anon,authenticated;
GRANT SELECT ON public.kmsa_import_review TO authenticated;

CREATE OR REPLACE FUNCTION public.kmsa_check_import_people(p_people jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e jsonb; output jsonb:='[]'::jsonb; v_uid text;v_email text;v_name text;
found_person record; status text; reason text;
BEGIN
 IF public.kmsa_admin_actor() IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF jsonb_typeof(p_people)<>'array' OR jsonb_array_length(p_people)>500 THEN RAISE EXCEPTION 'INVALID_BATCH_SIZE_MAX_500'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p_people) LOOP
  v_uid:=NULLIF(trim(e->>'universityId'),'');
  v_email:=NULLIF(lower(trim(e->>'email')),'');
  v_name:=trim(COALESCE(e->>'name',''));
  status:='READY'; reason:='';
  IF v_uid IS NULL OR v_email IS NULL OR v_name='' THEN status:='NEEDS_REVIEW';reason:='MISSING_IDENTITY_FIELD';
  ELSIF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN status:='NEEDS_REVIEW';reason:='INVALID_EMAIL'; END IF;
  IF v_uid IS NOT NULL THEN
   SELECT id,full_name,batch_number,email INTO found_person FROM public.profiles
   WHERE trim(university_id)=v_uid ORDER BY created_at LIMIT 1;
   IF FOUND THEN status:='EXISTS';reason:='MATCHING_UNIVERSITY_ID'; END IF;
  END IF;
  IF status<>'EXISTS' AND v_email IS NOT NULL THEN
   SELECT id,full_name,batch_number,email INTO found_person FROM public.profiles
   WHERE lower(trim(email))=v_email ORDER BY created_at LIMIT 1;
   IF FOUND THEN status:='EXISTS';reason:='MATCHING_EMAIL'; END IF;
  END IF;
  output:=output||jsonb_build_array(jsonb_build_object('row',e->'row','status',status,'reason',reason,
    'existingId',CASE WHEN status='EXISTS' THEN found_person.id ELSE NULL END,
    'existingName',CASE WHEN status='EXISTS' THEN found_person.full_name ELSE NULL END,
    'existingBatch',CASE WHEN status='EXISTS' THEN found_person.batch_number ELSE NULL END));
 END LOOP;
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_check_import_people(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_check_import_people(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.kmsa_save_import_review(p_batch integer,p_people jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e jsonb; actor uuid; n integer:=0;
BEGIN
 actor:=public.kmsa_admin_actor(); IF actor IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF jsonb_typeof(p_people)<>'array' OR jsonb_array_length(p_people)>500 THEN RAISE EXCEPTION 'INVALID_BATCH_SIZE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.kmsa_batches WHERE batch_number=p_batch) THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p_people) LOOP
  IF length(trim(coalesce(e->>'name','')))<2 THEN CONTINUE; END IF;
  INSERT INTO public.kmsa_import_review(batch_number,full_name,university_id,email,created_by)
   VALUES(p_batch,left(trim(e->>'name'),255),nullif(left(trim(e->>'universityId'),64),''),nullif(left(trim(e->>'email'),255),''),actor)
   ON CONFLICT DO NOTHING;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_save_import_review(integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_save_import_review(integer,jsonb) TO authenticated;
-- Preserve leadership succession independently of the current membership slot.
CREATE TABLE IF NOT EXISTS public.kmsa_leadership_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cycle_id uuid NOT NULL REFERENCES public.cycles(id),
 seat_role text NOT NULL,
 secretariat_id uuid REFERENCES public.secretariats(id),
 old_profile_id uuid REFERENCES public.profiles(id),
 new_profile_id uuid NOT NULL REFERENCES public.profiles(id),
 performed_by uuid NOT NULL REFERENCES public.profiles(id),
 changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kmsa_leadership_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kmsa_leadership_changes_admin_read ON public.kmsa_leadership_changes;
CREATE POLICY kmsa_leadership_changes_admin_read ON public.kmsa_leadership_changes FOR SELECT TO authenticated
 USING(public.kmsa_admin_actor() IS NOT NULL);
REVOKE ALL ON public.kmsa_leadership_changes FROM anon,authenticated;
GRANT SELECT ON public.kmsa_leadership_changes TO authenticated;

CREATE OR REPLACE FUNCTION public.kmsa_admin_replace_leader(
 p_cycle uuid,p_role text,p_secretariat uuid,p_new_profile uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; former uuid; target_cycle public.cycles%ROWTYPE; candidate public.profiles%ROWTYPE;
BEGIN
 actor:=public.kmsa_admin_actor(); IF actor IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_role NOT IN ('PRESIDENT','GS','SECRETARY') THEN RAISE EXCEPTION 'LEADERSHIP_ROLE_INVALID'; END IF;
 IF (p_role='SECRETARY' AND p_secretariat IS NULL) OR (p_role<>'SECRETARY' AND p_secretariat IS NOT NULL) THEN
  RAISE EXCEPTION 'SECRETARIAT_SEAT_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(74631929);
 SELECT * INTO target_cycle FROM public.cycles WHERE id=p_cycle FOR UPDATE;
 IF NOT FOUND OR target_cycle.status NOT IN('DRAFT','OPEN') THEN RAISE EXCEPTION 'CYCLE_NOT_EDITABLE'; END IF;
 SELECT * INTO candidate FROM public.profiles WHERE id=p_new_profile AND active FOR UPDATE;
 IF NOT FOUND OR candidate.role='ADMIN' THEN RAISE EXCEPTION 'CANDIDATE_NOT_AVAILABLE'; END IF;
 IF EXISTS(SELECT 1 FROM public.cycle_memberships m WHERE m.cycle_id=p_cycle AND m.profile_id=p_new_profile
    AND m.role IN ('PRESIDENT','GS','SECRETARY') AND m.ended_at IS NULL
    AND NOT (m.role=p_role AND m.secretariat_id IS NOT DISTINCT FROM p_secretariat))
 THEN RAISE EXCEPTION 'CANDIDATE_HOLDS_ANOTHER_EXECUTIVE_SEAT'; END IF;
 SELECT profile_id INTO former FROM public.cycle_memberships m
 WHERE m.cycle_id=p_cycle AND m.role=p_role AND m.ended_at IS NULL
 AND m.secretariat_id IS NOT DISTINCT FROM p_secretariat LIMIT 1 FOR UPDATE;
 IF former=p_new_profile THEN RETURN jsonb_build_object('ok',true,'unchanged',true); END IF;
 IF former IS NOT NULL THEN
  UPDATE public.cycle_memberships SET role='MEMBER',secretariat_id=NULL,ended_at=NULL
   WHERE cycle_id=p_cycle AND profile_id=former;
 END IF;
 INSERT INTO public.cycle_memberships(cycle_id,profile_id,role,secretariat_id,ended_at)
 VALUES(p_cycle,p_new_profile,p_role,p_secretariat,NULL)
 ON CONFLICT(cycle_id,profile_id) DO UPDATE SET role=excluded.role,secretariat_id=excluded.secretariat_id,ended_at=NULL;
 INSERT INTO public.kmsa_leadership_changes(cycle_id,seat_role,secretariat_id,old_profile_id,new_profile_id,performed_by)
 VALUES(p_cycle,p_role,p_secretariat,former,p_new_profile,actor);
 IF target_cycle.is_current THEN
  IF former IS NOT NULL THEN
   UPDATE public.profiles SET role='MEMBER',secretariat_id=NULL WHERE id=former AND role<>'ADMIN';
  END IF;
  UPDATE public.profiles SET role=p_role::public.app_role,
   secretariat_id=CASE WHEN p_role='SECRETARY' THEN p_secretariat ELSE NULL END
   WHERE id=p_new_profile AND role<>'ADMIN';
 END IF;
 RETURN jsonb_build_object('ok',true,'old',former,'new',p_new_profile);
END $$;
REVOKE ALL ON FUNCTION public.kmsa_admin_replace_leader(uuid,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kmsa_admin_replace_leader(uuid,text,uuid,uuid) TO authenticated;

-- Optional separate assistant seat (not equivalent to GS authority).
CREATE OR REPLACE FUNCTION public.kmsa_admin_replace_assistant(p_cycle uuid,p_profile uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; old_profile uuid; c public.cycles%ROWTYPE;
BEGIN
 actor:=public.kmsa_admin_actor(); IF actor IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(74631929);
 SELECT * INTO c FROM public.cycles WHERE id=p_cycle FOR UPDATE;
 IF NOT FOUND OR c.status NOT IN('DRAFT','OPEN') THEN RAISE EXCEPTION 'CYCLE_NOT_EDITABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_profile AND active AND role<>'ADMIN') THEN RAISE EXCEPTION 'MEMBER_NOT_AVAILABLE'; END IF;
 IF EXISTS(SELECT 1 FROM public.cycle_memberships WHERE cycle_id=p_cycle AND profile_id=p_profile
  AND role IN('PRESIDENT','GS','SECRETARY') AND ended_at IS NULL) THEN RAISE EXCEPTION 'MEMBER_IS_ALREADY_EXECUTIVE'; END IF;
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
COMMIT;
