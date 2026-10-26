-- KMSA v5.8: cycle scoped memberships, lightweight assignments and secure administration.
-- Apply after 0016. This migration never stores passwords.

create table if not exists public.cycle_batches (
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  batch_number integer not null check(batch_number between 1 and 999),
  created_at timestamptz not null default now(),
  primary key(cycle_id,batch_number)
);

-- A person's cohort is stable even when cycle membership changes.
alter table public.profiles add column if not exists batch_number integer check(batch_number between 1 and 999);

create table if not exists public.member_contact_details (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  phone text, whatsapp text, telegram_handle text, department text,
  current_location text, country text, city text,
  imported_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.member_contact_details enable row level security;
grant select on public.member_contact_details to authenticated;
drop policy if exists member_contacts_private on public.member_contact_details;
create policy member_contacts_private on public.member_contact_details for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=profile_id and p.active=true
 and (p.auth_user_id=auth.uid() or exists(select 1 from public.profiles adminp where adminp.auth_user_id=auth.uid() and adminp.active and adminp.role='ADMIN'))));

create table if not exists public.cycle_memberships (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'MEMBER',
  secretariat_id uuid references public.secretariats(id),
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique(cycle_id,profile_id),
  check (role <> 'SECRETARY' or secretariat_id is not null)
);
create unique index if not exists cycle_one_active_secretary_per_secretariat
 on public.cycle_memberships(cycle_id,secretariat_id)
 where role='SECRETARY' and ended_at is null;
create index if not exists cycle_memberships_profile on public.cycle_memberships(profile_id,cycle_id);
create unique index if not exists cycle_unique_president_and_gs on public.cycle_memberships(cycle_id,role)
 where role in ('PRESIDENT','GS') and ended_at is null;

alter table public.cycles add column if not exists activation_at timestamptz;
alter table public.cycles add column if not exists activated_by uuid references public.profiles(id);
alter table public.cycles add column if not exists cycle_start_date date;

-- Avoid duplicate position definitions when the same title is used in later cycles.
alter table public.operational_positions add column if not exists cycle_id uuid references public.cycles(id);
alter table public.position_assignments add column if not exists cycle_id uuid references public.cycles(id);
alter table public.position_assignments add column if not exists assignment_detail text;
update public.operational_positions p set cycle_id=(select id from public.cycles where is_current=true limit 1) where p.cycle_id is null;
update public.position_assignments a set cycle_id=coalesce((select p.cycle_id from public.operational_positions p where p.id=a.position_id),(select id from public.cycles where is_current=true limit 1)) where a.cycle_id is null;
alter table public.operational_positions drop constraint if exists operational_positions_secretariat_id_title_key;
create unique index if not exists operational_positions_cycle_title_unique
 on public.operational_positions(cycle_id,secretariat_id,title);

-- Bootstrap pre-existing active profiles into the currently active cycle without changing them.
insert into public.cycle_memberships(cycle_id,profile_id,role,secretariat_id)
 select c.id,p.id,case when p.role='ADMIN' then 'MEMBER'::public.app_role else p.role end,
 case when p.role='SECRETARY' then p.secretariat_id else null end
 from public.cycles c cross join public.profiles p
 where c.is_current=true and p.active=true
 on conflict(cycle_id,profile_id) do nothing;

-- Account's permanent ADMIN credential is separate from organizational office.
-- Activation is a single database transaction and is only callable by a real administrator.
create or replace function public.activate_kmsa_cycle(p_cycle_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare actor_id uuid;
begin
 select id into actor_id from public.profiles where auth_user_id=auth.uid() and role='ADMIN' and active=true;
 if actor_id is null then raise exception 'ADMIN_REQUIRED'; end if;
 perform pg_advisory_xact_lock(2026,58);
 if not exists(select 1 from public.cycles where id=p_cycle_id and status='DRAFT') then raise exception 'CYCLE_NOT_AVAILABLE'; end if;
 if not exists(select 1 from public.cycle_memberships where cycle_id=p_cycle_id and role='PRESIDENT' and ended_at is null) then
    raise exception 'CYCLE_PRESIDENT_REQUIRED'; end if;
 if not exists(select 1 from public.cycle_memberships where cycle_id=p_cycle_id and role='GS' and ended_at is null) then raise exception 'CYCLE_GS_REQUIRED'; end if;
 update public.cycles set is_current=false,status='CLOSED',closed_at=coalesce(closed_at,now()) where is_current=true and id<>p_cycle_id;
 update public.cycles set is_current=true,status='OPEN',closed_at=null,activation_at=now(),activated_by=actor_id where id=p_cycle_id;
 -- Keep legacy consumers consistent until all routes are migrated to cycle memberships.
 update public.profiles set role='MEMBER',secretariat_id=null
  where role<>'ADMIN';
 update public.profiles p set role=m.role,secretariat_id=case when m.role='SECRETARY' then m.secretariat_id else null end
 from public.cycle_memberships m where m.cycle_id=p_cycle_id and m.profile_id=p.id and m.ended_at is null and p.role<>'ADMIN';
 insert into public.system_settings(key,value,updated_by,updated_at)
  select 'current_cycle', to_jsonb(c.code),actor_id,now() from public.cycles c where c.id=p_cycle_id
  on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end $$;
revoke all on function public.activate_kmsa_cycle(uuid) from public,anon;
grant execute on function public.activate_kmsa_cycle(uuid) to authenticated;

-- Position and membership tables are always read in the user's active cycle.
create or replace function public.kmsa_active_cycle_id() returns uuid
language sql stable security definer set search_path=public as $$
 select id from public.cycles where is_current=true limit 1
$$;
grant execute on function public.kmsa_active_cycle_id() to authenticated;

alter table public.cycle_batches enable row level security;
alter table public.cycle_memberships enable row level security;
drop policy if exists cycle_batches_read on public.cycle_batches;
create policy cycle_batches_read on public.cycle_batches for select to authenticated using (
 exists(select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.active=true)
);
drop policy if exists cycle_memberships_read on public.cycle_memberships;
create policy cycle_memberships_read on public.cycle_memberships for select to authenticated using (
 exists(select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.active=true
 and (p.role='ADMIN' or p.id=profile_id or (p.role in ('GS','PRESIDENT') and cycle_id=public.kmsa_active_cycle_id())
 or (p.role='SECRETARY' and secretariat_id=p.secretariat_id and cycle_id=public.kmsa_active_cycle_id())))
);
revoke insert,update,delete on public.cycle_batches,public.cycle_memberships from anon,authenticated;
grant select on public.cycle_batches,public.cycle_memberships to authenticated;

-- Read membership must not silently expand authorization across years.
-- New position access is additionally constrained by the active cycle, even where older policies allow it.
drop policy if exists position_assignments_current_cycle_guard on public.position_assignments;
create policy position_assignments_current_cycle_guard on public.position_assignments
 as restrictive for select to authenticated using(cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN');
drop policy if exists positions_current_cycle_guard on public.operational_positions;
create policy positions_current_cycle_guard on public.operational_positions
 as restrictive for select to authenticated using(cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN');

-- Guard against cross-cycle project visibility in existing general RLS policies.
-- Users cannot use historical project links to gain present-day operational permissions.
drop policy if exists initiatives_current_cycle_guard on public.initiatives;
create policy initiatives_current_cycle_guard on public.initiatives as restrictive for select to authenticated
 using(cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN');
drop policy if exists proposals_current_cycle_guard on public.proposals;
create policy proposals_current_cycle_guard on public.proposals as restrictive for select to authenticated
 using(cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN');

-- Prevent profile reads from revealing imported contact details through over-broad legacy policies.
-- Detailed import fields are NOT stored in profiles.

-- Existing child reads: RLS on the parent alone does not constrain security-definer RPCs.
-- Explicit restrictive policies for routes that select child tables directly.
create or replace function public.kmsa_project_is_current(p_initiative uuid) returns boolean
 language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.initiatives i where i.id=p_initiative and i.cycle_id=public.kmsa_active_cycle_id())
$$;
grant execute on function public.kmsa_project_is_current(uuid) to authenticated;

drop policy if exists results_current_cycle_guard on public.results;
create policy results_current_cycle_guard on public.results as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_project_is_current(initiative_id));
drop policy if exists project_updates_current_cycle_guard on public.project_updates;
create policy project_updates_current_cycle_guard on public.project_updates as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_project_is_current(initiative_id));
drop policy if exists project_activity_entries_current_cycle_guard on public.project_activity_entries;
create policy project_activity_entries_current_cycle_guard on public.project_activity_entries as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_project_is_current(initiative_id));
drop policy if exists project_closure_requests_current_cycle_guard on public.project_closure_requests;
create policy project_closure_requests_current_cycle_guard on public.project_closure_requests as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_project_is_current(initiative_id));
drop policy if exists project_supervision_assignments_current_cycle_guard on public.project_supervision_assignments;
create policy project_supervision_assignments_current_cycle_guard on public.project_supervision_assignments as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_project_is_current(initiative_id));
drop policy if exists project_supervision_followups_current_cycle_guard on public.project_supervision_followups;
create policy project_supervision_followups_current_cycle_guard on public.project_supervision_followups as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_project_is_current(initiative_id));
drop policy if exists project_permissions_current_cycle_guard on public.project_permissions;
create policy project_permissions_current_cycle_guard on public.project_permissions as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_project_is_current(initiative_id));
drop policy if exists project_interventions_current_cycle_guard on public.project_interventions;
create policy project_interventions_current_cycle_guard on public.project_interventions as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_project_is_current(initiative_id));
drop policy if exists milestone_supervision_events_current_cycle_guard on public.milestone_supervision_events;
create policy milestone_supervision_events_current_cycle_guard on public.milestone_supervision_events as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_project_is_current(initiative_id));
drop policy if exists milestone_deadline_requests_current_cycle_guard on public.milestone_deadline_requests;
create policy milestone_deadline_requests_current_cycle_guard on public.milestone_deadline_requests as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_project_is_current(initiative_id));

create or replace function public.kmsa_milestone_is_current(p_milestone uuid) returns boolean
 language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.milestones m join public.results r on r.id=m.result_id
  join public.initiatives i on i.id=r.initiative_id where m.id=p_milestone and i.cycle_id=public.kmsa_active_cycle_id())
$$;
grant execute on function public.kmsa_milestone_is_current(uuid) to authenticated;

drop policy if exists milestones_current_cycle_guard on public.milestones;
create policy milestones_current_cycle_guard on public.milestones as restrictive for select to authenticated
 using(exists(select 1 from public.results r where r.id=result_id and public.kmsa_project_is_current(r.initiative_id)));
drop policy if exists milestone_evidence_current_cycle_guard on public.milestone_evidence;
create policy milestone_evidence_current_cycle_guard on public.milestone_evidence as restrictive for select to authenticated
 using(public.current_role()::text<>'ADMIN' and public.kmsa_milestone_is_current(milestone_id));

-- Standalone events also belong to the active cycle (including events without a linked position).
alter table public.work_events add column if not exists cycle_id uuid references public.cycles(id);
update public.work_events e set cycle_id=coalesce((select p.cycle_id from public.operational_positions p where p.id=e.position_id),public.kmsa_active_cycle_id()) where e.cycle_id is null;
alter table public.work_events alter column cycle_id set default public.kmsa_active_cycle_id();
drop policy if exists work_events_current_cycle_guard on public.work_events;
create policy work_events_current_cycle_guard on public.work_events as restrictive for select to authenticated using(cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN');

-- Legacy standalone work needs a cycle tag too; default follows the activated cycle.
alter table public.quick_tasks add column if not exists cycle_id uuid references public.cycles(id);
alter table public.routine_obligations add column if not exists cycle_id uuid references public.cycles(id);
alter table public.user_notifications add column if not exists cycle_id uuid references public.cycles(id);
update public.quick_tasks set cycle_id=public.kmsa_active_cycle_id() where cycle_id is null;
update public.routine_obligations set cycle_id=public.kmsa_active_cycle_id() where cycle_id is null;
update public.user_notifications set cycle_id=public.kmsa_active_cycle_id() where cycle_id is null;
alter table public.quick_tasks alter column cycle_id set default public.kmsa_active_cycle_id();
alter table public.routine_obligations alter column cycle_id set default public.kmsa_active_cycle_id();
alter table public.user_notifications alter column cycle_id set default public.kmsa_active_cycle_id();
drop policy if exists quick_tasks_current_cycle_guard on public.quick_tasks;
create policy quick_tasks_current_cycle_guard on public.quick_tasks as restrictive for select to authenticated using(cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN');
drop policy if exists routine_obligations_current_cycle_guard on public.routine_obligations;
create policy routine_obligations_current_cycle_guard on public.routine_obligations as restrictive for select to authenticated using(cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN');
drop policy if exists user_notifications_current_cycle_guard on public.user_notifications;
create policy user_notifications_current_cycle_guard on public.user_notifications as restrictive for select to authenticated using(cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN');

-- Activity header + body always come from the same cycle.
create or replace function public.user_notification_feed(p_limit integer default 30)
returns table(id uuid,event_type text,title text,body text,entity_type text,entity_id uuid,action_path text,read_at timestamptz,created_at timestamptz)
language sql stable security definer set search_path=public as $$
 select n.id,n.event_type,n.title,n.body,n.entity_type,n.entity_id,n.action_path,n.read_at,n.created_at
 from public.user_notifications n where n.profile_id=public.current_profile_id() and n.cycle_id=public.kmsa_active_cycle_id()
 order by n.created_at desc limit greatest(1,least(coalesce(p_limit,30),100));
$$;
grant execute on function public.user_notification_feed(integer) to authenticated;

-- Workspace sheet is SECURITY DEFINER; old RLS does not protect its rows.
create or replace function public.workspace_project_sheet()
returns table(
  project_id uuid,
  secretariat_id uuid,
  secretariat_name text,
  project_title text,
  approval_status text,
  setup_status text,
  project_status text,
  health text,
  lead_id uuid,
  lead_name text,
  secretary_id uuid,
  secretary_name text,
  result_statement text,
  success_measure text,
  assignment_start_at timestamptz,
  target_due_at timestamptz,
  update_interval_days integer,
  next_update_due_at timestamptz,
  update_overdue boolean,
  total_milestones bigint,
  verified_milestones bigint,
  current_milestone text,
  current_milestone_due_at timestamptz,
  current_milestone_status text,
  current_milestone_overdue boolean,
  days_to_current_milestone integer,
  latest_update_note text,
  latest_update_health text,
  last_lead_note text,
  last_lead_update_at timestamptz,
  last_intervention text,
  last_intervention_at timestamptz,
  open_blockers bigint,
  latest_blocker_at timestamptz,
  pending_special_permissions bigint,
  needs_attention boolean,
  secretary_response_needed boolean
)
language sql stable security definer set search_path=public as $$
with visible as (
  select i.* from public.initiatives i where i.cycle_id=public.kmsa_active_cycle_id() and public.can_read_initiative(i.id) and public.current_role()::text<>'ADMIN'
), base as (
 select
   i.id project_id,i.secretariat_id,s.name_ar secretariat_name,i.title project_title,
   i.approval_status,i.setup_status,i.status project_status,i.health,
   i.owner_id lead_id,lead.full_name lead_name,i.secretary_id,sec.full_name secretary_name,
   r.statement result_statement,r.success_measure,i.assignment_start_at,i.target_due_at,
   i.update_interval_days,i.next_update_due_at,
   (i.status='ACTIVE' and i.approval_status='APPROVED' and i.next_update_due_at is not null and i.next_update_due_at<now()) update_overdue,
   (select count(*) from public.milestones m where m.result_id=r.id and coalesce(m.design_status,'APPROVED')<>'REJECTED') total_milestones,
   (select count(*) from public.milestones m where m.result_id=r.id and m.status='VERIFIED' and coalesce(m.design_status,'APPROVED')<>'REJECTED') verified_milestones,
   cm.title current_milestone,cm.due_at current_milestone_due_at,cm.status::text current_milestone_status,
   (cm.due_at is not null and cm.due_at<now()) current_milestone_overdue,
   case when cm.due_at is null then null else floor(extract(epoch from (cm.due_at-now()))/86400.0)::int end days_to_current_milestone,
   pu.progress_note latest_update_note,pu.health latest_update_health,pu.created_at project_update_at,
   lu.lead_note milestone_lead_note,lu.status_updated_at milestone_update_at,
   li.action_text last_intervention,li.created_at last_intervention_at,
   (select count(*) from public.blockers b join public.milestones bm on bm.id=b.milestone_id where bm.result_id=r.id and b.status='OPEN') open_blockers,
   (select max(b.created_at) from public.blockers b join public.milestones bm on bm.id=b.milestone_id where bm.result_id=r.id and b.status='OPEN') latest_blocker_at,
   (select count(*) from public.project_permissions pp where pp.initiative_id=i.id and pp.permission_type='SPECIAL' and pp.status='PENDING') pending_special_permissions
 from visible i
 join public.secretariats s on s.id=i.secretariat_id
 left join public.profiles lead on lead.id=i.owner_id
 left join public.profiles sec on sec.id=i.secretary_id
 left join lateral (select rr.* from public.results rr where rr.initiative_id=i.id order by rr.created_at limit 1) r on true
 left join lateral (
   select m.title,m.due_at,m.status
   from public.milestones m
   where m.result_id=r.id and coalesce(m.design_status,'APPROVED')<>'REJECTED' and m.status not in ('VERIFIED','CANCELLED')
   order by coalesce(m.sequence_no,999999),m.due_at limit 1
 ) cm on true
 left join lateral (
   select u.progress_note,u.health,u.created_at
   from public.project_updates u where u.initiative_id=i.id order by u.created_at desc limit 1
 ) pu on true
 left join lateral (
   select m.lead_note,m.status_updated_at
   from public.milestones m where m.result_id=r.id order by m.status_updated_at desc limit 1
 ) lu on true
 left join lateral (
   select x.action_text,x.created_at from public.project_interventions x where x.initiative_id=i.id order by x.created_at desc limit 1
 ) li on true
), shaped as (
 select b.*,
   coalesce(b.latest_update_note,b.milestone_lead_note) last_lead_note,
   case
     when b.project_update_at is null then b.milestone_update_at
     when b.milestone_update_at is null then b.project_update_at
     else greatest(b.project_update_at,b.milestone_update_at)
   end last_lead_update_at
 from base b
), flagged as (
 select s.*,
  (
    s.approval_status='PENDING_GS' or s.approval_status='RETURNED' or
    s.health in ('WATCH','AT_RISK','BLOCKED') or s.open_blockers>0 or s.update_overdue or
    (s.current_milestone_due_at is not null and s.current_milestone_due_at<now()+interval '72 hours') or
    (s.target_due_at is not null and s.target_due_at<now()+interval '5 days')
  ) needs_attention,
  (
    s.approval_status='APPROVED' and s.project_status='ACTIVE' and
    (s.health in ('WATCH','AT_RISK','BLOCKED') or s.open_blockers>0 or s.update_overdue or s.current_milestone_overdue) and
    (
      s.last_intervention_at is null or s.last_intervention_at < greatest(
        case when s.health in ('WATCH','AT_RISK','BLOCKED') then coalesce(s.project_update_at,s.milestone_update_at,'1970-01-01'::timestamptz) else '1970-01-01'::timestamptz end,
        case when s.open_blockers>0 then coalesce(s.latest_blocker_at,'1970-01-01'::timestamptz) else '1970-01-01'::timestamptz end,
        case when s.update_overdue then coalesce(s.next_update_due_at,'1970-01-01'::timestamptz) else '1970-01-01'::timestamptz end,
        case when s.current_milestone_overdue then coalesce(s.current_milestone_due_at,'1970-01-01'::timestamptz) else '1970-01-01'::timestamptz end
      )
    )
  ) secretary_response_needed
 from shaped s
)
select
 f.project_id,f.secretariat_id,f.secretariat_name,f.project_title,f.approval_status,f.setup_status,f.project_status,f.health,
 f.lead_id,f.lead_name,f.secretary_id,f.secretary_name,f.result_statement,f.success_measure,f.assignment_start_at,f.target_due_at,
 f.update_interval_days,f.next_update_due_at,f.update_overdue,f.total_milestones,f.verified_milestones,f.current_milestone,
 f.current_milestone_due_at,f.current_milestone_status,f.current_milestone_overdue,f.days_to_current_milestone,
 f.latest_update_note,f.latest_update_health,f.last_lead_note,f.last_lead_update_at,f.last_intervention,f.last_intervention_at,
 f.open_blockers,f.latest_blocker_at,f.pending_special_permissions,f.needs_attention,f.secretary_response_needed
from flagged f
order by f.needs_attention desc,f.secretariat_name,f.target_due_at nulls last,f.project_title;
$$;
grant execute on function public.workspace_project_sheet() to authenticated;

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
 where t.cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN' and public.can_read_quick_task(t.id)
 order by (t.status in ('DONE','CANCELLED')),coalesce(t.due_at,'9999-12-31'::timestamptz),t.created_at desc;
$$;
grant execute on function public.quick_task_sheet() to authenticated;

create or replace function public.routine_obligation_sheet()
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
 where r.active=true and r.cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN' and public.can_read_routine_obligation(r.id)
 order by r.next_due_at;
$$;
grant execute on function public.routine_obligation_sheet() to authenticated;

create or replace function public.kmsa_cycle_archive_index(p_cycle_id uuid)
returns table(project_id uuid,title text,state text,secretariat text)
language sql stable security definer set search_path=public as $$
 select i.id,i.title,i.status,s.name_ar
 from public.initiatives i join public.secretariats s on s.id=i.secretariat_id
 where i.cycle_id=p_cycle_id and p_cycle_id<>public.kmsa_active_cycle_id() and exists(
   select 1 from public.profiles p left join public.cycle_memberships m on m.profile_id=p.id and m.cycle_id=p_cycle_id
   where p.auth_user_id=auth.uid() and p.active and (
     i.owner_id=p.id or (m.role in ('GS','PRESIDENT') and m.ended_at is null)
     or (m.role='SECRETARY' and m.secretariat_id=i.secretariat_id and m.ended_at is null)
   )
 ) order by i.created_at desc;
$$;
revoke all on function public.kmsa_cycle_archive_index(uuid) from public,anon;
grant execute on function public.kmsa_cycle_archive_index(uuid) to authenticated;

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
 where p.cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN' and public.can_read_operational_position(p.id)
 order by p.active desc,p.title;
$$;
grant execute on function public.operational_position_sheet() to authenticated;

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
 where e.cycle_id=public.kmsa_active_cycle_id() and public.current_role()::text<>'ADMIN' and public.can_read_work_event(e.id)
 group by e.id,s.name_ar,p.title
 order by e.scheduled_at desc;
$$;
grant execute on function public.work_event_sheet() to authenticated;

create or replace function public.proposal_tracking_sheet()
returns table(
  proposal_id uuid,
  internal_id text,
  title text,
  applicant_name text,
  secretariat_id uuid,
  secretariat_name text,
  status text,
  execution_status text,
  submitted_at timestamptz,
  updated_at timestamptz,
  stage_due_at timestamptz,
  overdue boolean,
  days_in_current_stage numeric,
  current_version integer,
  current_pdf_drive_file_id text,
  document_status text,
  document_error text
)
language plpgsql stable security definer set search_path=public as $$
declare r text:=coalesce(public.current_role()::text,''); sid uuid:=public.current_secretariat_id(); pid uuid:=public.current_profile_id();
begin
 return query
 select p.id,p.internal_id,p.title,p.applicant_name,p.secretariat_id,s.name_ar,
        p.status::text,p.execution_status::text,p.submitted_at,p.updated_at,
        case when p.status in ('WITH_SECRETARY','REVISED') then p.secretary_due_at when p.status='WITH_GS' then p.gs_due_at else null end stage_due_at,
        case when p.status in ('WITH_SECRETARY','REVISED') then p.secretary_due_at<now() when p.status='WITH_GS' then p.gs_due_at<now() else false end overdue,
        round(extract(epoch from (now()-coalesce(la.created_at,p.submitted_at,p.created_at)))/86400.0,1) days_in_current_stage,
        p.current_version,pv.pdf_drive_file_id,
        case when pv.pdf_drive_file_id is not null then 'READY' else coalesce(j.status,'NOT_QUEUED') end document_status,
        j.last_error document_error
 from public.proposals p
 join public.secretariats s on s.id=p.secretariat_id
 left join lateral (select a.created_at from public.proposal_actions a where a.proposal_id=p.id order by a.created_at desc limit 1) la on true
 left join public.proposal_versions pv on pv.proposal_id=p.id and pv.version_no=p.current_version
 left join lateral (
   select b.status,b.last_error from public.background_jobs b
   where b.entity_type='PROPOSAL' and b.entity_id=p.id and b.job_type in ('DOCUMENT_PROPOSAL','ARCHIVE_STAGING_PROPOSAL')
   order by b.created_at desc limit 1
 ) j on true
 where p.cycle_id=public.kmsa_active_cycle_id() and r<>'ADMIN' and (p.applicant_id=pid or r in ('GS','PRESIDENT') or (r='SECRETARY' and p.secretariat_id=sid))
 order by overdue desc,p.updated_at desc;
end $$;
grant execute on function public.proposal_tracking_sheet() to authenticated;

-- Admin role is a technical operator, not a project reviewer.
drop policy if exists initiatives_no_admin_guard on public.initiatives;
create policy initiatives_no_admin_guard on public.initiatives as restrictive for select to authenticated using(public.current_role()::text<>'ADMIN');
drop policy if exists proposals_no_admin_guard on public.proposals;
create policy proposals_no_admin_guard on public.proposals as restrictive for select to authenticated using(public.current_role()::text<>'ADMIN');
drop policy if exists positions_no_admin_guard on public.operational_positions;
create policy positions_no_admin_guard on public.operational_positions as restrictive for select to authenticated using(public.current_role()::text<>'ADMIN');
drop policy if exists quick_tasks_no_admin_guard on public.quick_tasks;
create policy quick_tasks_no_admin_guard on public.quick_tasks as restrictive for select to authenticated using(public.current_role()::text<>'ADMIN');
drop policy if exists routine_no_admin_guard on public.routine_obligations;
create policy routine_no_admin_guard on public.routine_obligations as restrictive for select to authenticated using(public.current_role()::text<>'ADMIN');

create or replace function public.kmsa_proposal_is_current(p_proposal uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.proposals p where p.id=p_proposal and p.cycle_id=public.kmsa_active_cycle_id())
$$;
grant execute on function public.kmsa_proposal_is_current(uuid) to authenticated;
drop policy if exists proposal_versions_cycle_guard on public.proposal_versions;
create policy proposal_versions_cycle_guard on public.proposal_versions as restrictive for select to authenticated using(public.kmsa_proposal_is_current(proposal_id));
drop policy if exists proposal_actions_cycle_guard on public.proposal_actions;
create policy proposal_actions_cycle_guard on public.proposal_actions as restrictive for select to authenticated using(public.kmsa_proposal_is_current(proposal_id));

-- Pending members of a FUTURE cycle may already have accounts, but cannot see current-cycle work.
create or replace function public.kmsa_has_current_membership() returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.cycle_memberships m where m.cycle_id=public.kmsa_active_cycle_id()
 and m.profile_id=public.current_profile_id() and m.ended_at is null)
$$;
grant execute on function public.kmsa_has_current_membership() to authenticated;
drop policy if exists initiatives_cycle_membership_guard on public.initiatives;
create policy initiatives_cycle_membership_guard on public.initiatives as restrictive for select to authenticated
 using(public.kmsa_has_current_membership());
drop policy if exists proposals_cycle_membership_guard on public.proposals;
create policy proposals_cycle_membership_guard on public.proposals as restrictive for select to authenticated
 using(public.kmsa_has_current_membership());

-- Secretary's people picker must not surface former-cycle-only members or ADMIN users.
create or replace function public.member_directory_search(p_query text default '')
returns table(id uuid,full_name text,university_id text,email text)
language plpgsql stable security definer set search_path=public as $$
declare r text:=coalesce(public.current_role()::text,''); q text:=lower(trim(coalesce(p_query,'')));
begin
 if r not in ('SECRETARY','GS','PRESIDENT') then raise exception 'not allowed'; end if;
 return query
 select p.id,p.full_name,p.university_id,p.email
 from public.profiles p
 join public.cycle_memberships m on m.profile_id=p.id
 where m.cycle_id=public.kmsa_active_cycle_id() and m.ended_at is null and p.active and p.role <> 'ADMIN'
   and (q='' or lower(p.full_name) like '%'||q||'%' or lower(coalesce(p.university_id,'')) like '%'||q||'%' or lower(p.email) like '%'||q||'%')
 order by p.full_name limit 40;
end $$;
grant execute on function public.member_directory_search(text) to authenticated;
