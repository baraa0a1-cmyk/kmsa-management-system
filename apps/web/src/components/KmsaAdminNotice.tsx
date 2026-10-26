import {useEffect,useState} from 'react';
import {AlertCircle,CheckCircle2,X} from 'lucide-react';

export function adminMessage(error:unknown):string{
 const e=error as any;
 const raw=typeof e==='string'?e:typeof e?.message==='string'?e.message:typeof e?.error==='string'?e.error:typeof e?.details==='string'?e.details:typeof e?.code==='string'?e.code:'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';
 const translations:Record<string,string>={
  'CANDIDATE_BATCH_NOT_INCLUDED_OR_GRADUATED':'هذا العضو غير موجود ضمن الدفعات المشمولة بالدورة، أو أن دفعته متخرجة.',
  'CANDIDATE_HOLDS_ANOTHER_EXECUTIVE_SEAT':'الشخص يشغل منصبًا قياديًا آخر في هذه الدورة.',
  'CANDIDATE_ALREADY_ASSISTANT':'الشخص يشغل منصب مساعد السكرتير العام في الدورة نفسها.',
  'CYCLE_NOT_EDITABLE':'لا يمكن تعديل قيادة دورة مؤرشفة.',
  'CANDIDATE_NOT_AVAILABLE':'الحساب غير متاح للتكليف. تحقق من حالة العضو.',
  'MEMBER_IS_ALREADY_EXECUTIVE':'الشخص يشغل منصبًا تنفيذيًا آخر.',
  'EMAIL_IN_USE_BY_ANOTHER_MEMBER':'البريد الإلكتروني مرتبط بعضو آخر. يجب مراجعة التضارب.',
  'EMAIL_ALREADY_USED_BY_DIFFERENT_ID':'البريد الإلكتروني مرتبط برقم جامعي آخر.',
  'ADMIN_REQUIRED':'لا تملك صلاحية إجراء هذه العملية.',
  'CYCLE_LEADERSHIP_INCOMPLETE':'أضف الرئيس والسكرتير العام أولًا.',
  'JWT expired':'انتهت جلسة الدخول. سجّل الدخول مجددًا.'
 };
 return translations[raw]||raw.replace(/^Error:\s*/,'');
}
type Detail={type:'error'|'success';message:string};
export function adminToast(type:Detail['type'],message:string){window.dispatchEvent(new CustomEvent<Detail>('kmsa-admin-notice',{detail:{type,message}}));}
export function adminReport(error:unknown){adminToast('error',adminMessage(error));}
export default function KmsaAdminNotice(){
 const [notice,setNotice]=useState<Detail|null>(null);
 useEffect(()=>{const receive=(ev:Event)=>setNotice((ev as CustomEvent<Detail>).detail);window.addEventListener('kmsa-admin-notice',receive);return()=>window.removeEventListener('kmsa-admin-notice',receive)},[]);
 if(!notice)return null;
 return <div className={`kmsa-notice ${notice.type}`} role={notice.type==='error'?'alert':'status'} dir="rtl">
  {notice.type==='error'?<AlertCircle size={20}/>:<CheckCircle2 size={20}/>}<span>{notice.message}</span>
  <button type="button" aria-label="إغلاق التنبيه" onClick={()=>setNotice(null)}><X size={18}/></button>
 </div>;
}
