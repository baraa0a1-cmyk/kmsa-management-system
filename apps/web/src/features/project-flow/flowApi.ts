import { supabase } from '../../lib/supabase';
import { workspaceProjectSheet, workspaceProject } from '../../lib/api';
import type { ProjectSheetRow, ProjectBundle } from '../../lib/types';
import {documentationLate,secretaryHasMissedAction,supervisorDueAt} from './flowRules';

export type FlowCheck={id:string; initiative_id:string;actor_id:string;actor_kind:'DELEGATE'|'SECRETARY_DIRECT';assessment:'ON_TRACK'|'SLOW'|'NO_WORK'|'BLOCKED'|'UNVERIFIED'|'WAITING_EXTERNAL';channel:string;note:string|null;next_review_at:string|null;created_at:string};
export type FlowIssue={id:string;initiative_id:string;milestone_id:string|null;responsible_id:string;description:string;due_at:string|null;status:'OPEN'|'RESOLVED'|'CANCELLED';resolution_note:string|null;created_at:string};
export type FlowSecretaryAction={id:string;initiative_id:string;secretary_id:string;reason:string;action_kind:string;outcome_note:string;review_at:string|null;created_at:string};
export type FlowAssignment={initiative_id:string;supervisor_id:string;assigned_at:string;supervisor?:{full_name:string}|null};
export type FlowDecision={id:string;initiative_id:string;requested_by:string;type:'SUCCEEDED'|'CANCELLED'|'POSTPONED';reason:string;requested_at:string;status:string};
export type FlowPause={id:string;initiative_id:string;reason:string;status:string;requested_at?:string;created_at?:string};
export type FlowEntry={project:ProjectSheetRow;assigned:FlowAssignment|null;latestCheck:FlowCheck|null;baseline:string|null;openIssues:FlowIssue[];lastSecretaryAction:FlowSecretaryAction|null;needsCheck:boolean;checkDueAt:string|null;secretaryInaction:boolean;reportStale:boolean;paused:boolean;pendingDecisions:number};

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

export async function loadFlowIndex():Promise<{entries:FlowEntry[];decisions:FlowDecision[];pauses:FlowPause[]}>{
 const projects=await workspaceProjectSheet();
 if(!projects.length)return {entries:[],decisions:[],pauses:[]};
 const ids=projects.map(x=>x.project_id);
 const [assignments,checks,issues,secretaryActions,baselines,decisions,pauses]=await Promise.all([
  fetchMany('project_supervision_assignments',ids,'initiative_id,supervisor_id,assigned_at,supervisor:profiles!project_supervision_assignments_supervisor_id_fkey(full_name)','assigned_at'),
  fetchMany('kmsa_flow_checks',ids,'id,initiative_id,actor_id,actor_kind,assessment,channel,note,next_review_at,created_at'),
  fetchMany('kmsa_flow_issues',ids,'id,initiative_id,milestone_id,responsible_id,description,due_at,status,resolution_note,created_at'),
  fetchMany('kmsa_flow_secretary_actions',ids,'id,initiative_id,secretary_id,reason,action_kind,outcome_note,review_at,created_at'),
  fetchMany('kmsa_flow_baselines',ids,'initiative_id,started_at','started_at'),
  fetchMany('project_closure_requests',ids,'id,initiative_id,requested_by,type,reason,requested_at,status','requested_at'),
  // The v6.5 pause table exists on installations that can use this release.
  fetchMany('project_execution_pauses',ids,'*',null).catch((e:any)=>{if(/does not exist|schema cache|PGRST205|42P01/i.test(e?.message||''))return [];throw e;})
 ]);
 const byProject=<T extends {initiative_id:string}>(xs:T[])=>{const map=new Map<string,T[]>();for(const x of xs)map.set(x.initiative_id,[...(map.get(x.initiative_id)||[]),x]);return map};
 const assignmentsMap=byProject(assignments as FlowAssignment[]),checksMap=byProject(checks as FlowCheck[]),issuesMap=byProject(issues as FlowIssue[]),actionsMap=byProject(secretaryActions as FlowSecretaryAction[]),baselineMap=byProject(baselines as {initiative_id:string;started_at:string}[]),decisionsMap=byProject(decisions as FlowDecision[]),pauseMap=byProject(pauses as FlowPause[]);
 const entries:FlowEntry[]=projects.map(project=>{
  const assigned=assignmentsMap.get(project.project_id)?.[0]||null;
  const actorId=assigned?.supervisor_id||project.secretary_id||'';
  // A newly assigned deputy must not inherit missed checks from before their assignment.
  const relevant=(checksMap.get(project.project_id)||[]).filter(c=>c.actor_id===actorId&&(!assigned?.assigned_at||stamp(c.created_at)>=stamp(assigned.assigned_at)));
  const latestCheck=relevant[0]||null;
  const baseline=baselineMap.get(project.project_id)?.[0]?.started_at||null;
  const due=supervisorDueAt(baseline,assigned?.assigned_at||null,latestCheck);
  const paused=project.lifecycle_state==='POSTPONED'||(pauseMap.get(project.project_id)||[]).some(x=>x.status==='APPROVED'&&(!('pause_until_date' in x)||String((x as any).pause_until_date)>=new Date().toISOString().slice(0,10)));
  const lastSecretaryAction=actionsMap.get(project.project_id)?.[0]||null;
  const needsCheck=flowActive(project)&&!paused&&!!due&&stamp(due)<Date.now();
  const secretaryInaction=needsCheck&&secretaryHasMissedAction({due,now:Date.now(),delegated:!!assigned?.supervisor_id&&assigned.supervisor_id!==project.secretary_id,latestCheck,secretaryAction:lastSecretaryAction});
  // This means "not documented", NOT proof that the student did no actual work.
  const reportStale=flowActive(project)&&!paused&&documentationLate(project.last_lead_update_at,Date.now());
  return {project,assigned,latestCheck,baseline,checkDueAt:due,openIssues:(issuesMap.get(project.project_id)||[]).filter(i=>i.status==='OPEN'),lastSecretaryAction,needsCheck,secretaryInaction,reportStale,paused,pendingDecisions:(decisionsMap.get(project.project_id)||[]).filter(x=>x.status==='PENDING').length+(pauseMap.get(project.project_id)||[]).filter(x=>x.status==='PENDING').length};
 });
 return {entries,decisions:(decisions as FlowDecision[]).filter(x=>x.status==='PENDING'),pauses:(pauses as FlowPause[]).filter(x=>x.status==='PENDING')};
}
export async function loadFlowDetail(id:string):Promise<{bundle:ProjectBundle;checks:FlowCheck[];issues:FlowIssue[];secretaryActions:FlowSecretaryAction[];baseline:string|null}>{
 const [bundle,checks,issues,actions,baselines]=await Promise.all([
  workspaceProject(id),fetchMany('kmsa_flow_checks',[id],'id,initiative_id,actor_id,actor_kind,assessment,channel,note,next_review_at,created_at'),
  fetchMany('kmsa_flow_issues',[id],'id,initiative_id,milestone_id,responsible_id,description,due_at,status,resolution_note,created_at'),
  fetchMany('kmsa_flow_secretary_actions',[id],'id,initiative_id,secretary_id,reason,action_kind,outcome_note,review_at,created_at'),
  fetchMany('kmsa_flow_baselines',[id],'initiative_id,started_at','started_at')
 ]);
 return {bundle,checks:checks as FlowCheck[],issues:issues as FlowIssue[],secretaryActions:actions as FlowSecretaryAction[],baseline:baselines[0]?.started_at||null};
}
export async function flowAction(action:string,payload:Record<string,unknown>){
 const {data,error}=await supabase.functions.invoke('project-flow',{body:{action,payload}});
 if(error){let message=error.message||'تعذر الاتصال';const context=(error as any).context;if(context&&typeof context.clone==='function'){try{const json=await context.clone().json();if(json?.error)message=String(json.error)}catch{}}
  throw new Error(message)}
 if(data?.error)throw new Error(typeof data.error==='string'?data.error:'تعذر حفظ الإجراء');return data;
}
