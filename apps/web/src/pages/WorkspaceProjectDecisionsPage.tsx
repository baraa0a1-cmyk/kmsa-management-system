import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { workspaceProjectSheet } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatDateTime } from '../lib/labels';
import type { ProjectSheetRow } from '../lib/types';

type Closure = {id:string;initiative_id:string;type:'SUCCEEDED'|'CANCELLED'|'POSTPONED';reason:string;requested_at:string;status:string;postpone_until_date:string|null};
export default function WorkspaceProjectDecisionsPage(){
 const {profile}=useAuth();const [items,setItems]=useState<{request:Closure;project:ProjectSheetRow}[]>([]);
 const [busy,setBusy]=useState(true);const [error,setError]=useState('');const [all,setAll]=useState(false);
 const load=useCallback(async()=>{
  if(!profile?.id)return;
  setBusy(true);setError('');try{
   const projects=(await workspaceProjectSheet()).filter(p=>profile.role==='ADMIN'||p.secretary_id===profile.id||(profile.role==='SECRETARY'&&p.secretariat_id===profile.secretariat_id));
   if(!projects.length){setItems([]);return;}
   const projectById=new Map(projects.map(p=>[p.project_id,p]));
   const requests:Closure[]=[];
   // Chunk to avoid PostgREST URL limits. Pending first; historical requests optional.
   for(let i=0;i<projects.length;i+=80){const ids=projects.slice(i,i+80).map(p=>p.project_id);const r=await supabase.from('project_closure_requests').select('id,initiative_id,type,reason,requested_at,status,postpone_until_date').in('initiative_id',ids).order('requested_at',{ascending:false}).limit(500);if(r.error)throw r.error;requests.push(...(r.data||[]) as Closure[])}
   setItems(requests.map(request=>({request,project:projectById.get(request.initiative_id)!})).filter(x=>!!x.project).sort((a,b)=>new Date(b.request.requested_at).getTime()-new Date(a.request.requested_at).getTime()));
  }catch(e:any){setError(e?.message||'تعذر تحميل طلبات قرارات المشاريع.');setItems([])}finally{setBusy(false)}
 },[profile?.id,profile?.secretariat_id,profile?.role]);
 useEffect(()=>{void load()},[load]);
 const pending=useMemo(()=>items.filter(x=>x.request.status==='PENDING'),[items]);
 const shown=all?items:pending;
 const typeText=(t:string)=>t==='SUCCEEDED'?'إغلاق بنجاح':t==='CANCELLED'?'إلغاء المشروع':'تأجيل المشروع';
 return <section className="workspace-card v57-decisions-page" dir="rtl">
  <header className="v57-panel-head"><div><h2>قرارات المشاريع</h2><p>طلبات الإغلاق أو الإلغاء أو التأجيل التي تحتاج قرار السكرتير. اكتمال المحطات لا يغلق المشروع تلقائيًا.</p></div><button className="workspace-secondary" onClick={()=>void load()} disabled={busy}><RefreshCw size={15}/>{busy?'جارٍ التحميل…':'تحديث'}</button></header>
  <div className="v57-decision-toolbar"><div><b>{pending.length}</b> طلب بانتظار القرار</div><div className="v57-filters"><button className={!all?'active':''} onClick={()=>setAll(false)}>الطلبات المعلقة</button><button className={all?'active':''} onClick={()=>setAll(true)}>كل القرارات</button></div></div>
  {error&&<div className="member-form-error" role="alert">{error} <button onClick={()=>void load()}>إعادة المحاولة</button></div>}
  {busy?<p className="workspace-empty">جارٍ تحميل الطلبات…</p>:shown.length===0?<div className="workspace-empty"><CheckCircle2/>لا توجد طلبات {all?'مسجلة':'تنتظر القرار'}.</div>:<div className="v57-decision-list">{shown.map(({request,project})=><article key={request.id} className="v57-decision-row"><div><div className="v57-decision-title"><b>{project.project_title}</b><span className={`v57-lifecycle status-${request.type.toLowerCase()}`}>{typeText(request.type)}</span>{request.status==='PENDING'&&<span className="v57-count-dot">!</span>}</div><p>{request.reason}</p>{request.postpone_until_date&&<small>التأجيل حتى: {request.postpone_until_date}</small>}<small>قُدّم الطلب: {formatDateTime(request.requested_at)} · المسؤول: {project.lead_name||'—'}</small></div><div><span className={request.status==='PENDING'?'v57-awaiting':'v57-confirmed'}>{request.status==='PENDING'?'بانتظار قرارك':request.status==='APPROVED'?'اعتمد القرار':'رُفض الطلب'}</span><Link className="workspace-primary small" to={`/workspace/projects/${project.project_id}?action=closure`}>{request.status==='PENDING'?'مراجعة واتخاذ قرار':'فتح المشروع'}<ArrowLeft size={15}/></Link></div></article>)}</div>}
 </section>;
}
