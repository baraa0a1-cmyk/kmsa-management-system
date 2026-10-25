import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, ClipboardCheck, RefreshCw, UserCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { workspaceProjectSheet } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { ProjectSheetRow } from '../lib/types';
import { formatDateTime } from '../lib/labels';

type Assignment = {initiative_id:string; supervisor_id:string; supervisor?:{full_name:string}|null};
type Activity = {id:string;initiative_id:string;milestone_id:string|null;created_at:string;note:string|null;kind:string};
type Review = {id:string;initiative_id:string;source_activity_id:string|null;actor_id:string;event_type:string;created_at:string};
type SupervisionRow = {p:ProjectSheetRow; supervisor:string;delegated:boolean; latest?:Activity; review?:Review; awaiting:boolean};
const relevantReviews=['PROGRESS_OK','PROGRESS_FOLLOW_UP','RESULT_OK','RESULT_REVISION'];

/** Read-only supervision desk. No approvals, meetings or periodic forms are added. */
export default function WorkspaceSupervisionPage(){
 const {profile}=useAuth();
 const [rows,setRows]=useState<SupervisionRow[]>([]);const [busy,setBusy]=useState(true);const [error,setError]=useState('');const [filter,setFilter]=useState<'all'|'delegated'|'waiting'>('all');
 const load=useCallback(async()=>{
  if(!profile?.secretariat_id){setBusy(false);return;}
  setBusy(true);setError('');
  try{
   const projects=(await workspaceProjectSheet()).filter(p=>p.secretariat_id===profile.secretariat_id&&p.approval_status==='APPROVED'&&!['CANCELLED'].includes(p.project_status));
   if(!projects.length){setRows([]);return;}
   // Restrict queries to the secretary's own project IDs and surface errors instead of displaying fictitious all-clear signals.
   const ids=projects.slice(0,100).map(p=>p.project_id);
   const [assignments,activities,reviews]=await Promise.all([
    supabase.from('project_supervision_assignments').select('initiative_id,supervisor_id,supervisor:profiles!project_supervision_assignments_supervisor_id_fkey(full_name)').in('initiative_id',ids),
    supabase.from('project_activity_entries').select('id,initiative_id,milestone_id,created_at,note,kind').in('initiative_id',ids).eq('kind','MILESTONE_UPDATE').order('created_at',{ascending:false}).limit(1000),
    supabase.from('milestone_supervision_events').select('id,initiative_id,source_activity_id,actor_id,event_type,created_at').in('initiative_id',ids).in('event_type',relevantReviews).order('created_at',{ascending:false}).limit(1000)
   ]);
   for(const r of [assignments,activities,reviews])if(r.error)throw r.error;
   const a=(assignments.data||[]) as unknown as Assignment[];
   const ev=(activities.data||[]) as Activity[];
   const rv=(reviews.data||[]) as Review[];
   setRows(projects.slice(0,100).map(p=>{
    const assigned=a.find(x=>x.initiative_id===p.project_id);
    const latest=ev.find(x=>x.initiative_id===p.project_id);
    const supervisorId=assigned?.supervisor_id||profile.id;
    const review=latest?rv.find(x=>x.source_activity_id===latest.id&&x.actor_id===supervisorId):undefined;
    return {p,supervisor:assigned?.supervisor?.full_name||'السكرتير (مباشرة)',delegated:!!assigned,latest,review,awaiting:!!latest&&!review};
   }));
   if(projects.length>100)setError('عُرضت أحدث 100 مشروع فقط. يلزم توسيع استرجاع البيانات لعرض جميع المشاريع.');
   else if(ev.length===1000||rv.length===1000)setError('بلغ سجل الأحداث حد الاسترجاع؛ قد لا تظهر جميع المراجعات القديمة.');
  }catch(e:any){setError(e?.message||'تعذر تحميل متابعة السكرتارية.');setRows([])}finally{setBusy(false)}
 },[profile?.id,profile?.secretariat_id]);
 useEffect(()=>{void load()},[load]);
 const delegated=useMemo(()=>rows.filter(x=>x.delegated),[rows]);
 const awaiting=useMemo(()=>rows.filter(x=>x.awaiting),[rows]);
 const visible=rows.filter(r=>filter==='all'||filter==='delegated'&&r.delegated||filter==='waiting'&&r.awaiting);
 if(!profile?.secretariat_id)return <div className="workspace-card"><h2>إشراف السكرتارية</h2><p>هذه الصفحة مخصصة للسكرتير المعين على سكرتارية محددة.</p></div>;
 return <div className="workspace-stack v55-supervision" dir="rtl">
  <header className="v55-section-title"><div><span className="v55-eyebrow">إشراف السكرتارية</span><h1>المشاريع والمتابعون</h1><p>راقب تقدم العمل ومراجعات النائب، دون أن تدير تفاصيل التنفيذ أو توقف المسؤولين.</p></div><button className="workspace-secondary" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/> {busy?'جارٍ التحديث…':'تحديث البيانات'}</button></header>
  {error&&<div className="member-form-error" role="alert">{error} <button onClick={()=>void load()}>إعادة المحاولة</button></div>}
  <div className="v55-supervision-stats"><div><Users/><strong>{rows.length}</strong><span>مشروعًا تحت إشراف السكرتارية</span></div><div><UserCheck/><strong>{delegated.length}</strong><span>مشروعًا بمتابعة مفوضة</span></div><div><ClipboardCheck/><strong>{awaiting.length}</strong><span>تحديثًا أخيرًا دون تقييم موثق</span></div></div>
  <section className="workspace-card v55-supervision-desk"><div className="v55-table-heading"><div><h2>متابعة المشاريع المفوضة والمباشرة</h2><p>«لم يُقيّم» يعني عدم وجود تقييم موثق لآخر تحديث، لا يثبت غياب المتابعة خارج النظام.</p></div><div className="v55-filters"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>الكل</button><button className={filter==='delegated'?'active':''} onClick={()=>setFilter('delegated')}>المفوضة</button><button className={filter==='waiting'?'active':''} onClick={()=>setFilter('waiting')}>بانتظار تقييم</button></div></div>
   {busy?<div className="workspace-empty">جارٍ تحميل سجل المتابعة…</div>:!visible.length?<div className="workspace-empty"><CheckCircle2/>لا توجد مشاريع في هذا التصنيف.</div>:<div className="v55-supervision-table-wrap"><table className="v55-supervision-table"><thead><tr><th>المشروع</th><th>المسؤول</th><th>المتابع</th><th>آخر تقدم مسجل</th><th>المراجعة الإشرافية</th><th></th></tr></thead><tbody>{visible.map(x=><tr key={x.p.project_id}><td><strong>{x.p.project_title}</strong><small>{x.p.secretariat_name}{x.p.current_milestone_overdue?' · محطة متأخرة':''}</small></td><td>{x.p.lead_name}</td><td>{x.supervisor}{x.delegated&&<small>متابعة مفوضة</small>}</td><td>{x.latest?<><span>{x.latest.note||'تحديث دون وصف'}</span><small>{formatDateTime(x.latest.created_at)}</small></>:<span className="v55-muted">لم يُسجّل تقدم بعد</span>}</td><td>{x.review?<span className="v55-review-success"><CheckCircle2 size={14}/>راجع المتابع هذا التحديث</span>:x.latest?<span className="v55-review-await"><AlertCircle size={14}/>آخر تحديث لم يُقيّم</span>:<span className="v55-muted">لا تحديث للمراجعة</span>}</td><td><Link className="v55-row-link" to={`/workspace/projects/${x.p.project_id}`}>فتح المشروع <ArrowLeft size={15}/></Link></td></tr>)}</tbody></table></div>}
  </section>
 </div>;
}
