import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const file=(p)=>readFileSync(join(root,p),'utf8');
const check=(name,ok)=>{console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok)process.exitCode=1;};
const app=file('apps/web/src/App.tsx');
const home=file('apps/web/src/pages/WorkspaceHomePage.tsx');
const workflow=file('supabase/functions/workflow/index.ts');
const worker=file('supabase/functions/document-job/index.ts');
const monitor=file('supabase/functions/scheduled-monitor/index.ts');
const types=file('apps/web/src/lib/types.ts');
check('No organizational structure route',!app.includes('WorkspaceStructurePage')&&!existsSync(join(root,'apps/web/src/pages/WorkspaceStructurePage.tsx')));
check('Distinct project, task, routine and proposal paths',['/workspace/projects','/workspace/tasks','/workspace/routine','/workspace/proposals'].every(x=>app.includes(x)));
check('Director sees actionable priority and backend read failures',home.includes('الأولوية الآن')&&home.includes('Promise.allSettled')&&home.includes('النتائج الظاهرة قد تكون غير مكتملة'));
check('Pending GS assignment approvals are actionable on home',home.includes("p.approval_status==='PENDING_GS'")&&home.includes("p.approval_status==='RETURNED'"));
check('GS oversight and report paths',app.includes('/workspace/oversight')&&app.includes('/workspace/reports'));
check('Project requires periodic progress and next step',workflow.includes("PROJECT_UPDATE_ADD")&&workflow.includes('progressNote')&&workflow.includes('nextStep')&&workflow.includes('next_update_due_at'));
const healthCalculator=workflow.match(/async function computedProjectHealth\(db:any,initiativeId:string\)\s*\{([\s\S]*?)\n\}/)?.[1]||'';
check('Project health is server-derived and blockers take precedence',
  healthCalculator.includes(".eq('status','OPEN')") &&
  healthCalculator.includes("m.status==='BLOCKED'") &&
  healthCalculator.indexOf("return 'BLOCKED'") < healthCalculator.lastIndexOf("return 'ON_TRACK'") &&
  workflow.includes('const health=await computedProjectHealth(db,init.id)') &&
  !workflow.includes('const health=payload.health'));

check('Cancelled milestones cannot count as verified',workflow.includes("active.every((m:any)=>m.status==='VERIFIED')"));
check('Secretary intervention requires an actual action',workflow.includes('حدد إجراء التدخل الذي نفذته'));
check('MILESTONE evidence waits for Drive archive',!workflow.includes("await db.from('milestones').update({status:'READY_FOR_VERIFICATION'}).eq('id',m.id);await audit(db,profile,'EVIDENCE_FILE_QUEUED'"));
check('Document archive sets READY only after success',worker.includes("file_kind:'EVIDENCE'")&&worker.includes("status:'READY_FOR_VERIFICATION'"));
check('Staging upload must belong to uploader',workflow.includes('validateStagingFile(profile,payload,true)')&&workflow.includes('validateStagingFile(profile,payload,false)'));
check('Word/PDF MIME and binary type are validated',worker.includes("String.fromCharCode(...bytes.slice(0,5))!=='%PDF-'")&&worker.includes('bytes[0]===0x50'));
check('Retries preserve uploaded file identity',workflow.includes("if(v.source==='FILE_UPLOAD')")&&workflow.includes('ARCHIVE_STAGING_PROPOSAL'));
check('Unfinished recurring duty does not silently advance',workflow.includes("if(status==='COMPLETED'){const advance="));
check('Stuck jobs recovered and personal reminders exist',monitor.includes('Recovered after worker timeout')&&monitor.includes('PROJECT_UPDATE_OVERDUE'));
check('Roles data typed rather than optional quick task key fields',types.includes('task_id:string; id?:string'));
const projectPage=file('apps/web/src/pages/WorkspaceProjectPage.tsx');
check('Failed periodic update preserves user input',
  /if\s*\(await act\('PROJECT_UPDATE_ADD',[\s\S]*?\)\)\s*\{\s*setReport\(''\)/.test(projectPage) &&
  /catch\s*\(e:any\)\s*\{setError\([^;]+;return false\}/.test(projectPage));

check('File evidence upload reports archival pending',file('apps/web/src/pages/MilestonePage.tsx').includes('لن تصبح المحطة جاهزة للتحقق إلا بعد حفظ الملف'));
check('Evidence retries keyed by upload identity, never free-text note',worker.includes(".eq('source_storage_path',body.storage_path)")&&!worker.includes(".eq('note',body.note||null)"));
check('Drive Bridge deduplicates using source upload UUID',file('google-apps-script/DriveBridge.gs').includes('uploadKey')&&file('google-apps-script/DriveBridge.gs').includes('LockService.getScriptLock'));
check('V5 evidence migration present',existsSync(join(root,'supabase/migrations/0011_monitoring_integrity_v5.sql')));
check('No multiple 0010 migrations',!existsSync(join(root,'supabase/migrations/0010_structure_and_team.sql')));
if(process.exitCode){console.error('\nV5 guardrails failed. Do not deploy.');process.exit(process.exitCode)}
console.log('\nAll monitoring scope invariants verified. This is NOT a live database/RLS/Drive test.');
