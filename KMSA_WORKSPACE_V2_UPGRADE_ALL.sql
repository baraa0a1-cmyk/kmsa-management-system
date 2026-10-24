-- KMSA Workspace v2 complete upgrade
-- Safe to run once on the existing KMSA Supabase project. Includes workspace v1 + reporting + v2.

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

-- ===== Workspace reporting =====

create or replace function public.dashboard_metrics() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare pid uuid:=public.current_profile_id(); r text:=coalesce(public.current_role()::text,''); sid uuid:=public.current_secretariat_id(); out jsonb;
begin
  with visible as (
    select m.* from public.milestones m where public.can_read_milestone(m.id)
  ), secstats as (
    select s.id secretariat_id,s.name_ar secretariat_name,
      count(v.id) filter(where v.status not in ('VERIFIED','CANCELLED'))::int active,
      count(v.id) filter(where v.status not in ('VERIFIED','CANCELLED') and v.due_at<now())::int overdue,
      count(v.id) filter(where v.status='VERIFIED')::int verified,
      case when count(v.id) filter(where v.status='VERIFIED')=0 then 0 else
        round(100.0*count(v.id) filter(where v.status='VERIFIED' and v.verified_at<=v.due_at)/nullif(count(v.id) filter(where v.status='VERIFIED'),0))::int end on_time_rate
    from public.secretariats s left join visible v on v.secretariat_id=s.id
    where r in ('GS','PRESIDENT','ADMIN') or (r='SECRETARY' and s.id=sid) or exists(select 1 from visible x where x.secretariat_id=s.id)
    group by s.id,s.name_ar
  )
  select jsonb_build_object(
    'active_milestones',(select count(*) from visible where status not in ('VERIFIED','CANCELLED')),
    'needs_attention',(select count(*) from visible where status in ('AT_RISK','BLOCKED','READY_FOR_VERIFICATION') or (status not in ('VERIFIED','CANCELLED') and due_at<now()+interval '72 hours')),
    'overdue',(select count(*) from visible where status not in ('VERIFIED','CANCELLED') and due_at<now()),
    'ready_for_verification',(select count(*) from visible where status='READY_FOR_VERIFICATION'),
    'open_blockers',(select count(*) from public.blockers b join visible m on m.id=b.milestone_id where b.status='OPEN'),
    'weekly_commitments',(select count(*) from public.weekly_commitments c join visible m on m.id=c.milestone_id where c.week_start=date_trunc('week',current_date)::date),
    'weekly_evidence',(select count(*) from public.milestone_evidence e join visible m on m.id=e.milestone_id where e.created_at>=date_trunc('week',now())),
    'secretary_interventions',(select count(*) from public.project_interventions i join public.initiatives p on p.id=i.initiative_id where public.can_read_initiative(p.id) and i.created_at>=date_trunc('week',now())),
    'verification_rate',case when (select count(*) from visible)=0 then 0 else round(100.0*(select count(*) from visible where status='VERIFIED')/nullif((select count(*) from visible),0))::int end,
    'on_time_rate',case when (select count(*) from visible where status='VERIFIED')=0 then 0 else round(100.0*(select count(*) from visible where status='VERIFIED' and verified_at<=due_at)/nullif((select count(*) from visible where status='VERIFIED'),0))::int end,
    'open_proposals',(select count(*) from public.proposals p where (p.applicant_id=pid or r in ('GS','PRESIDENT','ADMIN') or (r='SECRETARY' and p.secretariat_id=sid)) and p.status not in ('WITHDRAWN','NOT_APPROVED')),
    'secretariats',(select coalesce(jsonb_agg(to_jsonb(secstats)),'[]'::jsonb) from secstats)
  ) into out;
  return out;
end $$;
grant execute on function public.dashboard_metrics() to authenticated;

create or replace function public.weekly_report(p_week_start date default null)
returns table(
  milestone_id uuid, week_start date, secretariat_name text, milestone_title text, owner_name text,
  result_statement text, due_at timestamptz, commitment_text text, evidence_count bigint,
  blocker_text text, intervention_text text, verification_state text
)
language sql stable security definer set search_path=public as $$
with params as (select coalesce(p_week_start,date_trunc('week',current_date)::date) ws), visible as (
 select m.* from public.milestones m where public.can_read_milestone(m.id)
)
select m.id,p.ws,s.name_ar,m.title,o.full_name,r.statement,m.due_at,
  c.commitment_text,
  (select count(*) from public.milestone_evidence e where e.milestone_id=m.id and e.created_at>=p.ws and e.created_at<p.ws+7)::bigint,
  (select b.description from public.blockers b where b.milestone_id=m.id and b.status='OPEN' order by b.created_at desc limit 1),
  (select i.action_text from public.project_interventions i where i.initiative_id=r.initiative_id and i.created_at>=p.ws and i.created_at<p.ws+7 order by i.created_at desc limit 1),
  (select v.decision from public.verifications v where v.milestone_id=m.id order by v.created_at desc limit 1)
from visible m
join public.results r on r.id=m.result_id
join public.secretariats s on s.id=m.secretariat_id
join public.profiles o on o.id=m.owner_id
cross join params p
left join public.weekly_commitments c on c.milestone_id=m.id and c.week_start=p.ws
order by s.name_ar,m.due_at;
$$;
grant execute on function public.weekly_report(date) to authenticated;

create or replace function public.workspace_attention_snapshot() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare out jsonb;
begin
 with visible as (
   select i.* from public.initiatives i
   where public.can_read_initiative(i.id) and i.status not in ('COMPLETED','CANCELLED')
 ), enriched as (
   select i.id,i.title,i.secretariat_id,i.owner_id,i.secretary_id,i.setup_status,i.health,i.target_due_at,i.last_update_at,
          s.name_ar secretariat_name,o.full_name owner_name,sec.full_name secretary_name,
          lu.health last_reported_health,lu.assistance_needed,lu.next_check_at,lu.created_at latest_update_at,
          nm.title next_milestone_title,nm.due_at next_milestone_due_at,nm.status next_milestone_status,
          coalesce(ob.open_blockers,0) open_blockers,coalesce(pp.pending_permissions,0) pending_permissions,
          li.last_intervention_at,
          (
            case when i.setup_status<>'ACTIVE' then 100 else 0 end +
            case when i.health='BLOCKED' then 80 when i.health='AT_RISK' then 60 when i.health='WATCH' then 35 else 0 end +
            case when coalesce(ob.open_blockers,0)>0 then 50 else 0 end +
            case when lu.assistance_needed is not null and btrim(lu.assistance_needed)<>'' then 45 else 0 end +
            case when i.setup_status='ACTIVE' and (coalesce(i.last_update_at,i.activated_at,i.created_at)<now()-interval '5 days') then 35 else 0 end +
            case when lu.next_check_at is not null and lu.next_check_at<now() then 30 else 0 end +
            case when nm.due_at is not null and nm.due_at<now()+interval '72 hours' then 25 else 0 end +
            case when coalesce(pp.pending_permissions,0)>0 then 20 else 0 end +
            case when i.target_due_at is not null and i.target_due_at<now()+interval '5 days' then 15 else 0 end
          )::int signal_score
   from visible i
   join public.secretariats s on s.id=i.secretariat_id
   left join public.profiles o on o.id=i.owner_id
   left join public.profiles sec on sec.id=i.secretary_id
   left join lateral (
     select u.health,u.assistance_needed,u.next_check_at,u.created_at
     from public.project_updates u where u.initiative_id=i.id order by u.created_at desc limit 1
   ) lu on true
   left join lateral (
     select m.title,m.due_at,m.status
     from public.milestones m join public.results r on r.id=m.result_id
     where r.initiative_id=i.id and m.design_status='APPROVED' and m.status not in ('VERIFIED','CANCELLED')
     order by m.due_at asc limit 1
   ) nm on true
   left join lateral (
     select count(*)::int open_blockers
     from public.blockers b join public.milestones m on m.id=b.milestone_id join public.results r on r.id=m.result_id
     where r.initiative_id=i.id and b.status='OPEN'
   ) ob on true
   left join lateral (
     select count(*)::int pending_permissions from public.project_permissions p
     where p.initiative_id=i.id and p.status='PENDING'
   ) pp on true
   left join lateral (
     select max(x.created_at) last_intervention_at from public.project_interventions x where x.initiative_id=i.id
   ) li on true
 )
 select coalesce(jsonb_agg(to_jsonb(enriched) order by signal_score desc,coalesce(next_milestone_due_at,target_due_at) asc),'[]'::jsonb) into out from enriched;
 return out;
end $$;
grant execute on function public.workspace_attention_snapshot() to authenticated;

create or replace function public.permission_approval_queue() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare out jsonb; r text:=coalesce(public.current_role()::text,''); sid uuid:=public.current_secretariat_id();
begin
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',a.id,'permission_id',a.permission_id,'approval_kind',a.approval_kind,'target_secretariat_id',a.target_secretariat_id,
   'status',a.status,'decided_by',a.decided_by,'decision_id',a.decision_id,'note',a.note,'created_at',a.created_at,'decided_at',a.decided_at,
   'permission',jsonb_build_object(
     'id',p.id,'initiative_id',p.initiative_id,'permission_key',p.permission_key,'title',p.title,'description',p.description,
     'permission_type',p.permission_type,'scope_type',p.scope_type,'target_secretariat_id',p.target_secretariat_id,'requested_by',p.requested_by,
     'requested_for',p.requested_for,'rationale',p.rationale,'status',p.status,'created_at',p.created_at,
     'target_secretariat',case when ts.id is null then null else jsonb_build_object('id',ts.id,'code',ts.code,'name_ar',ts.name_ar,'active',ts.active) end,
     'requester',case when req.id is null then null else jsonb_build_object('id',req.id,'full_name',req.full_name) end,
     'initiative',jsonb_build_object('id',i.id,'title',i.title,'secretariat_id',i.secretariat_id,'secretary_id',i.secretary_id,'owner_id',i.owner_id),
     'source_secretariat',jsonb_build_object('id',ss.id,'name_ar',ss.name_ar)
   )
 ) order by a.created_at),'[]'::jsonb) into out
 from public.project_permission_approvals a
 join public.project_permissions p on p.id=a.permission_id
 join public.initiatives i on i.id=p.initiative_id
 join public.secretariats ss on ss.id=i.secretariat_id
 left join public.secretariats ts on ts.id=p.target_secretariat_id
 left join public.profiles req on req.id=p.requested_by
 where a.status='PENDING' and (
   public.can_read_initiative(i.id) or r in ('GS','PRESIDENT','ADMIN') or
   (r='SECRETARY' and a.approval_kind='TARGET_SECRETARY' and a.target_secretariat_id=sid)
 );
 return out;
end $$;
grant execute on function public.permission_approval_queue() to authenticated;

-- ===== Workspace v2 =====

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
