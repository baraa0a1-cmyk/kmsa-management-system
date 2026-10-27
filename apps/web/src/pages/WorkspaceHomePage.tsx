import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, ListTodo, Plus, RefreshCw, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { proposalTrackingSheet, quickTaskSheet, routineObligationSheet, workspaceProjectSheet } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { loadProjectFollowup } from '../lib/projectFollowup';
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
 const [reviewQueue,setReviewQueue]=useState<FocusItem[]>([]);const [monitorFocus,setMonitorFocus]=useState<FocusItem[]>([]);
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
  if(profile&&result[0].status==='fulfilled'&&['SECRETARY','GS','ADMIN','MEMBER','APPLICANT'].includes(profile.role)){
   let snapshot:Awaited<ReturnType<typeof loadProjectFollowup>>|null=null;
   try{snapshot=await loadProjectFollowup(result[0].value,profile.id);
    const waiting=snapshot.reviewPending.filter(x=>x.supervisorId===profile.id && (x.project.lead_id!==profile.id||(profile.role==='SECRETARY'&&x.project.secretary_id===profile.id))).map(x=>({projectId:x.project.project_id,title:x.project.project_title,milestoneTitle:x.milestoneTitle,milestoneId:x.milestoneId,createdAt:x.update!.created_at,isResult:['READY_FOR_VERIFICATION','VERIFIED'].includes(x.update!.status_after||'')}));
    setReviewQueue(waiting.map(v=>({key:`review-${v.milestoneId}`,kind:'project' as const,title:v.title,route:`/workspace/projects/${v.projectId}?milestone=${v.milestoneId}&action=review`,date:v.createdAt,priority:0,text:`${v.isResult?'نتيجة':'تحديث'} محطة «${v.milestoneTitle}» ينتظر تقييمك. المطلوب: افتح المحطة وقيّم ${v.isResult?'النتيجة':'التقدم'}.`})));
   }catch{failed.push('تقييمات المشاريع');setReviewQueue([])}
   if(profile.role==='SECRETARY'&&snapshot){
    try{
     const projectSeen=new Set<string>();
     setMonitorFocus(snapshot.secretaryActions.filter(x=>x.delegated||x.secretaryAction==='REQUEST_UPDATE').filter(x=>{if(projectSeen.has(x.project.project_id))return false;projectSeen.add(x.project.project_id);return true}).map(x=>({
      key:`monitor-${x.project.project_id}`,kind:'project' as const,title:x.project.project_title,
      route:x.secretaryAction==='REQUEST_UPDATE'?`/workspace/projects/${x.project.project_id}?milestone=${x.milestoneId}&action=request-update`:'/workspace/projects?tab=supervision',
      date:x.schedule?.next_due_at||x.reviewDueAt||x.correctionDueAt||null,
      priority:0,text:x.secretaryAction==='REQUEST_UPDATE'?`لم تصل إفادة «${x.milestoneTitle}» في موعدها`:x.secretaryAction==='REQUEST_REVIEW'?`تأخر تقييم المتابع لمحطة «${x.milestoneTitle}»`:x.secretaryAction==='ESCALATE'?'لم يستجب المتابع بعد طلبي تقييم':'انتهى موعد التصحيح، ويلزم التحقق من الاستجابة'
     })));
    }catch{failed.push('متابعة الإشراف');setMonitorFocus([])}
   }else setMonitorFocus([]);
  }else {setReviewQueue([]);setMonitorFocus([])};
  setErrors(failed);setLoading(false);
 },[profile?.id,profile?.role]);
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
   if(monitorFocus.some(x=>x.key===`monitor-${p.project_id}`))continue;
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
  return [...reviewQueue,...monitorFocus,...list].sort((a,b)=>a.priority-b.priority||(a.date||'9999').localeCompare(b.date||'9999'));
 },[myProjects,myTasks,myRoutines,myProposals,memberLike,projects,oversight,isSecretary,reviewQueue,monitorFocus]);
 if(!profile)return null;
 return <div className="workspace-stack workspace-home-v3">
  <section className="workspace-home-hero"><div><span className="workspace-kicker">المتابعة والتنفيذ</span><h1>{memberLike?'ما يحتاج منك الآن':profileTitle(profile)}</h1>
   <p>{memberLike?'حدّث العمل أولًا بأول، حتى لو لم يقترب الموعد النهائي.':isSecretary?'ما الذي تعثر؟ من المسؤول؟ وما الذي يحتاج تدخلك؟':'المشكلات والالتزامات التي تحتاج قرارًا أو متابعة، عبر السكرتاريات.'}</p></div>
   {isSecretary&&<div className="workspace-head-actions"><Link className="workspace-primary" to="/workspace/projects/new"><Plus size={16}/>مشروع بنتيجة</Link><Link className="workspace-secondary" to="/workspace/tasks"><ListTodo size={16}/>مهمة بسيطة</Link></div>}
  </section>
  {errors.length>0&&<div className="workspace-card v5-load-alert" role="alert"><AlertTriangle size={18}/><span>تعذر تحميل: {errors.join('، ')}. النتائج الظاهرة قد تكون غير مكتملة، فلا تعتمد عليها لاتخاذ قرار.</span><button className="workspace-secondary" onClick={()=>void load()}>إعادة التحميل</button></div>}
  <section className="v55-inbox-heading"><div><span className="v55-eyebrow">العمل المطلوب</span><h2>ماذا ينتظر منك؟</h2><p>كل نوع عمل مستقل. اضغط العنصر لتصل إلى المشروع أو المهمة أو المقترح.</p></div><button type="button" className="workspace-secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>{loading?'جارٍ التحميل…':'تحديث'}</button></section>
  {isSecretary&&<Link className="v55-secretary-link" to="/workspace/supervision"><div className="v55-secretary-symbol"><Target size={22}/></div><div><strong>إشراف السكرتارية</strong><span>تابع المشاريع التي فوضتها للنائب، وآخر التحديثات التي لم يراجعها المتابع.</span></div><ArrowLeft size={18}/></Link>}
  <section className="v55-action-groups">
   {([{kind:'project',title:'المشاريع',description:'المحطات والتعثرات وقرارات المشاريع',icon:Target,route:'/workspace/projects'},
      {kind:'task',title:'المهام',description:'التكليفات القصيرة والمواعيد',icon:ListTodo,route:'/workspace/tasks'},
      {kind:'proposal',title:'المقترحات',description:'قرارات وإجراءات تنتظر الرد',icon:FileText,route:'/workspace/proposals'},
      {kind:'routine',title:'العمل الدوري',description:'الاستحقاقات المتكررة',icon:RefreshCw,route:'/workspace/routine'}] as const).filter(g=>g.kind!=='proposal'||!memberLike).map(group=>{
    const Icon=group.icon;
    const items=priority.filter(x=>x.kind===group.kind);
    return <div className="v55-action-card" key={group.kind}>
     <div className="v55-action-head"><span className={`v55-action-icon ${group.kind}`}><Icon size={18}/></span><div><h3>{group.title}</h3><p>{group.description}</p></div><span className="v55-action-count">{items.length}</span></div>
     <div className="v55-action-list">{loading?<p className="v55-action-empty">جارٍ التحميل…</p>:items.length?items.slice(0,5).map(item=><Link to={item.route} className="v55-action-entry" key={item.key}><div><strong>{item.title}</strong><p>{item.text}</p><small>{item.date?`الموعد: ${formatDate(item.date)} · `:''}افتح العنصر لاتخاذ الإجراء</small></div><ArrowLeft size={16}/></Link>):<p className="v55-action-empty">لا توجد إجراءات مطلوبة حاليًا.</p>}</div>
     <Link to={group.route} className="v55-action-all">عرض كل {group.title} <ArrowLeft size={14}/></Link>
    </div>;
   })}
  </section>
  {oversight&&<div className="workspace-home-links"><Link to="/workspace/oversight">المتابعة العامة والاستثناءات <ArrowLeft size={15}/></Link><Link to="/workspace/reports">استخراج تقرير من البيانات <ArrowLeft size={15}/></Link></div>}
 </div>
}
