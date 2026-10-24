import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[];
function requireText(file, needles){const text=read(file);for(const n of needles)checks.push({name:`${file}: ${n}`,ok:text.includes(n)});}
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}

checks.push({name:'V4 root SQL matches migration',ok:sha('KMSA_WORKSPACE_V4_UPGRADE_ALL.sql')===sha('supabase/migrations/0010_operating_system_v4.sql')});
requireText('supabase/migrations/0010_operating_system_v4.sql',[
 'create table if not exists public.operational_positions',
 'create table if not exists public.quick_tasks',
 'create table if not exists public.position_event_templates',
 'create table if not exists public.user_notifications',
 'create or replace function public.system_readiness_snapshot()'
]);
requireText('supabase/functions/workflow/index.ts',[
 "actionName==='TASK_CREATE'",
 "actionName==='POSITION_DUTY_UPDATE'",
 "actionName==='EVENT_TEMPLATE_UPDATE'",
 "actionName==='PROPOSAL_REVISION_UPLOAD'",
 'queueProposalArtifacts',
 'archiveProposalUpload'
]);
requireText('supabase/functions/scheduled-monitor/index.ts',[
 'Recovered after worker timeout',
 "const documentTypes=['DOCUMENT_PROPOSAL','ARCHIVE_STAGING_PROPOSAL','ARCHIVE_STAGING_EVIDENCE']",
 'PROJECT_UPDATE_OVERDUE',
 'ROUTINE_OVERDUE',
 'TASK_OVERDUE'
]);
requireText('apps/web/src/App.tsx',[
 '/workspace/tasks',
 '/workspace/routine',
 '/workspace/oversight',
 '/workspace/reports'
]);
requireText('apps/web/src/pages/MemberVoicePage.tsx',['تحميل نموذج Word','مقترح']);
requireText('apps/web/src/pages/MemberProposalDetailPage.tsx',['PROPOSAL_REVISION_UPLOAD','PDF','Word']);
requireText('apps/web/src/pages/WorkspaceOversightPage.tsx',['readinessSnapshot','المتابعة العامة']);
requireText('apps/web/src/pages/WorkspaceReportsPage.tsx',["value=\"TASKS\"",'تصدير PDF / طباعة','بيانات خام CSV']);
requireText('google-apps-script/DriveBridge.gs',['PROPOSAL_TEMPLATE_GOOGLE_DOC_ID','GENERATE_PROPOSAL','ARCHIVE_UPLOAD']);
requireText('docs/KMSA_ACCEPTANCE_TEST_V4_AR.md',['READY / NOT READY','P0','Worker failure']);

const secretPatterns=[/sb_secret_[A-Za-z0-9_-]{12,}/g,/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}/g];
const sourceFiles=[];
function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory()){if(ent.name==='node_modules'||ent.name==='.git')continue;walk(p)}else if(/\.(ts|tsx|js|mjs|sql|gs|json|md|html|css)$/.test(ent.name))sourceFiles.push(p)}}
walk(root);
let secretHit=false;for(const f of sourceFiles){const s=fs.readFileSync(f,'utf8');if(secretPatterns.some(r=>{r.lastIndex=0;return r.test(s)})){secretHit=true;break}}
checks.push({name:'No obvious JWT/Supabase secret embedded in source',ok:!secretHit});

const failed=checks.filter(x=>!x.ok);
for(const c of checks)console.log(`${c.ok?'PASS':'FAIL'}  ${c.name}`);
console.log(`\n${checks.length-failed.length}/${checks.length} static readiness checks passed.`);
if(failed.length)process.exit(1);
