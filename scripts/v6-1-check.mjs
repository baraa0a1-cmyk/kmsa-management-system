import fs from 'node:fs';
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=get('supabase/migrations/0020_admin_essentials_v6_1.sql');
const page=get('apps/web/src/pages/AdminPage.tsx');
const style=get('apps/web/src/pages/admin-v61.css');
const original=get('supabase/migrations/0019_v6_admin_safety.sql');
const checks=[
 ['Migration requires v6.0',sql.includes('KMSA_V6_1_PREREQUISITES_MISSING_APPLY_0017_0018_0019_FIRST')],
 ['Migration does not delete user, project or cycle rows',!(/DELETE FROM public\.(profiles|initiatives|proposals|cycles)\b/i.test(sql))],
 ['Batch correction is transactional',sql.includes('kmsa_admin_correct_batch')&&sql.includes('pg_advisory_xact_lock')],
 ['Changing batch number preserves profiles',sql.includes('UPDATE public.profiles SET batch_number=p_new_number')],
 ['Changing batch number preserves historical cycles',sql.includes('UPDATE public.cycle_batches SET batch_number=p_new_number')],
 ['Changing batch number preserves transfer histories',sql.includes('UPDATE public.kmsa_batch_transfers SET from_batch=p_new_number')&&sql.includes('UPDATE public.kmsa_batch_transfers SET to_batch=p_new_number')],
 ['Changing batch number preserves saved import reviews',sql.includes('UPDATE public.kmsa_import_review SET batch_number=p_new_number')],
 ['Batch correction audit trail',sql.includes('CREATE TABLE IF NOT EXISTS public.kmsa_batch_corrections')],
 ['Batch correction admin check',sql.includes("actor:=public.kmsa_admin_actor()")],
 ['Member search server-side scoped to admin',sql.includes('kmsa_admin_find_people')&&sql.includes('IF public.kmsa_admin_actor() IS NULL')],
 ['Member search supports cohort filtering',sql.includes('p_batch IS NULL OR p.batch_number=p_batch')],
 ['Member search is paginated',sql.includes('LIMIT p_limit OFFSET p_offset')],
 ['Member search caps page length',sql.includes('p_limit NOT BETWEEN 1 AND 50')],
 ['Admin batch counts server-side',sql.includes('kmsa_admin_batch_sizes()')],
 ['Two functional admin areas',page.includes('الأعضاء والدفعات')&&page.includes('الدورات والقيادة')],
 ['Batch creation does not require cycle',page.includes("'ADMIN_BATCH_CREATE'")],
 ['Batch detail opens from batch list',page.includes('setSelectedBatch(b.batch_number)')],
 ['People added inside a batch',(page.includes('<KmsaSingleMember batch={batch.batch_number}')||page.includes('<KmsaSingleMember batch={batch!.batch_number}'))],
 ['CSV imported inside batch with explicit selection',page.includes('selectedRows.includes(x.row)')&&page.includes('KmsaImportReview')],
 ['Single import password for selected users',page.includes('initialPassword:pass')],
 ['No council membership workflow in administration',!page.includes('مجلس الرابطة')],
 ['No freeze / academic individual status',!page.includes('التجميد')&&!page.includes('الحالة الأكاديمية')],
 ['Member move only selects a new batch',page.includes("'ADMIN_BATCH_MEMBER_MOVE'")&&!page.includes('سبب النقل')],
 ['Account recovery from member details',page.includes("'ADMIN_RESET_PASSWORD'")&&page.includes('MemberDetail')],
 ['Leader selection uses server search rather than 5000-member dropdown',page.includes('<SearchPeople cycleId={cycle.id} batch={personBatch?Number(personBatch):null}')&&!page.includes('.limit(5000)')],
 ['Leadership can change within active cycle via v6 RPC',page.includes('kmsa_admin_replace_leader')&&original.includes("target_cycle.status NOT IN('DRAFT','OPEN')")],
 ['General secretary assistant seat preserved',page.includes('GS_ASSISTANT')&&page.includes('kmsa_admin_replace_assistant')],
 ['Batch membership selectable within cycle',page.includes("'ADMIN_CYCLE_BATCH_ADD'")&&page.includes("'ADMIN_CYCLE_BATCH_REMOVE'")],
 ['Cycle switch has a single website confirmation',page.includes("ask('جعل الدورة الحالية'")&&page.includes('kmsa_switch_current_cycle')],
 ['Cycle switch checks current state before committing',page.includes('kmsa_cycle_preview')&&page.includes('p_expected_current')],
 ['Cycle switch supports reversal of last transition',page.includes('p_reversal:reversal')&&original.includes('ONLY_MOST_RECENT_SWITCH_CAN_BE_REVERSED')],
 ['No window native confirmation',!page.includes('window.confirm')],
 ['Identity palette includes brand blue red and dark',style.includes('#087ab8')&&style.includes('#ec1d32')&&style.includes('#1d2939')],
 ['Mobile layout',style.includes('@media(max-width:710px)')],
 ['Legacy multi-tab account navigation removed',!page.includes('v59-subnav')],
 ['No external password disclosure',page.includes('لا يستطيع المدير قراءة كلمة المرور الشخصية')],
];
let failed=0;for(const [title,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${title}`);if(!ok)failed++}console.log(`v6.1 ${checks.length-failed}/${checks.length}`);if(failed)process.exitCode=1;
