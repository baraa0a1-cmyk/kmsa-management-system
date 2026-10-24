-- KMSA Workspace v3
-- Simpler operational model: periodic project reports, recurring work, proposal document visibility,
-- and cleaner oversight/reporting data for secretary and GS.

alter table public.decisions add column if not exists decision_type text not null default 'GENERAL';

alter table public.initiatives add column if not exists update_interval_days integer not null default 3;
alter table public.initiatives add column if not exists next_update_due_at timestamptz;
alter table public.initiatives drop constraint if exists initiatives_update_interval_days_check;
alter table public.initiatives add constraint initiatives_update_interval_days_check check (update_interval_days between 1 and 30);

update public.initiatives
set next_update_due_at = coalesce(last_update_at, activated_at, created_at) + make_interval(days => update_interval_days)
where status='ACTIVE' and approval_status='APPROVED' and next_update_due_at is null;

create table if not exists public.routine_obligations (
  id uuid primary key default gen_random_uuid(),
  secretariat_id uuid not null references public.secretariats(id),
  secretary_id uuid references public.profiles(id),
  owner_id uuid not null references public.profiles(id),
  title text not null,
  description text,
  expected_output text,
  cadence text not null default 'WEEKLY' check (cadence in ('WEEKLY','MONTHLY','QUARTERLY','CUSTOM')),
  interval_days integer,
  next_due_at timestamptz not null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists routine_obligations_secretariat_idx on public.routine_obligations(secretariat_id,active,next_due_at);
create index if not exists routine_obligations_owner_idx on public.routine_obligations(owner_id,active,next_due_at);

drop trigger if exists routine_obligations_touch on public.routine_obligations;
create trigger routine_obligations_touch before update on public.routine_obligations for each row execute function public.touch_updated_at();

create table if not exists public.routine_updates (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.routine_obligations(id) on delete cascade,
  due_at timestamptz not null,
  submitted_by uuid not null references public.profiles(id),
  status text not null default 'COMPLETED' check (status in ('COMPLETED','AT_RISK','BLOCKED')),
  report_note text not null,
  output_text text,
  evidence_url text,
  secretary_note text,
  submitted_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz
);
create index if not exists routine_updates_obligation_idx on public.routine_updates(obligation_id,submitted_at desc);

alter table public.routine_obligations enable row level security;
alter table public.routine_updates enable row level security;
grant select on public.routine_obligations, public.routine_updates to authenticated;

create or replace function public.can_read_routine_obligation(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.routine_obligations r
  where r.id=p_id and (
    r.owner_id=public.current_profile_id() or
    r.secretary_id=public.current_profile_id() or
    public.current_role()::text in ('GS','PRESIDENT','ADMIN') or
    (public.current_role()::text='SECRETARY' and r.secretariat_id=public.current_secretariat_id())
  )
 );
$$;
grant execute on function public.can_read_routine_obligation(uuid) to authenticated;

drop policy if exists routine_obligations_read on public.routine_obligations;
create policy routine_obligations_read on public.routine_obligations for select to authenticated using (public.can_read_routine_obligation(id));
drop policy if exists routine_updates_read on public.routine_updates;
create policy routine_updates_read on public.routine_updates for select to authenticated using (public.can_read_routine_obligation(obligation_id));

-- Practical project sheet. A required periodic report is separate from milestone edits,
-- so a lead cannot stay silent until a deadline is near.
drop function if exists public.workspace_project_sheet();
create function public.workspace_project_sheet()
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
  select i.* from public.initiatives i where public.can_read_initiative(i.id)
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

-- Recurring work sheet for duties that are not projects.
create or replace function public.routine_obligation_sheet()
returns table(
  obligation_id uuid,
  secretariat_id uuid,
  secretariat_name text,
  title text,
  description text,
  expected_output text,
  owner_id uuid,
  owner_name text,
  secretary_id uuid,
  secretary_name text,
  cadence text,
  next_due_at timestamptz,
  overdue boolean,
  days_to_due integer,
  last_status text,
  last_report text,
  last_output text,
  last_secretary_note text,
  last_submitted_at timestamptz
)
language sql stable security definer set search_path=public as $$
select r.id,r.secretariat_id,s.name_ar,r.title,r.description,r.expected_output,r.owner_id,o.full_name,
       r.secretary_id,sec.full_name,r.cadence,r.next_due_at,(r.next_due_at<now()) overdue,
       floor(extract(epoch from (r.next_due_at-now()))/86400.0)::int days_to_due,
       u.status,u.report_note,u.output_text,u.secretary_note,u.submitted_at
from public.routine_obligations r
join public.secretariats s on s.id=r.secretariat_id
join public.profiles o on o.id=r.owner_id
left join public.profiles sec on sec.id=r.secretary_id
left join lateral (select * from public.routine_updates x where x.obligation_id=r.id order by x.submitted_at desc limit 1) u on true
where r.active=true and public.can_read_routine_obligation(r.id)
order by overdue desc,r.next_due_at,r.title;
$$;
grant execute on function public.routine_obligation_sheet() to authenticated;

-- Proposal tracking includes document generation state so "waiting for PDF" is explainable.
drop function if exists public.proposal_tracking_sheet();
create function public.proposal_tracking_sheet()
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
 where p.applicant_id=pid or r in ('GS','PRESIDENT','ADMIN') or (r='SECRETARY' and p.secretariat_id=sid)
 order by overdue desc,p.updated_at desc;
end $$;
grant execute on function public.proposal_tracking_sheet() to authenticated;

create or replace function public.proposal_document_status(p_proposal_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare out jsonb;
begin
 if not public.can_read_proposal(p_proposal_id) then raise exception 'not allowed'; end if;
 select jsonb_build_object(
   'pdfReady',pv.pdf_drive_file_id is not null,
   'pdfDriveFileId',pv.pdf_drive_file_id,
   'docxDriveFileId',pv.docx_drive_file_id,
   'jobStatus',coalesce(j.status,'NOT_QUEUED'),
   'lastError',j.last_error,
   'attempts',coalesce(j.attempts,0),
   'updatedAt',coalesce(j.completed_at,j.locked_at,j.created_at)
 ) into out
 from public.proposals p
 left join public.proposal_versions pv on pv.proposal_id=p.id and pv.version_no=p.current_version
 left join lateral (
   select * from public.background_jobs b where b.entity_type='PROPOSAL' and b.entity_id=p.id and b.job_type in ('DOCUMENT_PROPOSAL','ARCHIVE_STAGING_PROPOSAL') order by b.created_at desc limit 1
 ) j on true
 where p.id=p_proposal_id;
 return coalesce(out,'{}'::jsonb);
end $$;
grant execute on function public.proposal_document_status(uuid) to authenticated;
