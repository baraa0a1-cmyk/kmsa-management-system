-- KMSA v5.2: lightweight, independently auditable supervision; no approval gate for execution.
-- Apply after V5.1. Server functions are the only writers; safe to re-run.
alter table public.milestones add column if not exists relative_hours integer not null default 0;
alter table public.milestones add column if not exists completed_reported_at timestamptz;
-- Older v5.1 milestones may already be marked ready/completed. Preserve their actual reported timestamp.
update public.milestones set completed_reported_at=coalesce(verified_at,status_updated_at,updated_at)
 where status in ('READY_FOR_VERIFICATION','VERIFIED') and completed_reported_at is null;
-- Existing periodic reports are now optional; old due counters must not trigger obsolete warnings.
update public.initiatives set next_update_due_at=null where setup_status='ACTIVE' and next_update_due_at is not null;
-- Rebase pre-existing relative dates against already-completed predecessor milestones.
update public.milestones as dependent
set due_at = predecessor.completed_reported_at + (coalesce(dependent.relative_days,0) * interval '1 day')
             + (coalesce(dependent.relative_hours,0) * interval '1 hour')
from public.milestones as predecessor
where dependent.relative_to_milestone_id=predecessor.id
  and dependent.deadline_mode='RELATIVE' and predecessor.completed_reported_at is not null
  and dependent.status not in ('READY_FOR_VERIFICATION','VERIFIED','CANCELLED');


create table if not exists public.project_supervision_assignments (
 initiative_id uuid primary key references public.initiatives(id) on delete cascade,
 supervisor_id uuid not null references public.profiles(id),
 delegated_by uuid not null references public.profiles(id),
 assigned_at timestamptz not null default now()
);
create index if not exists project_supervision_by_person on public.project_supervision_assignments(supervisor_id);
alter table public.project_supervision_assignments enable row level security;
grant select on public.project_supervision_assignments to authenticated;
drop policy if exists project_supervision_read on public.project_supervision_assignments;
create policy project_supervision_read on public.project_supervision_assignments for select to authenticated
 using (supervisor_id=public.current_profile_id() or exists (
   select 1 from public.initiatives i where i.id=initiative_id and (
   i.secretary_id=public.current_profile_id() or public.can_read_secretariat(i.secretariat_id))));

-- Narrow delegated project access without assigning SECRETARY or ADMIN privileges.
create or replace function public.can_read_initiative(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.initiatives i where i.id=p_id and (
  i.secretary_id=public.current_profile_id() or public.can_read_secretariat(i.secretariat_id)
  or (i.approval_status='APPROVED' and (
   i.owner_id=public.current_profile_id()
   or exists(select 1 from public.results r where r.initiative_id=i.id and r.owner_id=public.current_profile_id())
   or exists(select 1 from public.project_supervision_assignments a where a.initiative_id=i.id and a.supervisor_id=public.current_profile_id())
  ))
 ));
$$;
grant execute on function public.can_read_initiative(uuid) to authenticated;

create table if not exists public.milestone_supervision_events (
 id uuid primary key default gen_random_uuid(),
 initiative_id uuid not null references public.initiatives(id) on delete restrict,
 milestone_id uuid not null references public.milestones(id) on delete restrict,
 actor_id uuid not null references public.profiles(id),
 event_type text not null check(event_type in ('COMPLETION_READ','PROGRESS_REVIEW','UPDATE_REQUEST','REQUEST_ANSWERED')),
 note text,
 related_request_id uuid references public.milestone_supervision_events(id),
 created_at timestamptz not null default now()
);
create index if not exists milestone_supervision_milestone on public.milestone_supervision_events(milestone_id,created_at desc);
create index if not exists milestone_supervision_project on public.milestone_supervision_events(initiative_id,created_at desc);
alter table public.milestone_supervision_events enable row level security;
grant select on public.milestone_supervision_events to authenticated;
drop policy if exists milestone_supervision_read on public.milestone_supervision_events;
create policy milestone_supervision_read on public.milestone_supervision_events for select to authenticated using(public.can_read_initiative(initiative_id));

create table if not exists public.milestone_deadline_requests (
 id uuid primary key default gen_random_uuid(),
 initiative_id uuid not null references public.initiatives(id) on delete restrict,
 milestone_id uuid not null references public.milestones(id) on delete restrict,
 requested_by uuid not null references public.profiles(id),
 original_due_at timestamptz not null,
 proposed_due_at timestamptz not null,
 reason text not null,
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
 decided_by uuid references public.profiles(id),
 decided_at timestamptz,
 decision_note text,
 created_at timestamptz not null default now(),
 check(proposed_due_at<>original_due_at)
);
create unique index if not exists milestone_deadline_one_pending on public.milestone_deadline_requests(milestone_id) where status='PENDING';
alter table public.milestone_deadline_requests enable row level security;
grant select on public.milestone_deadline_requests to authenticated;
drop policy if exists milestone_deadline_requests_read on public.milestone_deadline_requests;
create policy milestone_deadline_requests_read on public.milestone_deadline_requests for select to authenticated using(public.can_read_initiative(initiative_id));
-- No INSERT/UPDATE/DELETE policies on event/request tables: only trusted workflow writes.
