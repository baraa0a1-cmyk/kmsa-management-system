import { ArrowLeft, FilePlus2, FileText, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
export default function MemberVoicePage(){
 return <div className="member-simple-page">
  <div className="member-page-title"><span className="member-kicker">صوتك</span><h1>شارك بفكرتك ورأيك</h1><p>ابدأ من المقترحات الآن. وتظهر هنا بقية الحقوق الرقمية مثل الانتخابات والتظلمات عندما تكون مفعلة.</p></div>
  <div className="member-voice-hero">
   <div className="member-voice-icon"><FileText/></div>
   <div className="member-voice-copy"><span>المقترحات</span><h2>لديك فكرة يمكن أن تطور عمل الرابطة؟</h2><p>قدّمها مباشرة أو ارفع نموذجًا جاهزًا، ثم تابع مسارها من الاستلام حتى صدور القرار.</p></div>
   <div className="member-voice-actions"><Link className="member-action-primary" to="/proposals/new"><FilePlus2 size={18}/>مقترح جديد</Link><Link className="member-action-secondary" to="/proposals?upload=1"><Upload size={18}/>رفع ملف جاهز</Link><Link className="member-text-link" to="/proposals">مقترحاتي <ArrowLeft size={15}/></Link></div>
  </div>
 </div>
}
