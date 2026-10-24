import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, FileText, HandHeart, Megaphone, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { myProposals } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { formatDate, proposalStatusLabel } from '../lib/labels';
import type { Proposal } from '../lib/types';

export default function MemberHomePage(){
  const {profile}=useAuth();
  const [proposals,setProposals]=useState<Proposal[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{myProposals().then(setProposals).finally(()=>setLoading(false))},[]);
  const firstName=(profile?.full_name||'').trim().split(/\s+/)[0]||'مرحبًا';
  const relevant=useMemo(()=>proposals.filter(p=>['DRAFT','REVISION_REQUESTED','WITH_SECRETARY','REVISED','WITH_GS'].includes(p.status)).slice(0,3),[proposals]);
  const drafts=proposals.filter(p=>p.status==='DRAFT').length;
  const revisions=proposals.filter(p=>p.status==='REVISION_REQUESTED').length;

  return <div className="member-home">
    <section className="member-welcome">
      <div>
        <div className="member-eyebrow">رابطة طلاب كلية الطب — جامعة الخرطوم</div>
        <h1>مرحبًا، {firstName}</h1>
        <p>الفرص والخدمات ومشاركتك في الرابطة، في مكان واحد وبأقل عدد من الخطوات.</p>
      </div>
      <div className="member-id-chip">{profile?.university_id||'عضو الجمعية العمومية'}</div>
    </section>

    <section className="member-section">
      <div className="member-section-head"><div><span className="member-kicker">متاح الآن</span><h2>اكتشف ما يمكنك الاستفادة منه</h2></div><Link to="/opportunities" className="member-text-link">كل الفرص <ArrowLeft size={15}/></Link></div>
      <div className="member-empty-strip">
        <div className="member-empty-icon"><Sparkles size={20}/></div>
        <div><strong>لا توجد فرص منشورة حاليًا</strong><span>عند فتح تسجيل لفعالية، تدريب، تطوع أو فرصة أخرى ستظهر هنا مباشرة.</span></div>
      </div>
    </section>

    <section className="member-section">
      <div className="member-section-head"><div><span className="member-kicker">وصول سريع</span><h2>ماذا تريد أن تفعل؟</h2></div></div>
      <div className="member-quick-grid">
        <Link to="/opportunities" className="member-quick-card"><div className="member-quick-icon blue"><CalendarDays/></div><div><strong>الفرص</strong><span>فعاليات، تدريب، تطوع وفرص أخرى</span></div><ArrowLeft size={18}/></Link>
        <Link to="/services" className="member-quick-card"><div className="member-quick-icon red"><HandHeart/></div><div><strong>الخدمات</strong><span>الخدمات التي تتيحها الرابطة لأعضائها</span></div><ArrowLeft size={18}/></Link>
        <Link to="/voice" className="member-quick-card"><div className="member-quick-icon dark"><Megaphone/></div><div><strong>صوتك</strong><span>المقترحات وما يرتبط بحقوقك ومشاركتك</span></div><ArrowLeft size={18}/></Link>
      </div>
    </section>

    {!loading && (relevant.length>0 || drafts>0 || revisions>0) && <section className="member-section">
      <div className="member-section-head"><div><span className="member-kicker">من حسابك</span><h2>آخر ما يخصك</h2></div><Link to="/proposals" className="member-text-link">مقترحاتي <ArrowLeft size={15}/></Link></div>
      <div className="member-personal-list">
        {revisions>0&&<Link to="/proposals?tab=revision" className="member-alert-card"><div><strong>لديك {revisions} مقترح {revisions===1?'يحتاج':'تحتاج'} تعديلًا</strong><span>افتح الملاحظة وأرسل النسخة المعدلة.</span></div><ArrowLeft size={18}/></Link>}
        {drafts>0&&<Link to="/proposals?tab=drafts" className="member-note-card"><div><strong>{drafts} {drafts===1?'مسودة محفوظة':'مسودات محفوظة'}</strong><span>يمكنك استكمالها في أي وقت.</span></div><ArrowLeft size={18}/></Link>}
        {relevant.filter(p=>p.status!=='DRAFT'&&p.status!=='REVISION_REQUESTED').map(p=><Link key={p.id} to={`/proposals/${p.id}`} className="member-proposal-row"><FileText size={18}/><div><strong>{p.title}</strong><span>{proposalStatusLabel[p.status]} · آخر تحديث {formatDate(p.updated_at)}</span></div><ArrowLeft size={17}/></Link>)}
      </div>
    </section>}
  </div>
}
