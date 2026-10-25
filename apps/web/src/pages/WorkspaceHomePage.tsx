import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, ListTodo, Plus, RefreshCw, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { proposalTrackingSheet, quickTaskSheet, routineObligationSheet, workspaceProjectSheet } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import type { ProjectSheetRow, ProposalSheetRow, QuickTaskRow, RoutineObligationRow } from '../lib/types';
import { formatDate, profileTitle } from '../lib/labels';

type FocusItem = { key:string; title:string; text:string; route:string; kind:'project'|'task'|'routine'|'proposal'; date:string|null; priority:number };
const doneTask=(s:string)=>['DONE','CANCELLED'].includes(s);

export default function WorkspaceHomePage(){
 const {profile}=useAuth();
 const [projects,setProjects]=useState<ProjectSheetRow[]>([]);
 const [tasks,setTasks]=useState<QuickTaskRow[]>([]);
 const [routines,setRoutines]=useState<RoutineObligationRow[]>([]);
 const [proposals,setProposals]=useState<ProposalSheetRow[]>([]);
 const [loading,setLoading]=useState(true);
 const [errors,setErrors]=useState<string[]>([]);
 const load=useCallback(async()=>{
  setLoading(true);
  const labels=['المشاريع','المهام','العمل الدوري','المقترحات'];
  const result=await Promise.allSettled([workspaceProjectSheet(),quickTaskSheet(),routineObligationSheet(),proposalTrackingSheet()]);
  const failed:string[]=[];
  result.forEach((r,i)=>{if(r.status==='rejected')failed.push(labels[i]);});
  if(result[0].status==='fulfilled')setProjects(result[0].value);
  if(result[1].status==='fulfilled')setTasks(result[1].value as QuickTaskRow[]);
  if(result[2].status==='fulfilled')setRoutines(result[2].value);
  if(result[3].status==='fulfilled')setProposals(result[3].value);
  setErrors(failed);setLoading(false);
 },[]);
 useEffect(()=>{void load()},[load]);
 const role=profile?.role||'MEMBER';
 const memberLike=['MEMBER','APPLICANT'].includes(role);
 const isSecretary=role==='SECRETARY';
 const oversight=['GS','PRESIDENT','ADMIN'].includes(role);
 const myProjects=useMemo(()=>projects.filter(p=>(!memberLike||p.lead_id===profile?.id)&&p.approval_status==='APPROVED'&&p.project_status!=='COMPLETED'&&p.project_status!=='CANCELLED'),[projects,memberLike,profile?.id]);
 const myTasks=useMemo(()=>tasks.filter(t=>!memberLike||t.assignee_id===profile?.id),[tasks,memberLike,profile?.id]);
 const myRoutines=useMemo(()=>routines.filter(r=>!memberLike||r.owner_id===profile?.id),[routines,memberLike,profile?.id]);
 const myProposals=useMemo(()=>{
  if(memberLike)return [];
  return proposals.filter(p=>isSecretary?['WITH_SECRETARY','REVISED'].includes(p.status):role==='GS'?p.status==='WITH_GS':oversight&&['WITH_SECRETARY','REVISED','WITH_GS'].includes(p.status));
 },[proposals,memberLike,isSecretary,role,oversight]);
 const priority=useMemo(()=>{
  const list:FocusItem[]=[];
  if(!memberLike){for(const p of projects){
   if(oversight&&p.approval_status==='PENDING_GS')list.push({key:`approve-${p.project_id}`,kind:'project',title:p.project_title,route:`/workspace/projects/${p.project_id}`,date:p.assignment_start_at,text:'قرار التكليف ينتظر اعتماد GS قبل بدء التنفيذ',priority:0});
   else if(isSecretary&&p.approval_status==='RETURNED')list.push({key:`returned-${p.project_id}`,kind:'project',title:p.project_title,route:`/workspace/projects/${p.project_id}`,date:p.target_due_at,text:'أعيد قرار التكليف للمراجعة والتصحيح',priority:0});
  }}
  for(const p of myProjects){
   if(!p.current_milestone_overdue&&!p.open_blockers&&!p.secretary_response_needed)continue;
   const isOwner=memberLike;
   list.push({key:`p-${p.project_id}`,kind:'project',title:p.project_title,route:`/workspace/projects/${p.project_id}`,date:p.current_milestone_due_at,
    text:p.secretary_response_needed&&!isOwner?'عائق أو تأخر يحتاج استجابة جديدة من السكرتير':p.open_blockers>0?'يوجد عائق لم يحل بعد':p.current_milestone_overdue?'محطة إنجاز متأخرة':'يحتاج متابعة مبكرة',
    priority:p.secretary_response_needed&&!isOwner?0:p.current_milestone_overdue?1:p.open_blockers>0?2:4});
  }
  for(const t of myTasks){if(doneTask(t.status))continue;
   if(!t.overdue&&!['BLOCKED','WAITING_EXTERNAL'].includes(t.status)&&!(t.days_to_due!==null&&t.days_to_due<=1))continue;
   list.push({key:`t-${t.task_id}`,kind:'task',title:t.title,route:'/workspace/tasks',date:t.due_at,
    text:t.overdue?'الموعد تجاوز دون إكمال':t.status==='BLOCKED'?'مهمة متعثرة':t.status==='WAITING_EXTERNAL'?'تحتاج متابعة طرف آخر':'موعد المهمة قريب',priority:t.overdue?1:3});
  }
  for(const r of myRoutines){if(!r.overdue&&r.days_to_due>2&&!['BLOCKED','AT_RISK'].includes(r.last_status||''))continue;
   list.push({key:`r-${r.obligation_id}`,kind:'routine',title:r.title,route:'/workspace/routine',date:r.next_due_at,
    text:r.overdue?'تقرير/مخرج دوري متأخر':r.last_status==='BLOCKED'?'العمل الدوري متعثر':'استحقاق دوري قريب',priority:r.overdue?1:4});
  }
  for(const p of myProposals){list.push({key:`q-${p.proposal_id}`,kind:'proposal',title:p.title,route:`/workspace/proposals/${p.proposal_id}`,date:p.stage_due_at,
   text:p.overdue?`تجاوز المقترح مدة الاستجابة · ${p.days_in_current_stage} يوم`:`ينتظر إجراءً · ${p.days_in_current_stage} يوم في المرحلة`,priority:p.overdue?1:5});}
  return list.sort((a,b)=>a.priority-b.priority||(a.date||'9999').localeCompare(b.date||'9999')).slice(0,9);
 },[myProjects,myTasks,myRoutines,myProposals,memberLike,projects,oversight,isSecretary]);
 if(!profile)return null;
 return <div className="workspace-stack workspace-home-v3">
  <section className="workspace-home-hero"><div><span className="workspace-kicker">المتابعة والتنفيذ</span><h1>{memberLike?'ما يحتاج منك الآن':profileTitle(profile)}</h1>
   <p>{memberLike?'حدّث العمل أولًا بأول، حتى لو لم يقترب الموعد النهائي.':isSecretary?'ما الذي تعثر؟ من المسؤول؟ وما الذي يحتاج تدخلك؟':'المشكلات والالتزامات التي تحتاج قرارًا أو متابعة، عبر السكرتاريات.'}</p></div>
   {isSecretary&&<div className="workspace-head-actions"><Link className="workspace-primary" to="/workspace/projects/new"><Plus size={16}/>مشروع بنتيجة</Link><Link className="workspace-secondary" to="/workspace/tasks"><ListTodo size={16}/>مهمة بسيطة</Link></div>}
  </section>
  {errors.length>0&&<div className="workspace-card v5-load-alert" role="alert"><AlertTriangle size={18}/><span>تعذر تحميل: {errors.join('، ')}. النتائج الظاهرة قد تكون غير مكتملة، فلا تعتمد عليها لاتخاذ قرار.</span><button className="workspace-secondary" onClick={()=>void load()}>إعادة التحميل</button></div>}
  <section className="workspace-focus-card"><div className="workspace-focus-head"><div><span>الأولوية الآن</span><h2>{loading?'جارٍ جلب المتابعة…':priority.length?`${priority.length} أمور تحتاج انتباهًا`:'لا توجد مخالفات أو استحقاقات عاجلة ظاهرة'}</h2></div>{priority.length?<AlertTriangle/>:<CheckCircle2/>}</div>
   {!loading&&priority.length>0&&<div className="workspace-focus-list">{priority.map(item=><Link key={item.key} to={item.route}><div className={`workspace-focus-icon ${item.kind}`}>{item.kind==='project'?<Target/>:item.kind==='task'?<ListTodo/>:item.kind==='routine'?<RefreshCw/>:<FileText/>}</div><div><strong>{item.title}</strong><span>{item.text}</span><small className="v54-action-prompt">الإجراء: افتح {item.kind==='project'?'المشروع وحدد المحطة التي تحتاج إجراءً':item.kind==='proposal'?'المقترح واتخذ القرار':item.kind==='task'?'المهمة وحدّث حالتها':'العمل الدوري وسجّل المخرج'}</small>{item.date&&<small>موعد: {formatDate(item.date)}</small>}</div><ArrowLeft size={16}/></Link>)}</div>}
   {!loading&&priority.length===0&&errors.length===0&&<p className="v5-focus-empty">لا يعني ذلك اكتمال كل العمل. راجع المشاريع الجارية والتحديثات الدورية أدناه.</p>}
  </section>
  <section className="workspace-home-columns three">
   <div className="workspace-card home-v3-panel"><div className="workspace-card-head"><div><h2>المشاريع</h2><p>النتيجة والتقدم والدليل</p></div><Link to="/workspace/projects">فتح <ArrowLeft size={14}/></Link></div><div className="home-v3-list">{myProjects.slice(0,5).map(p=><Link key={p.project_id} to={`/workspace/projects/${p.project_id}`}><Target/><div><strong>{p.project_title}</strong><span>{p.lead_name}{oversight?` · ${p.secretariat_name}`:''}</span><small>{p.current_milestone_overdue?'محطة إنجاز متأخرة':p.current_milestone?`المحطة: ${p.current_milestone}`:`الموعد النهائي ${formatDate(p.target_due_at)}`}</small></div></Link>)}{!myProjects.length&&<div className="workspace-empty-inline">لا توجد مشاريع نشطة.</div>}</div></div>
   <div className="workspace-card home-v3-panel"><div className="workspace-card-head"><div><h2>المهام</h2><p>تكليفات قصيرة وواضحة</p></div><Link to="/workspace/tasks">فتح <ArrowLeft size={14}/></Link></div><div className="home-v3-list">{myTasks.filter(x=>!doneTask(x.status)).slice(0,5).map(t=><Link key={t.task_id} to="/workspace/tasks"><ListTodo/><div><strong>{t.title}</strong><span>{t.assignee_name}{oversight?` · ${t.secretariat_name}`:''}</span><small>{t.overdue?'متأخرة':t.due_at?formatDate(t.due_at):'لا موعد محدد'}</small></div></Link>)}{!myTasks.some(x=>!doneTask(x.status))&&<div className="workspace-empty-inline">لا توجد مهام جارية.</div>}</div></div>
   <div className="workspace-card home-v3-panel"><div className="workspace-card-head"><div><h2>العمل الدوري</h2><p>تقرير شخصي لكل استحقاق</p></div><Link to="/workspace/routine">فتح <ArrowLeft size={14}/></Link></div><div className="home-v3-list">{myRoutines.slice(0,5).map(r=><Link key={r.obligation_id} to="/workspace/routine"><RefreshCw/><div><strong>{r.title}</strong><span>{r.owner_name}{oversight?` · ${r.secretariat_name}`:''}</span><small>{r.overdue?'متأخر':`القادم: ${formatDate(r.next_due_at)}`}</small></div></Link>)}{!myRoutines.length&&<div className="workspace-empty-inline">لا يوجد عمل دوري مفعّل.</div>}</div></div>
  </section>
  {!memberLike&&<section className="workspace-card home-v3-panel"><div className="workspace-card-head"><div><h2>المقترحات بانتظار إجراء</h2><p>يظهر زمن بقاء المقترح عند الجهة المعنية</p></div><Link to="/workspace/proposals">فتح المقترحات <ArrowLeft size={14}/></Link></div><div className="home-v3-proposals">{myProposals.slice(0,6).map(p=><Link key={p.proposal_id} to={`/workspace/proposals/${p.proposal_id}`}><FileText/><div><strong>{p.title}</strong><span>{p.overdue?'تجاوز مهلة الاستجابة':`في المرحلة منذ ${p.days_in_current_stage} يوم`}</span></div><small>{oversight?p.secretariat_name:''}</small></Link>)}{!myProposals.length&&<div className="workspace-empty-inline">لا توجد مقترحات بانتظارك.</div>}</div></section>}
  {oversight&&<div className="workspace-home-links"><Link to="/workspace/oversight">المتابعة العامة والاستثناءات <ArrowLeft size={15}/></Link><Link to="/workspace/reports">استخراج تقرير من البيانات <ArrowLeft size={15}/></Link></div>}
 </div>
}
