-- Read access is granted by RLS. All mutations go through Edge Function workflow using service_role.

create or replace function public.can_read_secretariat(p_secretariat uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select case public.current_role()
    when 'ADMIN' then true
    when 'GS' then true
    when 'SECRETARY' then public.current_secretariat_id()=p_secretariat
    when 'MEMBER' then public.current_secretariat_id()=p_secretariat
    else false end;
$$;

create or replace function public.can_manage_secretariat(p_secretariat uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select case public.current_role()
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
     public.current_role() in ('GS','ADMIN') or
     (public.current_role()='SECRETARY' and p.secretariat_id=public.current_secretariat_id())
   )
 );
$$;

create or replace function public.can_read_milestone(p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from public.milestones m
   where m.id=p_id and (
     m.owner_id=public.current_profile_id() or
     public.can_read_secretariat(m.secretariat_id)
   )
 );
$$;

alter table public.cycles enable row level security;
alter table public.secretariats enable row level security;
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_versions enable row level security;
alter table public.proposal_actions enable row level security;
alter table public.initiatives enable row level security;
alter table public.results enable row level security;
alter table public.milestones enable row level security;
alter table public.weekly_commitments enable row level security;
alter table public.milestone_evidence enable row level security;
alter table public.blockers enable row level security;
alter table public.interventions enable row level security;
alter table public.verifications enable row level security;
alter table public.oversight_notes enable row level security;
alter table public.meetings enable row level security;
alter table public.decisions enable row level security;
alter table public.file_assets enable row level security;
alter table public.notification_log enable row level security;
alter table public.audit_log enable row level security;
alter table public.system_settings enable row level security;
alter table public.proposal_counters enable row level security;
alter table public.login_attempts enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.cycles, public.secretariats, public.profiles, public.plans, public.proposals, public.proposal_versions,
 public.proposal_actions, public.initiatives, public.results, public.milestones, public.weekly_commitments, public.milestone_evidence,
 public.blockers, public.interventions, public.verifications, public.oversight_notes, public.meetings, public.decisions,
 public.file_assets, public.notification_log, public.audit_log, public.system_settings to authenticated;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.current_secretariat_id() to authenticated;
grant execute on function public.can_read_secretariat(uuid) to authenticated;
grant execute on function public.can_read_proposal(uuid) to authenticated;
grant execute on function public.can_read_milestone(uuid) to authenticated;

create policy cycles_read on public.cycles for select to authenticated using (true);
create policy secretariats_read on public.secretariats for select to authenticated using (active or public.current_role() in ('GS','ADMIN'));
create policy profiles_read on public.profiles for select to authenticated using (
 id=public.current_profile_id() or public.current_role() in ('GS','ADMIN') or
 (public.current_role()='SECRETARY' and secretariat_id=public.current_secretariat_id())
);
create policy plans_read on public.plans for select to authenticated using (public.can_read_secretariat(secretariat_id));
create policy proposals_read on public.proposals for select to authenticated using (
 applicant_id=public.current_profile_id() or public.current_role() in ('GS','ADMIN') or
 (public.current_role()='SECRETARY' and secretariat_id=public.current_secretariat_id())
);
create policy proposal_versions_read on public.proposal_versions for select to authenticated using (public.can_read_proposal(proposal_id));
create policy proposal_actions_read on public.proposal_actions for select to authenticated using (public.can_read_proposal(proposal_id));
create policy initiatives_read on public.initiatives for select to authenticated using (owner_id=public.current_profile_id() or public.can_read_secretariat(secretariat_id));
create policy results_read on public.results for select to authenticated using (exists(select 1 from public.initiatives i where i.id=initiative_id and (i.owner_id=public.current_profile_id() or public.can_read_secretariat(i.secretariat_id))));
create policy milestones_read on public.milestones for select to authenticated using (owner_id=public.current_profile_id() or public.can_read_secretariat(secretariat_id));
create policy commitments_read on public.weekly_commitments for select to authenticated using (public.can_read_milestone(milestone_id));
create policy evidence_read on public.milestone_evidence for select to authenticated using (public.can_read_milestone(milestone_id));
create policy blockers_read on public.blockers for select to authenticated using (public.can_read_milestone(milestone_id));
create policy interventions_read on public.interventions for select to authenticated using (public.can_read_milestone(milestone_id));
create policy verifications_read on public.verifications for select to authenticated using (public.can_read_milestone(milestone_id));
create policy oversight_read on public.oversight_notes for select to authenticated using (public.current_role() in ('GS','ADMIN') or (public.current_role()='SECRETARY' and secretariat_id=public.current_secretariat_id()));
create policy meetings_read on public.meetings for select to authenticated using (public.current_role() in ('MEMBER','SECRETARY','GS','ADMIN'));
create policy decisions_read on public.decisions for select to authenticated using (public.current_role() in ('GS','ADMIN') or secretariat_id is null or public.can_read_secretariat(secretariat_id));
create policy files_read on public.file_assets for select to authenticated using (
 (entity_type='PROPOSAL' and public.can_read_proposal(entity_id)) or
 (entity_type='MILESTONE' and public.can_read_milestone(entity_id)) or
 public.current_role() in ('GS','ADMIN')
);
create policy notifications_read on public.notification_log for select to authenticated using (public.current_role() in ('GS','ADMIN'));
create policy audit_read on public.audit_log for select to authenticated using (public.current_role() in ('GS','ADMIN'));
create policy settings_read on public.system_settings for select to authenticated using (true);
-- proposal_counters and login_attempts deliberately have no authenticated select policy.
