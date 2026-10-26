import {useEffect,useState} from 'react';
import {AlertTriangle,ArrowRightLeft,CheckCircle2,History,LockKeyhole,RefreshCcw} from 'lucide-react';
import {supabase} from '../lib/supabase';
import './admin-v6.css';

type Cycle={id:string;code:string;name:string;is_current:boolean;status:string};
type Preview={current:{id:string;code:string;name:string}|null;target:{id:string;code:string;name:string;status:string};alreadyCurrent:boolean;leadership:{president:number;gs:number;secretaries:number};projectsInCurrent:number;projectsInTarget:number;proposalsInCurrent:number;proposalsInTarget:number;canRestorePrevious:boolean};
type HistoryRow={id:string;from_cycle_id:string|null;to_cycle_id:string;switched_at:string;is_reversal:boolean};
export default function KmsaCycleSwitchPanel({cycle,onChanged}:{cycle:Cycle;onChanged:()=>void}){
 const [preview,setPreview]=useState<Preview|null>(null),[history,setHistory]=useState<HistoryRow[]>([]);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [open,setOpen]=useState(false),[typed,setTyped]=useState(''),[ack,setAck]=useState(false),[reversal,setReversal]=useState(false);
 async function reload(){setLoading(true);setError('');try{const [p,h]=await Promise.all([supabase.rpc('kmsa_cycle_preview',{p_target:cycle.id}),supabase.from('kmsa_cycle_switch_log').select('id,from_cycle_id,to_cycle_id,switched_at,is_reversal').order('switched_at',{ascending:false}).limit(5)]);if(p.error)throw p.error;if(h.error)throw h.error;setPreview(p.data as Preview);setHistory(h.data||[]);}catch(e:any){setError(e.message||'تعذر فحص الانتقال بين الدورات.');}finally{setLoading(false)}}
 useEffect(()=>{setOpen(false);setTyped('');setAck(false);void reload()},[cycle.id]);
 const latest=history[0];const restore=Boolean(preview?.current?.id===latest?.to_cycle_id&&latest?.from_cycle_id===cycle.id);
 const canSwitch=Boolean(preview&&!preview.alreadyCurrent&&preview.leadership.president===1&&preview.leadership.gs===1);
 async function submit(){if(!preview||typed!==cycle.code||!ack||busy)return;setBusy(true);setError('');try{
  const {error:e}=await supabase.rpc('kmsa_switch_current_cycle',{p_target:cycle.id,p_expected_current:preview.current?.id||null,p_typed_code:typed,p_confirmed:true,p_reversal:reversal});if(e)throw e;
  setOpen(false);setTyped('');setAck(false);setReversal(false);onChanged();await reload();
 }catch(e:any){setError(e.message||'لم تتغير الدورة. راجع آخر تحديث وحاول مجددًا.');}finally{setBusy(false)}}
 return <section className="v6-switch" dir="rtl" aria-labelledby="v6-cycle-switch-title">
 <div className="v6-switch-head"><div><div className="v6-caption">إدارة النظام / الدورات</div><h3 id="v6-cycle-switch-title">الدورة المعتمدة لمساحة العمل</h3><p>هذا الإجراء منفصل عن إنشاء الدورة وتعديلها. لا يحذف أي مشروع أو مقترح أو تكليف من أي دورة.</p></div><LockKeyhole size={23}/></div>
 {loading?<p className="v6-muted">جارٍ فحص الدورات والصلاحيات…</p>:preview&&<>
  <div className="v6-cycle-compare"><div><small>المعتمدة الآن</small><strong>{preview.current?.name||'لا توجد دورة معتمدة'}</strong><span dir="ltr">{preview.current?.code||'—'}</span></div><ArrowRightLeft size={20}/><div><small>الدورة المحددة</small><strong>{cycle.name}</strong><span dir="ltr">{cycle.code}</span></div></div>
  <div className="v6-switch-facts"><span>{preview.projectsInCurrent} مشروع في الدورة المعتمدة</span><span>{preview.projectsInTarget} مشروع في الدورة المحددة</span><span>{preview.proposalsInCurrent} مقترح في الدورة المعتمدة</span><span>{preview.proposalsInTarget} مقترح في الدورة المحددة</span></div>
  <p className="v6-switch-notice"><AlertTriangle size={17}/> تبقى بيانات الدورتين محفوظة ومرتبطة بدورتهما الأصلية. الذي يتغير هو الدورة الظاهرة للعمل الجاري وصلاحيات المناصب، لا ملكية المشاريع.</p>
  {preview.alreadyCurrent?<div className="v6-switch-done"><CheckCircle2 size={17}/> هذه هي الدورة المعتمدة حاليًا.</div>:<>
   {!canSwitch&&<p className="v6-error">لا يمكن اعتماد الدورة حتى يكون لها رئيس وسكرتير عام محددان مرة واحدة لكل منصب.</p>}
   <button className="v6-secondary" disabled={!canSwitch||busy} onClick={()=>{setReversal(restore);setTyped('');setAck(false);setOpen(true)}}>
    {restore?<History size={16}/>:<ArrowRightLeft size={16}/>} {restore?'الرجوع إلى هذه الدورة السابقة':'مراجعة اعتماد هذه الدورة'}
   </button>
  </>}
  {history.length>0&&<div className="v6-switch-history"><strong>آخر تغييرات الاعتماد</strong>{history.slice(0,3).map(h=><div key={h.id}><History size={14}/><span>{new Date(h.switched_at).toLocaleString('ar-SD')}</span><span>{h.is_reversal?'رجوع لدورة سابقة':'اعتماد دورة'}</span></div>)}</div>}
 </>}
 {error&&<div className="v6-error" role="alert">{error} <button className="v6-link" onClick={()=>void reload()}><RefreshCcw size={14}/> إعادة فحص</button></div>}
 {open&&preview&&<div className="v6-modal-layer" role="presentation" onClick={()=>!busy&&setOpen(false)}><div className="v6-modal" role="dialog" aria-modal="true" aria-label="مراجعة اعتماد الدورة" onClick={e=>e.stopPropagation()}>
  <h3>{reversal?'الرجوع إلى الدورة السابقة':'تأكيد اعتماد الدورة'}</h3><p>ستصبح <b>{cycle.name}</b> هي دورة العمل الرسمية. ستُحفظ جميع سجلات الدورة الحالية دون حذف أو نقل تلقائي، وستتغير صلاحيات المناصب الجارية.</p>
  {reversal&&<p className="v6-switch-notice">إذا بدأ تنفيذ أعمال في الدورة التي تم اعتمادها بالخطأ، فستبقى تلك الأعمال محفوظة فيها ويمكن العودة إليها لاحقًا.</p>}
  <label className="v6-field">للتأكيد اكتب رمز الدورة التي تريد اعتمادها: <b dir="ltr">{cycle.code}</b><input value={typed} dir="ltr" autoComplete="off" onChange={e=>setTyped(e.target.value)} placeholder={cycle.code}/></label>
  <label className="v6-check"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> قرأت أثر التغيير وأفهم أن الصلاحيات ستتبدل، دون فقدان بيانات الدورتين.</label>
  <div className="v6-actions"><button className="v6-secondary" disabled={busy} onClick={()=>setOpen(false)}>إلغاء</button><button className="v6-primary" disabled={busy||typed!==cycle.code||!ack} onClick={()=>void submit()}>{busy?'جارٍ الاعتماد…':reversal?'تأكيد الرجوع':'اعتماد الدورة'}</button></div>
 </div></div>}
 </section>
}
