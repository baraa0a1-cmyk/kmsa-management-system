import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sql=read('supabase/migrations/0018_admin_batches_and_cycles_v5_9.sql');
const wf=read('supabase/functions/workflow/index.ts');
const page=read('apps/web/src/pages/AdminPage.tsx');
const shell=read('apps/web/src/components/AppShell.tsx');
const app=read('apps/web/src/App.tsx');
const css=read('apps/web/src/styles.css');
const checks=[
 ['Independent batch table',sql.includes('create table if not exists public.kmsa_batches')],
 ['Batch level 1-6 validated by DB',sql.includes('academic_level between 1 and 6')],
 ['Earlier cohorts backfilled',sql.includes('select batch_number from public.cycle_batches')],
 ['Batch read permission admin only',sql.includes("p.role='ADMIN'")&&sql.includes('kmsa_batches_admin_read')],
 ['Transfer audit trail',sql.includes('create table if not exists public.kmsa_batch_transfers')],
 ['Transfer is atomic SQL procedure',sql.includes('admin_move_kmsa_member')&&sql.includes('for update')],
 ['Transfer admin credential confirmed inside DB',sql.includes("p.role='ADMIN'" )&&sql.includes('admin_move_kmsa_member')],
 ['Transfer no reason field',!/\breason\b/.test(sql)],
 ['Cycle metadata atomic',sql.includes('admin_update_kmsa_cycle')&&sql.includes('to_jsonb(p_code)')],
 ['Cycle single active',sql.includes('kmsa_one_current_cycle_guard')],
 ['Nine constitutional seats include GS assistant',page.includes('GS_ASSISTANT')&&sql.includes('kmsa_cycle_gs_assistants')],
 ['Assistant does not implicitly get GS power',wf.includes("role:'MEMBER'")&&wf.includes("actionName==='ADMIN_CYCLE_ASSISTANT_SET'")],
 ['Cycle created without starting date or batches',wf.includes("is_current:false").valueOf()&&wf.includes("actionName==='ADMIN_CYCLE_CREATE'")&&wf.includes("const c=await db.from('cycles').insert({code,name,status:'DRAFT',is_current:false})")],
 ['Code prefix comes from numeric label',wf.includes('const code=`KMSA${suffix}`')],
 ['Cycle batches require catalog batch',wf.includes('أنشئ الدفعة أولًا في قسم الدفعات')],
 ['Cycle batches can be removed',wf.includes("actionName==='ADMIN_CYCLE_BATCH_REMOVE'")],
 ['Cohort imports no longer require cycle',wf.includes('ADMIN_BATCH_IMPORT')&&!/if\(actionName===\x27ADMIN_BATCH_IMPORT\x27\)\{\s*const cycleId/.test(wf)],
 ['Shared initial password and forced update',wf.includes('password:initial')&&wf.includes('must_change_password:true')],
 ['Existing passwords untouched during import',wf.includes("status:'EXISTS'")&&wf.includes('لم تُغير كلمة مروره')],
 ['No existing passwords displayed in UI',page.includes('لا يستطيع المدير قراءة كلمة المرور الشخصية')],
 ['Reset temporary secrets random',wf.includes('crypto.getRandomValues(new Uint8Array(24))')],
 ['Batch member move API checks',wf.includes("actionName==='ADMIN_BATCH_MEMBER_MOVE'")],
 ['Admin is separated from member portal',app.includes("profile?.role==='ADMIN'")&&shell.includes('function AdminShell()')],
 ['Admin can change own password',wf.includes('ACCOUNT_PASSWORD_CHANGE$')&&shell.includes("nav('/change-password')")],
 ['Compact batch sub-tabs',page.includes('a61-tools')&&page.includes('تعديل الدفعة')],
 ['Batch detail supports CSV',page.includes('function readCsv(')&&page.includes('استيراد CSV')],
 ['Batch list not linked to cycle',page.includes('function BatchArea(')&&page.includes('setSelectedBatch(')],
 ['No move reason requested',!page.includes('سبب النقل')],
 ['Import progress is visible',page.includes('setProgress(')&&page.includes('جارٍ التنفيذ')],
 ['CSS dedicated administration shell',css.includes('.v59-admin-shell')&&css.includes('.v59-list-row')],
 ['Admin does not render member notifications',shell.includes("if(profile?.role==='ADMIN')return <AdminShell/>")],
 ['Admin actions blocked from project operations',wf.includes('مدير النظام يدير الدورات والحسابات فقط')],
];
let failed=0;for(const [name,passed] of checks){console.log(`${passed?'PASS':'FAIL'} ${name}`);if(!passed)failed++;}
console.log(`v5.9: ${checks.length-failed}/${checks.length} static checks passed`);if(failed)process.exitCode=1;
