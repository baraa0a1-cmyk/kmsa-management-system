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

 // Requests are proportional to the milestone duration, not a daily/weekly reporting obligation.
 // A reminder is not a finding of negligence; no supervisor approval blocks execution.
 const dueSoon=72*3600000;
 const {data:ms}=await db.from('milestones').select('*,result:results(initiative_id,initiative:initiatives(id,title,cycle_id,owner_id,secretary_id,setup_status,approval_status,status,lifecycle_state,assignment_start_at))').not('status','in','("VERIFIED","CANCELLED","READY_FOR_VERIFICATION")');
 for(const m of ms||[]){
  const project=m.result?.initiative;if(!project||project.cycle_id!==currentCycleId||project.setup_status!=='ACTIVE'||project.approval_status!=='APPROVED'||['COMPLETED','CANCELLED'].includes(project.status)||project.lifecycle_state==='POSTPONED')continue;
  // Relative milestones start after their predecessor finishes; its earlier planned date is only a forecast.
  if(m.deadline_mode==='RELATIVE'&&m.relative_to_milestone_id){const previous=(await db.from('milestones').select('completed_reported_at').eq('id',m.relative_to_milestone_id).maybeSingle()).data;if(!previous?.completed_reported_at)continue;}
  const due=new Date(m.due_at).getTime();let created=Math.max(new Date(m.created_at).getTime(),project.assignment_start_at?new Date(project.assignment_start_at).getTime():0);
  if(m.deadline_mode==='RELATIVE'&&m.relative_to_milestone_id){const preceding=(await db.from('milestones').select('completed_reported_at').eq('id',m.relative_to_milestone_id).maybeSingle()).data;created=Math.max(created,new Date(preceding.completed_reported_at).getTime());}const span=Math.max(3600000,due-created);const elapsed=nowMs-created;
  if(!Number.isFinite(due)||nowMs<created)continue;
  const {data:progress}=await db.from('project_activity_entries').select('created_at,details').eq('milestone_id',m.id).eq('kind','MILESTONE_UPDATE').order('created_at',{ascending:false}).limit(30);
  const lastProgress=(progress||[]).find((e:any)=>['PROGRESS','COMPLETE'].includes(String(e.details?.update_type||'PROGRESS')));
  const lastProgressMs=lastProgress?new Date(lastProgress.created_at).getTime():created;
  const lastReportMs=(progress||[]).length?new Date(progress![0].created_at).getTime():created;
  const remaining=due-nowMs;const proportion=span<=3*86400000?86400000:span<=14*86400000?span*.25:span*.5;
  const firstCheck=span<=3*86400000?due-86400000:span<=14*86400000?due-span*.25:created+span*.5;
  const late=remaining<0;
  const needsInfo=late?lastReportMs<due:(nowMs>=firstCheck&&lastReportMs<firstCheck); // a truthful 'no progress' reply counts as a reply, not achievement
  if(needsInfo){
   const {data:recentReminder}=await db.from('notification_log').select('id').eq('event_type','MILESTONE_CONFIRM_STATUS').eq('entity_type','MILESTONE').eq('entity_id',m.id).gte('created_at',new Date(nowMs-(late?24:72)*3600000).toISOString()).limit(1);
   if(!(recentReminder||[]).length){
    const delivered=await inboxNotify(db,m.owner_id,'MILESTONE_CONFIRM_STATUS',`مشروع ${project.title}: يرجى تأكيد الوضع — ${m.title}`,late?'المحطة تجاوزت موعدها. حدّث آخر ما حدث أو سجل عدم تقدم.':'اقترب موعد المحطة ولم تصل معلومة كافية؛ حدّث آخر ما حدث.','MILESTONE',m.id,`/workspace/projects/${project.id}?milestone=${m.id}&action=update`);
    if(delivered)await db.from('notification_log').insert({channel:'SYSTEM',recipient:m.owner_id,event_type:'MILESTONE_CONFIRM_STATUS',entity_type:'MILESTONE',entity_id:m.id,status:'SENT'});
   }
   // An unanswered reminder becomes a supervision issue after 48h, not an automatic accusation.
   const {data:oldReminders}=await db.from('notification_log').select('created_at').eq('event_type','MILESTONE_CONFIRM_STATUS').eq('entity_type','MILESTONE').eq('entity_id',m.id).lt('created_at',new Date(nowMs-48*3600000).toISOString()).order('created_at',{ascending:false}).limit(1);
   if((oldReminders||[]).length&&lastProgressMs<new Date(oldReminders![0].created_at).getTime()){
    const assigned=(await db.from('project_supervision_assignments').select('supervisor_id').eq('initiative_id',project.id).maybeSingle()).data?.supervisor_id||project.secretary_id;
    if(assigned)await inboxNotify(db,assigned,'MILESTONE_AWAITING_CLARIFICATION',`محطة تحتاج استيضاحًا: ${m.title}`,'طلب النظام تأكيد الوضع ولم يظهر تقدم موثق بعد؛ راجع المسؤول عند الحاجة.','MILESTONE',m.id,`/workspace/projects/${project.id}`);
   }
  }
  // v5.7: no parallel legacy checkpoint alerts. Version-bound delegated review requests
  // below are the single source of truth for supervisor accountability.
  if(late)await queueSystemNotice(db,'MILESTONE_OVERDUE','MILESTONE',m.id);
 }
 // Delegated evaluation: actionable reminders only, not noise for every historical edit.
 const {data:delegations}=await db.from('project_supervision_assignments').select('initiative_id,supervisor_id,assigned_at');
 for(const delegation of delegations||[]){
  const projectQ=await db.from('initiatives').select('id,title,cycle_id,secretary_id,status,lifecycle_state,approval_status').eq('id',delegation.initiative_id).maybeSingle();
  const project=projectQ.data;
  if(!project||project.cycle_id!==currentCycleId||!project.secretary_id||project.secretary_id===delegation.supervisor_id||project.approval_status!=='APPROVED'||['COMPLETED','CANCELLED'].includes(project.status)||project.lifecycle_state==='POSTPONED')continue;
  // Only latest update per milestone. Otherwise stale revisions generate false alarms.
  const recentQ=await db.from('project_activity_entries').select('id,milestone_id,created_at,note').eq('initiative_id',project.id).eq('kind','MILESTONE_UPDATE').gte('created_at',new Date(nowMs-30*86400000).toISOString()).order('created_at',{ascending:false}).limit(100);
  if(recentQ.error){console.error('delegated updates',recentQ.error);continue;}
  const seen=new Set<string>();
  for(const update of recentQ.data||[]){
   if(seen.has(update.milestone_id))continue;seen.add(update.milestone_id);
   if(nowMs-new Date(update.created_at).getTime()<48*3600000||(delegation.assigned_at&&new Date(update.created_at)<new Date(delegation.assigned_at)))continue;
   const reviewQ=await db.from('milestone_supervision_events').select('id').eq('source_activity_id',update.id).eq('actor_id',delegation.supervisor_id).in('event_type',['PROGRESS_OK','PROGRESS_FOLLOW_UP','RESULT_OK','RESULT_REVISION']).limit(1);
   if(reviewQ.error){console.error('delegated review',reviewQ.error);continue;}if(reviewQ.data?.length)continue;
   const requestsQ=await db.from('project_supervision_followups').select('review_request_attempt,followup_due_at').eq('source_activity_id',update.id).eq('delegated_supervisor_id',delegation.supervisor_id).not('review_request_attempt','is',null).order('review_request_attempt',{ascending:false});
   if(requestsQ.error){console.error('delegated requests',requestsQ.error);continue;}
   const reqs=requestsQ.data||[];
   if(reqs.length===0){
    await inboxNotify(db,project.secretary_id,'DELEGATED_REVIEW_REQUEST_FIRST',`مشروع ${project.title}: تقييم النائب متأخر`, 'مرّت 48 ساعة على تحديث دون تقييم؛ المطلوب إرسال طلب تقييم أول للنائب.','ACTIVITY',update.id,'/workspace/projects?tab=supervision');
   }else if(nowMs>=new Date(reqs[0].followup_due_at).getTime()){
    if(reqs.length===1){
     await inboxNotify(db,project.secretary_id,'DELEGATED_REVIEW_REQUEST_SECOND',`مشروع ${project.title}: الطلب الأول دون استجابة`,'انقضت 24 ساعة على طلب التقييم الأول؛ المطلوب إرسال طلب تقييم ثانٍ للنائب لنفس التحديث.','ACTIVITY',update.id,'/workspace/projects?tab=supervision');
    }else{
     await inboxNotify(db,project.secretary_id,'DELEGATED_REVIEW_ESCALATION',`مشروع ${project.title}: طلبا التقييم بلا استجابة`,'لا ترسل طلبًا ثالثًا تلقائيًا؛ راجع سبب عدم الاستجابة وتدخل أو غيّر المتابع عند الحاجة.','ACTIVITY',update.id,'/workspace/projects?tab=supervision');
    }
   }
  }
 }

 const {data:projects}=await db.from('initiatives').select('*').eq('cycle_id',currentCycleId).eq('setup_status','ACTIVE').not('status','in','("COMPLETED","CANCELLED")');
 for(const project of projects||[]){
  if(project.lifecycle_state==='POSTPONED')continue;
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
