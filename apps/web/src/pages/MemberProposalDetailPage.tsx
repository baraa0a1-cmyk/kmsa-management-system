import { AlertTriangle, ArrowRight, Download, Edit3, FileText, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { downloadDriveFile, proposalById, proposalDocumentStatus, proposalHistory, workflow } from '../lib/api';
import { formatDateTime, proposalStatusLabel } from '../lib/labels';
import type { Proposal, ProposalDocumentStatus } from '../lib/types';

const actionLabels:Record<string,string>={CREATED:'تم إنشاء المقترح',SECRETARY_REVISION_REQUESTED:'طلبت السكرتارية تعديلًا',GS_REVISION_REQUESTED:'طُلب تعديل من السكرتارية العامة',REVISION_UPLOADED:'تم رفع نسخة معدلة',SECRETARY_FORWARDED:'رُفع للسكرتارية العامة',GS_APPROVED:'تمت إجازة المقترح',GS_REJECTED:'لم تتم إجازة المقترح',GS_DEFERRED:'تم تأجيل النظر',WITHDRAWN:'تم سحب المقترح'};
export default function MemberProposalDetailPage(){
 const {id}=useParams(); const [p,setP]=useState<Proposal|null>(null); const [hist,setHist]=useState<any>({actions:[],versions:[]}); const [busy,setBusy]=useState(false); const [err,setErr]=useState(''); const [docStatus,setDocStatus]=useState<ProposalDocumentStatus|null>(null);
 async function load(){if(!id)return;const [a,b,c]=await Promise.all([proposalById(id),proposalHistory(id),proposalDocumentStatus(id).catch(()=>null)]);setP(a);setHist(b);setDocStatus(c)}
 useEffect(()=>{load()},[id]);
 const latestRevision=useMemo(()=>hist.actions.find((a:any)=>['SECRETARY_REVISION_REQUESTED','GS_REVISION_REQUESTED'].includes(a.action_type)),[hist.actions]);
 async function withdraw(){if(!confirm('هل تريد سحب هذا المقترح؟'))return;setBusy(true);setErr('');try{await workflow('PROPOSAL_WITHDRAW',{proposalId:id,reason:'سحب مقدم المقترح'});await load()}catch(e:any){setErr(e?.message||'تعذر سحب المقترح.')}finally{setBusy(false)}}
 if(!p)return <div className="member-loading"><div className="loader"/></div>;
 return <div className="member-simple-page">
  <Link to="/proposals" className="member-back"><ArrowRight size={17}/>العودة إلى مقترحاتي</Link>
  <div className="member-detail-head"><div><span className="member-kicker mono">{p.internal_id}</span><h1>{p.title}</h1><p>{p.secretariat?.name_ar} · النسخة {p.current_version}</p></div><div className={`member-status large status-${p.status.toLowerCase()}`}>{proposalStatusLabel[p.status]}</div></div>
  {err&&<div className="member-form-error member-banner">{err}</div>}
  {hist.versions.length>0&&!hist.versions.some((v:any)=>v.version_no===p.current_version&&v.pdf_drive_file_id)&&<div className={`member-context-card ${docStatus?.jobStatus==='FAILED'?'attention':''}`}><div>{docStatus?.jobStatus==='FAILED'?<AlertTriangle size={19}/>:<RefreshCw size={19}/>}<span><strong>{docStatus?.jobStatus==='FAILED'?'تعذر تجهيز ملف PDF':'يتم تجهيز نسخة PDF الرسمية'}</strong><small>{docStatus?.jobStatus==='FAILED'?(docStatus.lastError||'حدث خطأ أثناء التوليد.'):'سيظهر هنا تلقائيًا بعد اكتمال تجهيز النموذج الرسمي.'}</small></span></div><button className="member-action-secondary" disabled={busy} onClick={async()=>{setBusy(true);setErr('');try{await workflow('PROPOSAL_DOCUMENT_RETRY',{proposalId:id});await load()}catch(e:any){setErr(e?.message||'تعذر إعادة تجهيز PDF.')}finally{setBusy(false)}}}>إعادة المحاولة</button></div>}

  {p.status==='DRAFT'&&<div className="member-context-card"><div><strong>هذه مسودة محفوظة</strong><span>يمكنك استكمالها وإرسالها عندما تكون جاهزًا.</span></div><Link className="member-action-primary" to={`/proposals/${p.id}/edit`}><Edit3 size={17}/>استكمال المسودة</Link></div>}
  {p.status==='REVISION_REQUESTED'&&<div className="member-context-card attention"><div><strong>المقترح يحتاج تعديلًا منك</strong><span>{latestRevision?.note_text||'راجع الملاحظات ثم أرسل النسخة المعدلة.'}</span></div><Link className="member-action-primary" to={`/proposals/${p.id}/edit`}><RotateCcw size={17}/>تعديل المقترح</Link></div>}
  <div className="member-detail-grid">
   <section className="member-content-card"><h2>ملخص المقترح</h2><div className="member-detail-fields"><div><span>السكرتارية</span><strong>{p.secretariat?.name_ar||'—'}</strong></div><div><span>الفترة المقترحة</span><strong>{p.proposed_period||'غير محددة'}</strong></div><div className="full"><span>الواقع الذي دفع للمقترح</span><p>{p.trigger_reality||'—'}</p></div><div className="full"><span>الفائدة الأساسية</span><p>{p.primary_benefit||'—'}</p></div><div className="full"><span>التدخل المقترح</span><p>{p.intervention||'—'}</p></div><div className="full"><span>معيار النجاح</span><p>{p.success_criterion||'—'}</p></div></div></section>
   <section className="member-content-card"><h2>مسار المقترح</h2><div className="member-member-timeline">{hist.actions.slice().reverse().map((a:any)=><div className="member-member-timeline-item" key={a.id}><i/><div><strong>{actionLabels[a.action_type]||'تم تحديث المقترح'}</strong>{a.note_text&&<span>{a.note_text}</span>}<small>{formatDateTime(a.created_at)}</small></div></div>)}</div></section>
  </div>
  {hist.versions.length>0&&<section className="member-content-card section-gap"><h2>النسخ والملفات</h2><div className="member-files-list">{hist.versions.map((v:any)=><div key={v.id}><div><FileText size={18}/><span><strong>النسخة {v.version_no}</strong><small>{formatDateTime(v.created_at)}</small></span></div><div>{v.pdf_drive_file_id&&<button onClick={()=>downloadDriveFile(v.pdf_drive_file_id)}><Download size={15}/>PDF</button>}{v.docx_drive_file_id&&<button onClick={()=>downloadDriveFile(v.docx_drive_file_id)}><Download size={15}/>Word</button>}</div></div>)}</div></section>}
  {!['APPROVED','NOT_APPROVED','WITHDRAWN','DRAFT'].includes(p.status)&&<div className="member-danger-zone"><button disabled={busy} onClick={withdraw}><Trash2 size={16}/>{busy?'جارٍ السحب…':'سحب المقترح'}</button></div>}
 </div>
}
