import {useEffect,useState} from 'react';
import {CalendarClock,CheckCircle2,FileClock,PauseCircle,Search,ShieldCheck,Users,XCircle} from 'lucide-react';
import type {ProjectBundle,MemberDirectoryItem} from '../../lib/types';
import {memberDirectorySearch,workflow} from '../../lib/api';
import './projectFlow.css';

type Mode='none'|'closure'|'pause'|'owner'|'supervisor'|'project-date';
type Props={bundle:ProjectBundle;profile:{id:string;role:string}|null|undefined;onChanged:()=>Promise<void>;open:boolean;requestedMode:Mode;onClose:()=>void};
const khDate=(s:string|null|undefined)=>s?new Intl.DateTimeFormat('ar-SD',{dateStyle:'medium',timeZone:'Africa/Khartoum'}).format(new Date(s)):'—';
export default function ProjectManagement({bundle,profile,onChanged,open,requestedMode,onClose}:Props){
 const p=bundle.initiative;
 const isSecretary=!!profile&&profile.role==='SECRETARY'&&profile.id===p.secretary_id;
 const delegated=!!profile&&bundle.supervisor?.supervisor_id===profile.id&&profile.id!==p.owner_id;
 const exceptionalGs=!!profile&&profile.role==='GS'&&p.owner_id===p.secretary_id;
 const canRequest=(isSecretary||delegated||exceptionalGs)&&profile?.id!==p.owner_id;
 const canPause=canRequest||profile?.id===p.owner_id;
 const canEditOwner=isSecretary||delegated;
 const completed=['COMPLETED','CANCELLED'].includes(p.status);
 const postponed=p.lifecycle_state==='POSTPONED';
 const pendingClosure=(bundle.closureRequests||[]).find(q=>q.status==='PENDING');
 const pendingPause=bundle.executionPauses.find(x=>x.status==='PENDING');
 const activePause=bundle.executionPauses.find(x=>x.status==='APPROVED'&&x.pause_until_date>=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Khartoum'}).format(new Date()));
 const [mode,setMode]=useState<Mode>('none');
 useEffect(()=>{if(open)setMode(requestedMode)},[open,requestedMode]);
 const [type,setType]=useState<'SUCCEEDED'|'CANCELLED'|'POSTPONED'>('SUCCEEDED');
 const [reason,setReason]=useState('');const [until,setUntil]=useState('');const [category,setCategory]=useState('EXAMS');
 const [decisionNote,setDecisionNote]=useState('');const [query,setQuery]=useState('');const [matches,setMatches]=useState<MemberDirectoryItem[]>([]);
 const [newProjectDue,setNewProjectDue]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 useEffect(()=>{let active=true;if(mode!=='owner'&&mode!=='supervisor')return;
  if(query.trim().length<2){setMatches([]);return;}
  const t=setTimeout(()=>memberDirectorySearch(query.trim()).then(x=>{if(active)setMatches(x)}).catch(()=>{if(active)setMatches([])}),250);
  return ()=>{active=false;clearTimeout(t)};
 },[query,mode]);
 async function apply(action:string,data:Record<string,unknown>,message:string){
  setError('');setNotice('');setBusy(true);
  try{await workflow(action,data);await onChanged();setMode('none');setReason('');setUntil('');setQuery('');setMatches([]);setNotice(message);onClose()}
  catch(e:any){setError(e?.message||'تعذر تنفيذ الإجراء؛ راجع بياناتك وحاول مرة أخرى.')}
  finally{setBusy(false)}
 }
 const actionButton=(label:string,next:typeof mode,icon:React.ReactNode)=><button className="flow-button flow-button-outline" type="button" onClick={()=>{setMode(next);setError('');setNotice('')}}>{icon}{label}</button>;
 if(!open)return null;
 return <div className="flow-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}><section className="flow-modal flow-management-dialog" id="project-management" role="dialog" aria-modal="true" aria-label="إدارة المشروع"><header className="flow-modal-header"><div><small className="flow-eyebrow">إجراءات المشروع</small><h2>إدارة المشروع</h2></div><button className="flow-icon-button" type="button" aria-label="إغلاق الإدارة" onClick={onClose}><XCircle size={20}/></button></header><div className="flow-modal-content">
  
  {error&&<p className="flow-alert" role="alert">{error}</p>}{notice&&<p className="flow-alert flow-alert-success" role="status">{notice}</p>}
  {pendingClosure&&<div className="flow-management-notice"><strong>طلب قرار معلق: {pendingClosure.type==='SUCCEEDED'?'إغلاق بنجاح':pendingClosure.type==='CANCELLED'?'إلغاء':'تأجيل'}</strong><p>{pendingClosure.reason}</p>{pendingClosure.postpone_until_date&&<small>الموعد المقترح: {pendingClosure.postpone_until_date}</small>}{(isSecretary&&p.owner_id!==profile?.id||exceptionalGs)&&<div className="flow-management-actions"><button disabled={busy} className="flow-button flow-button-brand" onClick={()=>void apply('PROJECT_CLOSE_DECIDE',{requestId:pendingClosure.id,decision:'APPROVE',note:decisionNote},'اعتمد القرار.')}>اعتماد</button><button disabled={busy||!decisionNote.trim()} className="flow-button flow-button-outline" onClick={()=>void apply('PROJECT_CLOSE_DECIDE',{requestId:pendingClosure.id,decision:'REJECT',note:decisionNote},'رُفض الطلب مع حفظ سبب الرفض.')}>رفض</button><textarea rows={2} value={decisionNote} onChange={e=>setDecisionNote(e.target.value)} placeholder="ملاحظة القرار (واجبة عند الرفض)"/></div>}</div>}
  {pendingPause&&<div className="flow-management-notice"><strong>طلب توقف مؤقت معلق</strong><p>{pendingPause.explanation} · حتى {pendingPause.pause_until_date}</p>{isSecretary&&<div className="flow-management-actions"><button disabled={busy} className="flow-button flow-button-brand" onClick={()=>void apply('PROJECT_PAUSE_DECIDE',{pauseId:pendingPause.id,approve:true,note:decisionNote},'اعتمد التوقف المؤقت.')}>اعتماد</button><button disabled={busy} className="flow-button flow-button-outline" onClick={()=>void apply('PROJECT_PAUSE_DECIDE',{pauseId:pendingPause.id,approve:false,note:decisionNote},'رُفض طلب التوقف.')}>رفض</button></div>}</div>}
  <div className="flow-management-actions">
   {canRequest&&!completed&&!postponed&&!pendingClosure&&actionButton('طلب إغلاق أو إلغاء أو تأجيل','closure',<FileClock size={16}/>)}
   {canPause&&!completed&&!postponed&&!activePause&&!pendingPause&&actionButton('طلب توقف مؤقت','pause',<PauseCircle size={16}/>)}
   {activePause&&isSecretary&&<button disabled={busy} className="flow-button flow-button-outline" onClick={()=>void apply('PROJECT_PAUSE_END',{pauseId:activePause.id},'استُؤنف المشروع مبكراً مع إعادة ضبط المواعيد.')}>استئناف من توقف مؤقت</button>}
   {postponed&&isSecretary&&<button disabled={busy} className="flow-button flow-button-brand" onClick={()=>void apply('PROJECT_RESUME',{initiativeId:p.id},'استؤنف المشروع؛ راجع مواعيد المحطات قبل متابعة التنفيذ.')}>استئناف مشروع مؤجل</button>}
   {canEditOwner&&!completed&&!postponed&&actionButton('تغيير مسؤول التنفيذ','owner',<Users size={16}/>)}
   {isSecretary&&!completed&&!postponed&&actionButton('تغيير المتابع','supervisor',<ShieldCheck size={16}/>)}
   {isSecretary&&!completed&&!postponed&&actionButton('تعديل نهاية المشروع','project-date',<CalendarClock size={16}/>)}
  </div>
  {mode==='closure'&&<div className="flow-management-form"><h3>طلب قرار بشأن المشروع</h3><label>نوع القرار</label><select value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="SUCCEEDED">إغلاق بنجاح</option><option value="CANCELLED">إلغاء المشروع</option><option value="POSTPONED">تأجيل المشروع</option></select>{type==='POSTPONED'&&<><label>تاريخ مراجعة الاستئناف</label><input type="date" value={until} onChange={e=>setUntil(e.target.value)}/></>}<label>النتيجة أو سبب القرار</label><textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="اذكر النتيجة التي تحققت أو سبب التغيير (12 حرفًا على الأقل)"/><button className="flow-button flow-button-brand" disabled={busy||reason.trim().length<12||(type==='POSTPONED'&&!until)} onClick={()=>void apply('PROJECT_CLOSE_REQUEST',{initiativeId:p.id,type,reason,postponeUntilDate:type==='POSTPONED'?until:null},'حُفظ طلب القرار في المشروع.')}>إرسال القرار</button></div>}
  {mode==='pause'&&<div className="flow-management-form"><h3>طلب توقف مؤقت</h3><label>السبب</label><select value={category} onChange={e=>setCategory(e.target.value)}><option value="EXAMS">الامتحانات</option><option value="PRIORITY">أولوية طارئة</option><option value="OTHER">ظرف آخر</option></select><label>حتى تاريخ</label><input type="date" value={until} onChange={e=>setUntil(e.target.value)}/><label>التوضيح</label><textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)}/><small>التوقف لمدة يوم إلى 30 يوماً، وتعلق الإفادة والتحقق أثناء المدة المعتمدة.</small><button className="flow-button flow-button-brand" disabled={busy||!until||reason.trim().length<12} onClick={()=>void apply('PROJECT_PAUSE_REQUEST',{initiativeId:p.id,category,explanation:reason,untilDate:until},'حُفظ طلب التوقف المؤقت.')}>إرسال الطلب</button></div>}
  {(mode==='owner'||mode==='supervisor')&&<div className="flow-management-form"><h3>{mode==='owner'?'اختيار مسؤول تنفيذ جديد':'تكليف متابع جديد'}</h3><label>بحث عن عضو</label><div className="flow-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="الاسم أو الرقم الجامعي"/></div>{matches.map(member=><button type="button" key={member.id} disabled={busy||member.id===p.owner_id&&mode==='owner'} className="flow-button flow-button-outline" onClick={()=>void apply(mode==='owner'?'PROJECT_OWNER_REASSIGN':'PROJECT_SUPERVISOR_ASSIGN',{initiativeId:p.id,...(mode==='owner'?{ownerId:member.id}:{supervisorId:member.id})},'حُفظ تكليف العضو الجديد مع إبقاء السجل السابق.')}>{member.full_name}</button>)}{mode==='supervisor'&&bundle.supervisor&&<button className="flow-button flow-button-outline" disabled={busy} onClick={()=>void apply('PROJECT_SUPERVISOR_ASSIGN',{initiativeId:p.id,supervisorId:null},'عادت المتابعة المباشرة للسكرتير.')}>إلغاء التفويض والعودة للسكرتير</button>}</div>}
  {mode==='project-date'&&<div className="flow-management-form"><h3>تعديل نهاية المشروع</h3><p>النهاية المعتمدة حالياً: {khDate(p.target_due_at)}. لا تُسمح نهاية أسبق من أي محطة غير مغلقة.</p><label>الموعد النهائي الجديد</label><input type="datetime-local" value={newProjectDue} onChange={e=>setNewProjectDue(e.target.value)}/><label>سبب التعديل</label><textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)}/><button className="flow-button flow-button-brand" disabled={busy||!newProjectDue||reason.trim().length<6} onClick={()=>void apply('PROJECT_TEMPLATE_UPDATE',{initiativeId:p.id,dueAt:newProjectDue,changeReason:reason},'عدّل موعد نهاية المشروع مع حفظ السبب في السجل.')}>اعتماد التعديل</button></div>}
  {mode!=='none'&&<button className="flow-inline-link" disabled={busy} onClick={()=>{setMode('none');setError('')}}><XCircle size={15}/> إغلاق النموذج</button>}
 </div></section></div>
}
