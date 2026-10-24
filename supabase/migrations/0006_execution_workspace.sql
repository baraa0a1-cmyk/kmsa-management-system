-- KMSA execution workspace v1
-- Adds result-lead collaboration, early intervention, delegated permissions, and president oversight.

alter type public.app_role add value if not exists 'PRESIDENT';

alter table public.initiatives add column if not exists secretary_id uuid references public.profiles(id);
alter table public.initiatives add column if not exists setup_status text not null default 'ACTIVE';
alter table public.initiatives add column if not exists health text not null default 'ON_TRACK';
alter table public.initiatives add column if not exists target_due_at timestamptz;
alter table public.initiatives add column if not exists activated_at timestamptz;
alter table public.initiatives add column if not exists last_update_at timestamptz;
alter table public.initiatives add column if not exists completed_at timestamptz;

alter table public.results add column if not exists assignment_status text not null default 'ACTIVE';
alter table public.results add column if not exists accepted_at timestamptz;
alter table public.results add column if not exists completed_at timestamptz;
alter table public.results add column if not exists assignment_feedback text;

alter table public.milestones add column if not exists design_status text not null default 'APPROVED';

alter table public.oversight_notes add column if not exists initiative_id uuid references public.initiatives(id) on delete set null;

create table if not exists public.project_updates (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  result_id uuid references public.results(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  health text not null default 'ON_TRACK' check (health in ('ON_TRACK','WATCH','AT_RISK','BLOCKED')),
  progress_note text not null,
  next_step text,
  next_check_at timestamptz,
  assistance_needed text,
  created_at timestamptz not null default now()
);
create index if not exists project_updates_initiative_idx on public.project_updates(initiative_id,created_at desc);

create table if not exists public.project_permissions (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  permission_key text,
  title text not null,
  description text,
  permission_type text not null default 'STANDARD' check (permission_type in ('STANDARD','SPECIAL')),
  scope_type text not null default 'OWN_SECRETARIAT' check (scope_type in ('OWN_SECRETARIAT','CROSS_SECRETARIAT','EXECUTIVE_COMMITTEE')),
  target_secretariat_id uuid references public.secretariats(id),
  requested_by uuid references public.profiles(id),
  requested_for uuid not null references public.profiles(id),
  rationale text,
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE','REJECTED','REVOKED')),
  decided_by uuid references public.profiles(id),
  decision_id uuid references public.decisions(id),
  decided_at timestamptz,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  unique(initiative_id, permission_key, requested_for)
);
create index if not exists project_permissions_pending_idx on public.project_permissions(status,scope_type,target_secretariat_id);


create table if not exists public.project_permission_approvals (
  id uuid primary key default gen_random_uuid(),
  permission_id uuid not null references public.project_permissions(id) on delete cascade,
  approval_kind text not null check (approval_kind in ('PROJECT_SECRETARY','TARGET_SECRETARY','EXECUTIVE_COMMITTEE')),
  target_secretariat_id uuid references public.secretariats(id),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  decided_by uuid references public.profiles(id),
  decision_id uuid references public.decisions(id),
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique(permission_id,approval_kind)
);
create index if not exists project_permission_approvals_pending_idx on public.project_permission_approvals(status,approval_kind,target_secretariat_id);

create table if not exists public.project_interventions (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  result_id uuid references public.results(id) on delete set null,
  milestone_id uuid references public.milestones(id) on delete set null,
  secretary_id uuid not null references public.profiles(id),
  trigger_type text not null default 'EARLY_WARNING',
  reason text,
  action_text text not null,
  due_at timestamptz,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists project_interventions_initiative_idx on public.project_interventions(initiative_id,created_at desc);

-- Existing projects become fully active legacy projects.
update public.initiatives set setup_status='ACTIVE', activated_at=coalesce(activated_at,created_at) where setup_status is null or setup_status='ACTIVE';
update public.results set assignment_status='ACTIVE', accepted_at=coalesce(accepted_at,created_at) where assignment_status is null or assignment_status='ACTIVE';
update public.milestones set design_status='APPROVED' where design_status is null;

create or replace function public.can_read_secretariat(p_secretariat uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select case public.current_role()::text
    when 'ADMIN' then true
    when 'PRESIDENT' then true
    when 'GS' then true
    when 'SECRETARY' then public.current_secretariat_id()=p_secretariat
    else false end;
$$;

create or replace function public.can_manage_secretariat(p_secretariat uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select case public.current_role()::text
    when 'ADMIN' then true
    when 'SECRETARY' then public.current_secretariat_id()=p_secretariat
    else false end;
$$;

create or replace function public.can_read_proposal(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from public.proposals p
   where p.id=p_id and (
     p.applicant_id=public.current_profile_id() or
     public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
     (public.current_role()::text='SECRETARY' and p.secretariat_id=public.current_secretariat_id())
   )
 );
$$;

create or replace function public.can_read_initiative(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from public.initiatives i
   where i.id=p_id and (
     i.owner_id=public.current_profile_id() or
     i.secretary_id=public.current_profile_id() or
     public.can_read_secretariat(i.secretariat_id) or
     exists(select 1 from public.results r where r.initiative_id=i.id and r.owner_id=public.current_profile_id())
   )
 );
$$;

create or replace function public.can_read_milestone(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from public.milestones m
   join public.results r on r.id=m.result_id
   where m.id=p_id and (
     m.owner_id=public.current_profile_id() or r.owner_id=public.current_profile_id() or
     public.can_read_initiative(r.initiative_id)
   )
 );
$$;

alter table public.project_updates enable row level security;
alter table public.project_permissions enable row level security;
alter table public.project_interventions enable row level security;
alter table public.project_permission_approvals enable row level security;

grant select on public.project_updates, public.project_permissions, public.project_interventions, public.project_permission_approvals to authenticated;
grant execute on function public.can_read_initiative(uuid) to authenticated;

-- Refresh read policies to separate a result lead from a secretary's full visibility.
drop policy if exists secretariats_read on public.secretariats;
create policy secretariats_read on public.secretariats for select to authenticated using (active or public.current_role()::text in ('GS','PRESIDENT','ADMIN'));

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
 id=public.current_profile_id() or public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
 (public.current_role()::text='SECRETARY' and secretariat_id=public.current_secretariat_id())
);

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated using (public.can_read_secretariat(secretariat_id));

drop policy if exists proposals_read on public.proposals;
create policy proposals_read on public.proposals for select to authenticated using (
 applicant_id=public.current_profile_id() or public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
 (public.current_role()::text='SECRETARY' and secretariat_id=public.current_secretariat_id())
);

drop policy if exists initiatives_read on public.initiatives;
create policy initiatives_read on public.initiatives for select to authenticated using (public.can_read_initiative(id));

drop policy if exists results_read on public.results;
create policy results_read on public.results for select to authenticated using (public.can_read_initiative(initiative_id));

drop policy if exists milestones_read on public.milestones;
create policy milestones_read on public.milestones for select to authenticated using (public.can_read_milestone(id));

drop policy if exists oversight_read on public.oversight_notes;
create policy oversight_read on public.oversight_notes for select to authenticated using (
 public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
 (public.current_role()::text='SECRETARY' and secretariat_id=public.current_secretariat_id())
);

drop policy if exists meetings_read on public.meetings;
create policy meetings_read on public.meetings for select to authenticated using (public.current_role()::text in ('MEMBER','SECRETARY','GS','PRESIDENT','ADMIN'));

drop policy if exists decisions_read on public.decisions;
create policy decisions_read on public.decisions for select to authenticated using (
 public.current_role()::text in ('GS','PRESIDENT','ADMIN') or secretariat_id is null or public.can_read_secretariat(secretariat_id)
);

drop policy if exists files_read on public.file_assets;
create policy files_read on public.file_assets for select to authenticated using (
 (entity_type='PROPOSAL' and public.can_read_proposal(entity_id)) or
 (entity_type='MILESTONE' and public.can_read_milestone(entity_id)) or
 public.current_role()::text in ('GS','PRESIDENT','ADMIN')
);

drop policy if exists notifications_read on public.notification_log;
create policy notifications_read on public.notification_log for select to authenticated using (public.current_role()::text in ('GS','PRESIDENT','ADMIN'));

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.current_role()::text in ('GS','PRESIDENT','ADMIN'));

drop policy if exists project_updates_read on public.project_updates;
create policy project_updates_read on public.project_updates for select to authenticated using (public.can_read_initiative(initiative_id));
drop policy if exists project_permissions_read on public.project_permissions;
create policy project_permissions_read on public.project_permissions for select to authenticated using (
 public.can_read_initiative(initiative_id) or public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
 (public.current_role()::text='SECRETARY' and target_secretariat_id=public.current_secretariat_id())
);
drop policy if exists project_interventions_read on public.project_interventions;
create policy project_interventions_read on public.project_interventions for select to authenticated using (public.can_read_initiative(initiative_id));

drop policy if exists project_permission_approvals_read on public.project_permission_approvals;
create policy project_permission_approvals_read on public.project_permission_approvals for select to authenticated using (
 exists(
   select 1 from public.project_permissions pp
   where pp.id=permission_id and (
     public.can_read_initiative(pp.initiative_id) or
     public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
     (public.current_role()::text='SECRETARY' and (
       target_secretariat_id=public.current_secretariat_id() or
       exists(select 1 from public.initiatives i where i.id=pp.initiative_id and i.secretary_id=public.current_profile_id())
     ))
   )
 )
);

-- A compact cross-secretariat snapshot for GS / President / Admin.
create or replace function public.executive_workspace_snapshot() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r text:=coalesce(public.current_role()::text,''); out jsonb;
begin
 if r not in ('GS','PRESIDENT','ADMIN') then raise exception 'not allowed'; end if;
 with p as (
   select i.id,i.secretariat_id,i.health,i.setup_status,i.target_due_at,i.last_update_at,
          i.secretary_id,i.owner_id,
          exists(select 1 from public.blockers b join public.milestones m on m.id=b.milestone_id join public.results rr on rr.id=m.result_id where rr.initiative_id=i.id and b.status='OPEN') blocked,
          exists(select 1 from public.milestones m join public.results rr on rr.id=m.result_id where rr.initiative_id=i.id and m.status not in ('VERIFIED','CANCELLED') and m.due_at<now()+interval '72 hours') due_soon
   from public.initiatives i where i.status not in ('COMPLETED','CANCELLED')
 ), agg as (
   select s.id,s.name_ar,
     count(p.id)::int active_projects,
     count(p.id) filter(where p.setup_status<>'ACTIVE')::int setup_pending,
     count(p.id) filter(where p.health in ('WATCH','AT_RISK','BLOCKED') or p.blocked or p.due_soon)::int needs_attention,
     count(p.id) filter(where p.blocked)::int blocked,
     count(p.id) filter(where p.last_update_at is null or p.last_update_at<now()-interval '5 days')::int stale
   from public.secretariats s left join p on p.secretariat_id=s.id where s.active=true group by s.id,s.name_ar
 )
 select jsonb_build_object(
   'secretariats',coalesce((select jsonb_agg(to_jsonb(agg) order by needs_attention desc,active_projects desc) from agg),'[]'::jsonb),
   'pending_permissions',(select count(*) from public.project_permission_approvals where status='PENDING'),
   'proposal_queue',(select count(*) from public.proposals where status='WITH_GS')
 ) into out;
 return out;
end $$;
grant execute on function public.executive_workspace_snapshot() to authenticated;

create or replace function public.can_read_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select
   p_profile=public.current_profile_id() or
   public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
   (public.current_role()::text='SECRETARY' and exists(select 1 from public.profiles p where p.id=p_profile and p.secretariat_id=public.current_secretariat_id())) or
   exists(
     select 1 from public.initiatives i
     where (i.owner_id=public.current_profile_id() or i.secretary_id=public.current_profile_id() or exists(select 1 from public.results r where r.initiative_id=i.id and r.owner_id=public.current_profile_id()))
       and p_profile in (i.owner_id,i.secretary_id)
   );
$$;
grant execute on function public.can_read_profile(uuid) to authenticated;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (public.can_read_profile(id));
