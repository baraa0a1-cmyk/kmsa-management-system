import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const get=f=>readFileSync(join(root,f),'utf8');
const workflow=get('supabase/functions/workflow/index.ts');
const monitor=get('supabase/functions/scheduled-monitor/index.ts');
const sql=get('KMSA_V5_6_UPGRADE.sql');
const project=get('apps/web/src/pages/WorkspaceProjectPage.tsx');
const projects=get('apps/web/src/pages/WorkspaceProjectsPage.tsx');
const desk=get('apps/web/src/pages/WorkspaceSupervisionPage.tsx');
const api=get('apps/web/src/lib/api.ts');
const shell=get('apps/web/src/components/AppShell.tsx');
const tests=[
 ['Migration included in root and numbered migrations',()=>existsSync(join(root,'supabase/migrations/0015_project_lifecycle_supervision_v5_6.sql'))],
 ['Terminal project closure is no longer automatic from milestones',()=>!workflow.includes("await db.from('initiatives').update({status:'COMPLETED',health:'ON_TRACK'")],
 ['Owner transfer is atomic in SQL',()=>sql.includes('kmsa_v56_transfer_project_owner')&&sql.includes('UPDATE public.milestones SET owner_id=p_new_owner')],
 ['Special permissions are revoked rather than inherited',()=>sql.includes("permission_type='SPECIAL' AND status IN ('ACTIVE','PENDING')")],
 ['Lifecycle decision is atomic in SQL',()=>sql.includes('kmsa_v56_decide_closure')&&sql.includes('FOR UPDATE')],
 ['Only service role can call lifecycle RPCs',()=>sql.includes('TO service_role')&&sql.includes('FROM PUBLIC,anon,authenticated')],
 ['Closure request is separate from milestone completion',()=>workflow.includes("actionName==='PROJECT_CLOSE_REQUEST'")&&workflow.includes('project_closure_requests')],
 ['Secretary authorizes terminal closure',()=>workflow.includes("actionName==='PROJECT_CLOSE_DECIDE'")&&workflow.includes("profile.role==='SECRETARY'&&init.secretary_id===profile.id")],
 ['Secretary can close own supervised project directly',()=>workflow.includes('profile.id===init.secretary_id&&profile.role===\'SECRETARY\'')],
 ['Pause requires an explicit future follow-up date',()=>workflow.includes("type==='POSTPONED'&&(!postponeDate")],
 ['Resuming postponed projects has an explicit workflow action',()=>workflow.includes("actionName==='PROJECT_RESUME'")],
 ['Execution is stopped while postponed',()=>workflow.includes("init.lifecycle_state==='POSTPONED'" )],
 ['Project includes a leading milestone card and full sheet',()=>project.includes('v56-focus-card')&&project.includes('v54-sheet')],
 ['Project top has assignment and closure actions',()=>project.includes('assignment-manage')&&project.includes('closure-request')],
 ['Owner transfer may be made by assigned direct supervisor',()=>workflow.includes("actionName==='PROJECT_OWNER_REASSIGN'")&&workflow.includes('await canFollowProject')],
 ['Only secretary may delegate/reassign direct supervision',()=>workflow.includes("تغيير المتابع المباشر من اختصاص السكرتير فقط")],
 ['No deputy reviews own work',()=>workflow.includes("selected===init.owner_id&&selected!==init.secretary_id")],
 ['Delegation reassignment preserves previous supervisor in audit',()=>workflow.includes('previous_supervisor_id:oldSupervisor')],
 ['Delegated old updates are not wrongly attributed to new supervisor',()=>monitor.includes('delegation.assigned_at')&&desk.includes('delegated.assigned_at')],
 ['Secretary has explicit follow-through action with due time',()=>workflow.includes("actionName==='PROJECT_SUPERVISION_FOLLOWUP'")&&workflow.includes('followup_due_at:due')],
 ['Follow-ups never erase pending review automatically',()=>desk.includes('يستمر ظهورها حتى وصول تقييم فعلي')],
 ['Monitoring escalates overdue follow-through to secretary',()=>monitor.includes('DELEGATED_REVIEW_REQUEST_SECOND')&&monitor.includes('DELEGATED_REVIEW_ESCALATION')],
 ['Postponed projects do not produce false active-work reminders',()=>monitor.includes("project.lifecycle_state==='POSTPONED'")],
 ['Projects and delegated supervision share one section',()=>projects.includes('WorkspaceSupervisionPage')&&projects.includes('v57-project-tabs')],
 ['Legacy stand-alone supervision route redirects to Projects tab',()=>get('apps/web/src/App.tsx').includes('/workspace/projects?tab=supervision')],
 ['Shell no longer displays separate supervision menu',()=>!shell.includes("to:'/workspace/supervision'")],
 ['Project status enrichment includes postponed flag',()=>api.includes('lifecycle_state')&&projects.includes('مؤجل')],
 ['Project history includes request and approval decisions',()=>project.includes('closure-request-')&&project.includes('closure-decision-')],
 ['Unreviewed milestones do not silently authorize successful closure when revision outstanding',()=>workflow.includes('review?.event_type===\'RESULT_REVISION\'')],
];
let failed=0;
for(const [name,fn] of tests){try{assert.ok(fn());console.log('PASS',name)}catch(e){console.error('FAIL',name);failed++}}
console.log(`KMSA v5.6: ${tests.length-failed}/${tests.length} passed`);if(failed)process.exitCode=1;
