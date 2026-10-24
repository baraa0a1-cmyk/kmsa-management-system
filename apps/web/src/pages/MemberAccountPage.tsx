import { KeyRound, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { workflow } from '../lib/api';
import { signOut } from '../lib/auth';

export default function MemberAccountPage(){
 const {profile,refreshProfile}=useAuth(); const nav=useNavigate();
 const [email,setEmail]=useState(profile?.email||''); const [emailPass,setEmailPass]=useState('');
 const [currentPass,setCurrentPass]=useState(''); const [newPass,setNewPass]=useState(''); const [confirmPass,setConfirmPass]=useState('');
 const [emailBusy,setEmailBusy]=useState(false); const [passBusy,setPassBusy]=useState(false); const [emailMsg,setEmailMsg]=useState(''); const [passMsg,setPassMsg]=useState(''); const [emailErr,setEmailErr]=useState(''); const [passErr,setPassErr]=useState('');
 async function changeEmail(e:FormEvent){e.preventDefault();setEmailErr('');setEmailMsg('');setEmailBusy(true);try{await workflow('ACCOUNT_EMAIL_CHANGE',{email,currentPassword:emailPass});await refreshProfile();setEmailPass('');setEmailMsg('تم تحديث البريد الإلكتروني بنجاح. يمكنك استخدامه في تسجيل الدخول من الآن.')}catch(err:any){setEmailErr(err?.message||'تعذر تحديث البريد.')}finally{setEmailBusy(false)}}
 async function changePassword(e:FormEvent){e.preventDefault();setPassErr('');setPassMsg('');if(newPass!==confirmPass){setPassErr('كلمتا السر غير متطابقتين.');return}if(newPass.length<8){setPassErr('كلمة السر الجديدة يجب ألا تقل عن 8 أحرف.');return}setPassBusy(true);try{await workflow('ACCOUNT_PASSWORD_CHANGE',{currentPassword:currentPass,newPassword:newPass});setCurrentPass('');setNewPass('');setConfirmPass('');setPassMsg('تم تغيير كلمة السر بنجاح.')}catch(err:any){setPassErr(err?.message||'تعذر تغيير كلمة السر.')}finally{setPassBusy(false)}}
 return <div className="member-simple-page">
  <div className="member-page-title"><span className="member-kicker">حسابي</span><h1>بيانات العضوية والأمان</h1><p>بياناتك الأساسية في الرابطة، مع إمكانية تغيير البريد وكلمة السر بنفسك.</p></div>
  <section className="member-profile-card"><div className="member-profile-avatar"><UserRound/></div><div className="member-profile-name"><strong>{profile?.full_name}</strong><span>عضو الجمعية العمومية</span></div><div className="member-profile-meta"><div><span>الرقم الجامعي</span><strong>{profile?.university_id||'—'}</strong></div><div><span>البريد</span><strong dir="ltr">{profile?.email}</strong></div><div><span>الحالة</span><strong className="member-active-dot">نشط</strong></div></div></section>
  <div className="member-settings-grid">
   <form className="member-settings-card" onSubmit={changeEmail}><div className="member-settings-title"><div className="member-settings-icon blue"><Mail/></div><div><h2>تغيير البريد الإلكتروني</h2><p>سيصبح البريد الجديد صالحًا لتسجيل الدخول مباشرة.</p></div></div>{emailErr&&<div className="member-form-error">{emailErr}</div>}{emailMsg&&<div className="member-form-success">{emailMsg}</div>}<label>البريد الجديد<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required dir="ltr"/></label><label>كلمة السر الحالية<input type="password" value={emailPass} onChange={e=>setEmailPass(e.target.value)} required autoComplete="current-password"/></label><button className="member-action-primary" disabled={emailBusy||email===profile?.email}>{emailBusy?'جارٍ الحفظ…':'حفظ البريد الجديد'}</button></form>
   <form className="member-settings-card" onSubmit={changePassword}><div className="member-settings-title"><div className="member-settings-icon red"><KeyRound/></div><div><h2>تغيير كلمة السر</h2><p>استخدم كلمة سر قوية ومختلفة عن كلمات السر الأخرى.</p></div></div>{passErr&&<div className="member-form-error">{passErr}</div>}{passMsg&&<div className="member-form-success">{passMsg}</div>}<label>كلمة السر الحالية<input type="password" value={currentPass} onChange={e=>setCurrentPass(e.target.value)} required autoComplete="current-password"/></label><label>كلمة السر الجديدة<input type="password" value={newPass} onChange={e=>setNewPass(e.target.value)} required autoComplete="new-password"/></label><label>تأكيد كلمة السر الجديدة<input type="password" value={confirmPass} onChange={e=>setConfirmPass(e.target.value)} required autoComplete="new-password"/></label><button className="member-action-primary" disabled={passBusy}>{passBusy?'جارٍ الحفظ…':'تغيير كلمة السر'}</button></form>
  </div>
  <div className="member-security-note"><ShieldCheck size={17}/><span>كلمة السر لا تُحفظ في قاعدة بيانات الرابطة؛ يتم التعامل معها داخل نظام المصادقة فقط.</span></div>
  <button className="member-account-logout" onClick={async()=>{await signOut();nav('/login')}}><LogOut size={17}/>تسجيل الخروج</button>
 </div>
}
