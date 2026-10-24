import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Clock3, ExternalLink, FileText, Link2, MessageSquareText, Plus, ShieldAlert } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { uploadToStaging, workflow, workspaceProject } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import type { Milestone, MilestoneStatus, ProjectActivityEntry, ProjectBundle } from '../lib/types';
import { formatDate, formatDateTime, milestoneStatusLabel } from '../lib/labels';
import { Modal } from '../components/Modal';

const editableStatuses: MilestoneStatus[]=['NOT_STARTED','IN_PROGRESS','AT_RISK','BLOCKED','READY_FOR_VERIFICATION'];
const activityNames:Record<string,string>={MILESTONE_UPDATE:'تحديث محطة',PERIODIC_CHECKIN:'إفادة دورية',SECRETARY_NOTE:'ملاحظة السكرتير',INTERVENTION:'تدخل السكرتير',REFERENCE:'مرجع للعمل',LEAD_NOTE:'ملاحظة المسؤول'};
const isClosed=(s:string)=>['VERIFIED','CANCELLED'].includes(s);
const isLate=(date?:string|null)=>!!date&&new Date(date).getTime()<Date.now();
const displayRisk=(m:Milestone)=>m.status==='BLOCKED'?'متعثر':m.status==='AT_RISK'?'مهدد':isLate(m.due_at)&&!isClosed(m.status)?'متأخر':null;
const safeHttps=(url:string)=>{try{return new URL(url).protocol==='https:'}catch{return false}};
const initialMilestone={title:'',verificationCriteria:'',dueAt:'',deadlineMode:'ABSOLUTE',relativeDays:7,relativeToMilestoneId:''};

export default function WorkspaceProjectPage(){
 const {id}=useParams();const {profile}=useAuth();
 const [bundle,setBundle]=useState<ProjectBundle|null>(null);const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [expanded,setExpanded]=useState<string|null>(null);
 const [draftStatus,setDraftStatus]=useState<Record<string,MilestoneStatus>>({});
 const [draftNote,setDraftNote]=useState<Record<string,string>>({});
 const [draftOutcome,setDraftOutcome]=useState<Record<string,string>>({});
 const [report,setReport]=useState('');const [nextStep,setNextStep]=useState('');const [help,setHelp]=useState('');
 const [reference,setReference]=useState({note:'',referenceUrl:''});
 const [fileDraft,setFileDraft]=useState<Record<string,File|null>>({});const [uploadNotice,setUploadNotice]=useState('');
 const [note,setNote]=useState('');const [intervention,setIntervention]=useState({reason:'',actionText:'',dueAt:''});
 const [modal,setModal]=useState<string|null>(null);const [selected,setSelected]=useState<Milestone|null>(null);
 const [milestoneForm,setMilestoneForm]=useState({...initialMilestone});
 const [gsReason,setGsReason]=useState('');
 async function load(){if(!id)return;const b=await workspaceProject(id);setBundle(b);setDraftStatus(Object.fromEntries(b.milestones.map(m=>[m.id,m.status])));setDraftNote({});setDraftOutcome({});}
 useEffect(()=>{let active=true;setLoading(true);setError('');if(id)workspaceProject(id).then(b=>{if(!active)return;setBundle(b);setDraftStatus(Object.fromEntries(b.milestones.map(m=>[m.id,m.status])));setLoading(false)}).catch(e=>{if(active){setError(e?.message||'تعذر تحميل بيانات المشروع');setLoading(false)}});return()=>{active=false}},[id]);
 async function act(action:string,payload:Record<string,unknown>){setBusy(true);setError('');try{await workflow(action,payload);await load();setModal(null);return true}catch(e:any){setError(e?.message||'تعذر حفظ التغيير');return false}finally{setBusy(false)}}
 const init=bundle?.initiative;const result=bundle?.results[0];
 const lead=!!(profile&&init&&(init.owner_id===profile.id||result?.owner_id===profile.id));
 const secretary=!!(profile&&init&&(profile.role==='ADMIN'||init.secretary_id===profile.id||(profile.role==='SECRETARY'&&profile.secretariat_id===init.secretariat_id)));
 const gs=!!profile&&['GS','ADMIN'].includes(profile.role);
 const executing=init?.approval_status==='APPROVED'&&init.setup_status==='ACTIVE'&&!['COMPLETED','CANCELLED'].includes(init.status);
 const milestones=useMemo(()=>[...(bundle?.milestones||[])].filter(m=>m.design_status!=='REJECTED').sort((a,b)=>(a.sequence_no||999)-(b.sequence_no||999)||new Date(a.due_at).getTime()-new Date(b.due_at).getTime()),[bundle]);
 const activities=bundle?.activity||[];const overdue=executing&&isLate(init?.next_update_due_at);
 const total=milestones.length;const verified=milestones.filter(m=>m.status==='VERIFIED').length;
 const stalled=milestones.filter(m=>displayRisk(m));
 const effectiveRisk=stalled.some(m=>m.status==='BLOCKED')||!!bundle?.blockers.length?'يوجد تعثر':stalled.length?'محطات تحتاج انتباهًا':overdue?'تحديث دوري متأخر':'لا توجد إشارات تأخير';
 const latestProjectUpdate=bundle?.updates[0];
 async function saveMilestone(m:Milestone){
  const status=draftStatus[m.id]||m.status;const leadNote=draftNote[m.id]?.trim()||'';const outcome=draftOutcome[m.id]?.trim()||'';
  if(status===m.status&&!leadNote&&!outcome){setError('غيّر الحالة أو أضف ملاحظة جديدة قبل الحفظ.');return;}
  const ok=await act('MILESTONE_PROGRESS_UPDATE',{milestoneId:m.id,status,leadNote:leadNote||m.lead_note||null,outcomeText:outcome||m.outcome_text||null});
  if(ok)setExpanded(m.id);
 }
 async function sendFile(m:Milestone){
  const file=fileDraft[m.id];if(!file)return;
  setBusy(true);setError('');setUploadNotice('');
  try{
   const stagingPath=await uploadToStaging(file);
   await workflow('EVIDENCE_FILE_ADD',{milestoneId:m.id,stagingPath,fileName:file.name,mimeType:file.type||'application/octet-stream',note:draftNote[m.id]||'',submitForVerification:false});
   setFileDraft(v=>({...v,[m.id]:null}));setUploadNotice(`أُرسل الملف «${file.name}» للأرشفة. يصبح متاحًا بعد نجاح الحفظ في Google Drive.`);
   await load();setExpanded(m.id);
  }catch(e:any){setError(e?.message||'تعذر حفظ الملف')}finally{setBusy(false)}
 }
 function openAction(kind:string,m?:Milestone){setSelected(m||null);setModal(kind);setNote('');setReference({note:'',referenceUrl:''});setIntervention({reason:'',actionText:'',dueAt:''});}
 function openMilestoneEditor(m?:Milestone){setSelected(m||null);setMilestoneForm(m?{title:m.title,verificationCriteria:m.verification_criteria||'',dueAt:m.due_at?.slice(0,10)||'',deadlineMode:m.deadline_mode||'ABSOLUTE',relativeDays:m.relative_days||7,relativeToMilestoneId:m.relative_to_milestone_id||''}:{...initialMilestone,deadlineMode:'ABSOLUTE'});setModal(m?'milestone-edit':'milestone-add')}
 function line(entry:ProjectActivityEntry){return <article className="followup-event" key={entry.id}>
   <div className="followup-event-meta"><strong>{entry.author?.full_name||'عضو الفريق'}</strong><span>{activityNames[entry.kind]||entry.kind} · {formatDateTime(entry.created_at)}</span></div>
   {entry.status_after&&<span className="followup-event-status">الحالة: {milestoneStatusLabel[entry.status_after as MilestoneStatus]||entry.status_after}</span>}
   {entry.note&&<p>{entry.note}</p>}
   {entry.reference_url&&<a href={entry.reference_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13}/> فتح المرجع المرتبط</a>}
   {typeof entry.details?.outcome==='string'&&<small>المخرج: {entry.details.outcome}</small>}
  </article>}
 if(loading)return <div className="workspace-empty"><Clock3/>جارٍ تحميل لوحة المشروع…</div>;
 if(!init||!bundle)return <div className="workspace-stack"><div className="member-form-error">{error||'لم نعثر على المشروع.'}</div><button className="workspace-secondary" onClick={()=>window.location.reload()}>إعادة المحاولة</button></div>;
 return <div className="workspace-stack workspace-project-v2 followup-page">
   <div className="workspace-back"><Link to="/workspace/projects"><ArrowRight size={16}/>المشاريع</Link>{secretary&&<Link to={`/workspace/projects/${init.id}/edit`} className="table-text-btn">تعديل قرار التكليف</Link>}</div>
   <header className="followup-hero">
    <div><div className="workspace-kicker">{init.secretariat?.name_ar} · متابعة مشروع</div><h1>{init.title}</h1><p>{result?.statement||init.objective}</p>
     <div className="followup-meta"><span>المسؤول: <b>{init.owner?.full_name||'—'}</b></span><span>الموعد النهائي: <b>{formatDate(init.target_due_at)}</b></span><span>آخر إفادة: <b>{latestProjectUpdate?formatDateTime(latestProjectUpdate.created_at):'لم تصل إفادة بعد'}</b></span></div>
    </div><div className="followup-progress"><strong>{verified} / {total}</strong><span>محطات متحققة</span><div className="followup-progress-track"><i style={{width:`${total?Math.round(verified/total*100):0}%`}}/></div></div>
   </header>
   {error&&<div className="member-form-error" role="alert">{error}</div>}{uploadNotice&&<div className="workspace-review-banner" role="status">{uploadNotice}</div>}
   {init.approval_status!=='APPROVED'&&<section className="workspace-review-banner"><Clock3/><div><strong>{init.approval_status==='PENDING_GS'?'بانتظار اعتماد GS':'المشروع لم يدخل مرحلة التنفيذ'}</strong><span>لا يوجد تحديث أو تدخل تنفيذي قبل اعتماد التكليف. يمكن مراجعة الخطة فقط.</span></div>{init.approval_status==='PENDING_GS'&&gs&&<div className="workspace-inline-actions"><button className="workspace-secondary" onClick={()=>setModal('gs-return')}>إعادة للمراجعة</button><button className="workspace-primary" disabled={busy} onClick={()=>act('PROJECT_GS_DECIDE',{initiativeId:init.id,decision:'APPROVE'})}>اعتماد التكليف</button></div>}{init.approval_status==='RETURNED'&&secretary&&<button className="workspace-primary" disabled={busy} onClick={()=>act('PROJECT_RESUBMIT_GS',{initiativeId:init.id})}>إعادة للإجازة</button>}</section>}
   <section className="followup-signals" aria-label="مؤشرات المتابعة المستقلة">
    <div><span>المؤشر الآلي</span><strong className={stalled.length||overdue?'followup-risk':''}>{effectiveRisk}</strong><small>لا يعتمد على الحالة التي يختارها المسؤول</small></div>
    <div><span>الإفادة الدورية القادمة</span><strong>{formatDate(init.next_update_due_at)}</strong><small>{overdue?'تأخر التحديث — يظهر للسكرتير العام':`كل ${init.update_interval_days||3} أيام`}</small></div>
    <div><span>النتيجة النهائية</span><strong>{init.status==='COMPLETED'?'متحققة':init.approval_status!=='APPROVED'?'قيد الاعتماد':'قيد التنفيذ'}</strong><small>تتحقق المحطات بصورة مستقلة</small></div>
   </section>
   <section className="workspace-card followup-table-card">
    <div className="workspace-card-head"><div><h2>محطات الإنجاز</h2><p>عدّل الحالة من الصف مباشرة، وافتح التفاصيل عند الحاجة لإضافة ملاحظة أو رابط أو مراجعة السجل.</p></div>{secretary&&<button className="workspace-secondary small" onClick={()=>openMilestoneEditor()}><Plus size={15}/>محطة جديدة</button>}</div>
    <div className="followup-scroll"><table className="followup-table"><thead><tr><th>المحطة والنتيجة الجزئية</th><th>موعدها</th><th>الحالة</th><th>آخر حركة</th><th>المتابعة</th></tr></thead><tbody>{milestones.map((m,index)=>{
     const status=draftStatus[m.id]||m.status;const late=isLate(m.due_at)&&!isClosed(m.status);const events=activities.filter(e=>e.milestone_id===m.id);const evidence=bundle.evidence.filter(e=>e.milestone_id===m.id);const editable=executing&&lead&&!isClosed(m.status);const isExpanded=expanded===m.id;const risk=displayRisk(m);
     return <FragmentRow key={m.id} expanded={isExpanded} colSpan={5} main={<tr className={`${risk?'followup-attention':''} ${isExpanded?'followup-open':''}`}>
       <td><div className="followup-mtitle"><span className="followup-order">{index+1}</span><div><strong>{m.title}</strong><small>{m.verification_criteria}</small></div></div></td>
       <td><span>{formatDate(m.due_at)}</span>{late&&<small className="followup-late">متأخر</small>}</td>
       <td>{editable?<select className="select followup-status-select" aria-label={`حالة ${m.title}`} value={status} onChange={e=>{setDraftStatus(v=>({...v,[m.id]:e.target.value as MilestoneStatus}));setExpanded(m.id)}}>{editableStatuses.map(s=><option key={s} value={s}>{milestoneStatusLabel[s]}</option>)}</select>:<span className={`workspace-pill ${m.status==='VERIFIED'?'good':risk?'danger':'neutral'}`}>{milestoneStatusLabel[m.status]}</span>}</td>
       <td><small>{events.length?formatDateTime(events[0].created_at):m.status_updated_at?formatDateTime(m.status_updated_at):'لا توجد حركة مسجلة'}</small></td>
       <td><div className="followup-row-actions">{editable&&<button className="followup-save" disabled={busy||status===m.status} onClick={()=>saveMilestone(m)}>حفظ الحالة</button>}<button type="button" className="followup-details-btn" onClick={()=>setExpanded(v=>v===m.id?null:m.id)} aria-expanded={isExpanded}>{isExpanded?<ChevronUp size={15}/>:<ChevronDown size={15}/>}<span>التفاصيل</span></button></div></td>
      </tr>} detail={<div className="followup-expanded">
       <div className="followup-detail-header"><b>{m.title}</b>{secretary&&<button className="table-text-btn" onClick={()=>openMilestoneEditor(m)}>تعديل بيانات المحطة</button>}</div>
       {editable&&<div className="followup-quick-edit"><label>ماذا تغير في هذه المحطة؟ <small>(اختياري للحالة العادية؛ مطلوب عند التعثر أو التأخير)</small><textarea className="textarea" rows={2} placeholder="مثال: استلمنا 12 مقالًا، والباقي قيد المراجعة" value={draftNote[m.id]||''} onChange={e=>setDraftNote(v=>({...v,[m.id]:e.target.value}))}/></label><label>المخرج المتحقق (عند طلب التحقق)<input className="input" value={draftOutcome[m.id]||''} onChange={e=>setDraftOutcome(v=>({...v,[m.id]:e.target.value}))} placeholder={m.outcome_text||'ما الذي سُلّم بالفعل؟'}/></label><button className="workspace-primary small" disabled={busy} onClick={()=>saveMilestone(m)}>حفظ تحديث المحطة</button></div>}
       {m.outcome_text&&<p className="followup-outcome"><CheckCircle2 size={15}/> المخرج المسجل: {m.outcome_text}</p>}
       <div className="followup-detail-actions">{executing&&lead&&<button className="workspace-secondary small" onClick={()=>openAction('reference',m)}><Link2 size={15}/>إضافة رابط / مرجع</button>}{executing&&lead&&<div className="followup-upload-inline"><label className="followup-upload-select"><FileText size={15}/> <span>{fileDraft[m.id]?.name||'اختيار PDF أو صورة'}</span><input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" aria-label={`رفع ملف للمحطة ${m.title}`} onChange={e=>setFileDraft(v=>({...v,[m.id]:e.target.files?.[0]||null}))}/></label>{fileDraft[m.id]&&<button className="workspace-primary small" disabled={busy} onClick={()=>sendFile(m)}>رفع للأرشيف</button>}</div>}{executing&&secretary&&<button className="workspace-secondary small" onClick={()=>openAction('note',m)}><MessageSquareText size={15}/>ملاحظة السكرتير</button>}{executing&&secretary&&<button className="workspace-secondary small" onClick={()=>openAction('intervention',m)}><ShieldAlert size={15}/>تدخل عند الحاجة</button>}{executing&&secretary&&m.status==='READY_FOR_VERIFICATION'&&m.owner_id!==profile?.id&&<><button disabled={busy} className="workspace-primary small" onClick={()=>act('MILESTONE_VERIFY',{milestoneId:m.id,decision:'VERIFIED',note:'تم التحقق من المخرج'})}>اعتماد المخرج</button><button disabled={busy} className="workspace-secondary small" onClick={()=>act('MILESTONE_VERIFY',{milestoneId:m.id,decision:'RETURNED',note:'يحتاج استكمالًا'})}>طلب استكمال</button></>}{executing&&secretary&&m.status==='READY_FOR_VERIFICATION'&&m.owner_id===profile?.id&&<span className="muted">التحقق من إنجاز السكرتير المسؤول يتم بواسطة GS.</span>}</div>
       <div className="followup-detail-grid"><div><h3>سجل هذه المحطة</h3>{events.length?events.map(line):<p className="muted">لا توجد تحديثات مسجلة بعد.</p>}</div><div><h3>الأدلة المؤرشفة</h3>{evidence.length?evidence.map(e=><p key={e.id} className="followup-file-entry"><FileText size={14}/> {e.note||e.evidence_type}{e.url&&safeHttps(e.url)&&<a href={e.url} target="_blank" rel="noopener noreferrer">فتح الرابط</a>}{e.drive_file_id&&<Link to={`/workspace/milestones/${m.id}`}>عرض في صفحة المحطة</Link>}</p>):<p className="muted">لا يوجد ملف مؤرشف لهذه المحطة.</p>}</div></div>
      </div>}/>;
    })}</tbody></table></div>
   </section>
   {executing&&<section className={`workspace-card followup-pulse ${overdue?'followup-pulse-overdue':''}`}>
    <div className="workspace-card-head"><div><h2>إفادة المسؤول الدورية</h2><p>تسجل ما جرى في تيليجرام أو خارجه، ولو لم تتغير حالة أي محطة. لا يلزم تغيير الحالة كل مرة.</p></div><strong>{overdue?'الإفادة متأخرة':`الموعد: ${formatDate(init.next_update_due_at)}`}</strong></div>
    {lead?<div className="followup-pulse-form"><textarea rows={2} className="textarea" value={report} onChange={e=>setReport(e.target.value)} placeholder="ماذا حدث منذ آخر إفادة؟ يمكن كتابة: لم يحدث تقدم، والسبب..."/><details><summary>الخطوة التالية أو الدعم المطلوب (اختياري)</summary><div className="followup-pulse-more"><input className="input" value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="الخطوة التالية"/><input className="input" value={help} onChange={e=>setHelp(e.target.value)} placeholder="الدعم المطلوب من السكرتير إن وجد"/></div></details><button disabled={busy||!report.trim()} className="workspace-primary" onClick={async()=>{if(await act('PROJECT_UPDATE_ADD',{initiativeId:init.id,progressNote:report,nextStep,assistanceNeeded:help})){setReport('');setNextStep('');setHelp('')}}}><MessageSquareText size={15}/>حفظ الإفادة</button></div>:<div className="followup-latest-pulse">{latestProjectUpdate?<><strong>{latestProjectUpdate.progress_note}</strong><small>{latestProjectUpdate.author?.full_name||'المسؤول'} · {formatDateTime(latestProjectUpdate.created_at)}</small></>:<span>لا توجد إفادة دورية حتى الآن.</span>}</div>}
   </section>}
   <section className="workspace-card followup-history"><div className="workspace-card-head"><div><h2>سجل المشروع</h2><p>التحديثات الأصلية من المسؤول، والملاحظات والتدخلات ظاهرة أيضًا للسكرتير العام ولا يستبدل أحدها الآخر.</p></div>{executing&&secretary&&<button className="workspace-secondary small" onClick={()=>openAction('note')}><MessageSquareText size={15}/>ملاحظة عامة</button>}</div>
    <div className="followup-history-list">{activities.length?activities.slice(0,30).map(line):<p className="muted">لم يبدأ التسجيل التنفيذي بعد.</p>}</div>
   </section>
   <Modal open={modal==='reference'} title={`إضافة مرجع ${selected?'— '+selected.title:''}`} onClose={()=>setModal(null)} footer={<button className="workspace-primary" disabled={busy||(!reference.note.trim()&&!reference.referenceUrl.trim())||!!reference.referenceUrl&&!safeHttps(reference.referenceUrl)} onClick={()=>act('PROJECT_REFERENCE_ADD',{initiativeId:init.id,milestoneId:selected?.id||null,...reference})}>حفظ المرجع</button>}><div className="field"><label>ماذا يثبت أو يوضح هذا المرجع؟</label><textarea className="textarea" rows={2} value={reference.note} onChange={e=>setReference(v=>({...v,note:e.target.value}))}/></div><div className="field section-gap"><label>رابط رسالة تيليجرام أو مستند (https)</label><input className="input" value={reference.referenceUrl} onChange={e=>setReference(v=>({...v,referenceUrl:e.target.value}))} placeholder="https://t.me/..."/>{reference.referenceUrl&&!safeHttps(reference.referenceUrl)&&<small className="danger-text">أدخل رابط https صحيحًا</small>}</div><p className="muted">الرابط يوثق السياق ولا يُعتبر تحققًا نهائيًا تلقائيًا. روابط المجموعات الخاصة قد لا تكون متاحة للسكرتير العام.</p></Modal>
   <Modal open={modal==='note'} title="ملاحظة السكرتير — دون اعتبارها تعثرًا" onClose={()=>setModal(null)} footer={<button className="workspace-primary" disabled={busy||!note.trim()} onClick={()=>act('PROJECT_SECRETARY_NOTE_ADD',{initiativeId:init.id,milestoneId:selected?.id||null,note})}>حفظ الملاحظة</button>}><textarea className="textarea" rows={4} value={note} onChange={e=>setNote(e.target.value)} placeholder="توجيه، سؤال، توصية أو متابعة عادية..."/></Modal>
   <Modal open={modal==='intervention'} title="تدخل السكرتير" onClose={()=>setModal(null)} footer={<button className="workspace-primary" disabled={busy||!intervention.actionText.trim()} onClick={()=>act('PROJECT_INTERVENTION_ADD',{initiativeId:init.id,resultId:result?.id||null,milestoneId:selected?.id||null,...intervention})}>تسجيل التدخل</button>}><div className="field"><label>ما الذي استدعى التدخل؟</label><textarea className="textarea" value={intervention.reason} onChange={e=>setIntervention(v=>({...v,reason:e.target.value}))}/></div><div className="field section-gap"><label>الإجراء الفعلي</label><textarea className="textarea" value={intervention.actionText} onChange={e=>setIntervention(v=>({...v,actionText:e.target.value}))}/></div><div className="field section-gap"><label>متابعة لاحقة (اختياري)</label><input className="input" type="date" value={intervention.dueAt} onChange={e=>setIntervention(v=>({...v,dueAt:e.target.value}))}/></div></Modal>
   <Modal open={modal==='gs-return'} title="إعادة المشروع للسكرتير" onClose={()=>setModal(null)} footer={<button className="workspace-primary" disabled={busy||!gsReason.trim()} onClick={()=>act('PROJECT_GS_DECIDE',{initiativeId:init.id,decision:'RETURN',note:gsReason})}>إعادة للمراجعة</button>}><textarea className="textarea" rows={4} value={gsReason} onChange={e=>setGsReason(e.target.value)} placeholder="ما الذي يحتاج تعديلًا؟"/></Modal>
   <Modal open={modal==='milestone-add'||modal==='milestone-edit'} title={selected?'تعديل محطة الإنجاز':'إضافة محطة إنجاز'} onClose={()=>setModal(null)} footer={<button className="workspace-primary" disabled={busy||!milestoneForm.title.trim()||!milestoneForm.dueAt} onClick={()=>act(selected?'MILESTONE_DESIGN_UPDATE':'MILESTONE_DESIGN_ADD',{...(selected?{milestoneId:selected.id}:{resultId:result?.id}),...milestoneForm})}>حفظ المحطة</button>}><div className="form-grid"><div className="field full"><label>عنوان المحطة</label><input className="input" value={milestoneForm.title} onChange={e=>setMilestoneForm(v=>({...v,title:e.target.value}))}/></div><div className="field full"><label>كيف نعرف أنها تحققت؟</label><textarea className="textarea" value={milestoneForm.verificationCriteria} onChange={e=>setMilestoneForm(v=>({...v,verificationCriteria:e.target.value}))}/></div><div className="field"><label>تاريخ المحطة</label><input className="input" type="date" value={milestoneForm.dueAt} onChange={e=>setMilestoneForm(v=>({...v,dueAt:e.target.value,deadlineMode:'ABSOLUTE'}))}/></div></div></Modal>
 </div>;
}

// Keeps expanded content attached to its corresponding table row without an extra page.
function FragmentRow({main,detail,expanded,colSpan}:{main:React.ReactElement;detail:React.ReactElement;expanded:boolean;colSpan:number}){
 return <>{main}{expanded&&<tr className="followup-detail-row"><td colSpan={colSpan}>{detail}</td></tr>}</>;
}
