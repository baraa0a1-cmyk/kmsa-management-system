-- KMSA v5.1: compact project follow-up, immutable append-only readable activity.
-- Run only AFTER the earlier Workspace v5 migrations. Safe to re-run.
create table if not exists public.project_activity_entries (
 id uuid primary key default gen_random_uuid(),
 initiative_id uuid not null references public.initiatives(id) on delete restrict,
 milestone_id uuid references public.milestones(id) on delete set null,
 author_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('MILESTONE_UPDATE','PERIODIC_CHECKIN','SECRETARY_NOTE','INTERVENTION','REFERENCE','LEAD_NOTE')),
 note text,
 status_after text,
 reference_url text check(reference_url is null or reference_url ~ '^https://'),
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists project_activity_entries_project_idx on public.project_activity_entries(initiative_id,created_at desc);
create index if not exists project_activity_entries_milestone_idx on public.project_activity_entries(milestone_id,created_at desc) where milestone_id is not null;
alter table public.project_activity_entries enable row level security;
grant select on public.project_activity_entries to authenticated;
drop policy if exists project_activity_entries_read on public.project_activity_entries;
create policy project_activity_entries_read on public.project_activity_entries for select to authenticated
 using (public.can_read_initiative(initiative_id));
-- No client write policy: writes happen only through the authorized workflow function.
