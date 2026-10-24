import { adminClient, corsHeaders, env, json } from '../_shared/common.ts';
async function send(chatId:string,text:string,url?:string){const body:any={chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true};if(url)body.reply_markup={inline_keyboard:[[{text:'فتح في نظام الرابطة',url}]]};const r=await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.description||'Telegram failed');return d.result?.message_id}

Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});try{
 if((req.headers.get('x-internal-secret')||'')!==env('FUNCTION_INTERNAL_SECRET'))return json({error:'forbidden'},403);
 const {event,entity_type,entity_id,payload={}}=await req.json();const db=adminClient();const base=env('SYSTEM_BASE_URL').replace(/\/$/,'');let recipients:any[]=[];let title='تحديث من نظام الرابطة';let memberUrl=base;let staffUrl=base;let proposalApplicantId:string|null=null;
 if(entity_type==='PROPOSAL'){
  const p=(await db.from('proposals').select('*,secretariat:secretariats(name_ar)').eq('id',entity_id).single()).data;if(!p)throw new Error('Proposal not found');
  const applicant=(await db.from('profiles').select('*').eq('id',p.applicant_id).single()).data;
  const secretary=(await db.from('profiles').select('*').eq('secretariat_id',p.secretariat_id).eq('role','SECRETARY').eq('active',true).maybeSingle()).data;
  const oversight=(await db.from('profiles').select('*').in('role',['GS','PRESIDENT','ADMIN']).eq('active',true)).data||[];
  proposalApplicantId=p.applicant_id;memberUrl=`${base}/#/proposals/${p.id}`;staffUrl=`${base}/#/workspace/proposals/${p.id}`;
  if(event==='NEW_PROPOSAL')recipients=[secretary];
  else if(event==='WITH_GS')recipients=[applicant,...oversight];
  else if(['REVISION_REQUESTED','APPROVED','NOT_APPROVED','DEFERRED','WITHDRAWN','EXECUTION_STATUS_CHANGED'].includes(event))recipients=[applicant,secretary,...oversight];
  else recipients=[applicant,secretary];
  title=`<b>${p.title}</b>\n${p.secretariat?.name_ar||''}\n${payload.note||''}`;
 }
 if(entity_type==='MILESTONE'){
  const m=(await db.from('milestones').select('*,owner:profiles!milestones_owner_id_fkey(*),secretariat:secretariats(name_ar)').eq('id',entity_id).single()).data;if(!m)throw new Error('Milestone not found');
  const secretary=(await db.from('profiles').select('*').eq('secretariat_id',m.secretariat_id).eq('role','SECRETARY').eq('active',true).maybeSingle()).data;
  const oversight=(await db.from('profiles').select('*').in('role',['GS','PRESIDENT','ADMIN']).eq('active',true)).data||[];
  staffUrl=memberUrl=`${base}/#/workspace/milestones/${m.id}`;
  recipients=event==='MILESTONE_READY'||event==='MILESTONE_BLOCKED'?[secretary,...oversight]:[m.owner,secretary,...oversight];
  title=`<b>${m.title}</b>\n${m.secretariat?.name_ar||''}`;
 }
 if(entity_type==='INITIATIVE'){
  const p=(await db.from('initiatives').select('*,owner:profiles!initiatives_owner_id_fkey(*),secretary:profiles!initiatives_secretary_id_fkey(*),secretariat:secretariats(name_ar)').eq('id',entity_id).single()).data;if(!p)throw new Error('Project not found');
  const oversight=(await db.from('profiles').select('*').in('role',['GS','PRESIDENT','ADMIN']).eq('active',true)).data||[];staffUrl=memberUrl=`${base}/#/workspace/projects/${p.id}`;
  if(event==='RESULT_ASSIGNMENT')recipients=[p.owner];
  else if(event==='PROJECT_PERMISSION_PENDING'&&payload.permission_id){
   const {data:approvals}=await db.from('project_permission_approvals').select('*').eq('permission_id',payload.permission_id).eq('status','PENDING');
   const pending=approvals||[];const targetIds=[...new Set(pending.filter((a:any)=>a.approval_kind==='TARGET_SECRETARY'&&a.target_secretariat_id).map((a:any)=>a.target_secretariat_id))];
   const targetSecretaries=targetIds.length?(await db.from('profiles').select('*').in('secretariat_id',targetIds).eq('role','SECRETARY').eq('active',true)).data||[]:[];
   const needsProjectSecretary=pending.some((a:any)=>a.approval_kind==='PROJECT_SECRETARY');const needsExecutive=pending.some((a:any)=>a.approval_kind==='EXECUTIVE_COMMITTEE');
   recipients=[...(needsProjectSecretary?[p.secretary]:[]),...targetSecretaries,...(needsExecutive?oversight:[])];
  }
  else if(['RESULT_ACCEPTED','PROJECT_NEEDS_ATTENTION','PROJECT_EARLY_WARNING','RESULT_ASSIGNMENT_RETURNED'].includes(event))recipients=[p.secretary,...oversight];
  else if(['PROJECT_PERMISSION_GRANTED','PROJECT_PERMISSION_REJECTED','SECRETARY_INTERVENTION'].includes(event))recipients=[p.owner,p.secretary];
  else if(event==='PROJECT_OVERSIGHT_NOTE')recipients=[p.secretary];
  else recipients=[p.owner,p.secretary];
  title=`<b>${p.title}</b>\n${p.secretariat?.name_ar||''}`;
 }
 const unique=new Map(recipients.filter(Boolean).map(r=>[r.id,r]));
 for(const r of unique.values()){
  if(!r.telegram_chat_id)continue;const url=entity_type==='PROPOSAL'&&r.id===proposalApplicantId?memberUrl:staffUrl;
  try{const mid=await send(r.telegram_chat_id,`🔔 ${event}\n\n${title}`,url);await db.from('notification_log').insert({channel:'TELEGRAM',recipient:r.telegram_chat_id,event_type:event,entity_type,entity_id,status:'SENT',provider_message_id:String(mid||'')})}catch(e:any){await db.from('notification_log').insert({channel:'TELEGRAM',recipient:r.telegram_chat_id,event_type:event,entity_type,entity_id,status:'FAILED',error:e?.message||String(e)})}
 }
 return json({ok:true,count:unique.size});
}catch(e:any){console.error(e);return json({error:e?.message||String(e)},500)}});
