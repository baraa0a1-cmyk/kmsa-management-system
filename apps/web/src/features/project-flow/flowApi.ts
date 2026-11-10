import { supabase } from '../../lib/supabase';
import { workspaceProjectSheet, workspaceProject } from '../../lib/api';
import type { ProjectSheetRow, ProjectBundle } from '../../lib/types';
import {documentationLate,secretaryHasMissedAction,supervisorDueAt,incompleteScope,negativeAssessment} from './flowRules';

export type FlowCheck={id:string; initiative_id:string;actor_id:string;actor_kind:'DELEGATE'|'SECRETARY_DIRECT';assessment:'ON_TRACK'|'SLOW'|'NO_WORK'|'BLOCKED'|'UNVERIFIED'|'WAITING_EXTERNAL';channel:string;note:string|null;next_review_at:string|null;milestone_ids:string[];created_at:string};
export type FlowIssue={id:string;initiative_id:string;milestone_id:string|null;responsible_id:string;description:string;due_at:string|null;status:'OPEN'|'RESOLVED'|'CANCELLED';resolution_note:string|null;created_at:string};
export type FlowAssignment={initiative_id:string;supervisor_id:string;assigned_at:string;supervisor?:{full_name:string}|null};
export type FlowDecision={id:string;initiative_id:string;requested_by:string;type:'SUCCEEDED'|'CANCELLED'|'POSTPONED';reason:string;requested_at:string;status:string};
export type FlowPause={id:string;initiative_id:string;reason:string;status:string;requested_at?:string;created_at?:string};
export type FlowEntry={project:ProjectSheetRow;assigned:FlowAssignment|null;latestCheck:FlowCheck|null;baseline:string|null;openIssues:FlowIssue[];activeMilestones:{id:string;title:string;status:string;due_at:string|null}[];totalMilestones:number;verifiedMilestones:number;uncoveredMilestones:string[];needsCheck:boolean;needsAttention:boolean;checkDueAt:string|null;secretaryInaction:boolean;reportStale:boolean;missingBaseline:boolean;paused:boolean;pendingDecisions:number};

export const flowActive=(p:ProjectSheetRow)=>p.approval_status==='APPROVED'&&p.setup_status==='ACTIVE'&&!['COMPLETED','CANCELLED'].includes(p.project_status)&&p.lifecycle_state!=='POSTPONED';
const stamp=(s:string|null|undefined)=>s?new Date(s).getTime():NaN;
export const hoursOverdue=(when:string|null)=>when?Math.max(0,Math.ceil((Date.now()-stamp(when))/3600000)):0;
export const flowLabel=(s:string)=>({ON_TRACK:'التقدم مناسب',SLOW:'التقدم بطيء',NO_WORK:'لم يحدث عمل',BLOCKED:'يوجد عائق',UNVERIFIED:'تعذر التحقق',WAITING_EXTERNAL:'بانتظار جهة خارجية'} as Record<string,string>)[s]||s;
export const formatFlowDate=(s:string|null|undefined)=>s&&!Number.isNaN(stamp(s))?new Intl.DateTimeFormat('ar-SD',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Africa/Khartoum'}).format(new Date(s)):'غير محدد';
export const projectStatus=(p:ProjectSheetRow)=>p.lifecycle_state==='POSTPONED'?'مؤجل':p.project_status==='COMPLETED'?'مغلق بنجاح':p.project_status==='CANCELLED'?'ملغى':p.approval_status!=='APPROVED'?'بانتظار الاعتماد':p.health==='BLOCKED'?'متعثر':p.health==='AT_RISK'?'مهدد':'جارٍ العمل';

async function fetchMany(table:string,ids:string[],cols:string,order:string|null='created_at'){
 const result:any[]=[];
 for(let j=0;j<ids.length;j+=50){
  for(let page=0;;page++){
   let q=supabase.from(table).select(cols).in('initiative_id',ids.slice(j,j+50));
   if(order)q=q.order(order,{ascending:false});
   const {data,error}=await q.range(page*500,(page+1)*500-1);
   if(error)throw new Error(`${table}: ${error.message}`);
   const arr=(data||[]) as any[];result.push(...arr);if(arr.length<500)break;
  }
 }
 return result;
}

async function fetchMilestonesForResults(ids:string[]){
 const rows:{id:string;title:string;status:string;result_id:string;due_at:string|null;design_status:string}[]=[];
 for(let i=0;i<ids.length;i+=50){for(let page=0;;page++){
  const {data,error}=await supabase.from('milestones').select('id,title,status,result_id,due_at,design_status').in('result_id',ids.slice(i,i+50)).order('sequence_no',{ascending:true}).range(page*500,(page+1)*500-1);
  if(error)throw new Error('تعذر تحميل محطات المشاريع: '+error.message);
  rows.push(...(data||[]) as any[]);if((data||[]).length<500)break;
 }}return rows;
}

export async function loadFlowIndex():Promise<{entries:FlowEntry[];decisions:FlowDecision[];pauses:FlowPause[]}>{
 const projects=await workspaceProjectSheet();
 if(!projects.length)return {entries:[],decisions:[],pauses:[]};
 const ids=projects.map(x=>x.project_id);
 const [assignments,checks,issues,baselines,decisions,pauses,results]=await Promise.all([
  fetchMany('project_supervision_assignments',ids,'initiative_id,supervisor_id,assigned_at,supervisor:profiles!project_supervision_assignments_supervisor_id_fkey(full_name)','assigned_at'),
  fetchMany('kmsa_flow_checks',ids,'id,initiative_id,actor_id,actor_kind,assessment,channel,note,next_review_at,milestone_ids,created_at'),
  fetchMany('kmsa_flow_issues',ids,'id,initiative_id,milestone_id,responsible_id,description,due_at,status,resolution_note,created_at'),
  fetchMany('kmsa_flow_baselines',ids,'initiative_id,started_at','started_at'),
  fetchMany('project_closure_requests',ids,'id,initiative_id,requested_by,type,reason,requested_at,status','requested_at'),
  // The v6.5 pause table exists on installations that can use this release.
  fetchMany('project_execution_pauses',ids,'*',null).catch((e:any)=>{if(/does not exist|schema cache|PGRST205|42P01/i.test(e?.message||''))return [];throw e;}),
  fetchMany('results',ids,'id,initiative_id',null)
 ]);
 const milestoneRows=await fetchMilestonesForResults(results.map((x:any)=>x.id));
 const milestoneByResult=new Map<string,typeof milestoneRows>();for(const m of milestoneRows)milestoneByResult.set(m.result_id,[...(milestoneByResult.get(m.result_id)||[]),m]);
 const byProject=<T extends {initiative_id:string}>(xs:T[])=>{const map=new Map<string,T[]>();for(const x of xs)map.set(x.initiative_id,[...(map.get(x.initiative_id)||[]),x]);return map};
 const assignmentsMap=byProject(assignments as FlowAssignment[]),checksMap=byProject(checks as FlowCheck[]),issuesMap=byProject(issues as FlowIssue[]),baselineMap=byProject(baselines as {initiative_id:string;started_at:string}[]),decisionsMap=byProject(decisions as FlowDecision[]),pauseMap=byProject(pauses as FlowPause[]);
 const entries:FlowEntry[]=projects.map(project=>{
  const resultIds=results.filter((r:any)=>r.initiative_id===project.project_id).map((r:any)=>r.id);
  const projectStages=resultIds.flatMap((id:string)=>milestoneByResult.get(id)||[]).filter(m=>m.design_status!=='REJECTED'&&m.status!=='CANCELLED');
  const workStages=projectStages.filter(m=>['IN_PROGRESS','AT_RISK','BLOCKED','READY_FOR_VERIFICATION'].includes(m.status));
  const stageScope=workStages.length?workStages:projectStages.filter(m=>m.status==='NOT_STARTED').sort((a,b)=>Date.parse(a.due_at||'')-Date.parse(b.due_at||'')).slice(0,1);
  const activeMilestones=stageScope.map(({id,title,status,due_at})=>({id,title,status,due_at}));
  const totalMilestones=projectStages.length;const verifiedMilestones=projectStages.filter(m=>m.status==='VERIFIED').length;
  const requiredScope=activeMilestones.map(m=>m.id);
  const assigned=assignmentsMap.get(project.project_id)?.[0]||null;
  const actorId=assigned?.supervisor_id||project.secretary_id||'';
  // A newly assigned deputy must not inherit missed checks from before their assignment.
  const relevant=(checksMap.get(project.project_id)||[]).filter(c=>c.actor_id===actorId&&(!assigned?.assigned_at||stamp(c.created_at)>=stamp(assigned.assigned_at)));
  const latestCheck=relevant[0]||null;
  // Partial-scope checks are retained for history, but never reset the project's 12h due clock.
  const qualifyingCheck=relevant.find(c=>incompleteScope(requiredScope,c.milestone_ids).length===0)||null;
  const uncoveredMilestones=latestCheck?incompleteScope(requiredScope,latestCheck.milestone_ids):requiredScope;
  const baseline=baselineMap.get(project.project_id)?.[0]?.started_at||null;
  const due=supervisorDueAt(baseline,assigned?.assigned_at||null,qualifyingCheck);
  const paused=project.lifecycle_state==='POSTPONED'||(pauseMap.get(project.project_id)||[]).some(x=>x.status==='APPROVED'&&(!('pause_until_date' in x)||String((x as any).pause_until_date)>=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Khartoum'}).format(new Date())));
  const needsCheck=flowActive(project)&&!paused&&!!due&&stamp(due)<Date.now();
  const secretaryInaction=needsCheck&&secretaryHasMissedAction({due,now:Date.now(),delegated:!!assigned?.supervisor_id&&assigned.supervisor_id!==project.secretary_id,latestCheck});
  // This means "not documented", NOT proof that the student did no actual work.
  const reportStale=flowActive(project)&&!paused&&activeMilestones.some(m=>m.status!=='READY_FOR_VERIFICATION')&&documentationLate(project.last_lead_update_at,Date.now(),24,baseline);
  const openIssues=(issuesMap.get(project.project_id)||[]).filter(i=>i.status==='OPEN');
  const unresolvedFinding=negativeAssessment(latestCheck?.assessment)&&(openIssues.length>0||!(issuesMap.get(project.project_id)||[]).length);
  const needsAttention=!paused&&(unresolvedFinding||openIssues.length>0||reportStale||needsCheck||!!project.current_milestone_overdue||!baseline);
  return {project,assigned,latestCheck,baseline,activeMilestones,totalMilestones,verifiedMilestones,uncoveredMilestones,missingBaseline:!baseline,needsAttention,checkDueAt:due,openIssues:(issuesMap.get(project.project_id)||[]).filter(i=>i.status==='OPEN'),needsCheck,secretaryInaction,reportStale,paused,pendingDecisions:(decisionsMap.get(project.project_id)||[]).filter(x=>x.status==='PENDING').length+(pauseMap.get(project.project_id)||[]).filter(x=>x.status==='PENDING').length};
 });
 return {entries,decisions:(decisions as FlowDecision[]).filter(x=>x.status==='PENDING'),pauses:(pauses as FlowPause[]).filter(x=>x.status==='PENDING')};
}
export async function loadFlowDetail(id:string):Promise<{bundle:ProjectBundle;checks:FlowCheck[];issues:FlowIssue[];baseline:string|null}>{
 const [bundle,checks,issues,baselines]=await Promise.all([
  workspaceProject(id),fetchMany('kmsa_flow_checks',[id],'id,initiative_id,actor_id,actor_kind,assessment,channel,note,next_review_at,milestone_ids,created_at'),
  fetchMany('kmsa_flow_issues',[id],'id,initiative_id,milestone_id,responsible_id,description,due_at,status,resolution_note,created_at'),
  fetchMany('kmsa_flow_baselines',[id],'initiative_id,started_at','started_at')
 ]);
 return {bundle,checks:checks as FlowCheck[],issues:issues as FlowIssue[],baseline:baselines[0]?.started_at||null};
}
export async function flowAction(action:string,payload:Record<string,unknown>){
 const {data,error}=await supabase.functions.invoke('project-flow',{body:{action,payload}});
 if(error){let message=error.message||'تعذر الاتصال';const context=(error as any).context;if(context&&typeof context.clone==='function'){try{const json=await context.clone().json();if(json?.error)message=String(json.error)}catch{}}
  throw new Error(message)}
 if(data?.error)throw new Error(typeof data.error==='string'?data.error:'تعذر حفظ الإجراء');return data;
}
