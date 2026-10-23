create extension if not exists pgcrypto;

create type public.app_role as enum ('APPLICANT','MEMBER','SECRETARY','GS','ADMIN');
create type public.proposal_status as enum ('DRAFT','WITH_SECRETARY','REVISION_REQUESTED','REVISED','WITH_GS','APPROVED','NOT_APPROVED','DEFERRED','WITHDRAWN');
create type public.execution_status as enum ('NOT_STARTED','IN_PROGRESS','AT_RISK','BLOCKED','COMPLETED','CANCELLED');
create type public.milestone_status as enum ('NOT_STARTED','IN_PROGRESS','AT_RISK','BLOCKED','READY_FOR_VERIFICATION','VERIFIED','CANCELLED');
create type public.priority_level as enum ('LOW','NORMAL','HIGH','CRITICAL');

create table public.cycles (
  id uuid primary key default gen_random_uuid(), code text unique not null, name text not null,
  is_current boolean not null default false, status text not null default 'OPEN',
  opened_at timestamptz default now(), closed_at timestamptz, created_at timestamptz not null default now()
);
create unique index one_current_cycle on public.cycles ((is_current)) where is_current;

create table public.secretariats (
  id uuid primary key default gen_random_uuid(), code text unique not null, name_ar text not null,
  active boolean not null default true, created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid unique not null references auth.users(id) on delete cascade,
  university_id text unique, email text unique not null, full_name text not null,
  role public.app_role not null default 'APPLICANT', secretariat_id uuid references public.secretariats(id),
  telegram_user_id text unique, telegram_chat_id text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index profiles_auth_user_idx on public.profiles(auth_user_id);
create index profiles_secretariat_idx on public.profiles(secretariat_id);
create index profiles_university_id_idx on public.profiles(university_id);

create table public.plans (
  id uuid primary key default gen_random_uuid(), cycle_id uuid not null references public.cycles(id),
  secretariat_id uuid not null references public.secretariats(id), title text not null,
  period_start date, period_end date, status text not null default 'DRAFT',
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index plans_secretariat_idx on public.plans(secretariat_id);
create index plans_cycle_idx on public.plans(cycle_id);

create table public.proposals (
  id uuid primary key default gen_random_uuid(), internal_id text unique not null,
  cycle_id uuid not null references public.cycles(id), applicant_id uuid not null references public.profiles(id),
  applicant_name text not null, applicant_email text not null, secretariat_id uuid not null references public.secretariats(id),
  title text not null, status public.proposal_status not null default 'DRAFT', execution_status public.execution_status not null default 'NOT_STARTED',
  proposed_period text, submitted_at timestamptz, needed_by timestamptz, urgency text, urgency_reason text,
  primary_beneficiaries text, trigger_reality text, primary_benefit text, secondary_benefits text,
  intervention text, success_criterion text, context_factors text, funding_needed text, funding_dependence text,
  estimated_cost text, funding_source text, current_version integer not null default 1, approved_version integer,
  secretary_due_at timestamptz, gs_due_at timestamptz, approved_at timestamptz, withdrawn_at timestamptz,
  drive_folder_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index proposals_applicant_idx on public.proposals(applicant_id);
create index proposals_secretariat_idx on public.proposals(secretariat_id);
create index proposals_status_idx on public.proposals(status);
create index proposals_cycle_idx on public.proposals(cycle_id);

create table public.proposal_versions (
  id uuid primary key default gen_random_uuid(), proposal_id uuid not null references public.proposals(id) on delete cascade,
  version_no integer not null, source text not null default 'STRUCTURED', created_by uuid references public.profiles(id),
  snapshot jsonb not null, change_summary text, doc_drive_file_id text, pdf_drive_file_id text, docx_drive_file_id text,
  original_upload_drive_file_id text, is_current boolean not null default true, is_approved boolean not null default false,
  created_at timestamptz not null default now(), unique(proposal_id, version_no)
);
create index proposal_versions_proposal_idx on public.proposal_versions(proposal_id,version_no desc);

create table public.proposal_actions (
  id uuid primary key default gen_random_uuid(), proposal_id uuid not null references public.proposals(id) on delete cascade,
  actor_id uuid references public.profiles(id), actor_role public.app_role, action_type text not null,
  from_status public.proposal_status, to_status public.proposal_status, note_text text, meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index proposal_actions_proposal_idx on public.proposal_actions(proposal_id,created_at desc);

create table public.initiatives (
  id uuid primary key default gen_random_uuid(), cycle_id uuid not null references public.cycles(id),
  plan_id uuid references public.plans(id) on delete set null, proposal_id uuid references public.proposals(id) on delete set null,
  secretariat_id uuid not null references public.secretariats(id), owner_id uuid not null references public.profiles(id),
  title text not null, objective text, source_type text not null default 'PLAN', status text not null default 'ACTIVE',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index initiatives_secretariat_idx on public.initiatives(secretariat_id);
create index initiatives_owner_idx on public.initiatives(owner_id);

create table public.results (
  id uuid primary key default gen_random_uuid(), initiative_id uuid not null references public.initiatives(id) on delete cascade,
  statement text not null, success_measure text, owner_id uuid references public.profiles(id), due_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index results_initiative_idx on public.results(initiative_id);

create table public.milestones (
  id uuid primary key default gen_random_uuid(), result_id uuid not null references public.results(id) on delete cascade,
  secretariat_id uuid not null references public.secretariats(id), owner_id uuid not null references public.profiles(id),
  title text not null, description text, due_at timestamptz not null, status public.milestone_status not null default 'NOT_STARTED',
  priority public.priority_level not null default 'NORMAL', verification_criteria text not null,
  verified_at timestamptz, cancelled_at timestamptz, created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index milestones_secretariat_idx on public.milestones(secretariat_id);
create index milestones_owner_idx on public.milestones(owner_id);
create index milestones_status_idx on public.milestones(status);
create index milestones_due_idx on public.milestones(due_at);

create table public.weekly_commitments (
  id uuid primary key default gen_random_uuid(), milestone_id uuid not null references public.milestones(id) on delete cascade,
  owner_id uuid not null references public.profiles(id), week_start date not null,
  commitment_text text not null, target_at timestamptz, status text not null default 'OPEN',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(milestone_id,week_start)
);
create index weekly_commitments_owner_idx on public.weekly_commitments(owner_id,week_start desc);

create table public.milestone_evidence (
  id uuid primary key default gen_random_uuid(), milestone_id uuid not null references public.milestones(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id), evidence_type text not null,
  note text, url text, drive_file_id text, created_at timestamptz not null default now()
);
create index evidence_milestone_idx on public.milestone_evidence(milestone_id,created_at desc);

create table public.blockers (
  id uuid primary key default gen_random_uuid(), milestone_id uuid not null references public.milestones(id) on delete cascade,
  opened_by uuid not null references public.profiles(id), description text not null, severity text not null default 'MEDIUM',
  status text not null default 'OPEN', resolution text, resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), resolved_at timestamptz
);
create index blockers_milestone_idx on public.blockers(milestone_id,status);

create table public.interventions (
  id uuid primary key default gen_random_uuid(), milestone_id uuid not null references public.milestones(id) on delete cascade,
  secretary_id uuid not null references public.profiles(id), action_text text not null, due_at timestamptz,
  status text not null default 'OPEN', created_at timestamptz not null default now(), closed_at timestamptz
);
create index interventions_milestone_idx on public.interventions(milestone_id,created_at desc);

create table public.verifications (
  id uuid primary key default gen_random_uuid(), milestone_id uuid not null references public.milestones(id) on delete cascade,
  verifier_id uuid not null references public.profiles(id), decision text not null check(decision in ('VERIFIED','RETURNED')),
  note text, created_at timestamptz not null default now()
);
create index verifications_milestone_idx on public.verifications(milestone_id,created_at desc);

create table public.oversight_notes (
  id uuid primary key default gen_random_uuid(), secretariat_id uuid not null references public.secretariats(id),
  milestone_id uuid references public.milestones(id) on delete set null, created_by uuid not null references public.profiles(id),
  note text not null, severity text not null default 'INFO', secretary_response text, resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(), cycle_id uuid not null references public.cycles(id), title text not null,
  held_at timestamptz not null, chair_id uuid references public.profiles(id), status text not null default 'DRAFT',
  minutes_drive_file_id text, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.decisions (
  id uuid primary key default gen_random_uuid(), meeting_id uuid references public.meetings(id) on delete set null,
  secretariat_id uuid references public.secretariats(id), title text not null, decision_text text not null,
  owner_id uuid references public.profiles(id), due_at timestamptz, status text not null default 'OPEN',
  related_entity_type text, related_entity_id uuid, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);

create table public.file_assets (
  id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id uuid not null,
  file_kind text not null, file_name text not null, mime_type text, drive_file_id text not null,
  version_no integer, uploaded_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create index file_assets_entity_idx on public.file_assets(entity_type,entity_id,created_at desc);

create table public.notification_log (
  id uuid primary key default gen_random_uuid(), channel text not null, recipient text not null, event_type text not null,
  entity_type text, entity_id uuid, status text not null, provider_message_id text, error text,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key, actor_id uuid references public.profiles(id), action text not null,
  entity_type text not null, entity_id uuid, before_data jsonb, after_data jsonb, meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.system_settings (
  key text primary key, value jsonb not null, description text, updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);

create table public.proposal_counters (
  cycle_id uuid not null references public.cycles(id), secretariat_id uuid not null references public.secretariats(id),
  counter integer not null default 0, primary key(cycle_id,secretariat_id)
);

create table public.login_attempts (
  id bigserial primary key, identifier_hash text not null, ip_hash text, success boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_recent_idx on public.login_attempts(identifier_hash,created_at desc);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger plans_touch before update on public.plans for each row execute function public.touch_updated_at();
create trigger proposals_touch before update on public.proposals for each row execute function public.touch_updated_at();
create trigger initiatives_touch before update on public.initiatives for each row execute function public.touch_updated_at();
create trigger results_touch before update on public.results for each row execute function public.touch_updated_at();
create trigger milestones_touch before update on public.milestones for each row execute function public.touch_updated_at();
create trigger commitments_touch before update on public.weekly_commitments for each row execute function public.touch_updated_at();

create or replace function public.current_profile_id() returns uuid language sql stable security definer set search_path=public as $$
 select id from public.profiles where auth_user_id=auth.uid() and active=true limit 1;
$$;
create or replace function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$
 select role from public.profiles where auth_user_id=auth.uid() and active=true limit 1;
$$;
create or replace function public.current_secretariat_id() returns uuid language sql stable security definer set search_path=public as $$
 select secretariat_id from public.profiles where auth_user_id=auth.uid() and active=true limit 1;
$$;

create or replace function public.next_proposal_internal_id(p_secretariat uuid) returns text
language plpgsql security definer set search_path=public as $$
declare c record; s record; n integer;
begin
 select * into c from public.cycles where is_current=true limit 1;
 if c.id is null then raise exception 'No current cycle'; end if;
 select * into s from public.secretariats where id=p_secretariat;
 if s.id is null then raise exception 'Secretariat not found'; end if;
 insert into public.proposal_counters(cycle_id,secretariat_id,counter) values(c.id,p_secretariat,1)
 on conflict(cycle_id,secretariat_id) do update set counter=public.proposal_counters.counter+1
 returning counter into n;
 return c.code||'-'||s.code||'-'||lpad(n::text,4,'0');
end $$;
