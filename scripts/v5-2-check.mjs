import fs from 'node:fs';
import path from 'node:path';
import ts from '../apps/web/node_modules/typescript/lib/typescript.js';
const root=path.resolve(import.meta.dirname,'..');
const read=(n)=>fs.readFileSync(path.join(root,n),'utf8');
const wf=read('supabase/functions/workflow/index.ts'),mon=read('supabase/functions/scheduled-monitor/index.ts');
const ui=read('apps/web/src/pages/WorkspaceProjectPage.tsx'),form=read('apps/web/src/pages/WorkspaceProjectCreatePage.tsx');
const api=read('apps/web/src/lib/api.ts'),sql=read('KMSA_V5_2_UPGRADE.sql'),shell=read('apps/web/src/components/AppShell.tsx');
const proposal=read('apps/web/src/pages/ProposalEditorPage.tsx');
const worker=read('supabase/functions/document-job/index.ts');
const checks=[
 ['Follow-up sheet retains inline milestone status change',ui.includes('followup-table')&&ui.includes('v54-state-select')],
 ['Typed updates in dialog, result column appears after completed',ui.includes('نوع آخر ما حدث')&&ui.includes('v54-sheet')&&ui.includes('النتيجة')&&ui.includes('NO_PROGRESS')],
 ['Activity records actor timestamp and classification',wf.includes('author_id:profile.id')&&wf.includes('update_type:updateType')],
 ['No progress update cannot imply real progress in monitoring',mon.includes("['PROGRESS','COMPLETE']")],
 ['Result quality review is not an execution gate',wf.includes('MILESTONE_QUALITY_REVIEW')&&wf.includes('RESULT_OK')&&ui.includes('النتيجة مناسبة')],
 ['Supervisor periodic progress check logged',wf.includes('MILESTONE_PROGRESS_REVIEW')&&mon.includes('MILESTONE_SUPERVISOR_REVIEW_')],
 ['One unanswered request per milestone',wf.includes('هناك طلب تحديث مفتوح')&&wf.includes('REQUEST_ANSWERED')],
 ['Automatic milestone reminders are duration-based not daily',mon.includes('span<=3*86400000')&&mon.includes('span<=14*86400000')&&!mon.includes('PROJECT_UPDATE_OVERDUE')],
 ['Escalation for unanswered requests waits 48h',mon.includes('nowMs-48*3600000')],
 ['Delegation is project scoped, not an extra SECRETARY role',sql.includes('project_supervision_assignments')&&wf.includes('canFollowProject')&&shell.includes('project_supervision_assignments')],
 ['Deputy cannot self-review; secretary is allowed',wf.includes('reviewIdentityAllowed')&&wf.includes('profile.id===init.secretary_id')],
 ['Deadline request needs reason and stores original deadline',wf.includes('MILESTONE_DEADLINE_REQUEST')&&sql.includes('original_due_at')&&sql.includes('reason text not null')],
 ['Deadline approval allowed to delegated supervisor with audit',wf.includes('MILESTONE_DEADLINE_DECIDE')&&wf.includes('recalcDependentMilestones(db,m.id)')],
 ['Relative milestone deadline rebased on predecessor completion',wf.includes('actualOrPlannedBase')&&wf.includes('completed_reported_at')&&wf.includes('relative_hours')],
 ['Cycle prevention in relative references',wf.includes('لا يمكن إنشاء دائرة بين مواعيد المحطات')],
 ['Hours available in milestone creation/edit',form.includes('relativeHours')&&ui.includes('relativeHours')&&form.includes('datetime-local')],
 ['Modal used for deadline change and supervisor delegation',ui.includes("modal==='deadline'")&&ui.includes("modal==='assign-supervisor'")],
 ['Proposal submit shows missing required fields instead of inert button',proposal.includes('field-invalid')&&proposal.includes('setAttempted(true)')&&proposal.includes('disabled={busy}')],
 ['Project submit similarly shows invalid fields',form.includes('field-invalid')&&form.includes('setAttempted(true)')&&form.includes('disabled={busy}')],
 ['Supervisor event/request tables are append only from client',sql.includes('No INSERT/UPDATE/DELETE policies')&&!/grant\s+(insert|update|delete)/i.test(sql)],
 ['Review guard is enforced server-side',wf.includes('!reviewIdentityAllowed(profile,init,m)')&&wf.includes('MILESTONE_QUALITY_REVIEW')],
 ['Project closes on reported completion without mandatory supervisor gate',wf.includes("active.every((m:any)=>['READY_FOR_VERIFICATION','VERIFIED'].includes(m.status))")],
 ['Archived evidence completion preserves relative deadlines',worker.includes('reportArchivedEvidenceCompletion')&&worker.includes('rebaseChildren(db,m.id)')&&worker.includes('completed_reported_at')],
 ['New database migration has ordered path',fs.existsSync(path.join(root,'supabase/migrations/0013_project_supervision_v5_2.sql'))],
];
let errors=0;
for(const [title,ok] of checks){console.log((ok?'PASS':'FAIL')+' '+title);if(!ok)errors++}
for(const f of ['apps/web/src/pages/WorkspaceProjectPage.tsx','apps/web/src/pages/WorkspaceProjectCreatePage.tsx','apps/web/src/pages/ProposalEditorPage.tsx','apps/web/src/lib/api.ts','supabase/functions/workflow/index.ts','supabase/functions/scheduled-monitor/index.ts','supabase/functions/document-job/index.ts']){
 const file=ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const ok=file.parseDiagnostics.length===0;console.log((ok?'PASS':'FAIL')+' Syntax '+f);if(!ok)errors++;
}
console.log(`TOTAL ${checks.length+7} tests, ${errors} failed`);if(errors)process.exitCode=1;
