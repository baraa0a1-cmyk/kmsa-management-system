import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plus, Search, Target, Printer, FileSpreadsheet } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import WorkspaceSupervisionPage from './WorkspaceSupervisionPage';
import WorkspaceProjectDecisionsPage from './WorkspaceProjectDecisionsPage';
import { exportCsv, secretariats, workspaceProjectSheet } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { ProjectSheetRow, Secretariat } from '../lib/types';
import { formatDate, milestoneStatusLabel } from '../lib/labels';

const approvalLabel:Record<string,string>={PENDING_GS:'بانتظار اعتماد GS',APPROVED:'معتمد',RETURNED:'أعيد للمراجعة'};
const healthLabel:Record<string,string>={ON_TRACK:'على المسار',WATCH:'يحتاج توضيحًا',AT_RISK:'مهدد',BLOCKED:'متعثر'};
export default function WorkspaceProjectsPage(){
 const {profile}=useAuth();const [params,setParams]=useSearchParams();
 const tab=params.get('tab')||'projects';const hasSupervision=!!profile&&['SECRETARY','ADMIN'].includes(profile.role);
 const [rows,setRows]=useState<ProjectSheetRow[]>([]);const [secs,setSecs]=useState<Secretariat[]>([]);
 const [q,setQ]=useState('');const [sec,setSec]=useState('');const [status,setStatus]=useState('ALL');
 const [fromDate,setFromDate]=useState('');const [toDate,setToDate]=useState('');const [supervisorIds,setSupervisorIds]=useState<string[]>([]);const [projectSupervisors,setProjectSupervisors]=useState<Record<string,string>>({});const [supervisorsOpen,setSupervisorsOpen]=useState(false);
 const [ownership,setOwnership]=useState<'all'|'mine'|'team'>('all');const [owners,setOwners]=useState<string[]>([]);const [ownersOpen,setOwnersOpen]=useState(false);
 const ownerWrap=useRef<HTMLDivElement|null>(null), supervisorWrap=useRef<HTMLDivElement|null>(null);
 const [pendingDecisions,setPendingDecisions]=useState(0);const [supervisionCount,setSupervisionCount]=useState(0);
 const [busy,setBusy]=useState(true);const [error,setError]=useState('');
 const global=!!profile&&['GS','PRESIDENT'].includes(profile.role);const canCreate=profile?.role==='SECRETARY';const isMember=['APPLICANT','MEMBER'].includes(profile?.role||'');
 useEffect(()=>{let live=true;setBusy(true);setError('');Promise.all([workspaceProjectSheet(),secretariats()]).then(async([projectRows,sections])=>{
  if(!live)return;setRows(projectRows);setSecs(sections);setBusy(false);
  if(!profile?.id||!hasSupervision)return;
  const scoped=projectRows.filter(p=>profile.role==='ADMIN'||p.secretary_id===profile.id||(profile.role==='SECRETARY'&&p.secretariat_id===profile.secretariat_id));
  let pending=0;
  for(let i=0;i<scoped.length;i+=80){const resp=await supabase.from('project_closure_requests').select('id',{count:'exact',head:true}).in('initiative_id',scoped.slice(i,i+80).map(x=>x.project_id)).eq('status','PENDING');if(!live)return;if(resp.error){setError('تعذر قراءة عداد قرارات المشاريع: '+resp.error.message);break;}pending+=resp.count||0;}
  if(live)setPendingDecisions(pending);
  // Supervision count in tab is based on pending explicit review activities, not arbitrary health colors.
  const allowedIds=scoped.filter(p=>p.approval_status==='APPROVED'&&!['COMPLETED','CANCELLED'].includes(p.project_status)&&p.lifecycle_state!=='POSTPONED').map(p=>p.project_id);
  if(!allowedIds.length)return;
  const ids=allowedIds.slice(0,100);const a=await supabase.from('project_supervision_assignments').select('initiative_id,supervisor_id').in('initiative_id',ids);
  const u=await supabase.from('project_activity_entries').select('id,initiative_id,milestone_id,created_at').in('initiative_id',ids).eq('kind','MILESTONE_UPDATE').order('created_at',{ascending:false}).limit(1000);
  const r=await supabase.from('milestone_supervision_events').select('source_activity_id,actor_id').in('initiative_id',ids).in('event_type',['PROGRESS_OK','PROGRESS_FOLLOW_UP','RESULT_OK','RESULT_REVISION']).limit(1000);
  if(!live||a.error||u.error||r.error)return;
  const supervisors=new Map((a.data||[]).map(x=>[x.initiative_id,x.supervisor_id]));
  const seen=new Set<string>();const unreviewed=(u.data||[]).filter(x=>{const k=x.initiative_id+'-'+x.milestone_id;if(seen.has(k))return false;seen.add(k);const target=supervisors.get(x.initiative_id);return target&&Date.now()-new Date(x.created_at).getTime()>=48*3600000&&!(r.data||[]).some(z=>z.source_activity_id===x.id&&z.actor_id===target)});
  if(live)setSupervisionCount(unreviewed.length);
 }).catch(e=>{if(live){setError(e?.message||'تعذر جلب قائمة المشاريع.');setBusy(false)}});return()=>{live=false};},[profile?.id,profile?.secretariat_id,profile?.role,hasSupervision,tab]);
 useEffect(()=>{setOwnersOpen(false);setSupervisorsOpen(false)},[tab]);
 useEffect(()=>{const dismiss=(e:PointerEvent)=>{if(!ownerWrap.current?.contains(e.target as Node))setOwnersOpen(false);if(!supervisorWrap.current?.contains(e.target as Node))setSupervisorsOpen(false)};
  const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOwnersOpen(false);setSupervisorsOpen(false)}};
  document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',esc);
  return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',esc)};
 },[]);
 useEffect(()=>{if(!rows.length)return;let live=true;const ids=rows.map(x=>x.project_id);
  (async()=>{const pairs:Record<string,string>={};for(let i=0;i<ids.length;i+=80){const {data,error}=await supabase.from('project_supervision_assignments').select('initiative_id,supervisor_id').in('initiative_id',ids.slice(i,i+80));if(error)throw error;for(const x of data||[])pairs[x.initiative_id]=x.supervisor_id;}if(live)setProjectSupervisors(pairs)})().catch(e=>{if(live)setError('تعذر جلب بيانات المتابعين: '+e.message)});
  return()=>{live=false};
 },[rows]);
 const supervisors=useMemo(()=>{const direct=rows.map(r=>[r.secretary_id||'',r.secretary_name||'السكرتير'] as const);const delegated=Object.values(projectSupervisors).map(id=>[id,rows.find(r=>r.lead_id===id)?.lead_name||id] as const);return Array.from(new Map<string,string>([...direct,...delegated].filter(x=>!!x[0]) as [string,string][]).entries()).map(([id,name])=>({id,name}));},[rows,projectSupervisors]);
 const candidates=useMemo(()=>Array.from(new Map(rows.map(r=>[r.lead_id,{id:r.lead_id,name:r.lead_name||'بدون اسم'}])).values()).sort((a,b)=>a.name.localeCompare(b.name,'ar')),[rows]);
 const filtered=useMemo(()=>rows.filter(r=>{
  if(q&&!`${r.project_title} ${r.lead_name||''} ${r.result_statement||''}`.toLowerCase().includes(q.toLowerCase()))return false;
  if(sec&&r.secretariat_id!==sec)return false;
  if(ownership==='mine'&&r.lead_id!==profile?.id)return false;
  if(ownership==='team'&&r.lead_id===profile?.id)return false;
  if(owners.length&&!owners.includes(r.lead_id))return false;
  if(supervisorIds.length&&!supervisorIds.includes(projectSupervisors[r.project_id]||r.secretary_id||''))return false;
  const first=r.assignment_start_at?new Date(r.assignment_start_at).getTime():0;const last=r.target_due_at?new Date(r.target_due_at).getTime():Infinity;
  if(fromDate&&last<new Date(fromDate+'T00:00:00').getTime())return false;
  if(toDate&&first>new Date(toDate+'T23:59:59').getTime())return false;
  if(status==='PENDING'&&!['PENDING_GS','RETURNED'].includes(r.approval_status))return false;
  if(status==='ACTIVE'&&!(r.approval_status==='APPROVED'&&r.project_status==='ACTIVE'&&r.lifecycle_state!=='POSTPONED'))return false;
  if(status==='POSTPONED'&&r.lifecycle_state!=='POSTPONED')return false;
  if(status==='CANCELLED'&&r.project_status!=='CANCELLED')return false;
  if(status==='DONE'&&r.project_status!=='COMPLETED')return false;
  return true;
 }),[rows,q,sec,status,owners,ownership,profile?.id,projectSupervisors,supervisorIds,fromDate,toDate]);
 function csv(){exportCsv('KMSA-projects-filtered',filtered.map(r=>({name:r.project_title,leader:r.lead_name,secretariat:r.secretariat_name,start:r.assignment_start_at||'',end:r.target_due_at||'',update:r.latest_update_note||r.last_lead_note||'',result:r.result_statement||'',state:r.project_status})),[
   {key:'name',label:'المشروع'},{key:'secretariat',label:'السكرتارية'},{key:'leader',label:'مسؤول التنفيذ'},
   {key:'start',label:'البداية'},{key:'end',label:'النهاية'},{key:'update',label:'آخر تحديث'}, {key:'result',label:'النتيجة'}, {key:'state',label:'الحالة'}]);}
 function printReport(){
  const safe=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
  const data=filtered.map(r=>`<tr><td>${safe(r.project_title)}</td><td>${safe(r.lead_name)}</td><td>${safe(r.assignment_start_at?.slice(0,10))}</td><td>${safe(r.target_due_at?.slice(0,10))}</td><td>${safe(r.latest_update_note||r.last_lead_note)}</td><td>${safe(r.result_statement)}</td><td>${safe(r.project_status)}</td></tr>`).join('');
  const win=window.open('','_blank','width=1080,height=800');if(!win){setError('متصفحك منع فتح التقرير. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');return}
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>تقرير المشاريع</title><style>@page{size:A4 landscape;margin:13mm}body{font:12px/1.75 Arial,sans-serif;color:#25362b}header{border-bottom:3px solid #853149;padding-bottom:12px;margin-bottom:16px}header h1{margin:0;font-size:23px}header p{margin:5px 0;color:#52635a}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #dce2dc;vertical-align:top;padding:8px;overflow-wrap:anywhere;white-space:pre-wrap}thead{display:table-header-group}th{background:#f0f3ef}tr{break-inside:avoid}footer{margin-top:16px;color:#6c766e;font-size:10px}@media print{button{display:none}}</style></head><body><header><h1>رابطة طلاب كلية الطب — جامعة الخرطوم</h1><p>تقرير سير المشاريع · ${safe(profile?.secretariat?.name_ar||'المشاريع')} · ${filtered.length} مشروع · ${safe(new Date().toLocaleDateString('ar-SD'))}</p></header><table><thead><tr><th>المشروع</th><th>المسؤول</th><th>بداية المشروع</th><th>الموعد</th><th>آخر تحديث</th><th>النتيجة</th><th>الحالة</th></tr></thead><tbody>${data}</tbody></table><footer>تقرير يعتمد على البيانات المسجلة والفلاتر الحالية. يُرجى حفظه PDF باستخدام أمر الطباعة.</footer><script>window.addEventListener('load',()=>{window.print()})<\/script></body></html>`);
  win.document.close();
 }
 const stateFor=(r:ProjectSheetRow)=>r.approval_status!=='APPROVED'?{label:approvalLabel[r.approval_status]||r.approval_status,tone:'pending'}:r.lifecycle_state==='POSTPONED'?{label:'مؤجل',tone:'postponed'}:r.project_status==='COMPLETED'?{label:'مغلق بنجاح',tone:'succeeded'}:r.project_status==='CANCELLED'?{label:'ملغى',tone:'cancelled'}:r.health==='BLOCKED'?{label:'متعثر',tone:'blocked'}:r.health==='AT_RISK'?{label:'مهدد',tone:'risk'}:{label:'جارٍ العمل',tone:'active'};
 return <div className="workspace-stack workspace-data-page v57-project-index" dir="rtl">
  {hasSupervision&&<nav className="v57-project-tabs" aria-label="أقسام المشاريع">
   <button className={tab==='projects'?'active':''} onClick={()=>setParams({})}>سير المشاريع</button>
   <button className={tab==='supervision'?'active':''} onClick={()=>setParams({tab:'supervision'})}>متابعة الإشراف{supervisionCount>0&&<b className="v57-count-dot">{supervisionCount}</b>}</button>
   <button className={tab==='decisions'?'active':''} onClick={()=>setParams({tab:'decisions'})}>قرارات المشاريع{pendingDecisions>0&&<b className="v57-count-dot">{pendingDecisions}</b>}</button>
  </nav>}
  {error&&<div role="alert" className="member-form-error">{error}</div>}
  {tab==='supervision'&&hasSupervision?<WorkspaceSupervisionPage/>:tab==='decisions'&&hasSupervision?<WorkspaceProjectDecisionsPage/>:<>
  <header className="workspace-page-head v57-project-heading"><div><span className="workspace-kicker">المشاريع / متابعة التنفيذ</span><h1>{isMember?'مشاريعي':profile?.role==='SECRETARY'?'مشاريع السكرتارية':'المشاريع'}</h1><p>من المسؤول؟ ما آخر ما تحقق؟ ومتى يستحق التدخل؟</p></div><div className="workspace-head-actions">{canCreate&&<Link className="workspace-primary" to="/workspace/projects/new"><Plus size={16}/>مشروع جديد</Link>}</div></header>
  <section className="workspace-card v57-project-table-panel"><div className="v57-project-filters">
   <label className="workspace-search"><Search size={17}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ابحث عن مشروع أو مسؤول أو نتيجة"/></label>
   <div className="v57-filters"><button className={ownership==='all'?'active':''} onClick={()=>setOwnership('all')}>الكل</button><button className={ownership==='mine'?'active':''} onClick={()=>setOwnership('mine')}>المسؤول عنها أنا</button>{!isMember&&<button className={ownership==='team'?'active':''} onClick={()=>setOwnership('team')}>مسؤولية الآخرين</button>}</div>
   {!isMember&&<div className="v57-owner-picker" ref={ownerWrap}><button className="workspace-secondary small" onClick={()=>{setSupervisorsOpen(false);setOwnersOpen(v=>!v)}}>المسؤولون {owners.length>0?`(${owners.length})`:''}</button>{ownersOpen&&<div className="v57-owner-options"><strong>اختر أكثر من مسؤول</strong>{candidates.map(o=><label key={o.id}><input type="checkbox" checked={owners.includes(o.id)} onChange={e=>setOwners(v=>e.target.checked?[...v,o.id]:v.filter(x=>x!==o.id))}/>{o.name}</label>)}<button className="workspace-secondary small" onClick={()=>{setOwners([]);setOwnersOpen(false)}}>إزالة الاختيار</button></div>}</div>}
   {!isMember&&<div className="v57-owner-picker" ref={supervisorWrap}><button className="workspace-secondary small" onClick={()=>{setOwnersOpen(false);setSupervisorsOpen(v=>!v)}}>المشرفون {supervisorIds.length?`(${supervisorIds.length})`:''}</button>{supervisorsOpen&&<div className="v57-owner-options"><strong>المشرف المتابع</strong>{supervisors.map(x=><label key={x.id}><input type="checkbox" checked={supervisorIds.includes(x.id)} onChange={e=>setSupervisorIds(v=>e.target.checked?[...v,x.id]:v.filter(id=>id!==x.id))}/>{x.name}</label>)}<button className="workspace-secondary small" onClick={()=>{setSupervisorIds([]);setSupervisorsOpen(false)}}>مسح الفلتر</button></div>}</div>}
   {global&&<select className="select compact-filter" aria-label="السكرتارية" value={sec} onChange={e=>setSec(e.target.value)}><option value="">كل السكرتاريات</option>{secs.map(s=><option key={s.id} value={s.id}>{s.name_ar}</option>)}</select>}
   <select className="select compact-filter" aria-label="حالة المشروع" value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">جميع الحالات</option><option value="ACTIVE">جارٍ العمل</option><option value="PENDING">بانتظار الاعتماد</option><option value="DONE">مغلق بنجاح</option><option value="POSTPONED">مؤجل</option><option value="CANCELLED">ملغى</option></select><label className="v58-filter-date">من <input type="date" aria-label="من تاريخ" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label><label className="v58-filter-date">إلى <input type="date" aria-label="إلى تاريخ" value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
   {(owners.length>0||supervisorIds.length>0||status!=='ALL'||fromDate||toDate||q)&&<button className="workspace-secondary small" onClick={()=>{setOwners([]);setSupervisorIds([]);setStatus('ALL');setFromDate('');setToDate('');setQ('')}}>مسح الفلاتر</button>}
   <span className="workspace-filter-count">{filtered.length} مشروع</span>
   <button className="workspace-secondary small" disabled={!filtered.length} onClick={csv}><FileSpreadsheet size={14}/> Excel/CSV</button><button className="workspace-secondary small" disabled={!filtered.length} onClick={printReport}><Printer size={14}/> PDF</button>
  </div><div className="workspace-sheet-wrap"><table className="workspace-sheet v57-project-sheet"><thead><tr>{global&&<th>السكرتارية</th>}<th>المشروع</th><th>المسؤول</th><th>آخر ما تحقق / النتيجة</th><th>المحطة الحالية</th><th>الموعد</th><th>الحالة</th><th></th></tr></thead><tbody>
   {filtered.map(r=>{const s=stateFor(r);return <tr key={r.project_id}>{global&&<td>{r.secretariat_name}</td>}<td><Link to={`/workspace/projects/${r.project_id}`}><strong>{r.project_title}</strong></Link><small>{approvalLabel[r.approval_status]||''}</small></td><td><strong>{r.lead_name||'—'}</strong><small>{r.secretary_name?`السكرتير: ${r.secretary_name}`:''}</small></td><td className="v57-output-cell">{r.latest_update_note||r.last_lead_note||r.result_statement||'لم يُسجّل تحديث بعد'}</td><td><strong>{r.current_milestone||'—'}</strong><small>{r.current_milestone_status?milestoneStatusLabel[r.current_milestone_status as keyof typeof milestoneStatusLabel]||r.current_milestone_status:''}</small></td><td>{formatDate(r.current_milestone_due_at||r.target_due_at)}{r.current_milestone_overdue&&r.lifecycle_state!=='POSTPONED'&&<small className="danger-text">محطة تجاوزت الموعد</small>}</td><td><span className={`v57-lifecycle status-${s.tone}`}>{s.label}</span></td><td><Link className="v55-row-link" to={`/workspace/projects/${r.project_id}`}>فتح <ArrowLeft size={14}/></Link></td></tr>})}
   {!filtered.length&&<tr><td colSpan={global?8:7}><div className="workspace-empty"><Target/>{busy?'جارٍ تحميل المشاريع…':'لا توجد مشاريع بهذا الاختيار.'}</div></td></tr>}
  </tbody></table></div></section></>}
 </div>;
}
