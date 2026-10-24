import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Radar, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { executiveSnapshot, workspaceAttention } from '../lib/api';
import { formatDate } from '../lib/labels';

function accountability(x:any){
 if(x.setup_status!=='ACTIVE')return {who:'السكرتير',text:'المشروع لم يدخل التنفيذ بعد؛ مسؤولية استكمال التهيئة تقع على السكرتير.'};
 const noUpdate=!x.last_update_at||Date.now()-new Date(x.last_update_at).getTime()>5*86400000;const noIntervention=!x.last_intervention_at||Date.now()-new Date(x.last_intervention_at).getTime()>3*86400000;
 if(x.pending_permissions>0)return {who:'جهة الموافقة',text:'هناك صلاحية معلقة قد تمنع المسؤول من التنفيذ؛ افحص أين توقفت الموافقة قبل محاسبة مسؤول النتيجة.'};
 if(x.open_blockers>0&&noIntervention)return {who:'السكرتير',text:'عائق مفتوح ولم يُسجل تدخل حديث من السكرتير.'};
 if(x.assistance_needed&&noIntervention)return {who:'السكرتير',text:'مسؤول النتيجة طلب دعمًا ولم يُسجل تدخل حديث.'};
 if(noUpdate&&noIntervention)return {who:'مسؤول النتيجة + السكرتير',text:'لا يوجد تحديث حديث من مسؤول النتيجة، ولا يظهر تدخل متابعة حديث من السكرتير.'};
 if(noUpdate)return {who:'مسؤول النتيجة',text:'السكرتير تدخل، لكن لا يوجد تحديث حديث من مسؤول النتيجة.'};
 if(x.health!=='ON_TRACK'&&noIntervention)return {who:'السكرتير',text:'ظهرت إشارة خطر في تحديث المشروع دون تدخل حديث.'};
 if(x.last_intervention_at)return {who:'تحت المتابعة',text:'سُجل تدخل من السكرتير؛ راقب هل تغير واقع المشروع بعده.'};
 return {who:'متابعة',text:'المشروع يحتاج نظرًا بحسب الموعد أو المحطة القادمة.'};
}
export default function WorkspaceOversightPage(){
 const [snapshot,setSnapshot]=useState<any>({secretariats:[]});const [attention,setAttention]=useState<any[]>([]);useEffect(()=>{(async()=>{setSnapshot(await executiveSnapshot());setAttention(await workspaceAttention())})()},[]);
 const flagged=useMemo(()=>attention.filter(x=>x.signal_score>0),[attention]);
 return <div className="workspace-stack"><div className="workspace-page-head"><div><span className="workspace-kicker">السكرتارية العامة والرئاسة</span><h1>الرقابة العامة</h1><p>هذه الصفحة لا تبحث عن المتأخرين بعد فوات الموعد؛ تبحث عن إشارات الانحراف ومن كان يفترض أن يتصرف عند ظهورها.</p></div></div>
  <section className="workspace-card"><div className="workspace-card-head"><div><h2>صحة السكرتاريات</h2><p>مستخرجة من المشاريع وتحديثاتها وعوائقها، لا من تقرير موازٍ.</p></div></div><div className="workspace-secretariat-table">{(snapshot.secretariats||[]).map((s:any)=><div key={s.id}><strong>{s.name_ar}</strong><span>{s.active_projects} مشروع</span><span>{s.setup_pending} قيد التهيئة</span><span className={s.needs_attention?'danger-text':''}>{s.needs_attention} يحتاج انتباهًا</span><span>{s.stale} بلا تحديث</span></div>)}</div></section>
  <section className="workspace-card"><div className="workspace-card-head"><div><h2>إشارات المسؤولية</h2><p>ليست أحكام محاسبة آلية؛ هي تفسير أولي يساعد GS والرئيس على توجيه السؤال للشخص الصحيح.</p></div><span className="workspace-pill warn">{flagged.length}</span></div><div className="workspace-project-list">{flagged.map((x:any)=>{const a=accountability(x);return <Link to={`/workspace/projects/${x.id}`} key={x.id} className="workspace-project-row"><div className="workspace-project-main"><div className={`workspace-project-health ${x.signal_score>=70?'danger':'warn'}`}>{x.open_blockers>0?<ShieldAlert/>:<AlertTriangle/>}</div><div><strong>{x.title}</strong><span>{x.secretariat_name} · مسؤول النتيجة: {x.owner_name||'—'} · السكرتير: {x.secretary_name||'—'}</span><p className="workspace-accountability"><b>{a.who}:</b> {a.text}</p></div></div><div className="workspace-project-state"><span className={`workspace-pill ${x.signal_score>=70?'danger':'warn'}`}>{x.signal_score>=70?'أولوية عالية':'يحتاج متابعة'}</span><small>{x.next_milestone_due_at?`المحطة ${formatDate(x.next_milestone_due_at)}`:x.target_due_at?`النتيجة ${formatDate(x.target_due_at)}`:'—'}</small></div></Link>})}{!flagged.length&&<div className="workspace-empty"><CheckCircle2/>لا توجد إشارات رقابية بارزة الآن.</div>}</div></section>
 </div>
}
