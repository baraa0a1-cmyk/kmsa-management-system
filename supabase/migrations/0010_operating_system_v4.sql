-- KMSA Operating System v4
-- Focus: execution follow-up, lightweight roles, recurring duties, quick tasks,
-- recurring group events, resilient document jobs, personal notifications and readiness checks.

-- ---------- Proposal & document reliability ----------
alter table public.proposals add column if not exists proposal_type text not null default 'GENERAL';
alter table public.proposals add column if not exists submission_mode text not null default 'STRUCTURED';

alter table public.background_jobs add column if not exists dedupe_key text;
alter table public.background_jobs add column if not exists heartbeat_at timestamptz;
create unique index if not exists background_jobs_active_dedupe_idx
  on public.background_jobs(dedupe_key)
  where dedupe_key is not null and status in ('PENDING','PROCESSING');
create index if not exists background_jobs_processing_watchdog_idx
  on public.background_jobs(status,locked_at) where status='PROCESSING';

-- ---------- Lightweight operational positions ----------
-- This is deliberately NOT an org-chart system. A position exists only when it affects work.
create table if not exists public.operational_positions (
  id uuid primary key default gen_random_uuid(),
  secretariat_id uuid not null references public.secretariats(id),
  title text not null,
  description text,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(secretariat_id,title)
);

create table if not exists public.position_assignments (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.operational_positions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  scope_label text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists position_assignment_active_unique
  on public.position_assignments(position_id,profile_id,coalesce(scope_label,'')) where active=true;
create index if not exists position_assignments_profile_idx on public.position_assignments(profile_id,active);

create table if not exists public.position_duty_templates (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.operational_positions(id) on delete cascade,
  title text not null,
  description text,
  expected_output text,
  interval_days integer not null default 7 check(interval_days between 1 and 365),
  first_due_after_days integer not null default 7 check(first_due_after_days between 0 and 365),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists position_duty_templates_position_idx on public.position_duty_templates(position_id,active);

alter table public.routine_obligations add column if not exists source_type text not null default 'MANUAL';
alter table public.routine_obligations add column if not exists position_assignment_id uuid references public.position_assignments(id) on delete set null;
alter table public.routine_obligations add column if not exists duty_template_id uuid references public.position_duty_templates(id) on delete set null;
create unique index if not exists routine_position_template_active_unique
  on public.routine_obligations(position_assignment_id,duty_template_id)
  where active=true and position_assignment_id is not null and duty_template_id is not null;

-- ---------- Quick tasks ----------
create table if not exists public.quick_tasks (
  id uuid primary key default gen_random_uuid(),
  secretariat_id uuid not null references public.secretariats(id),
  title text not null,
  description text,
  assignee_id uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  due_at timestamptz,
  priority text not null default 'NORMAL' check(priority in ('LOW','NORMAL','HIGH','CRITICAL')),
  status text not null default 'OPEN' check(status in ('OPEN','IN_PROGRESS','WAITING_EXTERNAL','BLOCKED','DONE','CANCELLED')),
  assignee_note text,
  evidence_url text,
  secretary_note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quick_tasks_assignee_idx on public.quick_tasks(assignee_id,status,due_at);
create index if not exists quick_tasks_secretariat_idx on public.quick_tasks(secretariat_id,status,due_at);

-- ---------- Recurring group events with individual attendance ----------
create table if not exists public.position_event_templates (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.operational_positions(id) on delete cascade,
  title text not null,
  description text,
  interval_days integer not null default 30 check(interval_days between 1 and 365),
  next_event_at timestamptz not null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_events (
  id uuid primary key default gen_random_uuid(),
  secretariat_id uuid not null references public.secretariats(id),
  template_id uuid references public.position_event_templates(id) on delete set null,
  position_id uuid references public.operational_positions(id) on delete set null,
  title text not null,
  scheduled_at timestamptz not null,
  status text not null default 'SCHEDULED' check(status in ('SCHEDULED','HELD','CANCELLED')),
  notes text,
  outcomes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(template_id,scheduled_at)
);

create table if not exists public.event_attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.work_events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  assignment_id uuid references public.position_assignments(id) on delete set null,
  status text not null default 'PENDING' check(status in ('PENDING','PRESENT','ABSENT','EXCUSED')),
  note text,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz,
  unique(event_id,profile_id)
);

-- ---------- Personal notification inbox ----------
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  action_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_notifications_profile_idx on public.user_notifications(profile_id,read_at,created_at desc);

-- ---------- Touch triggers ----------
drop trigger if exists operational_positions_touch on public.operational_positions;
create trigger operational_positions_touch before update on public.operational_positions for each row execute function public.touch_updated_at();
drop trigger if exists position_duty_templates_touch on public.position_duty_templates;
create trigger position_duty_templates_touch before update on public.position_duty_templates for each row execute function public.touch_updated_at();
drop trigger if exists quick_tasks_touch on public.quick_tasks;
create trigger quick_tasks_touch before update on public.quick_tasks for each row execute function public.touch_updated_at();
drop trigger if exists position_event_templates_touch on public.position_event_templates;
create trigger position_event_templates_touch before update on public.position_event_templates for each row execute function public.touch_updated_at();
drop trigger if exists work_events_touch on public.work_events;
create trigger work_events_touch before update on public.work_events for each row execute function public.touch_updated_at();

-- ---------- RLS ----------
alter table public.operational_positions enable row level security;
alter table public.position_assignments enable row level security;
alter table public.position_duty_templates enable row level security;
alter table public.quick_tasks enable row level security;
alter table public.position_event_templates enable row level security;
alter table public.work_events enable row level security;
alter table public.event_attendance enable row level security;
alter table public.user_notifications enable row level security;

grant select on public.operational_positions, public.position_assignments, public.position_duty_templates,
 public.quick_tasks, public.position_event_templates, public.work_events, public.event_attendance, public.user_notifications to authenticated;

create or replace function public.can_read_operational_position(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.operational_positions p
  where p.id=p_id and (
    public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
    (public.current_role()::text='SECRETARY' and p.secretariat_id=public.current_secretariat_id()) or
    exists(select 1 from public.position_assignments a where a.position_id=p.id and a.profile_id=public.current_profile_id() and a.active=true)
  )
 );
$$;
grant execute on function public.can_read_operational_position(uuid) to authenticated;

create or replace function public.can_read_quick_task(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.quick_tasks t
  where t.id=p_id and (
   t.assignee_id=public.current_profile_id() or t.assigned_by=public.current_profile_id() or
   public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
   (public.current_role()::text='SECRETARY' and t.secretariat_id=public.current_secretariat_id())
  )
 );
$$;
grant execute on function public.can_read_quick_task(uuid) to authenticated;

create or replace function public.can_read_work_event(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.work_events e
  where e.id=p_id and (
   public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
   (public.current_role()::text='SECRETARY' and e.secretariat_id=public.current_secretariat_id()) or
   exists(select 1 from public.event_attendance a where a.event_id=e.id and a.profile_id=public.current_profile_id())
  )
 );
$$;
grant execute on function public.can_read_work_event(uuid) to authenticated;

drop policy if exists operational_positions_read on public.operational_positions;
create policy operational_positions_read on public.operational_positions for select to authenticated using(public.can_read_operational_position(id));
drop policy if exists position_assignments_read on public.position_assignments;
create policy position_assignments_read on public.position_assignments for select to authenticated using(public.can_read_operational_position(position_id));
drop policy if exists position_duty_templates_read on public.position_duty_templates;
create policy position_duty_templates_read on public.position_duty_templates for select to authenticated using(public.can_read_operational_position(position_id));
drop policy if exists quick_tasks_read on public.quick_tasks;
create policy quick_tasks_read on public.quick_tasks for select to authenticated using(public.can_read_quick_task(id));
drop policy if exists position_event_templates_read on public.position_event_templates;
create policy position_event_templates_read on public.position_event_templates for select to authenticated using(public.can_read_operational_position(position_id));
drop policy if exists work_events_read on public.work_events;
create policy work_events_read on public.work_events for select to authenticated using(public.can_read_work_event(id));
drop policy if exists event_attendance_read on public.event_attendance;
create policy event_attendance_read on public.event_attendance for select to authenticated using(public.can_read_work_event(event_id));
drop policy if exists user_notifications_read on public.user_notifications;
create policy user_notifications_read on public.user_notifications for select to authenticated using(profile_id=public.current_profile_id());

-- ---------- Operational sheet functions ----------
create or replace function public.operational_position_sheet()
returns table(
 position_id uuid, secretariat_id uuid, secretariat_name text, title text, description text, active boolean,
 active_people bigint, active_duties bigint, active_events bigint
)
language sql stable security definer set search_path=public as $$
 select p.id,p.secretariat_id,s.name_ar,p.title,p.description,p.active,
  (select count(*) from public.position_assignments a where a.position_id=p.id and a.active=true),
  (select count(*) from public.position_duty_templates d where d.position_id=p.id and d.active=true),
  (select count(*) from public.position_event_templates e where e.position_id=p.id and e.active=true)
 from public.operational_positions p
 join public.secretariats s on s.id=p.secretariat_id
 where public.can_read_operational_position(p.id)
 order by p.active desc,p.title;
$$;
grant execute on function public.operational_position_sheet() to authenticated;

create or replace function public.quick_task_sheet()
returns table(
 task_id uuid, secretariat_id uuid, secretariat_name text, title text, description text,
 assignee_id uuid, assignee_name text, assigned_by uuid, assigned_by_name text,
 due_at timestamptz, priority text, status text, assignee_note text, secretary_note text,
 evidence_url text, overdue boolean, days_to_due integer, created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path=public as $$
 select t.id,t.secretariat_id,s.name_ar,t.title,t.description,t.assignee_id,a.full_name,t.assigned_by,b.full_name,
  t.due_at,t.priority,t.status,t.assignee_note,t.secretary_note,t.evidence_url,
  (t.due_at is not null and t.due_at<now() and t.status not in ('DONE','CANCELLED')),
  case when t.due_at is null then null else floor(extract(epoch from (t.due_at-now()))/86400.0)::int end,
  t.created_at,t.updated_at
 from public.quick_tasks t
 join public.secretariats s on s.id=t.secretariat_id
 join public.profiles a on a.id=t.assignee_id
 join public.profiles b on b.id=t.assigned_by
 where public.can_read_quick_task(t.id)
 order by (t.status in ('DONE','CANCELLED')),coalesce(t.due_at,'9999-12-31'::timestamptz),t.created_at desc;
$$;
grant execute on function public.quick_task_sheet() to authenticated;

-- Replace routine sheet with source/position visibility while preserving existing columns.
drop function if exists public.routine_obligation_sheet();
create function public.routine_obligation_sheet()
returns table(
 obligation_id uuid, secretariat_id uuid, secretariat_name text, title text, description text, expected_output text,
 owner_id uuid, owner_name text, secretary_id uuid, secretary_name text, cadence text, interval_days integer,
 next_due_at timestamptz, overdue boolean, days_to_due integer, last_status text, last_report text, last_output text,
 last_secretary_note text, last_submitted_at timestamptz, source_type text, position_title text, scope_label text,
 duty_template_id uuid, position_assignment_id uuid
)
language sql stable security definer set search_path=public as $$
 select r.id,r.secretariat_id,s.name_ar,r.title,r.description,r.expected_output,r.owner_id,o.full_name,r.secretary_id,sec.full_name,
  r.cadence,r.interval_days,r.next_due_at,(r.next_due_at<now()),floor(extract(epoch from (r.next_due_at-now()))/86400.0)::int,
  u.status,u.report_note,u.output_text,u.secretary_note,u.submitted_at,r.source_type,p.title,a.scope_label,r.duty_template_id,r.position_assignment_id
 from public.routine_obligations r
 join public.secretariats s on s.id=r.secretariat_id
 join public.profiles o on o.id=r.owner_id
 left join public.profiles sec on sec.id=r.secretary_id
 left join public.position_assignments a on a.id=r.position_assignment_id
 left join public.operational_positions p on p.id=a.position_id
 left join lateral (
  select x.status,x.report_note,x.output_text,x.secretary_note,x.submitted_at
  from public.routine_updates x where x.obligation_id=r.id order by x.submitted_at desc limit 1
 ) u on true
 where r.active=true and public.can_read_routine_obligation(r.id)
 order by r.next_due_at;
$$;
grant execute on function public.routine_obligation_sheet() to authenticated;

create or replace function public.work_event_sheet()
returns table(
 event_id uuid, secretariat_id uuid, secretariat_name text, title text, position_id uuid, position_title text,
 scheduled_at timestamptz, status text, notes text, outcomes text,
 total_people bigint, present_count bigint, absent_count bigint, excused_count bigint, pending_count bigint
)
language sql stable security definer set search_path=public as $$
 select e.id,e.secretariat_id,s.name_ar,e.title,e.position_id,p.title,e.scheduled_at,e.status,e.notes,e.outcomes,
  count(a.id),count(a.id) filter(where a.status='PRESENT'),count(a.id) filter(where a.status='ABSENT'),
  count(a.id) filter(where a.status='EXCUSED'),count(a.id) filter(where a.status='PENDING')
 from public.work_events e
 join public.secretariats s on s.id=e.secretariat_id
 left join public.operational_positions p on p.id=e.position_id
 left join public.event_attendance a on a.event_id=e.id
 where public.can_read_work_event(e.id)
 group by e.id,s.name_ar,p.title
 order by e.scheduled_at desc;
$$;
grant execute on function public.work_event_sheet() to authenticated;

create or replace function public.user_notification_feed(p_limit integer default 30)
returns table(id uuid,event_type text,title text,body text,entity_type text,entity_id uuid,action_path text,read_at timestamptz,created_at timestamptz)
language sql stable security definer set search_path=public as $$
 select n.id,n.event_type,n.title,n.body,n.entity_type,n.entity_id,n.action_path,n.read_at,n.created_at
 from public.user_notifications n where n.profile_id=public.current_profile_id()
 order by n.created_at desc limit greatest(1,least(coalesce(p_limit,30),100));
$$;
grant execute on function public.user_notification_feed(integer) to authenticated;

-- A readiness snapshot for GS/Admin: operational warnings, not a vanity score.
create or replace function public.system_readiness_snapshot() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r public.app_role; out jsonb;
begin
 r:=public.current_role();
 if r::text not in ('GS','PRESIDENT','ADMIN') then raise exception 'forbidden'; end if;
 select jsonb_build_object(
  'pending_document_jobs',(select count(*) from public.background_jobs where job_type in ('DOCUMENT_PROPOSAL','ARCHIVE_STAGING_PROPOSAL') and status in ('PENDING','PROCESSING')),
  'failed_document_jobs',(select count(*) from public.background_jobs where job_type in ('DOCUMENT_PROPOSAL','ARCHIVE_STAGING_PROPOSAL') and status='FAILED'),
  'stuck_document_jobs',(select count(*) from public.background_jobs where status='PROCESSING' and coalesce(heartbeat_at,locked_at,created_at)<now()-interval '5 minutes'),
  'projects_needing_attention',(select count(*) from public.workspace_project_sheet() x where x.needs_attention),
  'projects_without_recent_secretary_response',(select count(*) from public.workspace_project_sheet() x where x.secretary_response_needed),
  'overdue_routine',(select count(*) from public.routine_obligation_sheet() x where x.overdue),
  'overdue_tasks',(select count(*) from public.quick_task_sheet() x where x.overdue),
  'overdue_proposals',(select count(*) from public.proposal_tracking_sheet() x where x.overdue)
 ) into out;
 return out;
end;
$$;
grant execute on function public.system_readiness_snapshot() to authenticated;
