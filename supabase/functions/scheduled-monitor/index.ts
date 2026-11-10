import { adminClient, corsHeaders, env, inboxNotify, json } from '../_shared/common.ts';

async function invoke(name:string,body:any){const r=await fetch(`${env('SUPABASE_URL')}/functions/v1/${name}`,{method:'POST',headers:{'Content-Type':'application/json','x-internal-secret':env('FUNCTION_INTERNAL_SECRET'),'Authorization':`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,'apikey':env('SUPABASE_SERVICE_ROLE_KEY')},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`${name} failed`);return d}
async function recently(db:any,event:string,entityType:string,entityId:string,hours=12){const since=new Date(Date.now()-hours*3600000).toISOString();const {count}=await db.from('notification_log').select('*',{count:'exact',head:true}).eq('event_type',event).eq('entity_type',entityType).eq('entity_id',entityId).gte('created_at',since);return (count||0)>0}
async function queueSystemNotice(db:any,event:string,entityType:string,entityId:string,recipient='RESPONSIBLE'){if(await recently(db,event,entityType,entityId,event.includes('DUE_SOON')?12:24))return;await db.from('background_jobs').insert({job_type:'TELEGRAM_NOTIFY',entity_type:entityType,entity_id:entityId,payload:{event},dedupe_key:`notify:${event}:${entityType}:${entityId}`});await db.from('notification_log').insert({channel:'SYSTEM',recipient,event_type:event,entity_type:entityType,entity_id:entityId,status:'QUEUED'})}

Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});try{const secret=req.headers.get('x-cron-secret')||req.headers.get('x-internal-secret')||'';if(secret!==env('CRON_SECRET')&&secret!==env('FUNCTION_INTERNAL_SECRET'))return json({error:'forbidden'},403);const db=adminClient();const now=new Date();const nowMs=now.getTime();const currentCycleId=(await db.from('cycles').select('id').eq('is_current',true).single()).data?.id;if(!currentCycleId)throw new Error('لا توجد دورة تنظيمية مفعّلة.');
 // Recover abandoned jobs. A crashed worker must never leave a document at PROCESSING forever.
 const stuckBefore=new Date(nowMs-5*60000).toISOString();const {data:stuck}=await db.from('background_jobs').select('*').eq('status','PROCESSING').lt('locked_at',stuckBefore).limit(50);
 for(const job of stuck||[]){const attempts=Number(job.attempts||0);await db.from('background_jobs').update({status:attempts>=5?'FAILED':'PENDING',locked_at:null,heartbeat_at:null,last_error:attempts>=5?(job.last_error||'Worker timeout'):'Recovered after worker timeout',run_after:attempts>=5?job.run_after:new Date(nowMs+60000).toISOString()}).eq('id',job.id)}

 // Documents are user-facing and should never wait behind notification traffic.
 const documentTypes=['DOCUMENT_PROPOSAL','ARCHIVE_STAGING_PROPOSAL','ARCHIVE_STAGING_EVIDENCE'];
 const {data:documentJobs}=await db.from('background_jobs').select('*').eq('status','PENDING').lte('run_after',now.toISOString()).in('job_type',documentTypes).order('created_at').limit(12);
 const otherLimit=Math.max(0,25-(documentJobs||[]).length);let otherJobs:any[]=[];
 if(otherLimit>0){const r=await db.from('background_jobs').select('*').eq('status','PENDING').lte('run_after',now.toISOString()).not('job_type','in',`(${documentTypes.map(x=>`"${x}"`).join(',')})`).order('created_at').limit(otherLimit);otherJobs=r.data||[]}
 const jobs=[...(documentJobs||[]),...otherJobs];
 for(const job of jobs){const lockTime=new Date().toISOString();const locked=await db.from('background_jobs').update({status:'PROCESSING',locked_at:lockTime,heartbeat_at:lockTime,attempts:job.attempts+1}).eq('id',job.id).eq('status','PENDING').select('id').maybeSingle();if(!locked.data)continue;try{if(documentTypes.includes(job.job_type))await invoke('document-job',job.payload);else if(job.job_type==='TELEGRAM_NOTIFY')await invoke('telegram-notify',{event:job.payload.event,entity_type:job.entity_type,entity_id:job.entity_id,payload:job.payload});await db.from('background_jobs').update({status:'DONE',completed_at:new Date().toISOString(),heartbeat_at:new Date().toISOString()}).eq('id',job.id)}catch(e:any){const attempts=job.attempts+1;await db.from('background_jobs').update({status:attempts>=5?'FAILED':'PENDING',locked_at:null,heartbeat_at:null,last_error:e?.message||String(e),run_after:new Date(nowMs+Math.min(attempts*2,10)*60000).toISOString()}).eq('id',job.id)}}

 // v7.2 project-level obligations: ONE executive update per project / 24h, not one per station.
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Khartoum'}).format(now);
 const {data:pauseRows}=await db.from('project_execution_pauses').select('initiative_id').eq('status','APPROVED').gte('pause_until_date',today);
 const pausedIds=new Set((pauseRows||[]).map((x:any)=>x.initiative_id));
 const {data:dailyProjects}=await db.from('initiatives').select('id,title,owner_id,cycle_id,status,lifecycle_state,setup_status,approval_status,assignment_start_at,activated_at')
  .eq('cycle_id',currentCycleId).eq('setup_status','ACTIVE').eq('approval_status','APPROVED').not('status','in','("COMPLETED","CANCELLED")').limit(500);
 for(const project of dailyProjects||[]){
  if(pausedIds.has(project.id)||project.lifecycle_state==='POSTPONED'||!project.owner_id)continue;
  const started=Math.max(new Date(project.assignment_start_at||0).getTime()||0,new Date(project.activated_at||0).getTime()||0);
  if(started>nowMs)continue;
  const {data:unfinished}=await db.from('milestones').select('id,result:results!inner(initiative_id)').eq('result.initiative_id',project.id).neq('design_status','REJECTED').not('status','in','("VERIFIED","CANCELLED","READY_FOR_VERIFICATION")').limit(1);
  if(!(unfinished||[]).length)continue;
  const {data:baselineRows}=await db.from('kmsa_flow_baselines').select('started_at').eq('initiative_id',project.id).maybeSingle();
  const {data:lastBatch}=await db.from('kmsa_flow_batches').select('created_at').eq('initiative_id',project.id).eq('author_id',project.owner_id).order('created_at',{ascending:false}).limit(1);
  const anchor=Math.max(started,new Date(baselineRows?.started_at||0).getTime()||0,new Date(lastBatch?.[0]?.created_at||0).getTime()||0);
  if(!anchor||nowMs-anchor<24*3600000)continue;
  const event='KMSA_V72_PROJECT_DAILY_UPDATE';if(await recently(db,event,'INITIATIVE',project.id,23))continue;
  const delivered=await inboxNotify(db,project.owner_id,event,`مشروع ${project.title}: الإفادة اليومية مستحقة`,
   'سجّل إفادة واحدة عن واقع المشروع خلال 24 ساعة، حتى إن لم يحدث تقدم. لا حاجة لتكرار الإفادة لكل محطة.',
   'INITIATIVE',project.id,`/workspace/projects/${project.id}?action=update`);
  if(delivered)await db.from('notification_log').insert({channel:'SYSTEM',recipient:project.owner_id,event_type:event,entity_type:'INITIATIVE',entity_id:project.id,status:'SENT'});
 }
 const {data:supervisorClocks}=await db.from('project_supervision_schedule').select('initiative_id,supervisor_id,next_due_at').lt('next_due_at',now.toISOString()).limit(300);
 for(const clock of supervisorClocks||[]){if(pausedIds.has(clock.initiative_id))continue;
  const project=(await db.from('initiatives').select('id,title,secretary_id,cycle_id,status,lifecycle_state,setup_status,approval_status').eq('id',clock.initiative_id).maybeSingle()).data;
  if(!project||project.cycle_id!==currentCycleId||project.setup_status!=='ACTIVE'||project.approval_status!=='APPROVED'||['COMPLETED','CANCELLED'].includes(project.status)||project.lifecycle_state==='POSTPONED')continue;
  const ass=(await db.from('project_supervision_assignments').select('supervisor_id,assigned_at').eq('initiative_id',project.id).maybeSingle()).data;
  const delegated=!!ass?.supervisor_id&&ass.supervisor_id!==project.secretary_id&&ass.supervisor_id===clock.supervisor_id;
  if(delegated){
    const {data:reviews}=await db.from('kmsa_supervision_oversight').select('reviewed_at,follow_up_due_at').eq('initiative_id',project.id).eq('supervisor_id',clock.supervisor_id).order('reviewed_at',{ascending:false}).limit(1);
    const recent=reviews?.[0];const secretaryReviewNeeded=!recent||new Date(recent.reviewed_at).getTime()<new Date(clock.next_due_at).getTime();
    const secretaryFollowup=!!recent&&!secretaryReviewNeeded&&new Date(recent.follow_up_due_at).getTime()<nowMs;
    if(secretaryReviewNeeded||secretaryFollowup){
      const type=secretaryReviewNeeded?'KMSA_V73_SECRETARY_OVERSIGHT':'KMSA_V73_SECRETARY_FOLLOW_UP';
      if(!await recently(db,type,'INITIATIVE',project.id,23)){
        await inboxNotify(db,project.secretary_id,type,
          secretaryReviewNeeded?`مشروع ${project.title}: راجع تأخر المتابع`:`مشروع ${project.title}: تأخر المتابع لم يُحسم بعد المراجعة`,
          secretaryReviewNeeded?'المتابع متأخر عن التحقق. راجع الحالة وسجل واقعة المراجعة فقط؛ تأخر المتابع يبقى حتى يتحقق فعلياً.':'راجع استمرار التأخر واتخذ قرار إعادة الإسناد عند الحاجة. لا تكرر تسجيل المراجعة نفسها.',
          'INITIATIVE',project.id,`/workspace/projects/${project.id}?view=supervision`);
      }
    }
  }
  const event='KMSA_V65_SUPERVISOR_CHECK';if(await recently(db,event,'INITIATIVE',project.id,23))continue;
  const delivered=await inboxNotify(db,clock.supervisor_id,event,`مشروع ${project.title}: مطلوب تحقق إشرافي`, 'انقضى استحقاق التحقق الإشرافي خلال 24 ساعة. تواصل أو راجع مخرجات العمل، ثم سجل ما ثبت لديك دون انتظار إفادة المسؤول.', 'INITIATIVE',project.id,`/workspace/projects/${project.id}?action=verify`);
  if(delivered)await db.from('notification_log').insert({channel:'SYSTEM',recipient:clock.supervisor_id,event_type:event,entity_type:'INITIATIVE',entity_id:project.id,status:'SENT'});
 }

 // Requests are proportional to the milestone duration, not a daily/weekly reporting obligation.
 // A reminder is not a finding of negligence; no supervisor approval blocks execution.
 const dueSoon=72*3600000;
 const {data:ms}=await db.from('milestones').select('*,result:results(initiative_id,initiative:initiatives(id,title,cycle_id,owner_id,secretary_id,setup_status,approval_status,status,lifecycle_state,assignment_start_at))').not('status','in','("VERIFIED","CANCELLED","READY_FOR_VERIFICATION")');
 for(const m of ms||[]){
  const project=m.result?.initiative;if(!project||pausedIds.has(project.id)||project.cycle_id!==currentCycleId||project.setup_status!=='ACTIVE'||project.approval_status!=='APPROVED'||['COMPLETED','CANCELLED'].includes(project.status)||project.lifecycle_state==='POSTPONED')continue;
  // Relative milestones start after their predecessor finishes; its earlier planned date is only a forecast.
  if(m.deadline_mode==='RELATIVE'&&m.relative_to_milestone_id){const previous=(await db.from('milestones').select('completed_reported_at').eq('id',m.relative_to_milestone_id).maybeSingle()).data;if(!previous?.completed_reported_at)continue;}
  const due=new Date(m.due_at).getTime();let created=Math.max(new Date(m.created_at).getTime(),project.assignment_start_at?new Date(project.assignment_start_at).getTime():0);
  if(m.deadline_mode==='RELATIVE'&&m.relative_to_milestone_id){const preceding=(await db.from('milestones').select('completed_reported_at').eq('id',m.relative_to_milestone_id).maybeSingle()).data;created=Math.max(created,new Date(preceding.completed_reported_at).getTime());}const span=Math.max(3600000,due-created);const elapsed=nowMs-created;
  if(!Number.isFinite(due)||nowMs<created)continue;
  const late=due<nowMs;
  // Routine project updates are notified once per project above, not once per milestone.
  // Milestone overdue remains an objective exception, not a second daily status request.
  if(late)await queueSystemNotice(db,'MILESTONE_OVERDUE','MILESTONE',m.id);
 }
 // Delegated evaluation: actionable reminders only, not noise for every historical edit.
 // Legacy per-update review-request escalation is superseded by the 24h project check.
 const {data:projects}=await db.from('initiatives').select('*').eq('cycle_id',currentCycleId).eq('setup_status','ACTIVE').not('status','in','("COMPLETED","CANCELLED")');
 for(const project of projects||[]){
  if(project.lifecycle_state==='POSTPONED'||pausedIds.has(project.id))continue;
  const due=project.target_due_at?new Date(project.target_due_at).getTime():null;
  if(due&&due<nowMs)await queueSystemNotice(db,'PROJECT_EARLY_WARNING','INITIATIVE',project.id,'SECRETARY');
 }

 const {data:routines}=await db.from('routine_obligations').select('*').eq('cycle_id',currentCycleId).eq('active',true);
 for(const r of routines||[]){const due=new Date(r.next_due_at).getTime();if(due<nowMs){await queueSystemNotice(db,'ROUTINE_OVERDUE','ROUTINE',r.id);await inboxNotify(db,r.owner_id,'ROUTINE_OVERDUE',`استحقاق دوري متأخر: ${r.title}`,'ارفع التقرير أو وضّح العائق.','ROUTINE',r.id,'/workspace/routine')}else if(due-nowMs<=dueSoon){await queueSystemNotice(db,'ROUTINE_DUE_SOON','ROUTINE',r.id);await inboxNotify(db,r.owner_id,'ROUTINE_DUE_SOON',`استحقاق دوري قريب: ${r.title}`,null,'ROUTINE',r.id,'/workspace/routine')}}

 const {data:tasks}=await db.from('quick_tasks').select('*').eq('cycle_id',currentCycleId).not('status','in','("DONE","CANCELLED")');for(const t of tasks||[]){if(!t.due_at)continue;const due=new Date(t.due_at).getTime();if(due<nowMs){await inboxNotify(db,t.assignee_id,'TASK_OVERDUE',`مهمة متأخرة: ${t.title}`,'حدّث حالتها أو اذكر العائق.','TASK',t.id,'/workspace/tasks');if(t.assigned_by)await inboxNotify(db,t.assigned_by,'TASK_OVERDUE_MANAGER',`مهمة متأخرة: ${t.title}`,null,'TASK',t.id,'/workspace/tasks')}else if(due-nowMs<=24*3600000)await inboxNotify(db,t.assignee_id,'TASK_DUE_SOON',`موعد المهمة قريب: ${t.title}`,null,'TASK',t.id,'/workspace/tasks')}

 // Generate upcoming recurring group events once, then create individual attendance rows.
 const eventWindow=new Date(nowMs+7*86400000).toISOString();const {data:eventTemplates}=await db.from('position_event_templates').select('*,position:operational_positions(*)').eq('active',true).lte('next_event_at',eventWindow);
 for(const t of eventTemplates||[]){if(t.position?.cycle_id!==currentCycleId)continue;const when=t.next_event_at;let e=(await db.from('work_events').select('*').eq('template_id',t.id).eq('scheduled_at',when).maybeSingle()).data;if(!e){const ins=await db.from('work_events').insert({secretariat_id:t.position.secretariat_id,template_id:t.id,position_id:t.position_id,title:t.title,scheduled_at:when,created_by:t.created_by}).select().single();if(ins.error)throw ins.error;e=ins.data;const assignments=(await db.from('position_assignments').select('*').eq('position_id',t.position_id).eq('active',true)).data||[];if(assignments.length)await db.from('event_attendance').insert(assignments.map((a:any)=>({event_id:e.id,profile_id:a.profile_id,assignment_id:a.id})));for(const a of assignments)await inboxNotify(db,a.profile_id,'EVENT_UPCOMING',`موعد قادم: ${t.title}`,null,'EVENT',e.id,'/workspace/routine')}
  const next=new Date(when);next.setUTCDate(next.getUTCDate()+Number(t.interval_days||30));await db.from('position_event_templates').update({next_event_at:next.toISOString()}).eq('id',t.id)
 }

 const {data:ps}=await db.from('proposals').select('*').eq('cycle_id',currentCycleId).in('status',['WITH_SECRETARY','WITH_GS']);for(const p of ps||[]){const due=p.status==='WITH_GS'?p.gs_due_at:p.secretary_due_at;if(!due)continue;const t=new Date(due).getTime();const event=t<nowMs?'PROPOSAL_OVERDUE':'PROPOSAL_DUE_SOON';if(t<nowMs||t-nowMs<=dueSoon)await queueSystemNotice(db,event,'PROPOSAL',p.id)}
 return json({ok:true,processedJobs:(jobs||[]).length,recoveredJobs:(stuck||[]).length});}catch(e:any){console.error(e);return json({error:e?.message||String(e)},500)}});
