import { supabase } from './supabase';
import type { Blocker, Evidence, Initiative, Intervention, MemberDirectoryItem, Milestone, Plan, Profile, ProjectBundle, ProjectIntervention, ProjectPermission, ProjectPermissionApproval, ProjectSheetRow, ProjectUpdate, Proposal, ProposalDocumentStatus, ProposalSheetRow, ResultItem, RoutineObligationRow, Secretariat, WeeklyCommitment } from './types';

export async function currentProfile(): Promise<Profile> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('UNAUTHORIZED');
  const { data, error } = await supabase.from('profiles').select('*,secretariat:secretariats(*)').eq('auth_user_id', auth.user.id).single();
  if (error) throw error; return data;
}
export async function secretariats(): Promise<Secretariat[]> {
  const { data, error } = await supabase.from('secretariats').select('*').eq('active', true).order('name_ar');
  if (error) throw error; return data || [];
}
export async function myProposals(): Promise<Proposal[]> {
  const { data, error } = await supabase.from('proposals').select('*, secretariat:secretariats(*)').order('updated_at', {ascending:false});
  if (error) throw error; return data || [];
}
export async function ownProposals(): Promise<Proposal[]> {
  const p=await currentProfile();
  const { data, error } = await supabase.from('proposals').select('*, secretariat:secretariats(*)').eq('applicant_id',p.id).order('updated_at',{ascending:false});
  if(error) throw error; return data||[];
}
export async function proposalById(id:string) {
  const { data, error } = await supabase.from('proposals').select('*, secretariat:secretariats(*)').eq('id', id).single();
  if (error) throw error; return data as Proposal;
}
export async function proposalHistory(id:string) {
  const [actions, versions, attachments] = await Promise.all([
    supabase.from('proposal_actions').select('*, actor:profiles(full_name,role)').eq('proposal_id',id).order('created_at',{ascending:false}),
    supabase.from('proposal_versions').select('*').eq('proposal_id',id).order('version_no',{ascending:false}),
    supabase.from('file_assets').select('*').eq('entity_type','PROPOSAL').eq('entity_id',id).order('created_at',{ascending:false})
  ]);
  if (actions.error) throw actions.error; if (versions.error) throw versions.error; if (attachments.error) throw attachments.error;
  return { actions: actions.data || [], versions: versions.data || [], attachments: attachments.data || [] };
}
export async function workflow(action:string, payload:any={}) {
  const { data, error } = await supabase.functions.invoke('workflow',{body:{action,payload}});
  if (error) throw error; if (data?.error) throw new Error(data.error); return data;
}
export async function plans(): Promise<Plan[]> {
  const { data, error } = await supabase.from('plans').select('*').order('created_at',{ascending:false}); if(error) throw error; return data||[];
}
export async function milestones(): Promise<Milestone[]> {
  const { data,error }=await supabase.from('milestones').select('*, result:results(*), owner:profiles!milestones_owner_id_fkey(id,full_name)').order('due_at',{ascending:true}); if(error) throw error; return data||[];
}
export async function milestoneBundle(id:string): Promise<{ milestone: Milestone; commitments: WeeklyCommitment[]; evidence: Evidence[]; blockers: Blocker[]; interventions: Intervention[]; verifications: any[] }> {
  const [m,c,e,b,i,v] = await Promise.all([
    supabase.from('milestones').select('*, result:results(*), owner:profiles!milestones_owner_id_fkey(id,full_name)').eq('id',id).single(),
    supabase.from('weekly_commitments').select('*').eq('milestone_id',id).order('week_start',{ascending:false}),
    supabase.from('milestone_evidence').select('*').eq('milestone_id',id).order('created_at',{ascending:false}),
    supabase.from('blockers').select('*').eq('milestone_id',id).order('created_at',{ascending:false}),
    supabase.from('interventions').select('*, secretary:profiles(full_name)').eq('milestone_id',id).order('created_at',{ascending:false}),
    supabase.from('verifications').select('*, verifier:profiles(full_name)').eq('milestone_id',id).order('created_at',{ascending:false})
  ]);
  for (const r of [m,c,e,b,i,v]) if(r.error) throw r.error;
  return {milestone:m.data as Milestone, commitments:c.data as WeeklyCommitment[], evidence:e.data as Evidence[], blockers:b.data as Blocker[], interventions:i.data as Intervention[], verifications:v.data || []};
}

export async function workspaceProjects(): Promise<Initiative[]> {
  const {data,error}=await supabase.from('initiatives').select('*,secretariat:secretariats(*),owner:profiles!initiatives_owner_id_fkey(id,full_name),secretary:profiles!initiatives_secretary_id_fkey(id,full_name)').order('updated_at',{ascending:false});
  if(error) throw error; return (data||[]) as Initiative[];
}
export async function workspaceProject(id:string): Promise<ProjectBundle> {
  // First locate this project's results; then load only its milestones/evidence.
  // A secretary must not download the association's entire activity ledger to open one project.
  const [i,r,u,p,pi,o,a,sv,se,dr]=await Promise.all([
    supabase.from('initiatives').select('*,secretariat:secretariats(*),owner:profiles!initiatives_owner_id_fkey(id,full_name),secretary:profiles!initiatives_secretary_id_fkey(id,full_name)').eq('id',id).single(),
    supabase.from('results').select('*,owner:profiles!results_owner_id_fkey(id,full_name)').eq('initiative_id',id).order('created_at'),
    supabase.from('project_updates').select('*,author:profiles(full_name)').eq('initiative_id',id).order('created_at',{ascending:false}),
    supabase.from('project_permissions').select('*,target_secretariat:secretariats!project_permissions_target_secretariat_id_fkey(*),requester:profiles!project_permissions_requested_by_fkey(id,full_name),approvals:project_permission_approvals(*)').eq('initiative_id',id).order('created_at'),
    supabase.from('project_interventions').select('*,secretary:profiles!project_interventions_secretary_id_fkey(id,full_name)').eq('initiative_id',id).order('created_at',{ascending:false}),
    supabase.from('oversight_notes').select('*,creator:profiles!oversight_notes_created_by_fkey(id,full_name)').eq('initiative_id',id).order('created_at',{ascending:false}),
    supabase.from('project_activity_entries').select('*,author:profiles!project_activity_entries_author_id_fkey(id,full_name)').eq('initiative_id',id).order('created_at',{ascending:false}),
    supabase.from('project_supervision_assignments').select('*,supervisor:profiles!project_supervision_assignments_supervisor_id_fkey(id,full_name)').eq('initiative_id',id).maybeSingle(),
    supabase.from('milestone_supervision_events').select('*,actor:profiles!milestone_supervision_events_actor_id_fkey(id,full_name)').eq('initiative_id',id).order('created_at',{ascending:false}),
    supabase.from('milestone_deadline_requests').select('*').eq('initiative_id',id).order('created_at',{ascending:false})
  ]);
  for(const x of [i,r,u,p,pi,o,a,sv,se,dr]) if(x.error)throw x.error;
  const resultIds=(r.data||[]).map((x:any)=>x.id);
  const m=resultIds.length?await supabase.from('milestones').select('*,owner:profiles!milestones_owner_id_fkey(id,full_name),result:results(*)').in('result_id',resultIds).order('sequence_no').order('due_at'):{data:[],error:null};
  if(m.error)throw m.error;
  const milestoneIds=(m.data||[]).map((x:any)=>x.id);
  const [b,e]=await Promise.all([
    milestoneIds.length?supabase.from('blockers').select('*').in('milestone_id',milestoneIds).eq('status','OPEN').order('created_at',{ascending:false}):Promise.resolve({data:[],error:null}),
    milestoneIds.length?supabase.from('milestone_evidence').select('*').in('milestone_id',milestoneIds).order('created_at',{ascending:false}):Promise.resolve({data:[],error:null})
  ]);
  if(b.error)throw b.error;if(e.error)throw e.error;
  return {initiative:i.data as Initiative,results:(r.data||[]) as ResultItem[],milestones:(m.data||[]) as Milestone[],updates:(u.data||[]) as ProjectUpdate[],permissions:(p.data||[]) as ProjectPermission[],interventions:(pi.data||[]) as ProjectIntervention[],blockers:(b.data||[]) as Blocker[],oversight:o.data||[],activity:a.data||[],evidence:(e.data||[]) as Evidence[], supervisor:sv.data||null, supervisionEvents:se.data||[], deadlineRequests:dr.data||[]};
}
export async function projectPermissionsPending(): Promise<(ProjectPermissionApproval & {permission:ProjectPermission})[]> {
  const {data,error}=await supabase.rpc('permission_approval_queue');if(error)throw error;return (data||[]) as any;
}
export async function workspaceAttention(){const {data,error}=await supabase.rpc('workspace_attention_snapshot');if(error)throw error;return (data||[]) as any[];}
export async function proposalExecutionProject(proposalId:string):Promise<Initiative|null>{const {data,error}=await supabase.from('initiatives').select('*,secretariat:secretariats(*),owner:profiles!initiatives_owner_id_fkey(id,full_name),secretary:profiles!initiatives_secretary_id_fkey(id,full_name)').eq('proposal_id',proposalId).maybeSingle();if(error)throw error;return (data||null) as Initiative|null;}
export async function staffProfiles(secretariatId?:string): Promise<Profile[]> {
  let q=supabase.from('profiles').select('*').eq('active',true).in('role',['MEMBER','SECRETARY']);if(secretariatId)q=q.eq('secretariat_id',secretariatId);const {data,error}=await q.order('full_name');if(error)throw error;return (data||[]) as Profile[];
}
export async function executiveSnapshot(){const {data,error}=await supabase.rpc('executive_workspace_snapshot');if(error)throw error;return data||{};}



export async function memberDirectorySearch(query=''): Promise<MemberDirectoryItem[]> {
  const {data,error}=await supabase.rpc('member_directory_search',{p_query:query}); if(error)throw error; return (data||[]) as MemberDirectoryItem[];
}
export async function workspaceProjectSheet(): Promise<ProjectSheetRow[]> {
  const {data,error}=await supabase.rpc('workspace_project_sheet'); if(error)throw error; return (data||[]) as ProjectSheetRow[];
}
export async function proposalTrackingSheet(): Promise<ProposalSheetRow[]> {
  const {data,error}=await supabase.rpc('proposal_tracking_sheet'); if(error)throw error; return (data||[]) as ProposalSheetRow[];
}

export async function routineObligationSheet(): Promise<RoutineObligationRow[]> {
  const {data,error}=await supabase.rpc('routine_obligation_sheet'); if(error)throw error; return (data||[]) as RoutineObligationRow[];
}
export async function proposalDocumentStatus(proposalId:string): Promise<ProposalDocumentStatus> {
  const {data,error}=await supabase.rpc('proposal_document_status',{p_proposal_id:proposalId}); if(error)throw error; return (data||{}) as ProposalDocumentStatus;
}

export function exportCsv(fileName:string, rows:Record<string,any>[], columns:{key:string;label:string}[]){
  const esc=(v:any)=>`"${String(v??'').replace(/"/g,'""')}"`;
  const lines=[columns.map(c=>esc(c.label)).join(','),...rows.map(r=>columns.map(c=>esc(r[c.key])).join(','))];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fileName.endsWith('.csv')?fileName:fileName+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function copyTableTsv(rows:Record<string,any>[], columns:{key:string;label:string}[]){
  const clean=(v:any)=>String(v??'').replace(/[\t\r\n]+/g,' ').trim();
  const text=[columns.map(c=>clean(c.label)).join('\t'),...rows.map(r=>columns.map(c=>clean(r[c.key])).join('\t'))].join('\n');
  await navigator.clipboard.writeText(text);return rows.length;
}

export async function weeklyReport(weekStart?:string) {
  const { data,error }=await supabase.rpc('weekly_report',{p_week_start:weekStart||null}); if(error) throw error; return data||[];
}
export async function dashboardMetrics() {
  const { data,error }=await supabase.rpc('dashboard_metrics'); if(error) throw error; return data||{};
}

function saveBase64File(fileName:string,mimeType:string,base64:string){
 const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)); const blob=new Blob([bytes],{type:mimeType||'application/octet-stream'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=fileName||'download';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function downloadDriveFile(driveFileId:string){const d=await workflow('FILE_DOWNLOAD',{driveFileId});saveBase64File(d.fileName,d.mimeType,d.base64)}
export async function downloadTemplate(){const d=await workflow('TEMPLATE_DOWNLOAD',{});saveBase64File(d.fileName,d.mimeType,d.base64)}
export async function uploadToStaging(file:File){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('UNAUTHORIZED');const safe=file.name.replace(/[^\w.\-\u0600-\u06FF]+/g,'_');const path=`${user.id}/${crypto.randomUUID()}-${safe}`;const ext=file.name.split('.').pop()?.toLowerCase();const inferred=ext==='pdf'?'application/pdf':ext==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':file.type||'application/octet-stream';const {error}=await supabase.storage.from('staging').upload(path,file,{upsert:false,contentType:inferred});if(error)throw new Error(error.message||'تعذر رفع الملف مؤقتًا.');return path}


// -----------------------------------------------------------------------------
// KMSA compatibility readers for the comprehensive Workspace update.
// These readers prefer the new RPC/view names when installed and degrade safely
// to the matching table (or an empty result) instead of crashing the shell.
// -----------------------------------------------------------------------------
async function kmsaCompatRpc(name:string, params:Record<string,any> = {}) {
  const { data, error } = await supabase.rpc(name, params);
  if (!error) return data;
  const missing = error.code === 'PGRST202' || error.code === '42883' || /Could not find the function|does not exist/i.test(error.message || '');
  if (missing) return null;
  throw error;
}
async function kmsaCompatTable(table:string, select='*') {
  const { data, error } = await supabase.from(table).select(select);
  if (error) return [];
  return data || [];
}


// KMSA compatibility API
export async function notificationFeed(limit=30): Promise<any[]> {
  // v5.4: The installed SQL exposes user_notification_feed, not notification_feed.
  const count=Math.max(1,Math.min(100,limit));
  const {data,error}=await supabase.rpc('user_notification_feed',{p_limit:count});
  if(!error)return (Array.isArray(data)?data:data?.items||[]) as any[];
  const missing=error.code==='PGRST202'||error.code==='42883'||/not found|does not exist/i.test(error.message||'');
  if(!missing)throw error; // Never disguise RLS/network failures as an empty inbox.
  const {data:auth,error:authError}=await supabase.auth.getUser();if(authError)throw authError;
  if(!auth.user)throw new Error('يجب تسجيل الدخول لعرض الإشعارات.');
  const {data:person,error:profileError}=await supabase.from('profiles').select('id').eq('auth_user_id',auth.user.id).single();
  if(profileError)throw profileError;
  const backup=await supabase.from('user_notifications').select('*').eq('profile_id',person.id).order('created_at',{ascending:false}).limit(count);
  if(backup.error)throw backup.error;
  return backup.data||[];
}


// KMSA compatibility API
export async function quickTaskSheet(..._args:any[]): Promise<any[]> {
  const rpc = await kmsaCompatRpc('quick_task_sheet');
  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);
  const rows:any[] = await kmsaCompatTable('quick_tasks');
  return rows;
}


// KMSA compatibility API
export async function readinessSnapshot(..._args:any[]): Promise<any> {
  const rpc = await kmsaCompatRpc('readiness_snapshot');
  if (rpc !== null) return Array.isArray(rpc) && rpc.length === 1 ? rpc[0] : rpc;
  // Safe fallback: derive the most important readiness signals from readers that
  // already exist in v3. This keeps oversight usable even before the RPC is added.
  const [projects, routines, proposals] = await Promise.all([
    workspaceProjectSheet().catch(()=>[]),
    routineObligationSheet().catch(()=>[]),
    proposalTrackingSheet().catch(()=>[])
  ]);
  const p:any[] = projects as any[]; const r:any[] = routines as any[]; const pr:any[] = proposals as any[];
  const snapshot:any = {
    ready: false,
    projects_needing_attention: p.filter(x=>x.needs_attention).length,
    secretary_response_needed: p.filter(x=>x.secretary_response_needed).length,
    overdue_routines: r.filter(x=>x.overdue).length,
    overdue_proposals: pr.filter(x=>x.overdue).length,
    critical_count: p.filter(x=>x.secretary_response_needed).length + r.filter(x=>x.overdue).length + pr.filter(x=>x.overdue).length
  };
  snapshot.ready = snapshot.critical_count === 0;
  return snapshot;
}


// KMSA compatibility API
export async function operationalPositions(..._args:any[]): Promise<any[]> {
  const rpc = await kmsaCompatRpc('operational_position_sheet');
  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);
  return await kmsaCompatTable('operational_positions');
}


// KMSA compatibility API
export async function positionAssignments(...args:any[]): Promise<any[]> {
  const rpc = await kmsaCompatRpc('position_assignment_sheet');
  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);
  const rows:any[] = await kmsaCompatTable('position_assignments');
  const positionId = typeof args[0] === 'string' ? args[0] : args[0]?.positionId;
  return positionId ? rows.filter((x:any)=>x.position_id===positionId) : rows;
}


// KMSA compatibility API
export async function positionDutyTemplates(...args:any[]): Promise<any[]> {
  const rpc = await kmsaCompatRpc('position_duty_template_sheet');
  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);
  const rows:any[] = await kmsaCompatTable('position_duty_templates');
  const positionId = typeof args[0] === 'string' ? args[0] : args[0]?.positionId;
  return positionId ? rows.filter((x:any)=>x.position_id===positionId) : rows;
}


// KMSA compatibility API
export async function positionEventTemplates(...args:any[]): Promise<any[]> {
  const rpc = await kmsaCompatRpc('position_event_template_sheet');
  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);
  const rows:any[] = await kmsaCompatTable('position_event_templates');
  const positionId = typeof args[0] === 'string' ? args[0] : args[0]?.positionId;
  return positionId ? rows.filter((x:any)=>x.position_id===positionId) : rows;
}


// KMSA compatibility API
export async function workEventSheet(..._args:any[]): Promise<any[]> {
  const rpc = await kmsaCompatRpc('work_event_sheet');
  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);
  return await kmsaCompatTable('work_events');
}


// KMSA compatibility API
export async function eventAttendance(...args:any[]): Promise<any[]> {
  const eventId = typeof args[0] === 'string' ? args[0] : args[0]?.eventId;
  const rpc = eventId ? await kmsaCompatRpc('event_attendance_sheet',{p_event_id:eventId}) : null;
  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);
  const rows:any[] = await kmsaCompatTable('event_attendance');
  return eventId ? rows.filter((x:any)=>x.event_id===eventId) : rows;
}

/** Pending evaluation of the newest update, scoped to projects this person actually supervises. */
export async function workspaceReviewerQueue(user:Profile, projects:ProjectSheetRow[]):Promise<{projectId:string;title:string;milestoneTitle:string;milestoneId:string;createdAt:string;isResult:boolean}[]> {
 const active=projects.filter(p=>p.approval_status==='APPROVED'&&p.setup_status==='ACTIVE');
 if(!active.length)return [];
 const ids=active.slice(0,100).map(p=>p.project_id);
 const assigned=await supabase.from('project_supervision_assignments').select('initiative_id,supervisor_id').in('initiative_id',ids);
 if(assigned.error)throw assigned.error;
 const direct=new Map((assigned.data||[]).map(x=>[x.initiative_id,x.supervisor_id]));
 const eligible=active.filter(p=>(direct.get(p.project_id)||p.secretary_id)===user.id);
 if(!eligible.length)return [];
 const eid=eligible.map(x=>x.project_id);
 const [events,reviews,milestones]=await Promise.all([
  supabase.from('project_activity_entries').select('id,initiative_id,milestone_id,created_at,status_after').in('initiative_id',eid).eq('kind','MILESTONE_UPDATE').order('created_at',{ascending:false}).limit(900),
  supabase.from('milestone_supervision_events').select('source_activity_id,actor_id').in('initiative_id',eid).in('event_type',['PROGRESS_OK','PROGRESS_FOLLOW_UP','RESULT_OK','RESULT_REVISION']).order('created_at',{ascending:false}).limit(900),
  supabase.from('results').select('id,initiative_id,milestones(id,title)').in('initiative_id',eid)
 ]);
 for(const resp of [events,reviews,milestones])if(resp.error)throw resp.error;
 const seen=new Set<string>();const reviewed=new Set((reviews.data||[]).map(x=>`${x.source_activity_id}:${x.actor_id}`));
 const titles=new Map<string,string>();
 for(const r of milestones.data||[])for(const m of (r.milestones||[]) as {id:string;title:string}[])titles.set(m.id,m.title);
 const found:{projectId:string;title:string;milestoneTitle:string;milestoneId:string;createdAt:string;isResult:boolean}[]=[];
 for(const e of events.data||[]){
  if(!e.milestone_id||seen.has(e.milestone_id))continue;
  seen.add(e.milestone_id);
  if(reviewed.has(`${e.id}:${user.id}`))continue;
  const p=eligible.find(x=>x.project_id===e.initiative_id);if(!p)continue;
  // Secretary may self-review own project; a deputy/member never reviews their own work.
  if(p.lead_id===user.id&&!(user.role==='SECRETARY'&&p.secretary_id===user.id))continue;
  found.push({projectId:p.project_id,title:p.project_title,milestoneId:e.milestone_id,milestoneTitle:titles.get(e.milestone_id)||p.current_milestone||'محطة إنجاز',createdAt:e.created_at,isResult:['READY_FOR_VERIFICATION','VERIFIED'].includes(e.status_after||'')});
 }
 return found;
}
