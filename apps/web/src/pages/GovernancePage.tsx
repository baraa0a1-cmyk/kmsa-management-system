import { useEffect, useMemo, useState } from 'react';
import { Gavel, Plus, Search } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { memberDirectorySearch, secretariats, workflow } from '../lib/api';
import type { MemberDirectoryItem, Secretariat } from '../lib/types';
import { formatDateTime } from '../lib/labels';
import { Modal } from '../components/Modal';

const typeLabels:Record<string,string>={
 GENERAL:'قرار عام',APPOINTMENT:'تعيين',DELEGATION:'تفويض',ADMINISTRATIVE:'قرار إداري',EXECUTIVE_COMMITTEE:'قرار اللجنة التنفيذية',OTHER:'أخرى'
};

export default function GovernancePage(){
 const {profile}=useAuth();
 const [decisions,setDecisions]=useState<any[]>([]); const [secs,setSecs]=useState<Secretariat[]>([]); const [q,setQ]=useState('');
 const [open,setOpen]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const [personQ,setPersonQ]=useState(''); const [people,setPeople]=useState<MemberDirectoryItem[]>([]); const [person,setPerson]=useState<MemberDirectoryItem|null>(null);
 const [form,setForm]=useState({title:'',decisionText:'',decisionType:'GENERAL',secretariatId:''});
 const can=!!profile&&['GS','PRESIDENT','ADMIN'].includes(profile.role);
 async function load(){const [d,s]=await Promise.all([supabase.from('decisions').select('*,secretariat:secretariats(name_ar),owner:profiles!decisions_owner_id_fkey(full_name)').order('created_at',{ascending:false}),secretariats()]);if(d.error)throw d.error;setDecisions(d.data||[]);setSecs(s)}
 useEffect(()=>{load()},[]);
 useEffect(()=>{if(!open||personQ.trim().length<2){setPeople([]);return}const t=setTimeout(()=>memberDirectorySearch(personQ.trim()).then(setPeople).catch(()=>setPeople([])),250);return()=>clearTimeout(t)},[personQ,open]);
 const filtered=useMemo(()=>decisions.filter(d=>!q||`${d.title} ${d.decision_text} ${d.owner?.full_name||''} ${d.secretariat?.name_ar||''}`.toLowerCase().includes(q.toLowerCase())),[decisions,q]);
 function start(){setForm({title:'',decisionText:'',decisionType:'GENERAL',secretariatId:''});setPerson(null);setPersonQ('');setError('');setOpen(true)}
 async function save(){if(!form.title.trim()||!form.decisionText.trim()){setError('اكتب عنوان القرار ونصه.');return}setBusy(true);setError('');try{await workflow('DECISION_CREATE',{...form,ownerId:person?.id||null});setOpen(false);await load()}catch(e:any){setError(e?.message||'تعذر حفظ القرار.')}finally{setBusy(false)}}
 return <div className="workspace-stack workspace-data-page">
  <div className="workspace-page-head"><div><span className="workspace-kicker">السجل الرسمي</span><h1>القرارات الرسمية</h1><p>سجل مختصر للقرارات التي تحتاج توثيقًا مؤسسيًا مثل التعيينات والتفويضات وقرارات اللجنة التنفيذية. لا يستخدم لمتابعة العمل اليومي.</p></div>{can&&<button className="workspace-primary" onClick={start}><Plus size={17}/>قرار جديد</button>}</div>
  <section className="workspace-card workspace-toolbar"><div className="workspace-search"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ابحث في القرارات…"/></div></section>
  <section className="workspace-card table-card"><div className="table-wrap"><table className="workspace-table"><thead><tr><th>القرار</th><th>النوع</th><th>الجهة/الشخص المعني</th><th>التاريخ</th></tr></thead><tbody>{filtered.map(d=><tr key={d.id}><td><strong>{d.title}</strong><small>{d.decision_text}</small></td><td>{typeLabels[d.decision_type||'GENERAL']||d.decision_type||'قرار عام'}</td><td>{d.owner?.full_name||d.secretariat?.name_ar||'الرابطة'}</td><td>{formatDateTime(d.created_at)}</td></tr>)}{!filtered.length&&<tr><td colSpan={4} className="table-empty">لا توجد قرارات مطابقة.</td></tr>}</tbody></table></div></section>
  <Modal open={open} title="تسجيل قرار رسمي" onClose={()=>setOpen(false)} footer={<><button className="workspace-secondary" onClick={()=>setOpen(false)}>إلغاء</button><button className="workspace-primary" disabled={busy} onClick={save}>{busy?'جارٍ الحفظ…':'حفظ القرار'}</button></>}>
   <div className="form-grid"><div className="field"><label>نوع القرار</label><select className="select" value={form.decisionType} onChange={e=>setForm({...form,decisionType:e.target.value})}>{Object.entries(typeLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div><div className="field"><label>السكرتارية المعنية <span className="muted">(اختياري)</span></label><select className="select" value={form.secretariatId} onChange={e=>setForm({...form,secretariatId:e.target.value})}><option value="">الرابطة عامة</option>{secs.filter(s=>s.code!=='GS').map(s=><option key={s.id} value={s.id}>{s.name_ar}</option>)}</select></div><div className="field full"><label>عنوان القرار</label><input className="input" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="مثال: تعيين نائب السكرتير…"/></div><div className="field full"><label>نص القرار</label><textarea className="textarea" rows={5} value={form.decisionText} onChange={e=>setForm({...form,decisionText:e.target.value})}/></div><div className="field full"><label>الشخص المعني <span className="muted">(اختياري)</span></label>{person?<div className="selected-member"><div><strong>{person.full_name}</strong><span>{person.university_id||person.email}</span></div><button onClick={()=>{setPerson(null);setPersonQ('')}}>تغيير</button></div>:<><input className="input" value={personQ} onChange={e=>setPersonQ(e.target.value)} placeholder="ابحث بالاسم أو الرقم الجامعي…"/>{people.length>0&&<div className="member-search-results">{people.map(p=><button key={p.id} onClick={()=>{setPerson(p);setPeople([])}}><strong>{p.full_name}</strong><span>{p.university_id||p.email}</span></button>)}</div>}</>}</div>{error&&<div className="form-error full">{error}</div>}</div>
  </Modal>
 </div>
}
