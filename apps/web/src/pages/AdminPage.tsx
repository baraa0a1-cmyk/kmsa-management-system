import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Check, FileUp, KeyRound, Plus, ShieldCheck, UsersRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { secretariats, workflow } from '../lib/api';
import type { Secretariat } from '../lib/types';
import { useSearchParams } from 'react-router-dom';

type Cycle={id:string;code:string;name:string;status:string;is_current:boolean;cycle_start_date?:string|null};
type Account={id:string;full_name:string;university_id?:string|null;email:string};
type ImportRecord={name:string;universityId:string;email:string;row:number;issue?:string;contacts:Record<string,string>};

// RFC4180-compatible CSV parser: commas, newlines and escaped quotation marks.
function parseCsv(source:string):string[][]{
 const rows:string[][]=[];let row:string[]=[];let cell='';let quote=false;
 for(let i=0;i<source.length;i++){
  const c=source[i];if(c==='"'){if(quote&&source[i+1]==='"'){cell+='"';i++}else quote=!quote;continue}
  if(c===','&&!quote){row.push(cell.trim());cell='';continue}
  if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';continue}
  cell+=c;
 }
 if(quote)throw new Error('الملف يحتوي على علامة اقتباس غير مغلقة.');
 row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 return rows;
}
function interpretCsv(source:string):{records:ImportRecord[];headers:string[]}{
 const rows=parseCsv(source.replace(/^\uFEFF/,''));if(!rows.length)throw new Error('الملف فارغ.');
 const headers=rows[0].map(s=>s.replace(/\s+/g,' ').trim());
 const find=(parts:string[])=>headers.findIndex(h=>parts.some(x=>h.toLowerCase()===x.toLowerCase()));
 const nameCol=find(['الاسم رباعي','الاسم','الاسم الكامل','full name','name']);
 const idCol=find(['الرقم الجامعي','الرقم الجامعى','university id','student id','university_id']);
 const emailCol=find(['البريد الإلكتروني','البريد الالكتروني','email','email address']);
 if(nameCol<0||idCol<0||emailCol<0)throw new Error('لم أتعرف على أعمدة الاسم والرقم الجامعي والبريد الإلكتروني في الملف.');
 const extraCols:Record<string,string[]>={phone:['رقم الهاتف','phone'],whatsapp:['رقم الواتساب','whatsapp'],telegram:['معرف التيليجرام','telegram'],department:['القسم','department'],location:['مكان التواجد الحالي','location'],country:['الدولة التي تتواجد فيها','country'],city:['المدينة / الولاية','city']};
 const extras:Record<string,number>=Object.fromEntries(Object.entries(extraCols).map(([key,labels])=>[key,find(labels)]));
 const emails=new Set<string>(),ids=new Set<string>();const records=rows.slice(1).map((cols,index)=>{
  const name=(cols[nameCol]||'').trim(), universityId=(cols[idCol]||'').trim(),email=(cols[emailCol]||'').trim().toLowerCase();
  const issue=!name||!universityId||!email?'بيانات أساسية ناقصة':!/^\S+@\S+\.\S+$/.test(email)?'البريد الإلكتروني غير صالح':emails.has(email)||ids.has(universityId)?'صف مكرر داخل الملف':undefined;
  if(!issue){emails.add(email);ids.add(universityId)}
  const contacts=Object.fromEntries(Object.entries(extras).map(([k,i])=>[k,(i>=0?cols[i]:'')||'']));
  return {row:index+2,name,universityId,email,issue,contacts};
 });return {headers,records};
}
export default function AdminPage(){
 const [params,setParams]=useSearchParams();const tab=params.get('tab')||'cycles';
 const [cycles,setCycles]=useState<Cycle[]>([]);const [secs,setSecs]=useState<Secretariat[]>([]);const [people,setPeople]=useState<Account[]>([]);
 const [message,setMessage]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const [form,setForm]=useState({code:'',name:'',startDate:'',batches:'97,98,99,100,101'});
 const [cycleId,setCycleId]=useState('');const [batch,setBatch]=useState('98');const [csv,setCsv]=useState<ImportRecord[]>([]);const [csvName,setCsvName]=useState('');const [password,setPassword]=useState('');
 const [results,setResults]=useState<{row:number;universityId:string;status:string;reason?:string}[]>([]);
 const [leader,setLeader]=useState({role:'SECRETARY',secretariatId:'',profileId:''});const [resetSearch,setResetSearch]=useState('');const [resetTarget,setResetTarget]=useState('');const [temporary,setTemporary]=useState('');
 async function load(){const [c,s,p]=await Promise.all([supabase.from('cycles').select('id,code,name,status,is_current,cycle_start_date').order('created_at',{ascending:false}),secretariats(),supabase.from('profiles').select('id,full_name,university_id,email').eq('active',true).order('full_name').limit(2000)]);
  if(c.error)throw c.error;if(p.error)throw p.error;setCycles(c.data||[]);setSecs(s);setPeople(p.data||[]);setCycleId(current=>current||(c.data?.find(x=>x.is_current)?.id||c.data?.[0]?.id||''));}
 useEffect(()=>{load().catch(e=>setError(e.message))},[]);
 async function act(action:string,payload:any){setBusy(true);setError('');setMessage('');try{const result=await workflow(action,payload);setMessage('تم تنفيذ العملية وحفظها.');await load().catch(()=>setMessage('تم حفظ العملية، لكن تعذر تحديث قائمة العرض. أعد فتح الصفحة للتأكد.'));return result}catch(e:any){setError(e?.message||'تعذر تنفيذ العملية.');return null}finally{setBusy(false)}}
 const valid=useMemo(()=>csv.filter(x=>!x.issue),[csv]);const invalid=csv.length-valid.length;
 const draft=cycles.find(x=>x.id===cycleId);
 async function importAll(){if(!password||password.length<12){setError('أدخل كلمة مرور أولية من 12 حرفًا على الأقل.');return}
  if(!valid.length){setError('لا توجد سجلات صالحة للاستيراد.');return}
  if(!window.confirm(`إنشاء ما يصل إلى ${valid.length} حسابًا في الدفعة ${batch}؟\nسيُطلب من أصحابها تغيير كلمة المرور الأولية عند أول دخول.`))return;
  setBusy(true);setError('');setResults([]);let all:any[]=[];
  try{for(let i=0;i<valid.length;i+=50){const chunk=valid.slice(i,i+50);const result=await workflow('ADMIN_BATCH_IMPORT',{cycleId,batch:Number(batch),initialPassword:password,people:chunk.map(x=>({name:x.name,universityId:x.universityId,email:x.email,contacts:x.contacts}))});
    all=all.concat((result.results||[]).map((r:any)=>({...r,row:chunk[(r.row||1)-1]?.row||r.row})));setResults([...all]);}
   setMessage(`اكتمل الاستيراد: ${all.filter(x=>x.status==='CREATED').length} جديد، ${all.filter(x=>x.status==='EXISTS').length} موجود سابقًا، ${all.filter(x=>x.status==='ERROR'||x.status==='INVALID').length} تعذر.`);
   setPassword('');await load().catch(()=>setMessage('اكتمل الاستيراد. تعذر تحديث قائمة الحسابات فقط؛ أعد فتح الصفحة.')); 
  }catch(e:any){setError('توقف الاستيراد بعد معالجة بعض السجلات. راجع النتائج قبل المحاولة مجددًا: '+(e.message||''))}finally{setBusy(false)}
 }
 async function fileChanged(file?:File){setError('');setResults([]);setCsv([]);if(!file)return;
  try{if(file.size>2_000_000)throw new Error('حجم الملف أكبر من 2 MB.');const data=interpretCsv(await file.text());if(data.records.length>3000)throw new Error('قسّم الملف إلى دفعات لا تتجاوز 3000 صف.');setCsvName(file.name);setCsv(data.records)}catch(e:any){setError(e.message)}
 }
 return <div className="workspace-stack workspace-data-page v58-admin" dir="rtl">
  <header className="workspace-page-head"><div><span className="workspace-kicker">إدارة تقنية فقط · لا تمنح صلاحيات إشراف على المشاريع</span><h1>إدارة النظام</h1><p>تهيئة الدورات، وحسابات الدفعات، واستعادة الدخول. تبقى تكليفات السكرتاريات من اختصاص السكرتارين.</p></div></header>
  <div className="workspace-tabs-simple">
   <button className={tab==='cycles'?'active':''} onClick={()=>setParams({tab:'cycles'})}><CalendarRange size={15}/> الدورات</button>
   <button className={tab==='import'?'active':''} onClick={()=>setParams({tab:'import'})}><FileUp size={15}/> استيراد دفعة</button>
   <button className={tab==='accounts'?'active':''} onClick={()=>setParams({tab:'accounts'})}><KeyRound size={15}/> استعادة الحسابات</button>
  </div>
  {error&&<div className="member-form-error" role="alert">{error}</div>}{message&&<div className="v58-success" role="status"><Check size={16}/>{message}</div>}
  {tab==='cycles'&&<>
   <section className="workspace-card card-pad"><h2>الدورات التنظيمية</h2><p className="muted">دورة واحدة فعالة. الدورات السابقة محفوظة كسجلات مستقلة، ولا يتغير رمز الدورة بإعداد نصّي.</p>
    <div className="v58-cycle-list">{cycles.map(c=><div className="v58-cycle" key={c.id}><div><strong>{c.name}</strong><small>{c.code} · {c.is_current?'الدورة الحالية':c.status==='DRAFT'?'قيد التهيئة':'أرشيف'}</small></div>{c.is_current?<span className="v58-pill">فعالة</span>:<button disabled={busy||c.status!=='DRAFT'} className="workspace-secondary small" onClick={()=>{if(window.confirm('هل تأكدت من إعداد الرئيس والسكرتارين؟ التفعيل ينقل الصلاحيات من الدورة السابقة.'))void act('ADMIN_CYCLE_ACTIVATE',{cycleId:c.id})}}>تفعيل الدورة</button>}</div>)}</div>
   </section>
   <section className="workspace-card card-pad"><h2>تهيئة دورة جديدة</h2><div className="form-grid">
    <div className="field"><label>رمز الدورة</label><input className="input" placeholder="2027" value={form.code} onChange={e=>setForm(v=>({...v,code:e.target.value}))}/></div>
    <div className="field"><label>اسم الدورة</label><input className="input" placeholder="الدورة التنظيمية 2027" value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))}/></div>
    <div className="field"><label>تاريخ البداية</label><input type="date" className="input" value={form.startDate} onChange={e=>setForm(v=>({...v,startDate:e.target.value}))}/></div>
    <div className="field"><label>الدفعات المشمولة — تُفصل بفاصلة</label><input className="input" placeholder="97,98,99,100,101" value={form.batches} onChange={e=>setForm(v=>({...v,batches:e.target.value}))}/></div>
   </div><button className="workspace-primary" disabled={busy||!form.code||!form.name} onClick={()=>act('ADMIN_CYCLE_CREATE',{code:form.code,name:form.name,startDate:form.startDate||null,batches:form.batches.split(/[,،\s]+/).filter(Boolean)})}><Plus size={16}/> إنشاء دورة قيد التهيئة</button></section>
   <section className="workspace-card card-pad"><h2>التكوين القيادي الأولي</h2><p className="muted">تحدد الرئيس والسكرتير العام والسكرتارين في دورة قيد التهيئة فقط. النواب ورؤساء اللجان يضافون لاحقًا داخل السكرتارية.</p>
    <div className="form-grid"><div className="field"><label>الدورة</label><select className="select" value={cycleId} onChange={e=>setCycleId(e.target.value)}>{cycles.map(c=><option key={c.id} value={c.id}>{c.name} — {c.is_current?'حالية':c.status}</option>)}</select></div>
    <div className="field"><label>المنصب</label><select className="select" value={leader.role} onChange={e=>setLeader(v=>({...v,role:e.target.value}))}><option value="PRESIDENT">رئيس الرابطة</option><option value="GS">السكرتير العام</option><option value="SECRETARY">سكرتير</option></select></div>
    {leader.role==='SECRETARY'&&<div className="field"><label>السكرتارية</label><select className="select" value={leader.secretariatId} onChange={e=>setLeader(v=>({...v,secretariatId:e.target.value}))}><option value="">اختر</option>{secs.filter(s=>s.code!=='GS').map(s=><option value={s.id} key={s.id}>{s.name_ar}</option>)}</select></div>}
    <div className="field"><label>الشخص</label><select className="select" value={leader.profileId} onChange={e=>setLeader(v=>({...v,profileId:e.target.value}))}><option value="">اختر الحساب</option>{people.map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.university_id||p.email}</option>)}</select></div></div>
    <button disabled={busy||!draft||draft.status!=='DRAFT'||!leader.profileId||(leader.role==='SECRETARY'&&!leader.secretariatId)} className="workspace-primary" onClick={()=>act('ADMIN_CYCLE_LEADER_SET',{cycleId,profileId:leader.profileId,role:leader.role,secretariatId:leader.secretariatId})}>تسجيل التكليف القيادي</button>
   </section>
  </>}
  {tab==='import'&&<section className="workspace-card card-pad"><h2><FileUp size={19}/> استيراد أعضاء دفعة</h2><p className="muted">ارفع ملف CSV كما هو. سيحدد النظام أعمدة الاسم الرباعي والرقم الجامعي والبريد الإلكتروني وبيانات التواصل المتاحة، ويعرض المكررات والبيانات الناقصة قبل الإنشاء. لا يتم إرسال الملف إلى الخادم حتى تؤكد الاستيراد.</p>
   <div className="form-grid"><div className="field"><label>الدورة</label><select className="select" value={cycleId} onChange={e=>setCycleId(e.target.value)}>{cycles.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    <div className="field"><label>رقم الدفعة (يجب إدراجها في الدورة)</label><input className="input" inputMode="numeric" value={batch} onChange={e=>setBatch(e.target.value)}/></div>
    <div className="field full"><label>ملف CSV</label><input className="input" type="file" accept=".csv,text/csv" onChange={e=>fileChanged(e.target.files?.[0])}/></div>
    <div className="field full"><label>كلمة المرور الأولية المشتركة (12 حرفًا على الأقل)</label><input className="input" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/><small className="muted">تُستخدم عند الإنشاء فقط، ويجب تغييرها عند أول دخول. لا تُعاد تعيين كلمة مرور حساب موجود.</small></div>
   </div>
   <div className="v58-batch-helper"><button className="workspace-secondary small" disabled={busy||!cycleId||!Number.isInteger(Number(batch))} onClick={()=>act('ADMIN_CYCLE_BATCH_ADD',{cycleId,batch:Number(batch)})}><Plus size={14}/> إضافة الدفعة لهذه الدورة إن لم تكن موجودة</button></div>
   {csv.length>0&&<><div className="v58-preview-info"><strong>{csvName}</strong><span>{csv.length} سجلًا · {valid.length} جاهزًا · {invalid} يحتاج مراجعة</span></div>
    <div className="workspace-sheet-wrap v58-preview"><table className="workspace-sheet"><thead><tr><th>صف</th><th>الاسم</th><th>الرقم الجامعي</th><th>البريد</th><th>النتيجة</th></tr></thead><tbody>{csv.slice(0,25).map(x=><tr key={x.row}><td>{x.row}</td><td>{x.name||'—'}</td><td>{x.universityId||'—'}</td><td>{x.email||'—'}</td><td>{x.issue?<span className="danger-text">{x.issue}</span>:<span>جاهز</span>}</td></tr>)}</tbody></table></div><small className="muted">معاينة أول 25 سجلًا؛ بقية الصفوف تدخل في التحقق نفسه.</small>
    <button className="workspace-primary" disabled={busy||!cycleId||!valid.length||password.length<12} onClick={()=>void importAll()}>{busy?'جارٍ إنشاء الحسابات…':`إنشاء ${valid.length} حسابًا صالحًا`}</button></>}
   {!!results.length&&<div className="v58-preview-info" role="status">أُنشئ {results.filter(x=>x.status==='CREATED').length} · موجود مسبقًا {results.filter(x=>x.status==='EXISTS').length} · تعذر {results.filter(x=>x.status==='ERROR'||x.status==='INVALID').length}</div>}
  </section>}
  {tab==='accounts'&&<section className="workspace-card card-pad"><h2><UsersRound size={19}/> إعادة تعيين الدخول</h2><p className="muted">كلمات المرور الشخصية غير قابلة للعرض. عند النسيان نصدر كلمة مرور جديدة مؤقتة؛ تظهر هنا مرة واحدة فقط، وتلزم صاحب الحساب بتغييرها.</p>
    <div className="field"><label>ابحث بالاسم أو الرقم الجامعي</label><input className="input" value={resetSearch} onChange={e=>{setResetSearch(e.target.value);setResetTarget('');setTemporary('')}} placeholder="ابحث عن عضو"/></div>
    <div className="v58-account-results">{resetSearch.trim().length>=2&&people.filter(p=>`${p.full_name} ${p.university_id||''} ${p.email}`.toLowerCase().includes(resetSearch.toLowerCase())).slice(0,12).map(p=><button className={resetTarget===p.id?'selected':''} key={p.id} onClick={()=>{setResetTarget(p.id);setTemporary('')}}><strong>{p.full_name}</strong><small>{p.university_id||p.email}</small></button>)}</div>
    {resetTarget&&<button className="workspace-primary" disabled={busy} onClick={async()=>{if(!window.confirm('إنشاء كلمة مرور مؤقتة جديدة وإبطال كلمة المرور القديمة لهذا الحساب؟'))return;const r=await act('ADMIN_RESET_PASSWORD',{profileId:resetTarget});if(r)setTemporary(r.temporaryPassword||'')}}><KeyRound size={16}/> إعادة تعيين كلمة المرور</button>}
    {temporary&&<div className="v58-password-once" role="status"><strong>كلمة المرور المؤقتة — انسخها الآن، لن تظهر مجددًا</strong><code dir="ltr">{temporary}</code><button className="workspace-secondary small" onClick={()=>navigator.clipboard.writeText(temporary)}>نسخ</button><p>سلّمها لصاحب الحساب عبر قناة آمنة، ولا تشاركها في مجموعة عامة.</p></div>}
  </section>}
  <div className="callout"><ShieldCheck size={16}/> النظام لا يحتفظ بكلمات المرور بصيغة مقروءة. الإجراءات الإدارية المهمة تُحفظ في سجل التدقيق.</div>
 </div>
}
