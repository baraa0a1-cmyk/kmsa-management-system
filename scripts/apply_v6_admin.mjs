/* Conservative source upgrade for KMSA v5.9. Abort with no modifications when markers differ. */
import fs from 'node:fs';import path from 'node:path';
const root=process.cwd();const pagePath=path.join(root,'apps/web/src/pages/AdminPage.tsx');
if(!fs.existsSync(pagePath)){console.error('لم أجد apps/web/src/pages/AdminPage.tsx. شغّل الأمر من جذر مشروع v5.9.');process.exit(2)}
let src=fs.readFileSync(pagePath,'utf8');const original=src;
if(src.includes('KmsaCycleSwitchPanel')){console.log('تم تطبيق ترقية الإدارة v6 مسبقًا؛ لم يحدث أي تغيير.');process.exit(0)}
const failures=[];
function replaceOnce(a,b,label){if(!src.includes(a)){failures.push(label);return}src=src.replace(a,b)}
replaceOnce("import { useEffect, useMemo, useState } from 'react';","import { useEffect, useMemo, useState } from 'react';\nimport KmsaCycleSwitchPanel from '../components/KmsaCycleSwitchPanel';\nimport KmsaImportReview from '../components/KmsaImportReview';\nimport KmsaSingleMember from '../components/KmsaSingleMember';",'imports');
replaceOnce("const cycle=cycles.find(c=>c.id===selectedCycleId);", "const [selectedImportRows,setSelectedImportRows]=useState<number[]>([]);\n const [confirmDialog,setConfirmDialog]=useState<{text:string;resolve:(answer:boolean)=>void}|null>(null);\n function confirmAction(text:string){return new Promise<boolean>(resolve=>setConfirmDialog({text,resolve}));}\n const cycle=cycles.find(c=>c.id===selectedCycleId);",'state');
replaceOnce("const good=csv.filter(r=>!r.issue);", "const good=csv.filter(r=>!r.issue&&selectedImportRows.includes(r.row));",'selected import');
replaceOnce("setCsv([]);setCsvName('');setImportSummary('');", "setSelectedImportRows([]);setCsv([]);setCsvName('');setImportSummary('');",'upload reset');
replaceOnce("<div className=\"v59-preview\">{csv.slice(0,8).map(x=><div key={x.row}><span>{x.name}</span><small>{x.issue||'جاهز'}</small></div>)}</div>",
"<KmsaImportReview rows={csv} fileKey={csvName} batch={selectedBatch} selected={selectedImportRows} onSelectionChange={setSelectedImportRows} onValidated={issues=>setCsv(old=>old.map(r=>({...r,issue:issues[r.row]||r.issue})))} />",'CSV preview');
replaceOnce("<h3>أفراد الدفعة</h3>","<h3>أفراد الدفعة</h3><KmsaSingleMember batch={selectedBatch} onDone={()=>void load()}/>",'single member');
replaceOnce("{cycle.status==='DRAFT'&&<div className=\"v59-activate\">", "{<KmsaCycleSwitchPanel cycle={cycle} onChanged={()=>void load()}/>} {false&&cycle.status==='DRAFT'&&<div className=\"v59-activate\">",'safe activation');
replaceOnce("{cycle.status==='DRAFT'&&<button className=\"v59-link\"", "{cycle.status!=='CLOSED'&&<button className=\"v59-link\"",'edit active seat button');
replaceOnce("{cycle.status==='DRAFT'&&leader.seat&&<div className=\"v59-compact-editor\">", "{cycle.status!=='CLOSED'&&leader.seat&&<div className=\"v59-compact-editor\">",'edit active seat panel');
const oldSeat="if(seat)void run(seat.key==='GS_ASSISTANT'?'ADMIN_CYCLE_ASSISTANT_SET':'ADMIN_CYCLE_LEADER_SET',{cycleId:cycle.id,profileId:leader.profileId,role:seat.role,secretariatId:seat.sid},'تم تسجيل شاغل المنصب.');";
const newSeat="if(seat)void saveLeadership(seat.role,seat.sid||null,leader.profileId);";
replaceOnce(oldSeat,newSeat,'replace active leader');
replaceOnce("async function openCsv(file?:File)","async function saveLeadership(role:string,sid:string|null,personId:string){if(!cycle)return;setBusy(true);setError('');setSuccess('');try{const r=role==='GS_ASSISTANT'?await supabase.rpc('kmsa_admin_replace_assistant',{p_cycle:cycle.id,p_profile:personId}):await supabase.rpc('kmsa_admin_replace_leader',{p_cycle:cycle.id,p_role:role,p_secretariat:sid,p_new_profile:personId});if(r.error)throw r.error;setSuccess('تم تحديث قيادة الدورة وتسجيل التغيير.');await load();}catch(e:any){setError(e?.message||'تعذر تعديل المنصب.');}finally{setBusy(false)}}\n async function openCsv(file?:File)",'leader save');
// Replace native browser confirmation in async contexts, retaining the guard logic.
replaceOnce("if(!window.confirm(`سيتم إنشاء حسابات جديدة للدفعة ${selectedBatch}. كلمة المرور الأولية موحدة، وسيُطلب تغييرها عند الدخول الأول. هل تؤكد؟`))return;","if(!(await confirmAction(`سيتم استيراد ${good.length} من الأسماء المحددة للدفعة ${selectedBatch}. كلمة المرور الأولية موحدة وستُغير عند الدخول الأول. هل تؤكد؟`)))return;",'import confirmation');
replaceOnce("if(!resetTarget||!window.confirm('سيتم إبطال كلمة المرور السابقة وإصدار كلمة مؤقتة جديدة. هل تؤكد؟'))return;","if(!resetTarget||!(await confirmAction('سيتم إبطال كلمة المرور السابقة وإصدار كلمة مؤقتة جديدة. هل تؤكد؟')))return;",'reset confirmation');
replaceOnce("if(!window.confirm(`نقل ${p.full_name} إلى الدفعة ${moveTo}؟`))return;", "if(!(await confirmAction(`نقل ${p.full_name} إلى الدفعة ${moveTo}؟ مع بقاء سجله السابق محفوظًا.`)))return;",'move confirmation');
replaceOnce("<footer className=\"v59-footer\">","{confirmDialog&&<div className=\"v6-modal-layer\" role=\"presentation\" onClick={()=>{confirmDialog.resolve(false);setConfirmDialog(null)}}><div className=\"v6-modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"تأكيد الإجراء\" onClick={e=>e.stopPropagation()}><h3>تأكيد الإجراء</h3><p>{confirmDialog.text}</p><div className=\"v6-actions\"><button className=\"v6-secondary\" onClick={()=>{confirmDialog.resolve(false);setConfirmDialog(null)}}>إلغاء</button><button className=\"v6-primary\" onClick={()=>{confirmDialog.resolve(true);setConfirmDialog(null)}}>تأكيد</button></div></div></div>}\n  <footer className=\"v59-footer\">",'site confirmation');
// Add batch and university number to account search/results, where present.
src=src.replaceAll('<small>{p.university_id||p.email}</small>','<small>{p.university_id||\'لا يوجد رقم جامعي\'} · الدفعة {p.batch_number??\'غير محددة\'} · {p.email}</small>');
if(failures.length){console.error('تعذر التطبيق لأن نسخة المشروع لا تطابق v5.9 المتوقعة. لم تتغير الملفات.\nالعناصر غير المطابقة: '+failures.join('، '));process.exit(3)}
// Shut the deprecated activation route at the Edge function as well (service role bypasses SQL GRANT).
const workflowPath=path.join(root,'supabase/functions/workflow/index.ts');
if(!fs.existsSync(workflowPath)){console.error('لم أجد وظيفة workflow. لم تتغير الملفات.');process.exit(4)}
let workflow=fs.readFileSync(workflowPath,'utf8');const originalWorkflow=workflow;
if(!workflow.includes("if(actionName==='ADMIN_CYCLE_ACTIVATE'){" ) || !workflow.includes("if(actionName==='ADMIN_RESET_PASSWORD'){")){
 console.error('ملف الخادم لا يطابق وظائف v5.9. لم تتغير الملفات.');process.exit(4);
}
workflow=workflow.replace("if(actionName==='ADMIN_CYCLE_ACTIVATE'){", "if(actionName==='ADMIN_CYCLE_ACTIVATE'){ throw new Error('اعتماد الدورة متاح فقط من واجهة إدارة v6 الآمنة.');");
workflow=workflow.replace("if(actionName==='ADMIN_RESET_PASSWORD'){", `if(actionName==='ADMIN_RESET_PASSWORD'){
   const candidate=(await db.from('profiles').select('role').eq('id',String(payload.profileId||'')).maybeSingle()).data;
   if(!candidate||candidate.role==='ADMIN')throw new Error('استعادة حساب المدير تتطلب إجراءً إداريًا خاصًا، وليس هذا النموذج.');`);
const backupDir=fs.existsSync(path.join(root,'.git'))?path.join(root,'.git','kmsa-v6-backups'):path.join(root,'_KMSA_V6_BACKUP');
fs.mkdirSync(backupDir,{recursive:true});
fs.writeFileSync(path.join(backupDir,'AdminPage.tsx'),original);
fs.writeFileSync(path.join(backupDir,'workflow-index.ts'),originalWorkflow);
fs.writeFileSync(pagePath,src);
fs.writeFileSync(workflowPath,workflow);console.log('تم تثبيت إضافات إدارة v6 وحفظ نسخة احتياطية من AdminPage. شغّل npm run build ثم اختبرها على قاعدة تجريبية.');
