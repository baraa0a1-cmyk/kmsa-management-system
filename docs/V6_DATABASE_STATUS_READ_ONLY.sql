-- READ ONLY. Safe to run in Supabase SQL Editor. No records are created or changed.
SELECT 'cycles' AS object, to_regclass('public.cycles') IS NOT NULL AS installed
UNION ALL SELECT 'cycle_memberships', to_regclass('public.cycle_memberships') IS NOT NULL
UNION ALL SELECT 'kmsa_cycle_switch_log', to_regclass('public.kmsa_cycle_switch_log') IS NOT NULL
UNION ALL SELECT 'kmsa_import_review', to_regclass('public.kmsa_import_review') IS NOT NULL
UNION ALL SELECT 'kmsa_leadership_changes', to_regclass('public.kmsa_leadership_changes') IS NOT NULL
UNION ALL SELECT 'kmsa_cycle_preview(uuid)', to_regprocedure('public.kmsa_cycle_preview(uuid)') IS NOT NULL
UNION ALL SELECT 'kmsa_switch_current_cycle', to_regprocedure('public.kmsa_switch_current_cycle(uuid,uuid,text,boolean,boolean)') IS NOT NULL;

-- Only cycle metadata (no personal information). Return the active cycle(s) and status.
SELECT code, name, status, is_current FROM public.cycles ORDER BY is_current DESC, created_at DESC;
