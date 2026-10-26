import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, RefreshCw, Send, UserCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { workspaceProjectSheet, workflow } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { ProjectSheetRow } from '../lib/types';
import { formatDateTime } from '../lib/labels';
import { Modal } from '../components/Modal';

type Assignment = {initiative_id:string;supervisor_id:string;assigned_at:string|null;supervisor:{full_name:string}|null};
type Activity = {id:string;initiative_id:string;milestone_id:string;created_at:string;note:string|null;kind:string};
type Review = {source_activity_id:string|null;actor_id:string};
type Request = {id:string;source_activity_id:string;delegated_supervisor_id:string;review_request_attempt:number|null;followup_due_at:string;created_at:string};
type SupervisionRow = {project:ProjectSheetRow;supervisorId:string;supervisorName:string;delegated:boolean;latest?:Activity;reviewed:boolean;requests:Request[]};
const HOUR=3600000;

export default function WorkspaceSupervisionPage(){
 const {profile}=useAuth();
 const [rows,setRows]=useState<SupervisionRow[]>([]);const [reviewQueue,setReviewQueue]=useState<SupervisionRow[]>([]);
 const [filter,setFilter]=useState<'all'|'direct'|'delegated'>('all');
 const [busy,setBusy]=useState(true);const [pending,setPending]=useState<string|null>(null);
 const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [confirmation,setConfirmation]=useState<SupervisionRow|null>(null);
 const load=useCallback(async()=>{
  if(!profile?.secretariat_id){setBusy(false);return;}
  setBusy(true);setError('');
  try{
   const projects=(await workspaceProjectSheet()).filter(p=>p.secretariat_id===profile.secretariat_id&&p.approval_status==='APPROVED'&&!['CANCELLED','COMPLETED'].includes(p.project_status)&&p.lifecycle_state!=='POSTPONED');
   if(!projects.length){setRows([]);setReviewQueue([]);return;}
   const ids=projects.map(p=>p.project_id);
   // Query by project, never by the entire association. Explicitly show truncation/errors.
   if(ids.length>200){setError('هناك أكثر من 200 مشروع؛ المعروض هنا أول 200 مشروع فقط.');}
   const scoped=ids.slice(0,200);
   const [assignments,activities,reviews,requests]=await Promise.all([
    supabase.from('project_supervision_assignments').select('initiative_id,supervisor_id,assigned_at,supervisor:profiles!project_supervision_assignments_supervisor_id_fkey(full_name)').in('initiative_id',scoped),
    supabase.from('project_activity_entries').select('id,initiative_id,milestone_id,created_at,note,kind').in('initiative_id',scoped).eq('kind','MILESTONE_UPDATE').order('created_at',{ascending:false}).limit(2000),
    supabase.from('milestone_supervision_events').select('source_activity_id,actor_id').in('initiative_id',scoped).in('event_type',['PROGRESS_OK','PROGRESS_FOLLOW_UP','RESULT_OK','RESULT_REVISION']).order('created_at',{ascending:false}).limit(2000),
    supabase.from('project_supervision_followups').select('id,source_activity_id,delegated_supervisor_id,review_request_attempt,followup_due_at,created_at').in('initiative_id',scoped).not('review_request_attempt','is',null).order('created_at',{ascending:false}).limit(2000)
   ]);
   for(const x of [assignments,activities,reviews,requests])if(x.error)throw x.error;
   const assignmentsData=(assignments.data||[]) as unknown as Assignment[];
   const ev=(activities.data||[]) as Activity[];const rv=(reviews.data||[]) as Review[];const rq=(requests.data||[]) as Request[];
   if(ev.length===2000||rv.length===2000||rq.length===2000)setError('وصل السجل إلى حد الاسترجاع. قد تحتاج المتابعة إلى ترقيم صفحات.');
   // Every station may have its own active update; do not lose gaps because another
   // milestone in the same project was edited more recently.
   const projectMap=new Map(projects.map(p=>[p.project_id,p]));const seenStations=new Set<string>();
   const actionableUpdates:SupervisionRow[]=[];
   for(const activity of ev){
    const stationKey=activity.initiative_id+':'+activity.milestone_id;
    if(seenStations.has(stationKey))continue;seenStations.add(stationKey);
    const project=projectMap.get(activity.initiative_id);const assignment=assignmentsData.find(x=>x.initiative_id===activity.initiative_id);
    if(!project||!assignment||assignment.supervisor_id===profile.id)continue;
    if(assignment.assigned_at&&new Date(activity.created_at)<new Date(assignment.assigned_at))continue;
    if(rv.some(x=>x.source_activity_id===activity.id&&x.actor_id===assignment.supervisor_id))continue;
    const requests=rq.filter(x=>x.source_activity_id===activity.id&&x.delegated_supervisor_id===assignment.supervisor_id).sort((a,b)=>(a.review_request_attempt||0)-(b.review_request_attempt||0));
    actionableUpdates.push({project,supervisorId:assignment.supervisor_id,supervisorName:assignment.supervisor?.full_name||'المتابع',delegated:true,latest:activity,reviewed:false,requests});
   }
   setReviewQueue(actionableUpdates);
   setRows(projects.slice(0,200).map(project=>{
    const delegated=assignmentsData.find(x=>x.initiative_id===project.project_id);
    const supervisorId=delegated?.supervisor_id||profile.id;
    const latest=ev.find(x=>x.initiative_id===project.project_id&&(!delegated?.assigned_at||new Date(x.created_at)>=new Date(delegated.assigned_at)));
    const reviewed=!!(latest&&rv.some(x=>x.source_activity_id===latest.id&&x.actor_id===supervisorId));
    return {project,supervisorId,supervisorName:delegated?.supervisor?.full_name||'السكرتير (مباشرة)',delegated:!!delegated&&supervisorId!==profile.id,latest,reviewed,requests:latest?rq.filter(x=>x.source_activity_id===latest.id&&x.delegated_supervisor_id===supervisorId).sort((a,b)=>(a.review_request_attempt||0)-(b.review_request_attempt||0)):[]};
   }));
  }catch(e:any){setError(e?.message||'تعذر جلب متابعة الإشراف.');setRows([]);setReviewQueue([])}finally{setBusy(false)}
 },[profile?.id,profile?.secretariat_id]);
 useEffect(()=>{void load()},[load]);
 const age=(date:string)=>Date.now()-new Date(date).getTime();
 const due=(r:SupervisionRow)=>!!r.latest&&!r.reviewed&&age(r.latest.created_at)>=48*HOUR;
 const actionFor=(r:SupervisionRow)=>{
  if(!r.delegated||!due(r))return null;
  if(r.requests.length===0)return {label:'إرسال طلب التقييم الأول',attempt:1};
  if(r.requests.length===1&&Date.now()>=new Date(r.requests[0].followup_due_at).getTime())return {label:'إرسال طلب التقييم الثاني',attempt:2};
  return null;
 };
 const pendingRows=reviewQueue.filter(x=>due(x));
 const awaitingSecretary=pendingRows.filter(x=>!!actionFor(x));
 const visible=rows.filter(x=>filter==='all'||(filter==='delegated'?x.delegated:!x.delegated));
 const currentRequest=confirmation?actionFor(confirmation):null;
 async function submitRequest(){
  if(!confirmation?.latest||!currentRequest||pending)return;
  const key=confirmation.latest.id;setPending(key);setError('');setNotice('');
  try{
   const data=await workflow('PROJECT_SUPERVISION_REQUEST_REVIEW',{initiativeId:confirmation.project.project_id,sourceActivityId:key});
   setNotice(data?.warning||`تم تسجيل طلب التقييم ${data.attempt===2?'الثاني':'الأول'} وإرساله للمتابع.`);
   setConfirmation(null);await load();
  }catch(e:any){setError(e?.message||'تعذر إرسال طلب التقييم.')}finally{setPending(null)}
 }
 if(!profile?.secretariat_id)return <section className="workspace-card"><h2>متابعة الإشراف</h2><p>تظهر هذه الصفحة للسكرتير المكلف بالسكرتارية.</p></section>;
 return <div className="workspace-stack v57-supervision" dir="rtl">
  <header className="v55-section-title"><div><span className="v55-eyebrow">إدارة الإشراف</span><h1>متابعة الإشراف</h1><p>مشاريع تشرف عليها بنفسك، ومشاريع فُوّضت لغيرك. كل طلب تقييم مرتبط بتحديث محدد.</p></div><button className="workspace-secondary" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/>{busy?'جارٍ التحديث…':'تحديث'}</button></header>
  {error&&<div className="member-form-error" role="alert">{error} <button onClick={()=>void load()}>إعادة المحاولة</button></div>}
  {notice&&<div className="v57-success" role="status"><CheckCircle2 size={18}/>{notice}</div>}
  <div className="v57-supervision-metrics"><div><Users size={17}/><b>{rows.length}</b><span>مشاريع تحت الإشراف</span></div><div><UserCheck size={17}/><b>{rows.filter(x=>x.delegated).length}</b><span>بإشراف مفوّض</span></div><div><AlertCircle size={17}/><b>{awaitingSecretary.length}</b><span>تحتاج إجراءً منك</span></div></div>
  <section className="workspace-card v57-supervision-panel">
   <div className="v57-panel-head"><div><h2>المشاريع والمتابعون</h2><p>مراجعة النائب لا توقف تنفيذ المسؤول. التحديثات العادية لا تُعد إخفاقًا بمجرد أنها لم تُراجع فورًا.</p></div><div className="v57-filters"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>الكل</button><button className={filter==='direct'?'active':''} onClick={()=>setFilter('direct')}>إشرافي المباشر</button><button className={filter==='delegated'?'active':''} onClick={()=>setFilter('delegated')}>الإشراف المفوّض</button></div></div>
   {awaitingSecretary.length>0&&<section className="v57-action-queue" aria-label="طلبات تقييم تنتظر إجراء السكرتير"><h3>طلبات تقييم تستحق إجراءك <b className="v57-count-dot">{awaitingSecretary.length}</b></h3><p>كل طلب مرتبط بتحديث محطة بعينه، حتى لو كان للمشروع أكثر من محطة نشطة.</p>{awaitingSecretary.map(r=>{const req=actionFor(r);return <div key={r.latest!.id} className="v57-action-entry"><div><strong>{r.project.project_title}</strong><small>المتابع: {r.supervisorName} · {r.latest?.note||'تحديث المحطة'} · {formatDateTime(r.latest!.created_at)}</small></div>{req&&<button className="workspace-primary small" onClick={()=>setConfirmation(r)} disabled={!!pending}><Send size={14}/>{req.label}</button>}</div>})}</section>}
   {busy?<p className="workspace-empty">جارٍ تحميل المشاريع…</p>:visible.length===0?<p className="workspace-empty">لا توجد مشاريع مطابقة.</p>:<div className="v57-supervision-list">
    {visible.map(r=>{const action=actionFor(r);const expiredSecond=r.requests.length>=2&&Date.now()>=new Date(r.requests[r.requests.length-1].followup_due_at).getTime()&&!r.reviewed;return <article key={r.project.project_id} className="v57-supervision-row">
     <div className="v57-row-main"><Link to={`/workspace/projects/${r.project.project_id}`}><strong>{r.project.project_title}</strong></Link><small>المسؤول: {r.project.lead_name||'—'} · المتابع: {r.supervisorName}</small><p>{r.latest?.note||'لا يوجد تقدم مسجل حتى الآن.'}</p>{r.latest&&<small>تحديث المسؤول: {formatDateTime(r.latest.created_at)}</small>}</div>
     <div className="v57-row-actions">
      {!r.latest?<span className="v57-muted">بانتظار أول تحديث</span>:r.reviewed?<span className="v57-confirmed"><CheckCircle2 size={15}/>تم تقييم التحديث</span>:!due(r)?<span className="v57-muted"><Clock3 size={15}/>لم تنتهِ مهلة التقييم</span>:<span className="v57-pending"><AlertCircle size={15}/>تقييم متأخر · 48 ساعة</span>}
      {r.delegated&&r.requests.length>0&&<small>{r.requests.length===1?'طلب التقييم الأول أُرسل':'أُرسل طلبان للتقييم'} · آخر مهلة: {formatDateTime(r.requests[r.requests.length-1].followup_due_at)}</small>}
      {action&&<button className="workspace-primary small" disabled={!!pending} onClick={()=>setConfirmation(r)}><Send size={14}/>{action.label}</button>}
      {expiredSecond&&<Link className="workspace-secondary small" to={`/workspace/projects/${r.project.project_id}`}>لم يستجب بعد طلبين — راجع التكليف</Link>}
      {!r.delegated&&!r.reviewed&&r.latest&&<Link className="workspace-secondary small" to={`/workspace/projects/${r.project.project_id}?milestone=${r.latest.milestone_id}&action=review`}>تقييم التحديث</Link>}
     </div>
    </article>})}
   </div>}
  </section>
  <Modal open={!!confirmation} title={currentRequest?.attempt===2?'إرسال طلب تقييم للمرة الثانية':'طلب تقييم التحديث'} onClose={()=>{if(!pending)setConfirmation(null)}} footer={<div className="workspace-inline-actions"><button className="workspace-secondary" disabled={!!pending} onClick={()=>setConfirmation(null)}>إلغاء</button><button className="workspace-primary" disabled={!!pending||!currentRequest} onClick={()=>void submitRequest()}>{pending?'جارٍ إرسال الطلب…':currentRequest?.label||'تعذر الإرسال'}</button></div>}>
   <p><strong>{confirmation?.project.project_title}</strong> — {confirmation?.supervisorName}</p><p>سيُطلب من المتابع تقييم التحديث الذي لم يراجعه، خلال 24 ساعة. {currentRequest?.attempt===2?'هذا هو الطلب الثاني لنفس التحديث.':''}</p><p className="muted">إرسال الطلب يثبت إجراء السكرتير، لكنه لا يمحو فجوة تقييم النائب. يستمر ظهورها حتى وصول تقييم فعلي.</p>
  </Modal>
 </div>;
}
