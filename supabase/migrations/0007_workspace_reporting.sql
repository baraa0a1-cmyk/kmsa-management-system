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
