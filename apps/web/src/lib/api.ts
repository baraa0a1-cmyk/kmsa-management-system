import { supabase } from './supabase';
import type { Blocker, Evidence, Intervention, Milestone, Plan, Profile, Proposal, Secretariat, WeeklyCommitment } from './types';

export async function currentProfile(): Promise<Profile> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('UNAUTHORIZED');
  const { data, error } = await supabase.from('profiles').select('*').eq('auth_user_id', auth.user.id).single();
  if (error) throw error;
  return data;
}
export async function secretariats(): Promise<Secretariat[]> {
  const { data, error } = await supabase.from('secretariats').select('*').eq('active', true).order('name_ar');
  if (error) throw error; return data || [];
}
export async function myProposals(): Promise<Proposal[]> {
  const { data, error } = await supabase.from('proposals').select('*, secretariat:secretariats(*)').order('updated_at', {ascending:false});
  if (error) throw error; return data || [];
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
export async function milestoneBundle(id:string) {
  const [m,c,e,b,i,v] = await Promise.all([
    supabase.from('milestones').select('*, result:results(*), owner:profiles!milestones_owner_id_fkey(id,full_name)').eq('id',id).single(),
    supabase.from('weekly_commitments').select('*').eq('milestone_id',id).order('week_start',{ascending:false}),
    supabase.from('milestone_evidence').select('*').eq('milestone_id',id).order('created_at',{ascending:false}),
    supabase.from('blockers').select('*').eq('milestone_id',id).order('created_at',{ascending:false}),
    supabase.from('interventions').select('*, secretary:profiles(full_name)').eq('milestone_id',id).order('created_at',{ascending:false}),
    supabase.from('verifications').select('*, verifier:profiles(full_name)').eq('milestone_id',id).order('created_at',{ascending:false})
  ]);
  for (const r of [m,c,e,b,i,v]) if(r.error) throw r.error;
  return {milestone:m.data, commitments:c.data as WeeklyCommitment[], evidence:e.data as Evidence[], blockers:b.data as Blocker[], interventions:i.data as Intervention[], verifications:v.data};
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
export async function uploadToStaging(file:File){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('UNAUTHORIZED');const safe=file.name.replace(/[^\w.\-\u0600-\u06FF]+/g,'_');const path=`${user.id}/${crypto.randomUUID()}-${safe}`;const {error}=await supabase.storage.from('staging').upload(path,file,{upsert:false,contentType:file.type});if(error)throw error;return path}
