import fs from 'node:fs';
import path from 'node:path';
import ts from '../apps/web/node_modules/typescript/lib/typescript.js';
const root=path.resolve(import.meta.dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const wf=read('supabase/functions/workflow/index.ts');
const ui=read('apps/web/src/pages/WorkspaceProjectPage.tsx');
const sql=read('KMSA_V5_3_UPGRADE.sql');
const types=read('apps/web/src/lib/types.ts');
const rules=[
 ['Only assigned supervisor or secretary may review',wf.includes('!await canFollowProject(db,profile,init)||!reviewIdentityAllowed(profile,init,m)')],
 ['Secretary may review own project',wf.includes("profile.id===init.secretary_id && profile.role==='SECRETARY'")],
 ['Deputy cannot review own output',wf.includes('profile.id!==m.owner_id')&&wf.includes('reviewIdentityAllowed')],
 ['Delegation forbids deputy self-assignment',wf.includes('selected===init.owner_id && !(selected===init.secretary_id')],
 ['Review tied to last execution update',wf.includes("eq('kind','MILESTONE_UPDATE')")&&wf.includes('source_activity_id:sourceId')],
 ['Review cannot be repeated for same update and reviewer',wf.includes("eq('source_activity_id',sourceId)")&&wf.includes('سبق تقييم هذا التحديث')],
 ['Unsatisfactory result requires correction note',wf.includes("'RESULT_REVISION'")&&wf.includes('حدد ما الذي يحتاج متابعة أو تعديلًا')],
 ['Reviewer feedback reaches result owner',wf.includes('MILESTONE_REVIEW_${reviewKind}')&&wf.includes('m.owner_id')],
 ['Correction reopens previously closed project',wf.includes("if(reviewKind==='RESULT_REVISION')")&&wf.includes("status:'ACTIVE',completed_at:null")],
 ['No quality review gate in project completion',!wf.match(/syncProjectCompletion[\s\S]{0,750}RESULT_OK/)],
 ['Eight-column sheet with separate reviews',ui.includes('<th>تقييم التحديث</th>')&&ui.includes('<th>تقييم النتيجة</th>')&&ui.includes('<th>ملاحظات المشرف</th>')&&ui.includes('<th>آخر ما حدث</th>')],
 ['Inline status dropdown opens modal',ui.includes('onChange={e=>openUpdate(m,e.target.value as MilestoneStatus)}')],
 ['Completed status needs concrete result',ui.includes('وصف النتيجة المتحققة ضروري')&&wf.includes('اكتب المخرج الفعلي')],
 ['Progress and result review choices match requirements',ui.includes('التقدم غير كافٍ')&&ui.includes('النتيجة مناسبة')&&ui.includes('تحتاج تعديلًا')&&ui.includes("'PROGRESS_UNCLEAR'")],
 ['Project history is available on the top card',ui.includes('سجل المشروع الكامل')&&ui.includes("modal==='project-log'")],
 ['History includes supervision and deadline events',ui.includes('bundle?.supervisionEvents')&&ui.includes('bundle?.deadlineRequests')],
 ['History includes archived evidence',ui.includes('bundle?.evidence')&&ui.includes('projectTimeline.map')],
 ['Info displays last update time and history link',ui.includes('formatDateTime(lastShownTime)')&&ui.includes('عرض سجل المحطة')],
 ['Deadline icon opens the existing approval flow',ui.includes('CalendarClock')&&ui.includes("openAction('deadline',m)")&&wf.includes('MILESTONE_DEADLINE_DECIDE')],
 ['Schema extends event types without client writes',sql.includes('source_activity_id')&&sql.includes('RESULT_REVISION')&&!/grant (insert|update|delete)/i.test(sql)],
 ['Project delegate and design changes logged',wf.includes("kind:'SUPERVISOR_ASSIGNMENT'")&&wf.includes("'DESIGN_CHANGE'")&&types.includes('SUPERVISOR_ASSIGNMENT')],
 ['Migration has next unique sequential number',fs.existsSync(path.join(root,'supabase/migrations/0014_project_quality_reviews_v5_3.sql'))]
];
let failed=0;
for(const [label,ok] of rules){console.log((ok?'PASS':'FAIL')+' '+label);if(!ok)failed++;}
for(const f of ['apps/web/src/pages/WorkspaceProjectPage.tsx','supabase/functions/workflow/index.ts']){
 const src=ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const ok=src.parseDiagnostics.length===0;console.log((ok?'PASS':'FAIL')+' Parse '+f);if(!ok)failed++;
}
console.log(`v5.3 ${rules.length+2} checks, ${failed} failed`);if(failed)process.exitCode=1;
