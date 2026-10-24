import { BriefcaseBusiness, CalendarDays, GraduationCap, HeartHandshake, Search } from 'lucide-react';
import { useState } from 'react';

const filters=['الكل','فعاليات','تدريب','تطوع','مناصب','أخرى'];
export default function MemberOpportunitiesPage(){
  const [active,setActive]=useState('الكل');
  return <div className="member-simple-page">
    <div className="member-page-title"><span className="member-kicker">الفرص</span><h1>كل ما هو متاح لك</h1><p>عندما تفتح الرابطة تسجيلًا لفعالية أو تدريب أو تطوع أو موقع عمل، ستجده هنا.</p></div>
    <div className="member-search"><Search size={18}/><input placeholder="ابحث في الفرص" aria-label="ابحث في الفرص"/></div>
    <div className="member-filter-row">{filters.map(x=><button key={x} className={active===x?'active':''} onClick={()=>setActive(x)}>{x}</button>)}</div>
    <div className="member-empty-page">
      <div className="member-empty-art"><CalendarDays/><GraduationCap/><HeartHandshake/><BriefcaseBusiness/></div>
      <h2>لا توجد فرص منشورة حاليًا</h2>
      <p>لن نملأ الصفحة بعناصر غير متاحة. عند نشر أي فرصة جديدة ستظهر هنا تلقائيًا.</p>
    </div>
  </div>
}
