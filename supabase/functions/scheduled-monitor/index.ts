import { adminClient, corsHeaders, env, json } from '../_shared/common.ts';

async function invoke(name:string,body:any){const r=await fetch(`${env('SUPABASE_URL')}/functions/v1/${name}`,{method:'POST',headers:{'Content-Type':'application/json','x-internal-secret':env('FUNCTION_INTERNAL_SECRET'),'Authorization':`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,'apikey':env('SUPABASE_SERVICE_ROLE_KEY')},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`${name} failed`);return d}
async function recently(db:any,event:string,entityType:string,entityId:string,hours=12){const since=new Date(Date.now()-hours*3600000).toISOString();const {count}=await db.from('notification_log').select('*',{count:'exact',head:true}).eq('event_type',event).eq('entity_type',entityType).eq('entity_id',entityId).gte('created_at',since);return (count||0)>0}

Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});try{const secret=req.headers.get('x-cron-secret')||req.headers.get('x-internal-secret')||'';if(secret!==env('CRON_SECRET')&&secret!==env('FUNCTION_INTERNAL_SECRET'))return json({error:'forbidden'},403);const db=adminClient();
 const {data:jobs}=await db.from('background_jobs').select('*').eq('status','PENDING').lte('run_after',new Date().toISOString()).order('created_at').limit(20);
 for(const job of jobs||[]){await db.from('background_jobs').update({status:'PROCESSING',locked_at:new Date().toISOString(),attempts:job.attempts+1}).eq('id',job.id);try{if(job.job_type==='DOCUMENT_PROPOSAL'||job.job_type==='ARCHIVE_STAGING_PROPOSAL'||job.job_type==='ARCHIVE_STAGING_EVIDENCE')await invoke('document-job',job.payload);else if(job.job_type==='TELEGRAM_NOTIFY')await invoke('telegram-notify',{event:job.payload.event,entity_type:job.entity_type,entity_id:job.entity_id,payload:job.payload});await db.from('background_jobs').update({status:'DONE',completed_at:new Date().toISOString()}).eq('id',job.id)}catch(e:any){const attempts=job.attempts+1;await db.from('background_jobs').update({status:attempts>=5?'FAILED':'PENDING',last_error:e?.message||String(e),run_after:new Date(Date.now()+Math.min(attempts*2,10)*60000).toISOString()}).eq('id',job.id)}}
 const now=Date.now();const dueSoon=72*3600000;
 const {data:ms}=await db.from('milestones').select('*').not('status','in','("VERIFIED","CANCELLED")');
 for(const m of ms||[]){const due=new Date(m.due_at).getTime();if(due<now){if(!await recently(db,'MILESTONE_OVERDUE','MILESTONE',m.id,12)){await db.from('background_jobs').insert({job_type:'TELEGRAM_NOTIFY',entity_type:'MILESTONE',entity_id:m.id,payload:{event:'MILESTONE_OVERDUE'}});await db.from('notification_log').insert({channel:'SYSTEM',recipient:'RESPONSIBLE',event_type:'MILESTONE_OVERDUE',entity_type:'MILESTONE',entity_id:m.id,status:'QUEUED'});if(['NOT_STARTED','IN_PROGRESS'].includes(m.status))await db.from('milestones').update({status:'AT_RISK'}).eq('id',m.id)}}else if(due-now<=dueSoon){if(!await recently(db,'MILESTONE_DUE_SOON','MILESTONE',m.id,12)){await db.from('background_jobs').insert({job_type:'TELEGRAM_NOTIFY',entity_type:'MILESTONE',entity_id:m.id,payload:{event:'MILESTONE_DUE_SOON'}});await db.from('notification_log').insert({channel:'SYSTEM',recipient:'RESPONSIBLE',event_type:'MILESTONE_DUE_SOON',entity_type:'MILESTONE',entity_id:m.id,status:'QUEUED'})}}}
 const {data:projects}=await db.from('initiatives').select('*').eq('setup_status','ACTIVE').not('status','in','("COMPLETED","CANCELLED")');
 for(const p of projects||[]){
  const [{data:latestUpdate},{count:pendingPermissions},{data:projectResults}]=await Promise.all([
   db.from('project_updates').select('health,assistance_needed,next_check_at,created_at').eq('initiative_id',p.id).order('created_at',{ascending:false}).limit(1).maybeSingle(),
   db.from('project_permissions').select('*',{count:'exact',head:true}).eq('initiative_id',p.id).eq('status','PENDING'),
   db.from('results').select('id').eq('initiative_id',p.id)
  ]);
  const resultIds=(projectResults||[]).map((x:any)=>x.id);let openBlockers=0;
  if(resultIds.length){const {data:projectMilestones}=await db.from('milestones').select('id').in('result_id',resultIds);const milestoneIds=(projectMilestones||[]).map((x:any)=>x.id);if(milestoneIds.length){const {count}=await db.from('blockers').select('*',{count:'exact',head:true}).in('milestone_id',milestoneIds).eq('status','OPEN');openBlockers=count||0}}
  const updateDue=p.next_update_due_at?new Date(p.next_update_due_at).getTime():null;
  const stale=!!(updateDue&&updateDue<now);
  if(updateDue){
   const updateEvent=stale?'PROJECT_UPDATE_OVERDUE':(updateDue-now<=12*3600000?'PROJECT_UPDATE_DUE_SOON':'');
   if(updateEvent&&!await recently(db,updateEvent,'INITIATIVE',p.id,12)){
    await db.from('background_jobs').insert({job_type:'TELEGRAM_NOTIFY',entity_type:'INITIATIVE',entity_id:p.id,payload:{event:updateEvent}});
    await db.from('notification_log').insert({channel:'SYSTEM',recipient:'RESPONSIBLE',event_type:updateEvent,entity_type:'INITIATIVE',entity_id:p.id,status:'QUEUED'});
   }
  }
  const due=p.target_due_at?new Date(p.target_due_at).getTime():null;
  const approaching=!!(due&&due>now&&due-now<=5*86400000);
  const nextCheckMissed=!!(latestUpdate?.next_check_at&&new Date(latestUpdate.next_check_at).getTime()<now);
  const assistanceNeeded=!!(latestUpdate?.assistance_needed&&String(latestUpdate.assistance_needed).trim());
  const blocked=(openBlockers||0)>0;
  const permissionPending=(pendingPermissions||0)>0;
  const risky=['WATCH','AT_RISK','BLOCKED'].includes(p.health)||stale||approaching||nextCheckMissed||assistanceNeeded||blocked||permissionPending;
  if(risky&&!await recently(db,'PROJECT_EARLY_WARNING','INITIATIVE',p.id,24)){
   const reasons:string[]=[];
   if(['WATCH','AT_RISK','BLOCKED'].includes(p.health))reasons.push(`health:${p.health}`);
   if(stale)reasons.push('periodic_update_overdue');
   if(approaching)reasons.push('result_due_soon');
   if(nextCheckMissed)reasons.push('next_check_missed');
   if(assistanceNeeded)reasons.push('assistance_requested');
   if(blocked)reasons.push('open_blocker');
   if(permissionPending)reasons.push('permission_pending');
   await db.from('background_jobs').insert({job_type:'TELEGRAM_NOTIFY',entity_type:'INITIATIVE',entity_id:p.id,payload:{event:'PROJECT_EARLY_WARNING',health:p.health,reasons}});
   await db.from('notification_log').insert({channel:'SYSTEM',recipient:'SECRETARY',event_type:'PROJECT_EARLY_WARNING',entity_type:'INITIATIVE',entity_id:p.id,status:'QUEUED'});
  }
 }
 const {data:routines}=await db.from('routine_obligations').select('*').eq('active',true);
 for(const r of routines||[]){const due=new Date(r.next_due_at).getTime();if(due<now&&!await recently(db,'ROUTINE_OVERDUE','ROUTINE',r.id,24)){await db.from('background_jobs').insert({job_type:'TELEGRAM_NOTIFY',entity_type:'ROUTINE',entity_id:r.id,payload:{event:'ROUTINE_OVERDUE'}});await db.from('notification_log').insert({channel:'SYSTEM',recipient:'RESPONSIBLE',event_type:'ROUTINE_OVERDUE',entity_type:'ROUTINE',entity_id:r.id,status:'QUEUED'})}else if(due>=now&&due-now<=dueSoon&&!await recently(db,'ROUTINE_DUE_SOON','ROUTINE',r.id,24)){await db.from('background_jobs').insert({job_type:'TELEGRAM_NOTIFY',entity_type:'ROUTINE',entity_id:r.id,payload:{event:'ROUTINE_DUE_SOON'}});await db.from('notification_log').insert({channel:'SYSTEM',recipient:'RESPONSIBLE',event_type:'ROUTINE_DUE_SOON',entity_type:'ROUTINE',entity_id:r.id,status:'QUEUED'})}}
 const {data:ps}=await db.from('proposals').select('*').in('status',['WITH_SECRETARY','WITH_GS']);for(const p of ps||[]){const due=p.status==='WITH_GS'?p.gs_due_at:p.secretary_due_at;if(!due)continue;const t=new Date(due).getTime();const event=t<now?'PROPOSAL_OVERDUE':'PROPOSAL_DUE_SOON';if((t<now||t-now<=dueSoon)&&!await recently(db,event,'PROPOSAL',p.id,12)){await db.from('background_jobs').insert({job_type:'TELEGRAM_NOTIFY',entity_type:'PROPOSAL',entity_id:p.id,payload:{event}});await db.from('notification_log').insert({channel:'SYSTEM',recipient:'RESPONSIBLE',event_type:event,entity_type:'PROPOSAL',entity_id:p.id,status:'QUEUED'})}}
 return json({ok:true,processedJobs:(jobs||[]).length});}catch(e:any){console.error(e);return json({error:e?.message||String(e)},500)}});
