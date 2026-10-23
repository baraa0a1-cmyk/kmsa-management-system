create or replace function public.dashboard_metrics() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  pid uuid:=public.current_profile_id(); r public.app_role:=public.current_role(); sid uuid:=public.current_secretariat_id(); out jsonb;
begin
  with visible as (
    select m.* from public.milestones m where
      m.owner_id=pid or r in ('GS','ADMIN') or (r in ('SECRETARY','MEMBER') and m.secretariat_id=sid)
  ), secstats as (
    select s.id secretariat_id,s.name_ar secretariat_name,
      count(v.id) filter(where v.status not in ('VERIFIED','CANCELLED'))::int active,
      count(v.id) filter(where v.status not in ('VERIFIED','CANCELLED') and v.due_at<now())::int overdue,
      count(v.id) filter(where v.status='VERIFIED')::int verified,
      case when count(v.id) filter(where v.status='VERIFIED')=0 then 0 else
        round(100.0*count(v.id) filter(where v.status='VERIFIED' and v.verified_at<=v.due_at)/nullif(count(v.id) filter(where v.status='VERIFIED'),0))::int end on_time_rate
    from public.secretariats s left join visible v on v.secretariat_id=s.id
    where r in ('GS','ADMIN') or s.id=sid group by s.id,s.name_ar
  )
  select jsonb_build_object(
    'active_milestones',(select count(*) from visible where status not in ('VERIFIED','CANCELLED')),
    'needs_attention',(select count(*) from visible where status in ('AT_RISK','BLOCKED','READY_FOR_VERIFICATION')),
    'overdue',(select count(*) from visible where status not in ('VERIFIED','CANCELLED') and due_at<now()),
    'ready_for_verification',(select count(*) from visible where status='READY_FOR_VERIFICATION'),
    'open_blockers',(select count(*) from public.blockers b join visible m on m.id=b.milestone_id where b.status='OPEN'),
    'weekly_commitments',(select count(*) from public.weekly_commitments c join visible m on m.id=c.milestone_id where c.week_start=date_trunc('week',current_date)::date),
    'weekly_evidence',(select count(*) from public.milestone_evidence e join visible m on m.id=e.milestone_id where e.created_at>=date_trunc('week',now())),
    'secretary_interventions',(select count(*) from public.interventions i join visible m on m.id=i.milestone_id where i.created_at>=date_trunc('week',now())),
    'verification_rate',case when (select count(*) from visible)=0 then 0 else round(100.0*(select count(*) from visible where status='VERIFIED')/nullif((select count(*) from visible),0))::int end,
    'on_time_rate',case when (select count(*) from visible where status='VERIFIED')=0 then 0 else round(100.0*(select count(*) from visible where status='VERIFIED' and verified_at<=due_at)/nullif((select count(*) from visible where status='VERIFIED'),0))::int end,
    'open_proposals',(select count(*) from public.proposals p where (p.applicant_id=pid or r in ('GS','ADMIN') or (r='SECRETARY' and p.secretariat_id=sid)) and p.status not in ('WITHDRAWN','NOT_APPROVED')),
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
 select m.* from public.milestones m where m.owner_id=public.current_profile_id() or public.current_role() in ('GS','ADMIN') or (public.current_role() in ('SECRETARY','MEMBER') and m.secretariat_id=public.current_secretariat_id())
)
select m.id,p.ws,s.name_ar,m.title,o.full_name,r.statement,m.due_at,
  c.commitment_text,
  (select count(*) from public.milestone_evidence e where e.milestone_id=m.id and e.created_at>=p.ws and e.created_at<p.ws+7)::bigint,
  (select b.description from public.blockers b where b.milestone_id=m.id and b.status='OPEN' order by b.created_at desc limit 1),
  (select i.action_text from public.interventions i where i.milestone_id=m.id and i.created_at>=p.ws and i.created_at<p.ws+7 order by i.created_at desc limit 1),
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
