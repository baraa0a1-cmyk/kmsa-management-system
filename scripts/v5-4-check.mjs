import fs from 'node:fs';
import path from 'node:path';
import ts from '../apps/web/node_modules/typescript/lib/typescript.js';
const root=path.resolve(import.meta.dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const ui=read('apps/web/src/pages/WorkspaceProjectPage.tsx');
const wf=read('supabase/functions/workflow/index.ts');
const common=read('supabase/functions/_shared/common.ts');
const api=read('apps/web/src/lib/api.ts');
const shell=read('apps/web/src/components/AppShell.tsx');
const home=read('apps/web/src/pages/WorkspaceHomePage.tsx');
const css=read('apps/web/src/styles.css');
const checks=[
 ['Only three editable project-milestone statuses',/editableStatuses: MilestoneStatus\[\]=\['IN_PROGRESS','READY_FOR_VERIFICATION','BLOCKED'\]/.test(ui)],
 ['Backend accepts only three implementation statuses',/const allowed=\['IN_PROGRESS','BLOCKED','READY_FOR_VERIFICATION'\]/.test(wf)],
 ['Four clear update categories in the UI', ['PROGRESS','NO_PROGRESS','BLOCKER','DEADLINE_CHANGE'].every(x=>ui.includes(`${x}:`)||ui.includes(`'${x}'`))],
 ['Backend rejects obsolete update categories',/\['PROGRESS','NO_PROGRESS','BLOCKER'\]/.test(wf)&&/تغيير الموعد له طلب مستقل/.test(wf)],
 ['Inline dropdown has explicit arrow and selected value',ui.includes('v54-state-select')&&ui.includes('<ChevronDown size={15}/>')&&ui.includes('value={viewStatus(m.status)}')],
 ['Result-description must be supplied at completion',ui.includes('وصف النتيجة المتحققة ضروري')&&ui.includes('صف النتيجة النهائية بصورة محددة')&&wf.includes('اكتب المخرج الفعلي')],
 ['Progress evaluation and result evaluation shown in separate columns',ui.includes('<th>تقييم التحديث</th>')&&ui.includes('<th>تقييم النتيجة</th>')],
 ['Result evaluation only displayed for completed milestone',ui.includes("{completed?<><span className={`v54-eval")],
 ['Reviews attached to the exact update version',ui.includes('source_activity_id===lastProgress?.id')&&ui.includes('source_activity_id===resultUpdate?.id')],
 ['Server review identity protection retained',wf.includes('reviewIdentityAllowed(profile,init,m)')],
 ['Owner can read reviewer feedback within table',ui.includes('latestFeedback?.note||m.secretary_note')&&ui.includes('ملاحظات المشرف')],
 ['Rework message reaches owner',wf.includes('MILESTONE_REVIEW_${reviewKind}')&&wf.includes('m.owner_id')],
 ['Deadline changes use separate approved workflow',ui.includes("openAction('deadline',m)")&&wf.includes("MILESTONE_DEADLINE_DECIDE")],
 ['Info icon shows exact time and opens milestone log',ui.includes('formatDateTime(lastShownTime)')&&ui.includes('عرض سجل المحطة')],
 ['Project history button remains visible',ui.includes('سجل المشروع الكامل')&&ui.includes("modal==='project-log'")],
 ['Real saving feedback and real workflow action',ui.includes('جارٍ تنفيذ طلبك')&&ui.includes('await workflow(action,payload)')&&!ui.includes('fakeSave')],
 ['Database mutation success separate from refresh failure',ui.includes('تم حفظ الإجراء، لكن تعذر تحديث العرض')],
 ['Update request is routed to actual backend action',ui.includes("act('MILESTONE_UPDATE_REQUEST'")&&wf.includes("kind==='UPDATE_REQUEST'")],
 ['Notification RPC uses installed actual function',api.includes("supabase.rpc('user_notification_feed'")],
 ['Notification failures are not silently converted into an empty inbox',api.includes('if(!missing)throw error')&&shell.includes("setError(e?.message||'تعذر جلب الإشعارات')")],
 ['Notifications refresh after returning to app',shell.includes("window.addEventListener('focus',onFocus)")&&shell.includes('60000')],
 ['Mark-read checks DB update failure',wf.includes('if(q.error)throw q.error;return json({ok:true});')],
 ['Home does not flag obsolete periodic report',!home.includes('تحديثك الدوري متأخر')&&!home.includes('تحديث المسؤول الدوري متأخر')],
 ['Compact, sticky, scrollable sheet plus modal styling',css.includes('.v54-scroll')&&css.includes('position:sticky')&&css.includes('.workspace-shell .modal')],
 ['No new organizational structure UI',!ui.includes('Organogram')&&!ui.includes('OrganizationBuilder')],
];
let fail=0;
for(const [label,passed] of checks){console.log(`${passed?'PASS':'FAIL'} ${label}`);if(!passed)fail++}
for(const file of ['apps/web/src/pages/WorkspaceProjectPage.tsx','apps/web/src/components/AppShell.tsx','apps/web/src/lib/api.ts','supabase/functions/workflow/index.ts','supabase/functions/_shared/common.ts']){
 const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 if(source.parseDiagnostics.length){fail++;console.log(`FAIL syntax ${file}:`,source.parseDiagnostics.map(x=>x.messageText))}
 else console.log(`PASS syntax ${file}`);
}
console.log(`v5.4: ${checks.length+5} checks; ${fail} failed`);if(fail)process.exitCode=1;
