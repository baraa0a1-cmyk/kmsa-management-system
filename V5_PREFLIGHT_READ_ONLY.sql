-- KMSA v5: read-only database schema check. Makes NO CHANGES.
-- Run in Supabase SQL Editor. 1 = installed; 0 = missing.
select name, case when to_regclass('public.'||name) is not null then 1 else 0 end as installed
from (values
 ('proposals'), ('proposal_versions'), ('background_jobs'), ('project_updates'), ('project_interventions'),
 ('initiatives'), ('results'), ('milestones'), ('routine_obligations'), ('routine_updates'),
 ('quick_tasks'), ('operational_positions'), ('position_assignments'), ('position_duty_templates'),
 ('work_events'), ('event_attendance'), ('user_notifications'), ('file_assets')
) as t(name)
order by name;

-- Privileged functions: verify installation without invoking the functions as a test member.
select p.proname as function_name, count(*) as installed_overloads
from pg_proc p join pg_namespace n on p.pronamespace=n.oid
where n.nspname='public' and p.proname in (
 'workspace_project_sheet','proposal_tracking_sheet','routine_obligation_sheet',
 'quick_task_sheet','system_readiness_snapshot','current_profile_id','current_role'
) group by p.proname order by p.proname;

-- Check whether v5 evidence source-identity upgrade has been installed.
select case when exists(
 select 1 from information_schema.columns where table_schema='public' and table_name='milestone_evidence' and column_name='source_storage_path'
) then 'INSTALLED' else 'MISSING' end as v5_evidence_identity;
