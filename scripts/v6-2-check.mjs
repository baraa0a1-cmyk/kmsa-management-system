import fs from 'node:fs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sql=read('supabase/migrations/0021_admin_integrity_v6_2.sql');
const workflow=read('supabase/functions/workflow/index.ts');
const admin=read('apps/web/src/pages/AdminPage.tsx');
const importer=read('apps/web/src/components/KmsaImportReview.tsx');
const toast=read('apps/web/src/components/KmsaAdminNotice.tsx');
const css=read('apps/web/src/pages/admin-v61.css');
const api=read('apps/web/src/lib/api.ts');
const tests=[
 ['Migration demands previous versions',sql.includes('KMSA_V6_2_PREREQUISITE_MISSING')],
 ['Migration atomic',sql.trim().startsWith('-- KMSA v6.2')&&sql.includes('BEGIN;')&&sql.trim().endsWith('COMMIT;')],
 ['No destructive cycle/project operations',!(/delete\s+from\s+public\.(?:cycles|initiatives|proposals|profiles)\b/i).test(sql)],
 ['Graduation separate from active flag',sql.includes('ADD COLUMN IF NOT EXISTS graduated boolean')],
 ['Graduation administration privileged',sql.includes('kmsa_admin_set_batch_graduated')&&sql.includes('ADMIN_REQUIRED')],
 ['Batch identity & graduated state atomic',sql.includes('kmsa_admin_save_batch_v62')&&sql.includes('kmsa_admin_correct_batch(')],
 ['Candidates depend on cycle batches',sql.includes('JOIN public.cycle_batches cb ON cb.batch_number=p.batch_number AND cb.cycle_id=p_cycle')],
 ['Graduated candidates excluded',sql.includes('b.graduated=false')],
 ['Inactive members excluded',sql.includes('p.active=true AND p.role<>\'ADMIN\'')],
 ['Office candidates admin-only',sql.includes('kmsa_admin_office_candidates')&&sql.includes('public.kmsa_admin_actor()')],
 ['Office RPC does not reveal to general public',sql.includes('REVOKE ALL ON FUNCTION public.kmsa_admin_office_candidates')],
 ['Leader checks server eligibility',sql.includes('IF NOT public.kmsa_office_candidate_allowed(p_cycle,p_new_profile)')],
 ['Assistant checks server eligibility',sql.includes('IF NOT public.kmsa_office_candidate_allowed(p_cycle,p_profile)')],
 ['Executive role conflict rejected',sql.includes('CANDIDATE_HOLDS_ANOTHER_EXECUTIVE_SEAT')],
 ['Current cycle profile privileges follow appointment',sql.includes('IF target_cycle.is_current THEN')],
 ['Office changes auditable',sql.includes('INSERT INTO public.kmsa_leadership_changes')],
 ['CSV matches university number',sql.includes('trim(university_id)=uid')],
 ['CSV distinguishes email collision',sql.includes('EMAIL_IN_USE_BY_ANOTHER_MEMBER')&&sql.includes('EMAIL_ALREADY_USED_BY_DIFFERENT_ID')],
 ['CSV review reveals existing email for diffs',sql.includes("'existingEmail'")],
 ['Legacy office endpoint disabled',workflow.includes('تم إيقاف طريقة التعيين القديمة')],
 ['Backend refuses graduated batch additions',workflow.includes('الدفعة متخرجة؛ لا يمكن ضمها')],
 ['Backend refuses removing batch of office-holder',workflow.includes('غّير التكليف أولًا')||workflow.includes('غيّر التكليف أولًا')],
 ['Update-existing action supports explicit fields only',workflow.includes("actionName==='ADMIN_MEMBER_SYNC'")&&workflow.includes('updateName===true')&&workflow.includes('updateEmail===true')],
 ['Update-existing asserts immutable university ID',workflow.includes("existing.university_id||''").valueOf()&&workflow.includes('الرقم الجامعي لا يطابق حساب العضو')],
 ['Update-existing does not set password',!workflow.slice(workflow.indexOf("if(actionName==='ADMIN_MEMBER_SYNC')"),workflow.indexOf("if(actionName==='ADMIN_BATCH_CREATE')")).includes('password:')],
 ['Update-existing does not move cohort',!workflow.slice(workflow.indexOf("if(actionName==='ADMIN_MEMBER_SYNC')"),workflow.indexOf("if(actionName==='ADMIN_BATCH_CREATE')")).includes('batch_number:')],
 ['Update existing uses Auth Admin only on server',workflow.includes('db.auth.admin.updateUserById')],
 ['Update-existing rollback after profile fail',workflow.includes('const rollback=await db.auth.admin.updateUserById')],
 ['Office search filtered by selected cycle',admin.includes("kmsa_admin_office_candidates")&&admin.includes('cycleId={cycle.id}')],
 ['Office cohort dropdown filtered',admin.includes('cycleBatchIds.includes(b.batch_number)&&b.active&&!b.graduated')],
 ['Editing cohort allows graduate selection',admin.includes('value="graduated">متخرجة')],
 ['Batch editing graduated state through RPC',admin.includes('kmsa_admin_save_batch_v62')],
 ['CSV existing accounts can be selected for update',importer.includes('onUpdatesChange')&&importer.includes('updateDecision(')],
 ['CSV independently chooses changed name/email',importer.includes("updateName',e.target.checked")&&importer.includes("updateEmail',e.target.checked")],
 ['CSV avoids creating on already existing',importer.includes("st==='ready'")],
 ['CSV update action separate from create',admin.includes("'ADMIN_MEMBER_SYNC'")&&admin.includes("'ADMIN_BATCH_IMPORT'")],
 ['Password required for new only',admin.includes('toImport.length>0&&pass.length<12')],
 ['Top notice component mounted',admin.includes('<KmsaAdminNotice/>')],
 ['Top notice above modal',css.includes('.kmsa-notice{position:fixed')&&css.includes('z-index:120000')],
 ['Unknown error objects converted readably',toast.includes('typeof e?.message')&&toast.includes("'حدث خطأ غير متوقع" )],
 ['Supabase HTTP object errors normalized',api.includes('typeof raw.message')],
 ['No browser native alerts in administration',!admin.includes('window.confirm(')&&!admin.includes('window.alert(')],
];
let bad=0;for(const [title,passed] of tests){console.log(`${passed?'PASS':'FAIL'} ${title}`);if(!passed)bad++}console.log(`v6.2 ${tests.length-bad}/${tests.length} checks passed`);if(bad)process.exitCode=1;
