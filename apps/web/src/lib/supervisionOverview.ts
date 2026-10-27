import {supabase} from './supabase';
import {loadProjectFollowup, type FollowupItem} from './projectFollowup';
import type {ProjectSheetRow,ProjectSupervisionClock,SupervisionCheck,SupervisionAction,ProjectExecutionPause,ProjectSupervisionRequest} from './types';
export type SupervisionProject={project:ProjectSheetRow;active:FollowupItem[];supervisorId:string;supervisorName:string;clock:ProjectSupervisionClock|null;lastCheck:SupervisionCheck|null;openActions:SupervisionAction[];pause:ProjectExecutionPause|null;lastRequest:ProjectSupervisionRequest|null;lateChecks:boolean;lateReports:number;pausePending:boolean;isPaused:boolean};
async function rows(table:string,ids:string[],select='*'){
 const values:any[]=[];for(let i=0;i<ids.length;i+=40){for(let page=0;;page++){
  const {data,error}=await supabase.from(table as any).select(select).in('initiative_id',ids.slice(i,i+40)).order(table==='project_supervision_schedule'?'updated_at':'created_at',{ascending:false}).range(page*700,(page+1)*700-1);
  if(error)throw new Error('تعذر تحميل متابعة المشاريع: '+error.message);const batch=(data||[]) as any[];values.push(...batch);if(batch.length<700)break;
 }}return values;
}
export async function loadSupervisionOverview(projects:ProjectSheetRow[],secretaryId:string):Promise<SupervisionProject[]>{
 const active=projects.filter(p=>p.setup_status==='ACTIVE'&&p.approval_status==='APPROVED'&&!['COMPLETED','CANCELLED'].includes(p.project_status)&&p.lifecycle_state!=='POSTPONED');
 if(!active.length)return [];
 const ids=active.map(p=>p.project_id);
 const [snap,clocks,checks,actions,pauses,requests]=await Promise.all([
  loadProjectFollowup(active,secretaryId),rows('project_supervision_schedule',ids,'initiative_id,supervisor_id,next_due_at,last_checked_at,updated_at'),rows('project_supervision_checks',ids),rows('project_supervision_actions',ids),rows('project_execution_pauses',ids),rows('project_supervision_requests',ids)
 ]);
 const newest=(array:any[],id:string)=>array.filter(v=>v.initiative_id===id).sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime())[0]||null;
 const now=Date.now();const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Khartoum',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return active.map(project=>{
  const related=snap.items.filter(x=>x.project.project_id===project.project_id&&x.issue!=='PLANNED');
  const activeStations=related.filter(x=>x.schedule||x.issue==='RESULT_REVIEW'||x.issue==='UNREVIEWED');
  const focused=activeStations.length?activeStations:related.filter(x=>x.issue==='AWAITING_REPORT').slice(0,1);
  const clock=clocks.find(x=>x.initiative_id===project.project_id)||null;
  const pause=pauses.filter(x=>x.initiative_id===project.project_id&&['PENDING','APPROVED'].includes(x.status)).sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0]||null;
  const isPaused=pause?.status==='APPROVED'&&pause.pause_until_date>=today;
  const supervisorId=clock?.supervisor_id||focused[0]?.supervisorId||project.secretary_id||secretaryId;
  const lastCheck=checks.filter(x=>x.initiative_id===project.project_id&&x.supervisor_id===supervisorId).sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0]||null;
  const lastRequest=requests.filter(x=>x.initiative_id===project.project_id&&x.supervisor_id===supervisorId).sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0]||null;
  const lateChecks=!isPaused&&!!clock&&new Date(clock.next_due_at).getTime()<now;
  return {project,active:focused,supervisorId,supervisorName:focused[0]?.supervisorName||project.secretary_name||'السكرتير',clock,lastCheck,openActions:actions.filter(x=>x.initiative_id===project.project_id&&x.status==='OPEN'),pause,lateChecks,lateReports:isPaused?0:focused.filter(x=>x.reportIsLate).length,pausePending:pause?.status==='PENDING',isPaused,lastRequest};
 }).sort((a,b)=>Number(b.pausePending)-Number(a.pausePending)||Number(b.lateChecks)-Number(a.lateChecks)||b.lateReports-a.lateReports||a.project.project_title.localeCompare(b.project.project_title,'ar'));
}
