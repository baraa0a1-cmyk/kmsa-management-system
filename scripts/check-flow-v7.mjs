import fs from 'node:fs';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));const read=p=>fs.readFileSync(resolve(root,p),'utf8');
const require=createRequire(import.meta.url);let ts;try{ts=require(resolve(root,'apps/web/node_modules/typescript'))}catch{ts=require('typescript')}
const rules=read('apps/web/src/features/project-flow/flowRules.ts');const js=ts.transpileModule(rules,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const m=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const base='2026-11-03T09:00:00.000Z',now=Date.parse(base);
const plus=h=>new Date(now+h*3600000).toISOString();
const checks=[
 ['Starts fresh without historical blame',m.supervisorDueAt(base,null,null)===plus(12)],
 ['New delegation resets accountability origin',m.supervisorDueAt(plus(6),plus(9),null)===plus(21)],
 ['External waiting respects review event',m.supervisorDueAt(base,null,{created_at:base,assessment:'WAITING_EXTERNAL',next_review_at:plus(72)})===plus(72)],
 ['Ordinary review sets 12-hour checkpoint',m.supervisorDueAt(base,null,{created_at:plus(3),assessment:'ON_TRACK',next_review_at:null})===plus(15)],
 ['No secretary blame before 24-hour grace',!m.secretaryHasMissedAction({due:plus(-10),now,delegated:true,latestCheck:null,secretaryAction:null})],
 ['Secretary accountability after missed delegated supervision',m.secretaryHasMissedAction({due:plus(-26),now,delegated:true,latestCheck:null,secretaryAction:null})],
 ['Direct secretary supervision not mistaken for deputization',!m.secretaryHasMissedAction({due:plus(-50),now,delegated:false,latestCheck:null,secretaryAction:null})],
 ['Telegram contact alone never removes the missing check',m.secretaryHasMissedAction({due:plus(-30),now,delegated:true,latestCheck:null,secretaryAction:{created_at:plus(-20),review_at:plus(12)}})],
 ['Secretary must return after promised follow-up',m.secretaryHasMissedAction({due:plus(-50),now,delegated:true,latestCheck:null,secretaryAction:{created_at:plus(-30),review_at:plus(-3)}})],
 ['New check resets the clock only when it is genuinely current',!m.secretaryHasMissedAction({due:m.supervisorDueAt(base,null,{created_at:plus(-3),assessment:'ON_TRACK',next_review_at:null}),now,delegated:true,latestCheck:{created_at:plus(-3),assessment:'ON_TRACK',next_review_at:null},secretaryAction:null})],
 ['Unknown report does not imply no work',!m.documentationLate(null,now)],
 ['Old report is separately detectable',m.documentationLate(plus(-30),now)],
];
const sql=read('supabase/migrations/0026_project_flow_v7.sql'),flow=read('supabase/functions/project-flow/index.ts'),home=read('apps/web/src/features/project-flow/ProjectFlowHome.tsx'),detail=read('apps/web/src/features/project-flow/ProjectFlowDetail.tsx'),installer=read('scripts/install-flow-v7.mjs');
checks.push(
 ['Writes to existing milestone history',sql.includes('INSERT INTO public.project_activity_entries')],
 ['Atomic batch progress function',sql.includes('CREATE OR REPLACE FUNCTION public.kmsa_flow_batch_progress')],
 ['No client writes to flow tables',sql.includes('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated')],
 ['Service-only execution privilege',sql.includes('TO service_role')&&!sql.includes('TO authenticated;\nCOMMIT')],
 ['New activity uses stable request key',sql.includes('UNIQUE(initiative_id,author_id,request_key)')],
 ['Group reporting preserves milestones',detail.includes('BATCH_UPDATE')&&detail.includes('selectedEdit')&&detail.includes('activeStages')],
 ['Single project verification workflow',detail.includes('CHECK_ADD')&&flow.includes("action==='CHECK_ADD'")],
 ['No self-review allowed',flow.includes('profile.id===init.owner_id')],
 ['Secretary and supervisor distinct',sql.includes("'DELEGATE','SECRETARY_DIRECT'" )],
 ['Project closure requires separate result review',sql.includes('kmsa_flow_require_result_review')&&sql.includes("event_type='RESULT_OK'")],
 ['Cycle and owner guards',flow.includes('data.cycle_id!==cycle.id')&&sql.includes('v_m.owner_id<>p_author')],
 ['No arbitrary injected access grants',!sql.includes('GRANT INSERT ON public.kmsa_flow_issues TO authenticated')],
 ['Old project workflows remain available',installer.includes('/classic')],
 ['Three tabs remain',home.includes('سير المشاريع')&&home.includes('متابعة الإشراف')&&home.includes('قرارات المشاريع')],
 ['Legacy request-update not reintroduced in new UI',!home.includes("MILESTONE_UPDATE_REQUEST")&&!detail.includes("MILESTONE_UPDATE_REQUEST")],
 ['Responsive visual language',read('apps/web/src/features/project-flow/projectFlow.css').includes('@media(max-width:760px)')],
 ['In-site date and time picker',read('apps/web/src/features/project-flow/FlowDateTimePicker.tsx').includes('createPortal')],
 ['UI has saving feedback',detail.includes('جارٍ الحفظ...')],
 ['Issue follow-up requires verification to close',flow.includes("action==='ISSUE_CLOSE'")&&flow.includes('resolution.length<6')],
 ['No retrospective check accusations on initial migration',sql.includes('kmsa_flow_baselines')&&sql.includes('now()')],
 ['Existing tables are not removed',!/(DROP TABLE|TRUNCATE|DELETE FROM public\.milestones)/i.test(sql)],
);
let failures=0;for(const [label,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${label}`);if(!ok)failures++}
console.log(`KMSA Flow v7: ${checks.length-failures}/${checks.length} checks pass`);if(failures)process.exitCode=1;
