-- KMSA Workspace v2
-- Secretariat-scoped secretaries, GS-approved project appointments, practical milestone tracking,
-- global project/proposal sheets, and member directory search for project assignment.

alter table public.initiatives add column if not exists approval_status text not null default 'APPROVED';
alter table public.initiatives add column if not exists gs_review_note text;
alter table public.initiatives add column if not exists gs_approved_by uuid references public.profiles(id);
alter table public.initiatives add column if not exists gs_approved_at timestamptz;
alter table public.initiatives add column if not exists assignment_start_at timestamptz;

alter table public.milestones add column if not exists sequence_no integer;
alter table public.milestones add column if not exists deadline_mode text not null default 'ABSOLUTE';
alter table public.milestones add column if not exists relative_days integer;
alter table public.milestones add column if not exists relative_to_milestone_id uuid references public.milestones(id) on delete set null;
alter table public.milestones add column if not exists outcome_text text;
alter table public.milestones add column if not exists lead_note text;
alter table public.milestones add column if not exists secretary_note text;
alter table public.milestones add column if not exists status_updated_at timestamptz not null default now();

-- Existing projects remain valid and visible. New workflow actions set PENDING_GS explicitly.
update public.initiatives set approval_status='APPROVED' where approval_status is null;
update public.milestones set sequence_no=sub.rn
from (
  select id,row_number() over(partition by result_id order by due_at,created_at)::int rn
  from public.milestones
) sub
where public.milestones.id=sub.id and public.milestones.sequence_no is null;

create index if not exists initiatives_approval_status_idx on public.initiatives(approval_status,secretariat_id);
do $$
begin
 if exists(
   select secretariat_id from public.profiles
   where role='SECRETARY' and active=true and secretariat_id is not null
   group by secretariat_id having count(*)>1
 ) then
   raise exception 'يوجد أكثر من سكرتير فعّال مرتبط بنفس السكرتارية. صحح الحسابات أولاً ثم أعد تشغيل الترقية.';
 end if;
 execute 'create unique index if not exists one_active_secretary_per_secretariat_idx on public.profiles(secretariat_id) where role=''SECRETARY'' and active=true and secretariat_id is not null';
end $$;
create index if not exists milestones_sequence_idx on public.milestones(result_id,sequence_no);

-- A project lead only sees an assignment after GS approval. The project secretary and oversight roles
-- can see it during preparation/review.
create or replace function public.can_read_initiative(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from public.initiatives i
   where i.id=p_id and (
     i.secretary_id=public.current_profile_id() or
     public.can_read_secretariat(i.secretariat_id) or
     (
       i.approval_status='APPROVED' and (
         i.owner_id=public.current_profile_id() or
         exists(select 1 from public.results r where r.initiative_id=i.id and r.owner_id=public.current_profile_id())
       )
     )
   )
 );
$$;
grant execute on function public.can_read_initiative(uuid) to authenticated;

-- Minimal member directory: secretaries search the whole active membership when assigning a project.
create or replace function public.member_directory_search(p_query text default '')
returns table(id uuid, full_name text, university_id text, email text)
language plpgsql stable security definer set search_path=public as $$
declare r text:=coalesce(public.current_role()::text,''); q text:=lower(trim(coalesce(p_query,'')));
begin
 if r not in ('SECRETARY','GS','PRESIDENT','ADMIN') then raise exception 'not allowed'; end if;
 return query
 select p.id,p.full_name,p.university_id,p.email
 from public.profiles p
 where p.active=true
   and p.role <> 'ADMIN'
   and (
     q='' or lower(p.full_name) like '%'||q||'%' or
     lower(coalesce(p.university_id,'')) like '%'||q||'%' or
     lower(p.email) like '%'||q||'%'
   )
 order by p.full_name
 limit 40;
end $$;
grant execute on function public.member_directory_search(text) to authenticated;

-- One practical tracking sheet used by a secretary for their own secretariat and by GS/President/Admin across all.
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
  total_milestones bigint,
  verified_milestones bigint,
  current_milestone text,
  current_milestone_due_at timestamptz,
  current_milestone_status text,
  current_milestone_overdue boolean,
  days_to_current_milestone integer,
  last_lead_note text,
  last_lead_update_at timestamptz,
  last_intervention text,
  last_intervention_at timestamptz,
  open_blockers bigint,
  pending_special_permissions bigint,
  needs_attention boolean
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
   (select count(*) from public.milestones m where m.result_id=r.id and coalesce(m.design_status,'APPROVED')<>'REJECTED') total_milestones,
   (select count(*) from public.milestones m where m.result_id=r.id and m.status='VERIFIED' and coalesce(m.design_status,'APPROVED')<>'REJECTED') verified_milestones,
   cm.title current_milestone,cm.due_at current_milestone_due_at,cm.status::text current_milestone_status,
   (cm.due_at is not null and cm.due_at<now()) current_milestone_overdue,
   case when cm.due_at is null then null else floor(extract(epoch from (cm.due_at-now()))/86400.0)::int end days_to_current_milestone,
   lu.lead_note last_lead_note,lu.status_updated_at last_lead_update_at,
   li.action_text last_intervention,li.created_at last_intervention_at,
   (select count(*) from public.blockers b join public.milestones bm on bm.id=b.milestone_id where bm.result_id=r.id and b.status='OPEN') open_blockers,
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
   select m.lead_note,m.status_updated_at
   from public.milestones m
   where m.result_id=r.id
   order by m.status_updated_at desc limit 1
 ) lu on true
 left join lateral (
   select x.action_text,x.created_at
   from public.project_interventions x where x.initiative_id=i.id order by x.created_at desc limit 1
 ) li on true
)
select b.*,
 (
   b.approval_status='PENDING_GS' or b.approval_status='RETURNED' or
   b.health in ('WATCH','AT_RISK','BLOCKED') or b.open_blockers>0 or
   (b.current_milestone_due_at is not null and b.current_milestone_due_at<now()+interval '72 hours') or
   (b.target_due_at is not null and b.target_due_at<now()+interval '5 days') or
   (b.project_status='ACTIVE' and (b.last_lead_update_at is null or b.last_lead_update_at<now()-interval '5 days'))
 ) needs_attention
from base b
order by needs_attention desc,b.secretariat_name,b.target_due_at nulls last,b.project_title;
$$;
grant execute on function public.workspace_project_sheet() to authenticated;

-- Proposal tracking sheet: no proposal disappears inside one secretariat.
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
  current_pdf_drive_file_id text
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
        p.current_version,pv.pdf_drive_file_id
 from public.proposals p
 join public.secretariats s on s.id=p.secretariat_id
 left join lateral (select a.created_at from public.proposal_actions a where a.proposal_id=p.id order by a.created_at desc limit 1) la on true
 left join public.proposal_versions pv on pv.proposal_id=p.id and pv.version_no=p.current_version
 where p.applicant_id=pid or r in ('GS','PRESIDENT','ADMIN') or (r='SECRETARY' and p.secretariat_id=sid)
 order by overdue desc,p.updated_at desc;
end $$;
grant execute on function public.proposal_tracking_sheet() to authenticated;
