import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, RefreshCw, Send, ShieldCheck, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { workspaceProjectSheet, workflow } from '../lib/api';
import { loadProjectFollowup, followupIssueLabel, type FollowupItem, type FollowupSnapshot } from '../lib/projectFollowup';
import { formatDateTime } from '../lib/labels';
import { Modal } from '../components/Modal';
const empty:FollowupSnapshot={items:[],secretaryActions:[],reviewPending:[],reportLate:[]};
const tomorrow=()=>{const date=new Date(Date.now()+24*3600000);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)};
export default function WorkspaceSupervisionPage(){
 const {profile}=useAuth();const [snapshot,setSnapshot]=useState<FollowupSnapshot>(empty);
 const [view,setView]=useState<'action'|'watch'|'all'>('action');const [assignment,setAssignment]=useState<'all'|'direct'|'delegated'>('all');
 const [busy,setBusy]=useState(true);const [sending,setSending]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [selected,setSelected]=useState<FollowupItem|null>(null);const [escalationText,setEscalationText]=useState('');const [escalationDue,setEscalationDue]=useState(tomorrow());
 const load=useCallback(async()=>{
  if(!profile?.id||(!profile.secretariat_id&&profile.role!=='ADMIN')){setBusy(false);return;}
  setBusy(true);setError('');try{
   const projects=(await workspaceProjectSheet()).filter(p=>profile.role==='ADMIN'||p.secretary_id===profile.id||(profile.role==='SECRETARY'&&p.secretariat_id===profile.secretariat_id));
   setSnapshot(await loadProjectFollowup(projects,profile.id));
  }catch(e:any){setError(e?.message||'تعذر تحميل متابعة الإشراف.');setSnapshot(empty)}finally{setBusy(false)}
 },[profile?.id,profile?.secretariat_id,profile?.role]);
 useEffect(()=>{void load()},[load]);
 const attention=useMemo(()=>snapshot.items.filter(x=>!!x.secretaryAction||(!x.delegated&&!!x.update&&!x.review)),[snapshot]);
 const watching=useMemo(()=>snapshot.items.filter(x=>!attention.includes(x)&&(x.issue==='CORRECTING'||x.issue==='UNREVIEWED'||x.issue==='RESULT_REVIEW'||x.issue==='NO_REPORT')),[snapshot,attention]);
 const all=useMemo(()=>snapshot.items.filter(x=>assignment==='all'||(assignment==='delegated'?x.delegated:!x.delegated)),[snapshot,assignment]);
 const shown=view==='action'?attention:view==='watch'?watching:all;
 async function takeAction(){if(!selected||sending)return;setSending(true);setError('');setNotice('');
  try{
   if(selected.secretaryAction==='REQUEST_REVIEW'){
    const result=await workflow('PROJECT_SUPERVISION_REQUEST_REVIEW',{initiativeId:selected.project.project_id,sourceActivityId:selected.update?.id});
    setNotice(result?.warning||`تم تسجيل طلب التقييم ${result?.attempt===2?'الثاني':'الأول'}.`);
   }else if(selected.secretaryAction==='ESCALATE'){
    if(escalationText.trim().length<5)throw new Error('اكتب إجراء السكرتير بعد عدم استجابة المتابع.');
    if(new Date(escalationDue).getTime()<=Date.now())throw new Error('حدد موعد متابعة لاحقًا.');
    await workflow('PROJECT_SUPERVISION_FOLLOWUP',{initiativeId:selected.project.project_id,sourceActivityId:selected.update?.id,kind:'CLARIFY',note:escalationText.trim(),dueAt:new Date(escalationDue).toISOString()});
    setNotice('تم تسجيل تدخل السكرتير وتحديد موعد للعودة إلى المتابعة.');
   }
   setSelected(null);await load();window.dispatchEvent(new Event('kmsa:followup-changed'));
  }catch(e:any){setError(e?.message||'تعذر حفظ الإجراء.')}finally{setSending(false)}
 }
 if(!profile?.secretariat_id&&profile?.role!=='ADMIN')return <section className="workspace-card"><h2>متابعة الإشراف</h2><p>تظهر هذه الصفحة للسكرتير المختص.</p></section>;
 return <div className="workspace-stack v64-supervision" dir="rtl">
  <header className="v55-section-title"><div><span className="v55-eyebrow">متابعة الأداء لا تسجيل الاطلاع</span><h1>متابعة الإشراف</h1><p>هل يرسل المسؤول إفادته؟ هل قيّم المتابع التقدم؟ وهل نُفذ التوجيه التصحيحي؟</p></div><button className="workspace-secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/>{busy?'جارٍ التحديث':'تحديث'}</button></header>
  {error&&<div className="member-form-error" role="alert">{error}</div>}{notice&&<div className="v57-success" role="status"><CheckCircle2 size={17}/>{notice}</div>}
  <nav className="v64-subtabs" aria-label="طرق عرض متابعة الإشراف">
   <button className={view==='action'?'active':''} onClick={()=>setView('action')}>تحتاج تدخلك {attention.length>0&&<span className="v64-red-count">{attention.length}</span>}</button>
   <button className={view==='watch'?'active':''} onClick={()=>setView('watch')}>تحت المتابعة <small>{watching.length}</small></button>
   <button className={view==='all'?'active':''} onClick={()=>setView('all')}>جميع المحطات <small>{all.length}</small></button>
  </nav>
  {view==='all'&&<div className="v64-mini-filters"><button className={assignment==='all'?'active':''} onClick={()=>setAssignment('all')}>الكل</button><button className={assignment==='direct'?'active':''} onClick={()=>setAssignment('direct')}>إشرافي المباشر</button><button className={assignment==='delegated'?'active':''} onClick={()=>setAssignment('delegated')}>المتابعة المفوضة</button></div>}
  {view==='action'&&<p className="v64-help-line"><AlertCircle size={15}/>الأحمر يعني أن إجراءً مطلوبًا منك، وليس مجرد وجود تأخر في المشروع.</p>}
  <section className="v64-supervision-list">
   {busy?<p className="workspace-empty">جارٍ تحميل حالة المتابعة…</p>:shown.length===0?<div className="workspace-card v64-empty"><ShieldCheck size={23}/><strong>{view==='action'?'لا توجد إجراءات إشرافية مطلوبة منك الآن':'لا توجد محطات في هذا العرض'}</strong><p>تبقى المستجدات والتقييمات محفوظة في سجل كل مشروع.</p></div>:
    shown.map(row=>{const directReview=!row.delegated&&!!row.update&&!row.review;
     const action=row.secretaryAction;const url=`/workspace/projects/${row.project.project_id}?milestone=${row.milestoneId}`;
     return <article key={row.milestoneId} className={`workspace-card v64-supervision-entry ${action||directReview?'v64-actionable':''}`}>
      <div className="v64-supervision-entry-top"><div><Link to={url}><strong>{row.project.project_title}</strong></Link><small>{row.milestoneTitle} · {row.delegated?`المتابع: ${row.supervisorName}`:'متابعة مباشرة'}</small></div><span className={`v64-status ${['NO_REPORT','CORRECTION_OVERDUE'].includes(row.issue)?'warn':['RESULT_ACCEPTED','ON_TRACK'].includes(row.issue)?'good':'neutral'}`}>{followupIssueLabel[row.issue]}</span></div>
      {row.reportIsLate&&row.issue!=='NO_REPORT'&&<p className="v64-next-line">تنبيه إضافي: موعد الإفادة التالية فات، حتى لو كان التقييم السابق لا يزال معلقًا.</p>}<p className="v64-supervision-update">{row.update?.note||'لم تصل إفادة عن هذه المحطة حتى الآن.'}</p>
      <div className="v64-supervision-foot"><small>{row.update?`الإفادة: ${formatDateTime(row.update.created_at)}`:row.schedule?`الإفادة المستحقة: ${formatDateTime(row.schedule.next_due_at)}`:'لم يحدد موعد إفادة'}</small>{row.review&&<small>تقييم المتابع: {row.review.event_type==='PROGRESS_OK'?'التقدم مناسب':row.review.event_type==='RESULT_OK'?'النتيجة مناسبة':row.review.event_type==='PROGRESS_UNCLEAR'?'المستجد غير واضح':row.review.note||'يحتاج متابعة'}</small>}</div>
      {row.correctionDueAt&&row.issue==='CORRECTING'&&<p className="v64-next-line">موعد التحقق من التصحيح: {formatDateTime(row.correctionDueAt)}</p>}
      <div className="v64-item-actions">
       {action==='REQUEST_REVIEW'&&<button className="workspace-primary small" onClick={()=>setSelected(row)}><Send size={14}/>{row.requests.length?'إرسال طلب التقييم الثاني':'طلب تقييم المتابع'}</button>}
       {action==='ESCALATE'&&<button className="workspace-primary small" onClick={()=>{setSelected(row);setEscalationText('');setEscalationDue(tomorrow())}}><AlertCircle size={14}/>تدخل السكرتير بعد طلبين</button>}
       {directReview&&<Link className="workspace-primary small" to={`${url}&action=review`}><Eye size={14}/>تقييم الإفادة</Link>}
       {action==='REQUEST_UPDATE'&&<Link className="workspace-secondary small" to={`${url}&action=request-update`}>مراجعة غياب الإفادة <ArrowLeft size={13}/></Link>}
       {action==='CHECK_CORRECTION'&&<Link className="workspace-secondary small" to={url}>التحقق من التصحيح <ArrowLeft size={13}/></Link>}
       {!action&&!directReview&&<Link className="workspace-secondary small" to={url}>فتح المحطة <ArrowLeft size={13}/></Link>}
      </div>
     </article>;
    })}
  </section>
  <Modal open={!!selected} title={selected?.secretaryAction==='ESCALATE'?'تدخل بعد عدم استجابة المتابع':'طلب تقييم المتابع'} onClose={()=>{if(!sending)setSelected(null)}} footer={<div className="workspace-inline-actions"><button className="workspace-secondary" disabled={sending} onClick={()=>setSelected(null)}>إلغاء</button><button className="workspace-primary" disabled={sending} onClick={()=>void takeAction()}>{sending?'جارٍ الحفظ…':selected?.secretaryAction==='ESCALATE'?'تسجيل التدخل':'إرسال طلب التقييم'}</button></div>}>
   <p><strong>{selected?.project.project_title}</strong> — {selected?.milestoneTitle}</p>
   {selected?.secretaryAction==='ESCALATE'?<><p className="muted">أُرسل طلبا تقييم دون استجابة. سجّل ما اتخذته عبر تيليجرام أو مباشرة، وحدد موعدًا للتحقق.</p><div className="field"><label>الإجراء الذي اتخذته *</label><textarea className="textarea" rows={3} value={escalationText} onChange={e=>setEscalationText(e.target.value)}/></div><div className="field"><label>موعد مراجعة أثر التدخل *</label><input className="input" type="datetime-local" value={escalationDue} onChange={e=>setEscalationDue(e.target.value)}/></div></>:<p className="muted">سيسجل النظام مطالبة المتابع بتقييم الإفادة المحددة. لا يعتبر الطلب تقييمًا ولا يمحو التأخر.</p>}
  </Modal>
 </div>;
}
