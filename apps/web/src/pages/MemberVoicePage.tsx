import { ArrowLeft, Download, FilePlus2, FileText, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { downloadTemplate } from '../lib/api';
export default function MemberVoicePage(){
 return <div className="member-simple-page">
  <div className="member-page-title"><span className="member-kicker">صوتك</span><h1>شارك بفكرتك ورأيك</h1><p>كل ما تحتاجه لتقديم المقترح أمامك مباشرة؛ لا تحتاج الدخول إلى «مقترحاتي» لتنزيل النموذج أو البدء.</p></div>
  <div className="member-voice-hero">
   <div className="member-voice-icon"><FileText/></div>
   <div className="member-voice-copy"><span>المقترحات</span><h2>لديك فكرة يمكن أن تطور عمل الرابطة؟</h2><p>اكتبها داخل النظام أو استخدم نموذج Word الرسمي، ثم تابع مسارها والنسخ الناتجة PDF وWord.</p></div>
   <div className="member-voice-actions"><Link className="member-action-primary" to="/proposals/new"><FilePlus2 size={18}/>كتابة مقترح</Link><Link className="member-action-secondary" to="/proposals?upload=1"><Upload size={18}/>رفع ملف جاهز</Link><button className="member-action-secondary" onClick={()=>downloadTemplate()}><Download size={18}/>تحميل نموذج Word</button><Link className="member-text-link" to="/proposals">متابعة مقترحاتي <ArrowLeft size={15}/></Link></div>
  </div>
 </div>
}
