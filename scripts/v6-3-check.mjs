import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/0022_office_enum_and_unassigned_v6_3.sql');
const ui=read('apps/web/src/pages/AdminPage.tsx');
const legacy=read('supabase/migrations/0021_admin_integrity_v6_2.sql');
const checks=[
 ['Guard verifies prior migration',sql.includes('V6_3_PREREQUISITES_MISSING')&&sql.includes('kmsa_admin_replace_leader')],
 ['Role parameter has enum cast in candidate comparison',sql.includes('m.role=p_role::public.app_role AND m.secretariat_id')],
 ['Role parameter has enum cast in incumbent search',sql.includes('m.cycle_id=p_cycle AND m.role=p_role::public.app_role AND')],
 ['No raw app_role=text equality remains in replacement function',!sql.includes('m.role=p_role AND')],
 ['Existing membership role replaced rather than new profile created',sql.includes('ON CONFLICT(cycle_id,profile_id) DO UPDATE')],
 ['Existing leadership history remains',sql.includes('INSERT INTO public.kmsa_leadership_changes')],
 ['Guard still requires allowed cycle/batch',sql.includes('kmsa_office_candidate_allowed(p_cycle,p_new_profile)')],
 ['Admin actor must authorize leader replacement',sql.includes('actor:=public.kmsa_admin_actor()')],
 ['Search recognizes unassigned sentinel -1',sql.includes('(p_batch=-1 AND p.batch_number IS NULL)')],
 ['Search rejects nonexistent negative batches',sql.includes('p_batch < -1 OR p_batch=0')],
 ['Search excludes permanent admin profiles',sql.includes("WHERE p.role<>'ADMIN'")],
 ['Unassigned count computed from null batch only',sql.includes('p.batch_number IS NULL')&&sql.includes('(-1)::integer, count(p.id)')],
 ['Unassigned count restricted to administrators',sql.includes('HAVING public.kmsa_admin_actor() IS NOT NULL')],
 ['Special unassigned group on list',ui.includes('غير محدد الدفعة')&&ui.includes('setSelectedBatch(-1)')],
 ['Unassigned selection shows people',ui.includes('isUnassigned?-1:batch!.batch_number')],
 ['No batch record created for sentinel',!sql.includes('INSERT INTO public.kmsa_batches')],
 ['No add/import controls on unassigned view',ui.includes('!isUnassigned&&<><KmsaSingleMember')],
 ['No batch edit control for unassigned view',ui.includes('!isUnassigned&&<Action variant="outline" onClick={startEdit}')],
 ['Unassigned profile can be moved using existing member action',ui.includes("'ADMIN_BATCH_MEMBER_MOVE'")],
 ['Navigation preserves unassigned sentinel',ui.includes('q.batch!==undefined&&q.batch!==0')],
 ['Admin search is paginated',sql.includes('LIMIT p_limit OFFSET p_offset')],
 ['SQL migration does not delete domain records',!(/DELETE FROM public\.(profiles|cycles|initiatives|proposals|kmsa_batches)/i.test(sql))],
 ['Original v6.2 schema untouched',legacy.includes('m.role=p_role AND')],
 ['Top notice error help improved',read('apps/web/src/components/KmsaAdminNotice.tsx').includes('operator does not exist: app_role = text')],
];
let fails=0;for(const [t,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${t}`);if(!ok)fails++;}console.log(`v6.3 ${checks.length-fails}/${checks.length} checks passed`);if(fails)process.exitCode=1;
