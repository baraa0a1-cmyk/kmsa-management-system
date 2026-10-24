import { LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { signIn } from '../lib/auth';

export default function LoginPage(){
 const [identifier,setIdentifier]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent){e.preventDefault();setError('');setBusy(true);try{await signIn(identifier,password)}catch(err:any){setError(err?.message||'تعذر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى.')}finally{setBusy(false)}}
 return <div className="portal-login-page">
  <section className="portal-login-brand">
   <div className="portal-login-brand-top"><img src={`${import.meta.env.BASE_URL}kmsa-logo.png`} alt="شعار رابطة طلاب كلية الطب"/><div><strong>رابطة طلاب كلية الطب</strong><span>جامعة الخرطوم</span></div></div>
   <div className="portal-login-copy"><span>البوابة الإلكترونية للرابطة</span><h1>كل ما يخص عضويتك، أقرب وأسهل.</h1><p>ادخل إلى الفرص والخدمات والمقترحات وما يخصك في الرابطة من مكان واحد.</p></div>
   <div className="portal-login-stripes"><i/><i/></div>
  </section>
  <section className="portal-login-form-wrap"><form className="portal-login-card" onSubmit={submit}><div className="portal-login-mobile-brand"><img src={`${import.meta.env.BASE_URL}kmsa-logo.png`} alt="KMSA"/><div><strong>رابطة طلاب كلية الطب</strong><span>جامعة الخرطوم</span></div></div><h2>تسجيل الدخول</h2><p>استخدم بريدك الإلكتروني أو رقمك الجامعي.</p>{error&&<div className="member-form-error">{error}</div>}<label className="portal-field"><span><Mail size={15}/> البريد أو الرقم الجامعي</span><input autoComplete="username" value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="البريد الإلكتروني أو الرقم الجامعي" required/></label><label className="portal-field"><span><LockKeyhole size={15}/> كلمة السر</span><input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="كلمة السر" required/></label><button className="portal-login-button" disabled={busy}>{busy?'جارٍ تسجيل الدخول…':'تسجيل الدخول'}</button><div className="portal-login-foot"><ShieldCheck size={14}/> حسابك مخصص لك ولا تشارك كلمة السر مع أي شخص.</div></form></section>
 </div>
}
