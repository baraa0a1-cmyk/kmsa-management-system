/** KMSA v6.4: ONE read model for the projects list, supervision screen and tab counter.
 * All queries are scoped to projects already visible to the caller and constrained by RLS.
 * Schedules are authored by the workflow, never by browser code.
 */
import { supabase } from './supabase';
import type { ProjectSheetRow } from './types';

export type FollowupSchedule={milestone_id:string;initiative_id:string;interval_hours:number;next_due_at:string;last_report_at:string|null};
export type FollowupActivity={id:string;initiative_id:string;milestone_id:string;created_at:string;note:string|null;status_after:string|null;details?:Record<string,unknown>};
export type FollowupReview={id:string;milestone_id:string;source_activity_id:string|null;actor_id:string;event_type:string;note:string|null;correction_due_at:string|null;created_at:string};
export type FollowupRequest={id:string;source_activity_id:string;delegated_supervisor_id:string;review_request_attempt:number|null;action_kind?:string;followup_due_at:string;created_at:string};
export type FollowupItem={
 project:ProjectSheetRow; milestoneId:string;milestoneTitle:string;milestoneDueAt:string|null;
 schedule:FollowupSchedule|null; update:FollowupActivity|null; review:FollowupReview|null;
 supervisorId:string; supervisorName:string; delegated:boolean; requests:FollowupRequest[];
 issue:'NO_REPORT'|'UNREVIEWED'|'CORRECTION_OVERDUE'|'CORRECTING'|'ON_TRACK'|'AWAITING_REPORT'|'PLANNED'|'RESULT_REVIEW'|'RESULT_ACCEPTED';
 secretaryAction:'REQUEST_UPDATE'|'REQUEST_REVIEW'|'ESCALATE'|'CHECK_CORRECTION'|null;reportIsLate:boolean;
 reviewDueAt:string|null; correctionDueAt:string|null;
};
export type FollowupSnapshot={items:FollowupItem[]; secretaryActions:FollowupItem[]; reviewPending:FollowupItem[]; reportLate:FollowupItem[]};

const complete=(s:string|null)=>['READY_FOR_VERIFICATION','VERIFIED','CANCELLED'].includes(s||'');
const time=(s:string|null|undefined)=>s?new Date(s).getTime():NaN;
export const reviewerGraceHours=(schedule:FollowupSchedule|null)=>Math.max(4,Math.min(24,Math.round((schedule?.interval_hours||48)/4)));
export const reviewDueAt=(activity:FollowupActivity,schedule:FollowupSchedule|null)=>new Date(time(activity.created_at)+reviewerGraceHours(schedule)*3600000).toISOString();

// A chunk may contain >1000 historical events: read every page. Never produce false zero counts.
async function readAll(table:string, select:string, ids:string[], filters?:(q:any)=>any, sortColumn='created_at'){
 const output:any[]=[];
 for(let i=0;i<ids.length;i+=40){
  for(let page=0;;page++){
   let q=supabase.from(table as any).select(select).in('initiative_id',ids.slice(i,i+40));
   if(filters)q=filters(q);
   q=q.order(sortColumn,{ascending:false}).range(page*700,(page+1)*700-1);
   const {data,error}=await q;
   if(error)throw new Error(`تعذر قراءة ${table}: ${error.message}`);
   const part=(data||[]) as any[];output.push(...part);
   if(part.length<700)break;
  }
 }
 return output;
}

export async function loadProjectFollowup(projects:ProjectSheetRow[], secretaryId:string):Promise<FollowupSnapshot>{
 const active=projects.filter(p=>p.approval_status==='APPROVED'&&p.setup_status==='ACTIVE'&&p.project_status!=='COMPLETED'&&p.project_status!=='CANCELLED'&&p.lifecycle_state!=='POSTPONED');
 if(!active.length)return {items:[],secretaryActions:[],reviewPending:[],reportLate:[]};
 const ids=active.map(p=>p.project_id);const projectById=new Map(active.map(p=>[p.project_id,p]));
 const [assignments, schedules, activities,reviews,requests]=await Promise.all([
  readAll('project_supervision_assignments','initiative_id,supervisor_id,assigned_at,supervisor:profiles!project_supervision_assignments_supervisor_id_fkey(full_name)',ids,undefined,'assigned_at'),
  readAll('milestone_followup_schedules','milestone_id,initiative_id,interval_hours,next_due_at,last_report_at',ids,undefined,'next_due_at'),
  // Pending result reviews have no active check-in schedule; include all milestones.
  readAll('project_activity_entries','id,initiative_id,milestone_id,created_at,note,status_after,details',ids,q=>q.eq('kind','MILESTONE_UPDATE')),
  readAll('milestone_supervision_events','id,initiative_id,milestone_id,source_activity_id,actor_id,event_type,note,correction_due_at,created_at',ids,q=>q.in('event_type',['PROGRESS_OK','PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_OK','RESULT_REVISION'])),
  readAll('project_supervision_followups','id,initiative_id,source_activity_id,delegated_supervisor_id,review_request_attempt,action_kind,followup_due_at,created_at',ids,q=>q)
 ]);
 // Milestones are retrieved via results IDs of scoped projects (never a global scan).
 const results=await readAll('results','id,initiative_id',ids,undefined,'created_at');
 const resultIds=results.map(r=>r.id as string);const mrows:any[]=[];
 for(let i=0;i<resultIds.length;i+=40){for(let page=0;;page++){
  const {data,error}=await supabase.from('milestones').select('id,result_id,title,due_at,status,design_status').in('result_id',resultIds.slice(i,i+40)).order('sequence_no',{ascending:true}).range(page*700,(page+1)*700-1);
  if(error)throw new Error('تعذر قراءة محطات المتابعة: '+error.message);
  const part=data||[];mrows.push(...part);if(part.length<700)break;
 }}
 const projectForResult=new Map(results.map(r=>[r.id as string,projectById.get(r.initiative_id as string)]));
 const assignmentsByProject=new Map(assignments.map(a=>[a.initiative_id as string,a]));
 const schedulesByMilestone=new Map(schedules.map(s=>[s.milestone_id as string,s as FollowupSchedule]));
 const latestByMilestone=new Map<string,FollowupActivity>();
 // readAll sorts each chunk separately; pick max timestamp explicitly.
 for(const a of activities as FollowupActivity[])if(a.milestone_id&&(!latestByMilestone.has(a.milestone_id)||time(a.created_at)>time(latestByMilestone.get(a.milestone_id)!.created_at)))latestByMilestone.set(a.milestone_id,a);
 const reviewedBySource=new Map<string,FollowupReview>();
 for(const r of reviews as FollowupReview[])if(r.source_activity_id){const key=r.source_activity_id+':'+r.actor_id;
  if(!reviewedBySource.has(key)||time(r.created_at)>time(reviewedBySource.get(key)!.created_at))reviewedBySource.set(key,r);
 }
 const requestsBySource=new Map<string,FollowupRequest[]>();
 for(const r of requests as FollowupRequest[]){const key=r.source_activity_id+':'+r.delegated_supervisor_id;requestsBySource.set(key,[...(requestsBySource.get(key)||[]),r]);}
 const now=Date.now();const items:FollowupItem[]=[];
 for(const m of mrows){
  if(m.design_status==='REJECTED'||m.status==='VERIFIED'||m.status==='CANCELLED')continue;
  const project=projectForResult.get(m.result_id);if(!project)continue;
  const a=assignmentsByProject.get(project.project_id);
  const supervisorId=a?.supervisor_id||project.secretary_id||secretaryId;
  const delegated=!!a?.supervisor_id&&a.supervisor_id!==project.secretary_id;
  const activity=latestByMilestone.get(m.id)||null;
  const schedule=schedulesByMilestone.get(m.id)||null;
  // An assignment is not responsible for reports submitted before delegation.
  const accountable=!!activity&&(!a?.assigned_at||time(activity.created_at)>=time(a.assigned_at));
  const review=accountable?reviewedBySource.get(activity!.id+':'+supervisorId)||null:null;
  const allFollowups=activity?(requestsBySource.get(activity.id+':'+supervisorId)||[]):[];
  const sourceRequests=allFollowups.filter(x=>x.review_request_attempt!==null).sort((x,y)=>(x.review_request_attempt||0)-(y.review_request_attempt||0));
  const lastCorrection=(reviews as FollowupReview[]).filter(r=>r.milestone_id===m.id&&r.actor_id===supervisorId&&['PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_REVISION'].includes(r.event_type)).sort((x,y)=>time(y.created_at)-time(x.created_at))[0];
  const resultReady=complete(m.status);
  const updateAfterCorrection=!!(lastCorrection&&activity&&time(activity.created_at)>time(lastCorrection.created_at));
  const correctionPending=!!lastCorrection&&!updateAfterCorrection;
  const noReport=!!schedule&&!resultReady&&time(schedule.next_due_at)<now;
  const reviewIsOverdue=!!activity&&!review&&accountable&&time(reviewDueAt(activity,schedule))<=now;
  let issue:FollowupItem['issue']='ON_TRACK';let action:FollowupItem['secretaryAction']=null;
  if(correctionPending){issue=time(lastCorrection.correction_due_at)<now?'CORRECTION_OVERDUE':'CORRECTING';if(issue==='CORRECTION_OVERDUE')action='CHECK_CORRECTION';}
  else if(activity&&!review){issue=resultReady?'RESULT_REVIEW':'UNREVIEWED';if(reviewIsOverdue)action=delegated?'REQUEST_REVIEW':null;}
  else if(noReport){issue='NO_REPORT';action='REQUEST_UPDATE';}
  else if(!activity){issue=schedule?'AWAITING_REPORT':'PLANNED';}
  else if(resultReady&&review?.event_type==='RESULT_OK'){issue='RESULT_ACCEPTED';}
  // The second reminder deadline is actionable even though the earlier reminder is already logged.
  if(action==='REQUEST_REVIEW'&&sourceRequests.length){
   const last=sourceRequests[sourceRequests.length-1];
   if(time(last.followup_due_at)>now)action=null;
   else if(sourceRequests.length>=2){const followup=allFollowups.filter(x=>x.review_request_attempt===null).sort((x,y)=>time(y.created_at)-time(x.created_at))[0];action=followup&&time(followup.followup_due_at)>now?null:'ESCALATE';}
  }
  // Never allow a count of a direct review to be doubled as a secretary 'chase a delegate' action.
  items.push({project,milestoneId:m.id,milestoneTitle:m.title,milestoneDueAt:m.due_at,schedule,update:activity,review,
   supervisorId,supervisorName:a?.supervisor?.full_name||project.secretary_name||'السكرتير',delegated,requests:sourceRequests,reportIsLate:noReport,
   issue,secretaryAction:action,reviewDueAt:activity?reviewDueAt(activity,schedule):null,correctionDueAt:lastCorrection?.correction_due_at||null});
 }
 const secretaryActions=items.filter(x=>!!x.secretaryAction).sort((a,b)=>time(a.schedule?.next_due_at||a.update?.created_at||'')-time(b.schedule?.next_due_at||b.update?.created_at||''));
 return {items,secretaryActions,reviewPending:items.filter(x=>!!x.update&&!x.review),reportLate:items.filter(x=>x.reportIsLate)};
}

export const followupIssueLabel:Record<FollowupItem['issue'],string>={NO_REPORT:'الإفادة متأخرة',UNREVIEWED:'بانتظار تقييم المستجد',CORRECTION_OVERDUE:'انتهى موعد التصحيح',CORRECTING:'تحت التصحيح',ON_TRACK:'تحت المتابعة',AWAITING_REPORT:'بانتظار أول إفادة',PLANNED:'محطة لاحقة',RESULT_REVIEW:'النتيجة تنتظر التقييم',RESULT_ACCEPTED:'النتيجة مقبولة'};
