import { Download, FilePlus2, Search, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { downloadTemplate, myProposals, secretariats, uploadToStaging, workflow } from '../lib/api';
import { formatDate, proposalStatusLabel } from '../lib/labels';
import type { Proposal, Secretariat } from '../lib/types';
import { Modal } from '../components/Modal';

const tabs=[['all','الكل'],['drafts','المسودات'],['review','قيد المراجعة'],['revision','يحتاج تعديل'],['decision','صدر القرار']] as const;
export default function MemberProposalsPage(){
 const [searchParams,setSearchParams]=useSearchParams();
 const [items,setItems]=useState<Proposal[]>([]); const [secs,setSecs]=useState<Secretariat[]>([]); const [query,setQuery]=useState(''); const [open,setOpen]=useState(searchParams.get('upload')==='1'); const [file,setFile]=useState<File|null>(null); const [busy,setBusy]=useState(false); const [stage,setStage]=useState(''); const [error,setError]=useState(''); const [success,setSuccess]=useState(searchParams.get('saved')==='1'?'تم حفظ المسودة بنجاح. يمكنك العودة إليها في أي وقت.':'');
 const [form,setForm]=useState<any>({title:'',applicantName:'',applicantEmail:'',secretariatId:'',neededBy:''});
 async function load(){setItems(await myProposals())}
 useEffect(()=>{load();secretariats().then(setSecs)},[]);
 useEffect(()=>{if(searchParams.get('upload')==='1')setOpen(true)},[searchParams]);
 const tab=searchParams.get('tab')||'all';
 const filtered=useMemo(()=>items.filter(p=>{
   const match=!query.trim()||`${p.title} ${p.internal_id} ${p.secretariat?.name_ar||''}`.toLowerCase().includes(query.trim().toLowerCase());
   if(!match)return false;
   if(tab==='drafts')return p.status==='DRAFT';
   if(tab==='review')return ['WITH_SECRETARY','REVISED','WITH_GS'].includes(p.status);
   if(tab==='revision')return p.status==='REVISION_REQUESTED';
   if(tab==='decision')return ['APPROVED','NOT_APPROVED','DEFERRED','WITHDRAWN'].includes(p.status);
   return true;
 }),[items,query,tab]);
 async function upload(){if(!file)return;setBusy(true);setError('');setSuccess('');try{if(!['pdf','docx'].includes(file.name.split('.').pop()?.toLowerCase()||''))throw new Error('اختر ملف PDF أو DOCX فقط.');if(file.size>12*1024*1024)throw new Error('حجم الملف أكبر من 12MB.');setStage('رفع الملف…');const stagingPath=await uploadToStaging(file);setStage('إرسال المقترح…');await workflow('PROPOSAL_UPLOAD_CREATE',{form,stagingPath,fileName:file.name,mimeType:file.type||undefined});setOpen(false);setFile(null);setForm((f:any)=>({...f,title:'',secretariatId:'',neededBy:''}));setStage('');setSuccess('تم رفع المقترح وإرساله بنجاح.');setSearchParams({tab:'review'});await load()}catch(err:any){setError(err?.message||'تعذر رفع المقترح. حاول مرة أخرى.');setStage('')}finally{setBusy(false)}}
 function close(){if(busy)return;setOpen(false);setError('');setStage('');if(searchParams.get('upload')){searchParams.delete('upload');setSearchParams(searchParams)}}
 return <div className="member-simple-page">
  <div className="member-page-title member-proposals-head"><div><span className="member-kicker">صوتك</span><h1>مقترحاتي</h1><p>أنشئ مقترحًا، احفظه كمسودة، أو تابع ما قدمته دون مصطلحات إدارية معقدة.</p></div><div className="member-page-actions"><Link className="member-action-primary" to="/proposals/new"><FilePlus2 size={18}/>مقترح جديد</Link><button className="member-action-secondary" onClick={()=>setOpen(true)}><Upload size={18}/>رفع ملف جاهز</button></div></div>
  {success&&<div className="member-form-success member-banner">{success}<button onClick={()=>setSuccess('')}><X size={15}/></button></div>}
  <div className="member-toolbar"><div className="member-search member-search-inline"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث في مقترحاتك"/></div><button className="member-template-link" onClick={()=>downloadTemplate()}><Download size={16}/>تحميل نموذج المقترح</button></div>
  <div className="member-tabs">{tabs.map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>setSearchParams(key==='all'?{}:{tab:key})}>{label}{key==='drafts'&&items.some(p=>p.status==='DRAFT')?<b>{items.filter(p=>p.status==='DRAFT').length}</b>:null}</button>)}</div>
  {filtered.length?<div className="member-proposal-list">{filtered.map(p=><Link key={p.id} to={`/proposals/${p.id}`} className="member-proposal-card"><div className="member-proposal-main"><div className="member-proposal-title">{p.title}</div><div className="member-proposal-meta"><span>{p.secretariat?.name_ar||'—'}</span><span>{formatDate(p.updated_at)}</span><span className="mono">{p.internal_id}</span></div></div><div className={`member-status status-${p.status.toLowerCase()}`}>{proposalStatusLabel[p.status]}</div></Link>)}</div>:<div className="member-empty-page compact"><FilePlus2/><h2>{tab==='drafts'?'لا توجد مسودات':'لا توجد مقترحات هنا'}</h2><p>{query?'جرّب عبارة بحث مختلفة.':'عندما يوجد عنصر في هذا التصنيف سيظهر هنا.'}</p>{tab==='all'&&<Link className="member-action-primary" to="/proposals/new">ابدأ مقترحًا جديدًا</Link>}</div>}
  <Modal open={open} title="رفع مقترح جاهز" onClose={close} footer={<><button className="member-action-primary" disabled={busy||!file||!form.title||!form.secretariatId} onClick={upload}>{busy?(stage||'جارٍ الرفع…'):'رفع وإرسال'}</button><button className="member-action-secondary" disabled={busy} onClick={close}>إلغاء</button></>}>
   {error&&<div className="member-form-error">{error}</div>}
   <div className="member-upload-drop"><Upload size={26}/><strong>{file?file.name:'اختر ملف المقترح'}</strong><span>PDF أو DOCX — بحد أقصى 12MB</span><input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>setFile(e.target.files?.[0]||null)}/></div>
   <div className="form-grid section-gap"><div className="field full"><label>عنوان المقترح</label><input className="input" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div><div className="field full"><label>السكرتارية المعنية</label><select className="select" value={form.secretariatId} onChange={e=>setForm({...form,secretariatId:e.target.value})}><option value="">اختر السكرتارية</option>{secs.map(s=><option key={s.id} value={s.id}>{s.name_ar}</option>)}</select></div><div className="field full"><label>متى تحتاج القرار؟ <span className="muted">(اختياري)</span></label><input className="input" type="date" value={form.neededBy} onChange={e=>setForm({...form,neededBy:e.target.value})}/></div></div>
  </Modal>
 </div>
}
