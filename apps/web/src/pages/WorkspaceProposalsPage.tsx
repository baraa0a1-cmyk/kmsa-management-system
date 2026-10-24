import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, FileText, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { myProposals } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import type { Proposal } from '../lib/types';
import { formatDate, proposalStatusLabel } from '../lib/labels';

const tone=(s:string)=>s==='APPROVED'?'good':s==='NOT_APPROVED'?'danger':s==='REVISION_REQUESTED'||s==='DEFERRED'?'warn':'info';
export default function WorkspaceProposalsPage(){
 const {profile}=useAuth();const [items,setItems]=useState<Proposal[]>([]);const [q,setQ]=useState('');const [tab,setTab]=useState('queue');
 useEffect(()=>{myProposals().then(setItems)},[]);
 const filtered=useMemo(()=>items.filter(p=>{if(q&&!`${p.title} ${p.internal_id} ${p.applicant_name}`.toLowerCase().includes(q.toLowerCase()))return false;if(tab==='queue')return profile?.role==='SECRETARY'?['WITH_SECRETARY','REVISED'].includes(p.status):profile?.role==='GS'?p.status==='WITH_GS':['WITH_SECRETARY','REVISED','WITH_GS'].includes(p.status);if(tab==='revision')return p.status==='REVISION_REQUESTED';if(tab==='decision')return ['APPROVED','NOT_APPROVED','DEFERRED'].includes(p.status);return true}),[items,q,tab,profile?.role]);
 const queueCount=items.filter(p=>profile?.role==='SECRETARY'?['WITH_SECRETARY','REVISED'].includes(p.status):profile?.role==='GS'?p.status==='WITH_GS':['WITH_SECRETARY','REVISED','WITH_GS'].includes(p.status)).length;
 return <div className="workspace-stack"><div className="workspace-page-head"><div><span className="workspace-kicker">المقترحات</span><h1>{profile?.role==='SECRETARY'?'مراجعة مقترحات السكرتارية':profile?.role==='GS'?'إجازة المقترحات':'سجل المقترحات'}</h1><p>{profile?.role==='SECRETARY'?'راجع المقترح في اختصاص السكرتارية، اطلب تعديلًا عند الحاجة، ثم ارفعه للسكرتارية العامة.':profile?.role==='GS'?'المقترحات التي رفعتها السكرتاريات تصل هنا للقرار النهائي: إجازة، تعديل، تأجيل أو عدم إجازة.':'عرض رقابي لمسار المقترحات وقراراتها دون تغيير مسار الاختصاص.'}</p></div>{queueCount>0&&<div className="workspace-head-stat"><strong>{queueCount}</strong><span>بانتظار إجراء</span></div>}</div>
  <section className="workspace-card"><div className="workspace-toolbar"><div className="workspace-tabs"><button className={tab==='queue'?'active':''} onClick={()=>setTab('queue')}>بانتظار الإجراء</button><button className={tab==='revision'?'active':''} onClick={()=>setTab('revision')}>لدى مقدم المقترح</button><button className={tab==='decision'?'active':''} onClick={()=>setTab('decision')}>صدر القرار</button><button className={tab==='all'?'active':''} onClick={()=>setTab('all')}>الكل</button></div><label className="workspace-search"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="العنوان، الرقم، مقدم المقترح"/></label></div>
   <div className="workspace-project-list">{filtered.map(p=><Link key={p.id} to={`/workspace/proposals/${p.id}`} className="workspace-project-row"><div className="workspace-project-main"><div className={`workspace-project-health ${tone(p.status)}`}><FileText/></div><div><strong>{p.title}</strong><span>{p.internal_id} · {p.applicant_name} · {p.secretariat?.name_ar||''}</span></div></div><div className="workspace-project-state"><span className={`workspace-pill ${tone(p.status)}`}>{proposalStatusLabel[p.status]}</span><small>{formatDate(p.updated_at)}</small></div></Link>)}{!filtered.length&&<div className="workspace-empty">{tab==='decision'?<CheckCircle2/>:<Clock3/>}لا توجد مقترحات في هذا التصنيف.</div>}</div>
  </section>
 </div>
}
