import {useState} from 'react';
import {UserPlus,X} from 'lucide-react';
import {workflow} from '../lib/api';
import {supabase} from '../lib/supabase';
import './admin-v6.css';
import {adminReport,adminToast} from './KmsaAdminNotice';
export default function KmsaSingleMember({batch,onDone}:{batch:number;onDone:()=>void}){
 const [open,setOpen]=useState(false),[name,setName]=useState(''),[universityId,setUniversityId]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(){setBusy(true);setError('');try{
  if(name.trim().length<3||!universityId.trim()||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||password.length<12)throw new Error('أكمل الاسم والرقم الجامعي والبريد وكلمة أولية من 12 حرفًا على الأقل.');
  const {data,error:checkError}=await supabase.rpc('kmsa_check_import_people',{p_people:[{row:1,name,universityId,email}]});if(checkError)throw checkError;
  if(data?.[0]?.status!=='READY')throw new Error('الرقم الجامعي أو البريد موجود مسبقًا، أو يحتاج مراجعة قبل إنشاء الحساب.');
  const r=await workflow('ADMIN_BATCH_IMPORT',{batch,initialPassword:password,people:[{name,universityId,email,contacts:{}}]});
  const item=r.results?.[0];if(item?.status!=='CREATED')throw new Error(item?.reason||'تعذر إنشاء الحساب.');
  setOpen(false);setPassword('');setName('');setUniversityId('');setEmail('');onDone();adminToast('success','تم إنشاء حساب العضو في الدفعة.');
 }catch(e:any){setError('');adminReport(e);}finally{setBusy(false)}}
 return <><button className="v6-admin-button" onClick={()=>setOpen(true)}><UserPlus size={15}/> إضافة عضو</button>{open&&<div className="v6-modal-layer" role="presentation" onClick={()=>!busy&&setOpen(false)}><div className="v6-modal" role="dialog" aria-modal="true" aria-label="إضافة عضو" onClick={e=>e.stopPropagation()} dir="rtl">
 <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><h3>إضافة عضو إلى الدفعة {batch}</h3><button className="v6-link" disabled={busy} onClick={()=>setOpen(false)}><X size={18}/></button></div>
 <label className="v6-field">الاسم الكامل<input value={name} onChange={e=>setName(e.target.value)}/></label>
 <label className="v6-field">الرقم الجامعي<input value={universityId} dir="ltr" onChange={e=>setUniversityId(e.target.value)}/></label>
 <label className="v6-field">البريد الإلكتروني<input value={email} type="email" dir="ltr" onChange={e=>setEmail(e.target.value)}/></label>
 <label className="v6-field">كلمة المرور الأولية<input value={password} type="password" autoComplete="new-password" onChange={e=>setPassword(e.target.value)}/></label>
 {error&&<p className="v6-error">{error}</p>}
 <div className="v6-actions"><button className="v6-secondary" disabled={busy} onClick={()=>setOpen(false)}>إلغاء</button><button className="v6-primary" disabled={busy} onClick={()=>void save()}>{busy?'جارٍ الإضافة...':'إنشاء حساب العضو'}</button></div></div></div>}</>
}
