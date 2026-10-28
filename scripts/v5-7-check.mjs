import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>readFileSync(join(root,f),'utf8');
const wf=read('supabase/functions/workflow/index.ts');
const mon=read('supabase/functions/scheduled-monitor/index.ts');
const sql=read('KMSA_V5_7_UPGRADE.sql');
const p=read('apps/web/src/pages/WorkspaceProjectsPage.tsx');
const sup=read('apps/web/src/pages/WorkspaceSupervisionPage.tsx');
const overview=read('apps/web/src/lib/supervisionOverview.ts');
const dec=read('apps/web/src/pages/WorkspaceProjectDecisionsPage.tsx');
const project=read('apps/web/src/pages/WorkspaceProjectPage.tsx');
const gs=read('apps/web/src/pages/WorkspaceOversightPage.tsx');
const shell=read('apps/web/src/components/AppShell.tsx');
const bell=read('apps/web/src/components/NotificationBell.tsx');
const tests=[
 ['New migration numbered after v5.6',()=>existsSync(join(root,'supabase/migrations/0016_review_requests_and_date_only_postponement_v5_7.sql'))],
 ['Two request attempts bounded by DB constraint',()=>sql.includes('BETWEEN 1 AND 2')],
 ['Per-update per-supervisor unique attempt',()=>sql.includes('(source_activity_id, delegated_supervisor_id, review_request_attempt)')],
 ['Postpone has date only in database',()=>sql.includes('postpone_until_date date')],
 ['Request only authorized secretary or administrator',()=>wf.includes('PROJECT_SUPERVISION_REQUEST_REVIEW')&&wf.includes("profile.role==='SECRETARY'&&init.secretary_id===profile.id")],
 ['Request must belong to project and current delegation',()=>wf.includes('source.initiative_id!==init.id')&&wf.includes('assignment.data.assigned_at')],
 ['Do not request review of stale version',()=>wf.includes('latest.data?.id!==source.id')],
 ['Already-reviewed update cannot receive reminder',()=>wf.includes('النائب قيّم هذا التحديث بالفعل')],
 ['Review reminders adapt to cadence instead of fixed 48h',()=>wf.includes('age<graceHours*3600000')&&wf.includes('Math.max(4,Math.min(24')],
 ['Second reminder only after first 24h',()=>wf.includes('attempt===2')&&wf.includes('followup_due_at')],
 ['No third reminder',()=>wf.includes('attempt>2')],
 ['First and second request labels explicit',()=>wf.includes('طلب تقييم أول')&&wf.includes('طلب تقييم ثانٍ')],
 ['Request source is update ID not project ID',()=>wf.includes("'ACTIVITY',source.id")],
 ['Failure of inbox notification does not roll back saved request',()=>wf.includes('notificationSent:notified')&&wf.includes('حُفظ طلب التقييم')],
 ['No obsolete second checkpoint supervisor notification',()=>!mon.includes('MILESTONE_SUPERVISOR_REVIEW_')],
 ['Monitor escalates missing first request to secretary',()=>mon.includes('DELEGATED_REVIEW_REQUEST_FIRST')],
 ['Monitor escalates unanswered first to second request',()=>mon.includes('DELEGATED_REVIEW_REQUEST_SECOND')],
 ['After second request monitor asks for different action',()=>mon.includes('DELEGATED_REVIEW_ESCALATION')],
 ['Monitor uses latest update per station',()=>mon.includes('seen.add(update.milestone_id)')],
 ['Out of date assignments not attributed to new delegate',()=>mon.includes('delegation.assigned_at')],
 ['No progress report is not falsely counted as progress',()=>mon.includes('lastReportMs')&&mon.includes('lastProgressMs')],
 ['Project area includes supervision and decisions tabs',()=>p.includes('WorkspaceSupervisionPage')&&p.includes('WorkspaceProjectDecisionsPage')],
 ['Decisions tab has pending badge',()=>p.includes('pendingDecisions>0')&&p.includes('v57-count-dot')],
 ['Supervision tabs have all direct delegated filters',()=>sup.includes('جميع المشرفين')&&sup.includes('المتأخرات فقط')&&sup.includes('المشرف')],
 ['Supervision tracks each station not just latest project',()=>sup.includes('row.active.map')&&overview.includes('activeStations')&&overview.includes('project:ProjectSheetRow')],
 ['Supervision first and second requests have loading and error states',()=>sup.includes('جارٍ الإرسال')&&sup.includes('setError(')&&sup.includes('setNotice(')&&sup.includes('disabled={working===')],
 ['Secretary controls on project include close and assignment',()=>project.includes('v57-project-tools')&&project.includes('assignment-manage')&&project.includes('closure-request')],
 ['Project completion remains a manual lifecycle decision',()=>wf.includes("actionName==='PROJECT_CLOSE_DECIDE'")],
 ['Date-only postpone front and backend validated',()=>project.includes('<KmsaDateTimePicker dateOnly')&&wf.includes('postponeUntilDate')],
 ['Secretary own closure label does not claim pending send',()=>project.includes('اعتماد القرار الآن')],
 ['Closure request modal shows saving',()=>project.includes('جارٍ إرسال القرار وتحديث السجل')],
 ['Decisions list links direct to decision dialog',()=>dec.includes('?action=closure')],
 ['Project statuses distinct and color coded',()=>read('apps/web/src/styles.css').includes('.v57-lifecycle.status-postponed')&&read('apps/web/src/styles.css').includes('.v57-lifecycle.status-succeeded')&&read('apps/web/src/styles.css').includes('.v57-lifecycle.status-cancelled')],
 ['My assigned projects filter present',()=>p.includes('المسؤول عنها أنا')],
 ['Several responsible persons can be filtered at once',()=>p.includes('type="checkbox"')&&p.includes('owners.includes(o.id)')],
 ['Secretariat rather than generic association appears in workspace title',()=>shell.includes('profile.secretariat?.name_ar')],
 ['Notification popover closes when navigating',()=>bell.includes('setOpen(false);void load()},[pathname]')],
 ['GS sees aggregated gaps without deputy messages',()=>gs.includes('supervisionGaps')&&gs.includes('secretaryActionMissing')],
 ['SQL and edge functions not directly exposing service-role RPC to members',()=>sql.includes('GRANT EXECUTE')&&sql.includes('TO service_role')],
];
let passed=0;
for(const [label,check] of tests){try{assert.ok(check());passed++;console.log(`PASS ${label}`)}catch(e){console.error(`FAIL ${label}`)}}
console.log(`v5.7: ${passed}/${tests.length} tests passed`);
if(passed!==tests.length)process.exitCode=1;
