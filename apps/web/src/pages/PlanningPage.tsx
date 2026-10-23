import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { plans, secretariats, workflow } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Modal } from '../components/Modal';
import type { Secretariat } from '../lib/types';

export default function PlanningPage(){
 const {profile}=useAuth();
 const [pls,setPlans]=useState<any[]>([]);
 const [inits,setInits]=useState<any[]>([]);
 const [modal,setModal]=useState<string|null>(null);
 const [form,setForm]=useState<any>({title:'',periodStart:'',periodEnd:'',objective:'',ownerId:'',planId:'',initiativeId:'',statement:'',successMeasure:'',dueAt:'',secretariatId:''});
 const [users,setUsers]=useState<any[]>([]);
 const [secs,setSecs]=useState<Secretariat[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');

 async function load(){
  const [p,i,u,s]=await Promise.all([
   plans(),
   supabase.from('initiatives').select('*,plan:plans(title,secretariat_id),owner:profiles(full_name)').order('created_at',{ascending:false}),
   supabase.from('profiles').select('id,full_name').eq('active',true).order('full_name'),
   secretariats()
  ]);
  setPlans(p);setInits(i.data||[]);setUsers(u.data||[]);setSecs(s);
 }
 useEffect(()=>{load()},[]);

 function openModal(kind:string){
  setError('');
  setForm({title:'',periodStart:'',periodEnd:'',objective:'',ownerId:'',planId:'',initiativeId:'',statement:'',successMeasure:'',dueAt:'',secretariatId:profile?.secretariat_id||''});
  setModal(kind);
 }

 async function save(){
  setError('');
  setBusy(true);
  try{
   if(modal==='plan'){
    if(!form.title?.trim())throw new Error('اكتب اسم الخطة.');
    if(profile?.role==='ADMIN'&&!form.secretariatId)throw new Error('اختر السكرتارية التي تتبع لها الخطة.');
    await workflow('PLAN_CREATE',form);
   }
   if(modal==='initiative'){
    const selectedPlan=pls.find(p=>p.id===form.planId);
    const secretariatId=form.secretariatId||selectedPlan?.secretariat_id||profile?.secretariat_id||'';
    if(!form.title?.trim())throw new Error('اكتب عنوان الـInitiative.');
    if(profile?.role==='ADMIN'&&!secretariatId)throw new Error('اختر السكرتارية المسؤولة عن مسار التنفيذ.');
    if(!form.ownerId)throw new Error('اختر مالك الـInitiative.');
    await workflow('INITIATIVE_CREATE',{planId:form.planId,title:form.title,objective:form.objective,ownerId:form.ownerId,secretariatId});
   }
   if(modal==='result'){
    if(!form.initiativeId)throw new Error('اختر مسار التنفيذ.');
    if(!form.statement?.trim())throw new Error('اكتب النتيجة المراد تحقيقها.');
    await workflow('RESULT_CREATE',{initiativeId:form.initiativeId,statement:form.statement,successMeasure:form.successMeasure,ownerId:form.ownerId,dueAt:form.dueAt||null});
   }
   setModal(null);
   await load();
  }catch(e:any){
   setError(e?.message||'تعذر الحفظ. حاول مرة أخرى.');
  }finally{setBusy(false)}
 }

 const canEdit=profile&&['SECRETARY','ADMIN'].includes(profile.role);
 return <>
  <div className="page-head">
   <div><h1>الخطط والنتائج</h1><p>هنا يبدأ العمل قبل أن يتحول إلى محطات: الخطة تحدد الاتجاه، الـInitiative تحدد مسار العمل، والنتيجة تحدد ما يجب أن يتغير.</p></div>
   {canEdit&&<div className="actions"><button className="btn btn-primary" onClick={()=>openModal('plan')}><Plus size={16}/>خطة</button><button className="btn btn-secondary" onClick={()=>openModal('initiative')}>Initiative</button><button className="btn btn-secondary" onClick={()=>openModal('result')}>نتيجة</button></div>}
  </div>
  <div className="grid grid-2">
   <section className="card card-pad"><div className="section-title"><div><h2>الخطط</h2><p>إطار زمني واحد للعمل، لا قائمة أنشطة متفرقة.</p></div></div><div className="list">{pls.map(p=><div className="list-item" key={p.id}><div className="item-main"><div className="item-title">{p.title}</div><div className="item-meta"><span>{p.status}</span><span>{p.period_start||'—'} → {p.period_end||'—'}</span></div></div></div>)}</div></section>
   <section className="card card-pad"><div className="section-title"><div><h2>مسارات التنفيذ</h2><p>يمكن أن تأتي من خطة، مقترح مجاز، أو عمل مباشر.</p></div></div><div className="list">{inits.map(i=><div className="list-item" key={i.id}><div className="item-main"><div className="item-title">{i.title}</div><div className="item-meta"><span>{i.plan?.title||i.source_type}</span><span>{i.owner?.full_name||'—'}</span></div></div></div>)}</div></section>
  </div>

  <Modal open={!!modal} title={modal==='plan'?'خطة جديدة':modal==='initiative'?'Initiative جديدة':'نتيجة جديدة'} onClose={()=>{setModal(null);setError('')}} footer={<button className="btn btn-primary" disabled={busy} onClick={save}>{busy?'جارٍ الحفظ…':'حفظ'}</button>}>
   {error&&<div className="error">{error}</div>}
   <div className="form-grid">
    {modal==='plan'&&<>
     <div className="field full"><label>اسم الخطة</label><input className="input" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div>
     {profile?.role==='ADMIN'&&<div className="field full"><label>السكرتارية المسؤولة</label><select className="select" value={form.secretariatId} onChange={e=>setForm({...form,secretariatId:e.target.value})}><option value="">اختر السكرتارية</option>{secs.map(s=><option value={s.id} key={s.id}>{s.name_ar}</option>)}</select></div>}
     <div className="field"><label>من</label><input className="input" type="date" value={form.periodStart} onChange={e=>setForm({...form,periodStart:e.target.value})}/></div>
     <div className="field"><label>إلى</label><input className="input" type="date" value={form.periodEnd} onChange={e=>setForm({...form,periodEnd:e.target.value})}/></div>
    </>}
    {modal==='initiative'&&<>
     <div className="field"><label>الخطة</label><select className="select" value={form.planId} onChange={e=>{const planId=e.target.value;const p=pls.find(x=>x.id===planId);setForm({...form,planId,secretariatId:p?.secretariat_id||form.secretariatId})}}><option value="">بدون خطة</option>{pls.map(p=><option value={p.id} key={p.id}>{p.title}</option>)}</select></div>
     {profile?.role==='ADMIN'&&<div className="field"><label>السكرتارية المسؤولة</label><select className="select" value={form.secretariatId} onChange={e=>setForm({...form,secretariatId:e.target.value})}><option value="">اختر السكرتارية</option>{secs.map(s=><option value={s.id} key={s.id}>{s.name_ar}</option>)}</select></div>}
     <div className="field"><label>المالك</label><select className="select" value={form.ownerId} onChange={e=>setForm({...form,ownerId:e.target.value})}><option value="">اختر</option>{users.map(u=><option value={u.id} key={u.id}>{u.full_name}</option>)}</select></div>
     <div className="field full"><label>العنوان</label><input className="input" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div>
     <div className="field full"><label>الهدف</label><textarea className="textarea" value={form.objective} onChange={e=>setForm({...form,objective:e.target.value})}/></div>
    </>}
    {modal==='result'&&<>
     <div className="field full"><label>مسار التنفيذ</label><select className="select" value={form.initiativeId} onChange={e=>setForm({...form,initiativeId:e.target.value})}><option value="">اختر</option>{inits.map(i=><option value={i.id} key={i.id}>{i.title}</option>)}</select></div>
     <div className="field full"><label>النتيجة المراد تحقيقها</label><textarea className="textarea" value={form.statement} onChange={e=>setForm({...form,statement:e.target.value})}/></div>
     <div className="field full"><label>كيف تقاس النتيجة؟</label><textarea className="textarea" value={form.successMeasure} onChange={e=>setForm({...form,successMeasure:e.target.value})}/></div>
     <div className="field"><label>المالك</label><select className="select" value={form.ownerId} onChange={e=>setForm({...form,ownerId:e.target.value})}><option value="">مالك الـInitiative</option>{users.map(u=><option value={u.id} key={u.id}>{u.full_name}</option>)}</select></div>
     <div className="field"><label>الموعد</label><input className="input" type="date" value={form.dueAt} onChange={e=>setForm({...form,dueAt:e.target.value})}/></div>
    </>}
   </div>
  </Modal>
 </>
}
