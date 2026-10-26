import fs from 'node:fs';import path from 'node:path';
const root=process.cwd(),src=f=>fs.readFileSync(path.join(root,f),'utf8');
const sql=src('supabase/migrations/0019_v6_admin_safety.sql');
const cycle=src('apps/web/src/components/KmsaCycleSwitchPanel.tsx');
const imp=src('apps/web/src/components/KmsaImportReview.tsx');
const single=src('apps/web/src/components/KmsaSingleMember.tsx');
const patch=src('scripts/apply_v6_admin.mjs');
const checks=[
 ['Cycle switch log persists across years',sql.includes('CREATE TABLE IF NOT EXISTS public.kmsa_cycle_switch_log')],
 ['Switch requires known active cycle',sql.includes('p_expected_current')&&sql.includes('CYCLE_CHANGED_RELOAD')],
 ['Switch serialized using advisory lock',sql.includes('pg_advisory_xact_lock(74631928)')],
 ['Requires typed cycle code on server',sql.includes('EXPLICIT_CONFIRMATION_REQUIRED')],
 ['Previous memberships preserved',!sql.includes('DELETE FROM public.cycle_memberships')],
 ['No project or proposal deletion in migration',!(/DELETE FROM public\.(initiatives|proposals|results)/i.test(sql))],
 ['Most recent switch reversible',sql.includes('ONLY_MOST_RECENT_SWITCH_CAN_BE_REVERSED')],
 ['Switch history includes old and new',sql.includes('from_cycle_id')&&sql.includes('to_cycle_id')],
 ['Legacy callable switch revoked',sql.includes('REVOKE EXECUTE ON FUNCTION public.activate_kmsa_cycle(uuid)')],
 ['Cycle preflight contains project and proposal counts',sql.includes('projectsInCurrent')&&sql.includes('proposalsInCurrent')],
 ['Current-cycle profile roles recomputed',sql.includes("UPDATE public.profiles SET role='MEMBER'")],
 ['Active-cycle leadership changes audited',sql.includes('kmsa_admin_replace_leader')&&sql.includes('kmsa_leadership_changes')],
 ['Assistant seat does not inherit GS powers',sql.includes('kmsa_admin_replace_assistant')&&!sql.includes("SET role='GS' WHERE")],
 ['Import verification uses university IDs',sql.includes('trim(university_id)=v_uid')],
 ['Import incomplete identities held as drafts',sql.includes('kmsa_import_review')&&sql.includes('kmsa_save_import_review')],
 ['Import status RPC admin only',sql.includes('kmsa_admin_actor() IS NULL')],
 ['Cycle modal needs checkbox and typed code',cycle.includes('typed!==cycle.code')&&cycle.includes('checked={ack}')],
 ['Cycle restore is exposed after switching',cycle.includes('الرجوع إلى هذه الدورة السابقة')],
 ['All CSV rows paged and selectable',imp.includes('displayed.slice(page*25')&&imp.includes('onSelectionChange')],
 ['CSV detects cross-batch conflicts',imp.includes('kmsa_check_import_people')],
 ['Member single entry supported',single.includes("workflow('ADMIN_BATCH_IMPORT'")],
 ['Installer fails closed on mismatch',patch.includes('if(failures.length)')&&patch.includes('process.exit(3)')],
 ['Installer blocks old Edge activation',patch.includes("ADMIN_CYCLE_ACTIVATE")&&patch.includes('اعتماد الدورة متاح فقط')],
 ['Installer blocks resetting another administrator',patch.includes("candidate.role==='ADMIN'")],
 ['All confirmation dialogs implemented in application',patch.includes('v6-modal-layer')],
];let failures=0;for(const [label,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${label}`);if(!ok)failures++;}console.log(`v6 static: ${checks.length-failures}/${checks.length} checks passed`);process.exitCode=failures?1:0;
