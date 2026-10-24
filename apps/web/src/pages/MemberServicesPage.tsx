import { HandHeart } from 'lucide-react';
export default function MemberServicesPage(){
 return <div className="member-simple-page">
  <div className="member-page-title"><span className="member-kicker">الخدمات</span><h1>خدمات الرابطة</h1><p>الخدمات الرقمية التي تتيحها الرابطة لأعضاء الجمعية العمومية ستظهر هنا عند تفعيلها.</p></div>
  <div className="member-empty-page"><div className="member-empty-single"><HandHeart/></div><h2>لا توجد خدمات رقمية مفعلة الآن</h2><p>لن تظهر خدمة هنا إلا إذا كانت متاحة ويمكنك استخدامها فعليًا.</p></div>
 </div>
}
