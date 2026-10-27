import { anonClient, audit, canManageSecretariat, corsHeaders, hasOversight, hoursFromNow, inboxNotify, isGs, json, queueJob, requestUser, setting } from '../_shared/common.ts';

const editableProposalStatuses=['DRAFT','WITH_SECRETARY','REVISION_REQUESTED','REVISED','DEFERRED'];
const terminalProposalStatuses=['NOT_APPROVED','WITHDRAWN'];

function proposalSnapshot(p:any){
 const keys=['title','applicant_name','applicant_email','secretariat_id','proposal_type','proposed_period','needed_by','urgency','urgency_reason','primary_beneficiaries','trigger_reality','primary_benefit','secondary_benefits','intervention','success_criterion','context_factors','funding_needed','funding_dependence','estimated_cost','funding_source'];
 return Object.fromEntries(keys.map(k=>[k,p[k]??null]));
}
function formToProposal(form:any){return {
 title:String(form.title||'').trim(), applicant_name:String(form.applicantName||'').trim(), applicant_email:String(form.applicantEmail||'').trim().toLowerCase(),
 secretariat_id:form.secretariatId, proposal_type:form.proposalType||'GENERAL', proposed_period:form.proposedPeriod||null, needed_by:form.neededBy?new Date(form.neededBy).toISOString():null,
 urgency_reason:form.urgencyReason||null, primary_beneficiaries:form.primaryBeneficiaries||null, trigger_reality:form.triggerReality||null,
 primary_benefit:form.primaryBenefit||null, secondary_benefits:form.secondaryBenefits||null, intervention:form.intervention||null,
 success_criterion:form.successCriterion||null, context_factors:form.contextFactors||null, funding_needed:form.fundingNeeded||'UNKNOWN',
 funding_dependence:form.fundingDependence||'UNKNOWN', estimated_cost:form.estimatedCost||null, funding_source:form.fundingSource||null
}}
async function getProposal(db:any,id:string){const {data,error}=await db.from('proposals').select('*').eq('id',id).single();if(error)throw error;const current=(await db.from('cycles').select('id').eq('is_current',true).single()).data?.id;if(!current||data.cycle_id!==current)throw new Error('هذا المقترح من دورة مؤرشفة.');return data}
async function getMilestone(db:any,id:string){const {data,error}=await db.from('milestones').select('*').eq('id',id).single();if(error)throw error;
 const r=await db.from('results').select('initiative_id').eq('id',data.result_id).single();if(r.error)throw r.error;
 const owner=await db.from('initiatives').select('cycle_id').eq('id',r.data.initiative_id).single();if(owner.error)throw owner.error;
 const active=(await db.from('cycles').select('id').eq('is_current',true).single()).data?.id;
 if(!active||owner.data.cycle_id!==active)throw new Error('محطة من دورة مؤرشفة؛ لا يمكن تعديلها.');
 return data}
async function action(db:any,p:any,profile:any,type:string,toStatus?:string,note?:string,meta:any={}){
 const before=p.status; const patch:any={}; if(toStatus)patch.status=toStatus;
 if(toStatus==='WITH_SECRETARY'||toStatus==='REVISED')patch.secretary_due_at=hoursFromNow(Number(await setting(db,'secretary_sla_hours',48)));
 if(toStatus==='WITH_GS')patch.gs_due_at=hoursFromNow(Number(await setting(db,'gs_sla_hours',48)));
 if(toStatus==='APPROVED'){patch.approved_at=new Date().toISOString();patch.approved_version=p.current_version;}
 if(toStatus==='WITHDRAWN')patch.withdrawn_at=new Date().toISOString();
 let updated=p; if(Object.keys(patch).length){const r=await db.from('proposals').update(patch).eq('id',p.id).select().single();if(r.error)throw r.error;updated=r.data}
 await db.from('proposal_actions').insert({proposal_id:p.id,actor_id:profile.id,actor_role:profile.role,action_type:type,from_status:before,to_status:toStatus||before,note_text:note||null,meta});
 await audit(db,profile,type,'PROPOSAL',p.id,p,updated,meta); return updated;
}
function kickBackgroundWorker(){
 try{const base=Deno.env.get('SUPABASE_URL');const secret=Deno.env.get('FUNCTION_INTERNAL_SECRET');if(!base||!secret)return;EdgeRuntime.waitUntil(fetch(`${base}/functions/v1/scheduled-monitor`,{method:'POST',headers:{'Content-Type':'application/json','x-internal-secret':secret},body:'{}'}).catch(()=>null))}catch{}
}
async function queueProposalArtifacts(db:any,p:any,versionNo:number){
 const payload={proposal_id:p.id,version_no:versionNo};
 const jobId=await queueJob(db,'DOCUMENT_PROPOSAL','PROPOSAL',p.id,payload,`proposal-doc:${p.id}:${versionNo}`);
 kickBackgroundWorker();
 return {queued:true,jobId};
}
async function archiveProposalUpload(db:any,p:any,versionNo:number,payload:any){
 const jobPayload={mode:'ARCHIVE_STAGING_PROPOSAL',proposal_id:p.id,version_no:versionNo,storage_path:payload.stagingPath,file_name:payload.fileName,mime_type:payload.mimeType};
 const jobId=await queueJob(db,'ARCHIVE_STAGING_PROPOSAL','PROPOSAL',p.id,jobPayload,`proposal-upload:${p.id}:${versionNo}`);
 kickBackgroundWorker();
 return {queued:true,jobId};
}
async function queueNotice(db:any,event:string,entityType:string,entityId:string,payload:any={}){
 await queueJob(db,'TELEGRAM_NOTIFY',entityType,entityId,{event,...payload},`notify:${event}:${entityType}:${entityId}`);
 if(entityType==='PROPOSAL'){
  const p=(await db.from('proposals').select('id,title,applicant_id,secretariat_id').eq('id',entityId).maybeSingle()).data;if(!p)return;
  const secretary=(await db.from('profiles').select('id').eq('role','SECRETARY').eq('secretariat_id',p.secretariat_id).eq('active',true).limit(1).maybeSingle()).data?.id||null;
  const gsIds=((await db.from('profiles').select('id').eq('role','GS').eq('active',true)).data||[]).map((x:any)=>x.id);
  if(event==='NEW_PROPOSAL'&&secretary)await inboxNotify(db,secretary,event,`مقترح جديد: ${p.title}`,'وصل مقترح جديد للمراجعة.','PROPOSAL',p.id,`/workspace/proposals/${p.id}`);
  if(event==='REVISION_UPLOADED'&&secretary)await inboxNotify(db,secretary,event,`وصل تعديل: ${p.title}`,'رفع مقدم المقترح نسخة معدلة.','PROPOSAL',p.id,`/workspace/proposals/${p.id}`);
  if(event==='REVISION_REQUESTED')await inboxNotify(db,p.applicant_id,event,`المقترح يحتاج تعديلًا: ${p.title}`,payload.note||'راجع الملاحظات وارفع النسخة المعدلة.','PROPOSAL',p.id,`/proposals/${p.id}`);
  if(event==='WITH_GS')for(const id of gsIds)await inboxNotify(db,id,event,`مقترح بانتظار الإجازة: ${p.title}`,null,'PROPOSAL',p.id,`/workspace/proposals/${p.id}`);
  if(['APPROVED','NOT_APPROVED','DEFERRED'].includes(event)){const title=event==='APPROVED'?`تمت إجازة المقترح: ${p.title}`:event==='DEFERRED'?`تم تأجيل النظر: ${p.title}`:`لم تتم إجازة المقترح: ${p.title}`;await inboxNotify(db,p.applicant_id,event,title,null,'PROPOSAL',p.id,`/proposals/${p.id}`);if(secretary)await inboxNotify(db,secretary,event,title,null,'PROPOSAL',p.id,`/workspace/proposals/${p.id}`)}
 }
 if(entityType==='INITIATIVE'&&event==='PROJECT_PENDING_GS'){const init=(await db.from('initiatives').select('id,title').eq('id',entityId).maybeSingle()).data;const gsIds=((await db.from('profiles').select('id').eq('role','GS').eq('active',true)).data||[]).map((x:any)=>x.id);for(const id of gsIds)await inboxNotify(db,id,event,`قرار تكليف بانتظار الاعتماد: ${init?.title||'مشروع'}`,null,'INITIATIVE',entityId,`/workspace/projects/${entityId}`)}
}
async function getInitiative(db:any,id:string){const {data,error}=await db.from('initiatives').select('*').eq('id',id).single();if(error)throw error;const current=(await db.from('cycles').select('id').eq('is_current',true).single()).data?.id;if(!current||data.cycle_id!==current)throw new Error('هذا المشروع يتبع دورة مؤرشفة ولا يمكن تعديله.');return data}
async function getResult(db:any,id:string){const {data,error}=await db.from('results').select('*,initiative:initiatives(*)').eq('id',id).single();if(error)throw error;const active=(await db.from('cycles').select('id').eq('is_current',true).single()).data?.id;if(!active||data?.initiative?.cycle_id!==active)throw new Error('هذا العمل تابع لدورة سابقة، وهو محفوظ للعرض فقط.');return data}
function canSuperviseProject(profile:any,initiative:any){return initiative.secretary_id===profile.id||(profile.role==='SECRETARY'&&profile.secretariat_id===initiative.secretariat_id)}
function isProjectLead(profile:any,initiative:any,result?:any){return initiative.owner_id===profile.id||result?.owner_id===profile.id}

async function computedProjectHealth(db:any,initiativeId:string){
 const results=await db.from('results').select('id').eq('initiative_id',initiativeId);if(results.error)throw results.error;
 const ids=(results.data||[]).map((x:any)=>x.id);if(!ids.length)return 'ON_TRACK';
 const milestones=await db.from('milestones').select('id,status,due_at').in('result_id',ids).neq('design_status','REJECTED');if(milestones.error)throw milestones.error;
 const ms=milestones.data||[];const mids=ms.map((x:any)=>x.id);let open=false;
 if(mids.length){const blocker=await db.from('blockers').select('id',{count:'exact',head:true}).in('milestone_id',mids).eq('status','OPEN');if(blocker.error)throw blocker.error;open=(blocker.count||0)>0;}
 if(open||ms.some((m:any)=>m.status==='BLOCKED'))return 'BLOCKED';
 if(ms.some((m:any)=>m.status==='AT_RISK'))return 'AT_RISK';
 if(ms.some((m:any)=>m.due_at&&new Date(m.due_at).getTime()<Date.now()&&!['VERIFIED','CANCELLED'].includes(m.status)))return 'WATCH';
 return 'ON_TRACK';
}

const STANDARD_PROJECT_PERMISSIONS=[
 ['UPDATE_PROGRESS','تحديث حالة التقدم','تحديث واقع المشروع والخطوة التالية ونقطة المتابعة القادمة.'],
 ['MANAGE_MILESTONES','المساهمة في محطات الإنجاز','اقتراح محطات الإنجاز وتعديلها أثناء مرحلة تصميم التنفيذ.'],
 ['ADD_EVIDENCE','رفع أدلة الإنجاز','إضافة الروابط والملفات والملاحظات التي تثبت الإنجاز.'],
 ['RAISE_BLOCKERS','رفع العوائق وطلب الدعم','تسجيل العائق فور ظهوره وطلب تدخل السكرتير قبل التأخير.'],
 ['VIEW_FILES','الوصول إلى ملفات المشروع','الاطلاع على الملفات المرتبطة بالمشروع ومحطات الإنجاز.']
];
async function ensureStandardPermissions(db:any,initiative:any,leadId:string,secretaryId:string){
 const rows=STANDARD_PROJECT_PERMISSIONS.map(([key,title,description])=>({initiative_id:initiative.id,permission_key:key,title,description,permission_type:'STANDARD',scope_type:'OWN_SECRETARIAT',requested_by:secretaryId,requested_for:leadId,status:'ACTIVE',decided_by:secretaryId,decided_at:new Date().toISOString()}));
 const {error}=await db.from('project_permissions').upsert(rows,{onConflict:'initiative_id,permission_key,requested_for'});if(error)throw error;
}

async function createPermissionApprovals(db:any,permission:any,initiative:any,requester:any,scope:string,targetSecretariatId?:string|null){
 const approvals:any[]=[];const requesterIsSupervisor=canSuperviseProject(requester,initiative);
 if(!requesterIsSupervisor)approvals.push({permission_id:permission.id,approval_kind:'PROJECT_SECRETARY',status:'PENDING'});
 if(scope==='CROSS_SECRETARIAT')approvals.push({permission_id:permission.id,approval_kind:'TARGET_SECRETARY',target_secretariat_id:targetSecretariatId,status:'PENDING'});
 if(scope==='EXECUTIVE_COMMITTEE')approvals.push({permission_id:permission.id,approval_kind:'EXECUTIVE_COMMITTEE',status:'PENDING'});
 if(approvals.length){const {error}=await db.from('project_permission_approvals').insert(approvals);if(error)throw error}
 return approvals.length;
}
async function syncPermissionApprovalState(db:any,permissionId:string){
 const {data:approvals,error}=await db.from('project_permission_approvals').select('*').eq('permission_id',permissionId);if(error)throw error;
 const list=approvals||[];let status='PENDING';if(list.some((x:any)=>x.status==='REJECTED'))status='REJECTED';else if(list.length&&list.every((x:any)=>x.status==='APPROVED'))status='ACTIVE';else if(!list.length)status='ACTIVE';
 const patch:any={status};if(status==='ACTIVE'||status==='REJECTED')patch.decided_at=new Date().toISOString();const u=await db.from('project_permissions').update(patch).eq('id',permissionId).select().single();if(u.error)throw u.error;return u.data;
}
async function syncProjectCompletion(db:any,resultId:string){
 // Completing all milestones is a delivery claim, NOT a decision to close the project.
 // Closure is a separate supervisor request approved by the secretary.
 const {data:result}=await db.from('results').select('initiative_id').eq('id',resultId).single();if(!result)return;
 const {data:ms,error}=await db.from('milestones').select('status,design_status').eq('result_id',resultId).neq('design_status','REJECTED');if(error)throw error;
 const active=(ms||[]).filter((m:any)=>m.design_status==='APPROVED');
 if(active.length&&active.every((m:any)=>['READY_FOR_VERIFICATION','VERIFIED'].includes(m.status))){
  const r=await db.from('results').update({assignment_status:'COMPLETED',completed_at:new Date().toISOString()}).eq('id',resultId);if(r.error)throw r.error;
 }else{
  // A corrected/reopened milestone reopens the result, not the lifecycle decision.
  const r=await db.from('results').update({assignment_status:'ACTIVE',completed_at:null}).eq('id',resultId).eq('assignment_status','COMPLETED');if(r.error)throw r.error;
 }
}


function validateStagingFile(profile:any,payload:any,proposal:boolean){
 const path=String(payload.stagingPath||'');if(!path||!path.startsWith(`${profile.id}/`)||path.includes('..'))throw new Error('مسار رفع الملف غير مصرح به.');
 if(proposal){const mime=String(payload.mimeType||'');if(!['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mime))throw new Error('المقترحات تقبل PDF أو DOCX فقط.');}
}
function isoDate(v:any){if(!v)return null;const d=new Date(v);if(Number.isNaN(d.getTime()))return null;return d.toISOString()}
function addDaysIso(base:string,days:number){const d=new Date(base);d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString()}
function addOffsetIso(base:string,days:number,hours:number){return new Date(new Date(base).getTime()+(Number(days||0)*24+Number(hours||0))*3600000).toISOString()}
function actualOrPlannedBase(m:any){return m.completed_reported_at||m.due_at;}
// Executive secretary may review their own project; a deputy/ordinary lead may not.
function reviewIdentityAllowed(profile:any,init:any,m:any){
 return profile.id!==m.owner_id || (profile.id===init.secretary_id && profile.role==='SECRETARY');
}
async function projectLedger(db:any,profile:any,initiativeId:string,kind:string,note:string,milestoneId:string|null=null,details:any={}){
 const res=await db.from('project_activity_entries').insert({initiative_id:initiativeId,author_id:profile.id,milestone_id:milestoneId,kind,note,details});if(res.error)throw res.error;
}
async function canFollowProject(db:any,profile:any,init:any){
 if(canSuperviseProject(profile,init))return true;
 if(init.approval_status!=='APPROVED')return false;
 const {data}=await db.from('project_supervision_assignments').select('supervisor_id').eq('initiative_id',init.id).eq('supervisor_id',profile.id).maybeSingle();
 return !!data;
}

async function recalcDependentMilestones(db:any,milestoneId:string){
 const base=await getMilestone(db,milestoneId);const {data:list,error}=await db.from('milestones').select('*').eq('relative_to_milestone_id',milestoneId).eq('deadline_mode','RELATIVE');if(error)throw error;
 for(const m of list||[]){const due=addOffsetIso(actualOrPlannedBase(base),Number(m.relative_days||0),Number(m.relative_hours||0));if(new Date(m.due_at).getTime()!==new Date(due).getTime()){const changed=await db.from('milestones').update({due_at:due,status_updated_at:new Date().toISOString()}).eq('id',m.id);if(changed.error)throw changed.error;await audit(db,null,'MILESTONE_RELATIVE_DUE_RECALCULATED','MILESTONE',m.id,{due_at:m.due_at},{due_at:due},{relative_to:milestoneId});}await recalcDependentMilestones(db,m.id)}
}
async function insertTemplateMilestones(db:any,profile:any,init:any,result:any,items:any[]){
 const created:any[]=[];
 for(let idx=0;idx<items.length;idx++){
  const item=items[idx]||{};const mode=item.deadlineMode==='RELATIVE'?'RELATIVE':'ABSOLUTE';let due:string|null=null;let relativeTo:string|null=null;let relativeDays:number|null=null;let relativeHours=0;
  if(mode==='RELATIVE'){
   const refIndex=item.relativeToIndex===undefined?idx-1:Number(item.relativeToIndex);if(refIndex<0||!created[refIndex])throw new Error(`حدد المحطة السابقة للمحطة رقم ${idx+1}.`);
   relativeTo=created[refIndex].id;relativeDays=Math.max(0,Number(item.relativeDays||0));relativeHours=Math.max(0,Number(item.relativeHours||0));due=addOffsetIso(actualOrPlannedBase(created[refIndex]),relativeDays,relativeHours);
  }else{due=isoDate(item.dueAt);if(!due)throw new Error(`حدد موعد المحطة رقم ${idx+1}.`)}
  const row={result_id:result.id,secretariat_id:init.secretariat_id,owner_id:init.owner_id,title:String(item.title||'').trim(),description:item.description||null,due_at:due,status:'NOT_STARTED',verification_criteria:String(item.verificationCriteria||item.outcomeDefinition||'').trim()||'تحقق النتيجة المحددة للمحطة',priority:item.priority||'NORMAL',created_by:profile.id,design_status:'APPROVED',sequence_no:idx+1,deadline_mode:mode,relative_days:relativeDays,relative_hours:relativeHours,relative_to_milestone_id:relativeTo,status_updated_at:new Date().toISOString()};
  if(!row.title)throw new Error(`اكتب اسم محطة الإنجاز رقم ${idx+1}.`);const r=await db.from('milestones').insert(row).select().single();if(r.error)throw r.error;created.push(r.data);
 }
 return created;
}
async function createTemplateSpecialPermissions(db:any,profile:any,init:any,items:any[]){
 const created:any[]=[];
 for(const item of items||[]){if(!String(item?.title||'').trim())continue;const scope=item.scopeType||'OWN_SECRETARIAT';if(scope==='CROSS_SECRETARIAT'&&!item.targetSecretariatId)throw new Error('حدد السكرتارية صاحبة الاختصاص للصلاحية الإضافية.');
  const row:any={initiative_id:init.id,permission_key:`SPECIAL_${crypto.randomUUID()}`,title:String(item.title).trim(),description:item.description||null,permission_type:'SPECIAL',scope_type:scope,target_secretariat_id:scope==='CROSS_SECRETARIAT'?item.targetSecretariatId:null,requested_by:profile.id,requested_for:init.owner_id,rationale:item.rationale||null,status:scope==='OWN_SECRETARIAT'?'ACTIVE':'PENDING',decided_by:scope==='OWN_SECRETARIAT'?profile.id:null,decided_at:scope==='OWN_SECRETARIAT'?new Date().toISOString():null};
  const r=await db.from('project_permissions').insert(row).select().single();if(r.error)throw r.error;if(scope!=='OWN_SECRETARIAT')await createPermissionApprovals(db,r.data,init,profile,scope,row.target_secretariat_id);created.push(r.data)
 }
 return created;
}

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 try{
  const {profile,db}=await requestUser(req); const body=await req.json(); const actionName=String(body.action||''); const payload=body.payload||{};
  if(!actionName)return json({error:'Missing action'},400);
  if(profile.role==='ADMIN' && !(/^(ADMIN_CYCLE_|ADMIN_BATCH_|ADMIN_RESET_PASSWORD$|ADMIN_MEMBER_SYNC$|ADMIN_SETTINGS_UPDATE$|NOTIFICATION_|ACCOUNT_PASSWORD_CHANGE$)/.test(actionName)||actionName==='PASSWORD_CHANGED'))throw new Error('مدير النظام يدير الدورات والحسابات فقط، ولا يدير أعمال السكرتاريات.');


  // v5.8: Permanent system administration is strictly distinct from organizational office.
  if(actionName.startsWith('ADMIN_CYCLE_')||actionName.startsWith('ADMIN_BATCH_')||actionName==='ADMIN_RESET_PASSWORD'||actionName==='ADMIN_MEMBER_SYNC'){
   if(profile.role!=='ADMIN')throw new Error('مدير النظام فقط يستطيع تنفيذ هذا الإجراء.');
  }
  if(actionName==='ADMIN_MEMBER_SYNC'){
   // Strict identity key: university ID, never a name or email-only match.
   const id=String(payload.profileId||''),uid=String(payload.universityId||'').trim();
   const proposedName=String(payload.name||'').trim();const proposedEmail=String(payload.email||'').trim().toLowerCase();
   const changeName=payload.updateName===true,changeEmail=payload.updateEmail===true;
   if(!id||!uid||(!changeName&&!changeEmail))throw new Error('اختر العضو والحقول التي تريد تحديثها.');
   const existingResult=await db.from('profiles').select('id,auth_user_id,university_id,full_name,email,batch_number,role').eq('id',id).single();
   if(existingResult.error)throw existingResult.error;const existing=existingResult.data;
   if(existing.role==='ADMIN'||String(existing.university_id||'').trim()!==uid)throw new Error('الرقم الجامعي لا يطابق حساب العضو. لم تُجر أي تغييرات.');
   if(changeName&&(proposedName.length<3||proposedName.length>250))throw new Error('اسم العضو غير صالح.');
   if(changeEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposedEmail))throw new Error('البريد الإلكتروني الجديد غير صالح.');
   const oldEmail=String(existing.email||'').trim().toLowerCase(),oldName=String(existing.full_name||'');
   if(changeEmail&&proposedEmail!==oldEmail){
    const conflict=await db.from('profiles').select('id').eq('email',proposedEmail).neq('id',id).limit(1);
    if(conflict.error)throw conflict.error;if(conflict.data?.length)throw new Error('البريد الإلكتروني الجديد مستخدم لحساب آخر.');
   }
   const newEmail=changeEmail?proposedEmail:oldEmail,newName=changeName?proposedName:oldName;
   if(newEmail===oldEmail&&newName===oldName)return json({ok:true,unchanged:true});
   // Do not change passwords, student cohort or university ID. Keep Auth and public profile consistent.
   const authBefore=await db.auth.admin.getUserById(existing.auth_user_id);
   if(authBefore.error||!authBefore.data.user)throw authBefore.error||new Error('تعذر التحقق من حساب الدخول.');
   const authEmail=String(authBefore.data.user.email||'');
   if(changeEmail&&newEmail!==oldEmail){
     const authUpdated=await db.auth.admin.updateUserById(existing.auth_user_id,{email:newEmail});
     if(authUpdated.error)throw authUpdated.error;
   }
   const updated=await db.from('profiles').update({email:newEmail,full_name:newName,updated_at:new Date().toISOString()})
     .eq('id',id).eq('university_id',uid).eq('email',existing.email).select('id,email,full_name').maybeSingle();
   if(updated.error||!updated.data){
     if(changeEmail&&newEmail!==oldEmail){
       const rollback=await db.auth.admin.updateUserById(existing.auth_user_id,{email:authEmail});
       if(rollback.error)throw new Error('تعذر إكمال تحديث البريد أو التراجع عنه. يحتاج الحساب مراجعة إدارية: '+id);
     }
     throw updated.error||new Error('تغيرت بيانات العضو أثناء التحديث؛ أعد فحصها.');
   }
   await audit(db,profile,'ADMIN_MEMBER_SYNC','PROFILE',id,{email:oldEmail,full_name:oldName},{email:newEmail,full_name:newName});
   return json({ok:true,updated:updated.data});
  }
  if(actionName==='ADMIN_BATCH_CREATE'){
   const batch=Number(payload.batch),level=payload.academicLevel==null?null:Number(payload.academicLevel);
   if(!Number.isInteger(batch)||batch<1||batch>999)throw new Error('اختر رقم دفعة صحيحًا.');
   if(level!==null&&(!Number.isInteger(level)||level<1||level>6))throw new Error('المستوى من الأول إلى السادس.');
   const r=await db.from('kmsa_batches').insert({batch_number:batch,display_name:`الدفعة ${batch}`,academic_level:level}).select().single();if(r.error)throw r.error;
   await audit(db,profile,'ADMIN_BATCH_CREATE','BATCH',null,null,{batch});return json({ok:true,batch:r.data});
  }
  if(actionName==='ADMIN_BATCH_UPDATE'){
   const batch=Number(payload.batch);const level=payload.academicLevel==null?null:Number(payload.academicLevel);
   if(!Number.isInteger(batch)||batch<1||batch>999||level!==null&&(!Number.isInteger(level)||level<1||level>6))throw new Error('بيانات دفعة غير صالحة.');
   const old=await db.from('kmsa_batches').select('*').eq('batch_number',batch).single();if(old.error)throw old.error;
   const patch:any={academic_level:level,updated_at:new Date().toISOString()};
   const r=await db.from('kmsa_batches').update(patch).eq('batch_number',batch).select().single();if(r.error)throw r.error;
   await audit(db,profile,'ADMIN_BATCH_UPDATE','BATCH',null,old.data,r.data);return json({ok:true,batch:r.data});
  }
  if(actionName==='ADMIN_BATCH_MEMBER_MOVE'){
   const id=String(payload.profileId||''),batch=Number(payload.toBatch);
   if(!Number.isInteger(batch)||batch<1||batch>999||!id)throw new Error('اختر العضو والدفعة الجديدة.');
   const before=await db.from('profiles').select('id,batch_number').eq('id',id).single();if(before.error)throw before.error;
   const authHeader=req.headers.get('Authorization')||'';
   const {createClient}=await import('npm:@supabase/supabase-js@2');
   const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false}});
   const moved=await caller.rpc('admin_move_kmsa_member',{p_profile_id:id,p_to_batch:batch});if(moved.error)throw moved.error;
   await audit(db,profile,'ADMIN_BATCH_MEMBER_MOVE','PROFILE',id,before.data,{batch_number:batch});return json({ok:true});
  }
  if(actionName==='ADMIN_CYCLE_CREATE'){
   const suffix=String(payload.code||'').trim().replace(/^KMSA/i,'');const code=`KMSA${suffix}`;
   const name=String(payload.name||'').trim();
   if(!/^[0-9]{1,5}$/.test(suffix)||name.length<3||name.length>120)throw new Error('اكتب رمز الدورة بالأرقام واسمًا واضحًا.');
   const c=await db.from('cycles').insert({code,name,status:'DRAFT',is_current:false}).select().single();if(c.error)throw c.error;
   await audit(db,profile,'ADMIN_CYCLE_CREATE','CYCLE',c.data.id,null,{code,name});return json({ok:true,cycle:c.data});
  }
  if(actionName==='ADMIN_CYCLE_UPDATE'){
   const id=String(payload.cycleId||'');const old=await db.from('cycles').select('*').eq('id',id).single();if(old.error)throw old.error;
   const suffix=String(payload.code??old.data.code).trim().replace(/^KMSA/i,'');const code=`KMSA${suffix}`;
   const name=String(payload.name??old.data.name).trim(),startDate=payload.startDate===undefined?old.data.cycle_start_date:payload.startDate||null;
   if(!/^[0-9]{1,5}$/.test(suffix)||name.length<3||name.length>120)throw new Error('رمز أو اسم الدورة غير صالح.');
   const authHeader=req.headers.get('Authorization')||'';
   const {createClient}=await import('npm:@supabase/supabase-js@2');
   const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false}});
   const res=await caller.rpc('admin_update_kmsa_cycle',{p_cycle_id:id,p_code:code,p_name:name,p_start_date:startDate});if(res.error)throw res.error;
   await audit(db,profile,'ADMIN_CYCLE_UPDATE','CYCLE',id,old.data,{code,name,cycle_start_date:startDate});return json({ok:true});
  }
  if(actionName==='ADMIN_CYCLE_BATCH_ADD'||actionName==='ADMIN_CYCLE_BATCH_REMOVE'){
   const cycleId=String(payload.cycleId||''),batch=Number(payload.batch);
   if(!Number.isInteger(batch)||batch<1||batch>999)throw new Error('رقم الدفعة غير صالح.');
   const cycle=(await db.from('cycles').select('id,status').eq('id',cycleId).single()).data;
   if(!cycle||cycle.status==='CLOSED')throw new Error('لا يمكن تعديل دفعات دورة مؤرشفة.');
   const known=(await db.from('kmsa_batches').select('batch_number').eq('batch_number',batch).eq('active',true).maybeSingle()).data;
   if(!known)throw new Error('أنشئ الدفعة أولًا في قسم الدفعات.');
   if(actionName==='ADMIN_CYCLE_BATCH_ADD'){const grad=await db.from('kmsa_batches').select('graduated').eq('batch_number',batch).single();if(grad.error)throw grad.error;if(grad.data?.graduated)throw new Error('الدفعة متخرجة؛ لا يمكن ضمها إلى دورة جديدة.');}
   if(actionName==='ADMIN_CYCLE_BATCH_ADD'){
    const r=await db.from('cycle_batches').upsert({cycle_id:cycleId,batch_number:batch},{onConflict:'cycle_id,batch_number'});if(r.error)throw r.error;
   }else{
    const exec=(await db.from('cycle_memberships').select('profile_id').eq('cycle_id',cycleId).in('role',['PRESIDENT','GS','SECRETARY']).is('ended_at',null)).data||[];
    const assistant=(await db.from('kmsa_cycle_gs_assistants').select('profile_id').eq('cycle_id',cycleId)).data||[];
    const officeIds=[...new Set([...exec,...assistant].map((x:any)=>x.profile_id))];
    if(officeIds.length){const blocked=await db.from('profiles').select('id').eq('batch_number',batch).in('id',officeIds).limit(1);if(blocked.error)throw blocked.error;if(blocked.data?.length)throw new Error('تعذر إزالة الدفعة لأن أحد شاغلي مناصب اللجنة التنفيذية من أفرادها. غيّر التكليف أولًا.');}
    const r=await db.from('cycle_batches').delete().eq('cycle_id',cycleId).eq('batch_number',batch);if(r.error)throw r.error;
   }
   await audit(db,profile,actionName,'CYCLE',cycleId,null,{batch});return json({ok:true});
  }
  if(actionName==='ADMIN_CYCLE_ASSISTANT_SET'||actionName==='ADMIN_CYCLE_LEADER_SET'){
   throw new Error('تم إيقاف طريقة التعيين القديمة. استخدم إدارة القيادة بعد تحديث النظام إلى v6.2.');
  }
  if(actionName==='ADMIN_CYCLE_ACTIVATE'){ throw new Error('اعتماد الدورة متاح فقط من واجهة إدارة v6 الآمنة.');
   const cycleId=String(payload.cycleId||'');if(!cycleId)throw new Error('اختر الدورة.');
   // Pass caller JWT to a restricted SECURITY DEFINER transaction, never mutate cycles row-by-row.
   const authHeader=req.headers.get('Authorization')||'';
   const {createClient}=await import('npm:@supabase/supabase-js@2');
   const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false}});
   const act=await caller.rpc('activate_kmsa_cycle',{p_cycle_id:cycleId});if(act.error)throw act.error;
   await audit(db,profile,'ADMIN_CYCLE_ACTIVATE','CYCLE',cycleId,null,{cycle_id:cycleId});
   return json({ok:true});
  }
  if(actionName==='ADMIN_BATCH_IMPORT'){
   const batch=Number(payload.batch);
   if(!Number.isInteger(batch)||batch<1||batch>999)throw new Error('حدد دفعة صالحة.');
   const known=(await db.from('kmsa_batches').select('batch_number').eq('batch_number',batch).eq('active',true).maybeSingle()).data;
   if(!known)throw new Error('الدفعة غير موجودة. أنشئها أولًا في قسم الدفعات.');
   const entries=payload.people;
   if(!Array.isArray(entries)||!entries.length||entries.length>100)throw new Error('أرسل دفعة استيراد من 1 إلى 100 شخص.');
   const initial=String(payload.initialPassword||'');
   if(initial.length<12||initial.length>128)throw new Error('كلمة المرور الأولية يجب أن تكون 12 حرفًا على الأقل.');
   const seenEmails=new Set<string>(),seenIds=new Set<string>();const results:any[]=[];
   for(let i=0;i<entries.length;i++){
    const raw=entries[i]||{};const email=String(raw.email||'').trim().toLowerCase();const name=String(raw.name||'').trim();const uid=String(raw.universityId||'').trim();
    const validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if(!validEmail||name.length<5||!uid||uid.length>80||seenEmails.has(email)||seenIds.has(uid)){
      results.push({row:i+1,universityId:uid,status:'INVALID',reason:'بيانات ناقصة أو مكررة في هذه المجموعة'});continue;
    }
    seenEmails.add(email);seenIds.add(uid);
    try{
     const byEmail=await db.from('profiles').select('id,university_id,batch_number').eq('email',email).limit(1);
     const byUid=await db.from('profiles').select('id,email,batch_number').eq('university_id',uid).limit(1);
     if(byEmail.error||byUid.error)throw byEmail.error||byUid.error;
     const existingEmail=byEmail.data?.[0],existingUid=byUid.data?.[0];
     if(existingEmail||existingUid){
       if(!existingEmail||!existingUid||existingEmail.id!==existingUid.id||(existingEmail.batch_number&&existingEmail.batch_number!==batch)){results.push({row:i+1,universityId:uid,status:'INVALID',reason:'البريد أو الرقم الجامعي مستخدم لحساب مختلف، يحتاج مراجعة'});continue;}
       if(!existingEmail.batch_number){const patch=await db.from('profiles').update({batch_number:batch}).eq('id',existingEmail.id);if(patch.error)throw patch.error;}
       results.push({row:i+1,universityId:uid,status:'EXISTS',reason:'الحساب موجود، لم تُغير كلمة مروره أو تكليفه'});continue;
     }
     const made=await db.auth.admin.createUser({email,password:initial,email_confirm:true,user_metadata:{full_name:name,must_change_password:true}});
     if(made.error||!made.data.user)throw made.error||new Error('تعذر إنشاء حساب الدخول');
     const authId=made.data.user.id;
     const prof=await db.from('profiles').insert({auth_user_id:authId,university_id:uid,batch_number:batch,email,full_name:name,role:'MEMBER',active:true,must_change_password:true}).select('id').single();
     if(prof.error){await db.auth.admin.deleteUser(authId);throw prof.error;}
     const contacts=raw.contacts||{};const safe=(v:any)=>String(v||'').trim().slice(0,140)||null;
     const contact=await db.from('member_contact_details').insert({profile_id:prof.data.id,phone:safe(contacts.phone),whatsapp:safe(contacts.whatsapp),telegram_handle:safe(contacts.telegram),department:safe(contacts.department),current_location:safe(contacts.location),country:safe(contacts.country),city:safe(contacts.city)});
     if(contact.error){await db.auth.admin.deleteUser(authId);throw contact.error;}
     results.push({row:i+1,universityId:uid,status:'CREATED'});
    }catch(e:any){results.push({row:i+1,universityId:uid,status:'ERROR',reason:String(e.message||'تعذر الإنشاء').slice(0,140)});}
   }
   await audit(db,profile,'ADMIN_BATCH_IMPORT','BATCH',null,null,{batch,created:results.filter(x=>x.status==='CREATED').length,total:entries.length});
   return json({ok:true,results});
  }
  if(actionName==='ADMIN_RESET_PASSWORD'){
   const candidate=(await db.from('profiles').select('role').eq('id',String(payload.profileId||'')).maybeSingle()).data;
   if(!candidate||candidate.role==='ADMIN')throw new Error('استعادة حساب المدير تتطلب إجراءً إداريًا خاصًا، وليس هذا النموذج.');
   const id=String(payload.profileId||'');const target=(await db.from('profiles').select('id,auth_user_id,email').eq('id',id).eq('active',true).single()).data;
   if(!target)throw new Error('الحساب غير موجود.');
   const bytes=crypto.getRandomValues(new Uint8Array(24));const temporary=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
   const reset=await db.auth.admin.updateUserById(target.auth_user_id,{password:temporary,user_metadata:{must_change_password:true}});if(reset.error)throw reset.error;
   const flag=await db.from('profiles').update({must_change_password:true}).eq('id',id);if(flag.error)throw flag.error;
   await audit(db,profile,'ADMIN_RESET_PASSWORD','PROFILE',id,null,{reset_at:new Date().toISOString()});
   return json({ok:true,temporaryPassword:temporary}); // Shown exactly once, never stored in application tables.
  }
  if(actionName==='PROPOSAL_CREATE'){
   const values=formToProposal(payload.form||{}); if(!values.title||!values.secretariat_id)throw new Error('بيانات المقترح الأساسية ناقصة.');
   const cycle=(await db.from('cycles').select('*').eq('is_current',true).single()).data; if(!cycle)throw new Error('لا توجد دورة حالية.');
   const {data:internalId,error:ierr}=await db.rpc('next_proposal_internal_id',{p_secretariat:values.secretariat_id}); if(ierr)throw ierr;
   const submit=payload.submit!==false; const proposalRow:any={...values,submission_mode:'STRUCTURED',internal_id:internalId,cycle_id:cycle.id,applicant_id:profile.id,status:submit?'WITH_SECRETARY':'DRAFT',submitted_at:submit?new Date().toISOString():null,current_version:1};
   if(submit)proposalRow.secretary_due_at=hoursFromNow(Number(await setting(db,'secretary_sla_hours',48)));
   const ins=await db.from('proposals').insert(proposalRow).select().single(); if(ins.error)throw ins.error; const p=ins.data;
   await db.from('proposal_versions').insert({proposal_id:p.id,version_no:1,source:'STRUCTURED',created_by:profile.id,snapshot:proposalSnapshot(p),change_summary:'النسخة الأولى',is_current:true});
   await db.from('proposal_actions').insert({proposal_id:p.id,actor_id:profile.id,actor_role:profile.role,action_type:'CREATED',from_status:null,to_status:p.status,note_text:submit?'تم تقديم المقترح':'تم حفظ المسودة'});
   await audit(db,profile,'PROPOSAL_CREATE','PROPOSAL',p.id,null,p,{submit}); await queueProposalArtifacts(db,p,1); if(submit)await queueNotice(db,'NEW_PROPOSAL','PROPOSAL',p.id);
   return json({ok:true,proposal:p});
  }


  if(actionName==='PROPOSAL_UPLOAD_CREATE'){
   validateStagingFile(profile,payload,true);const form=payload.form||{}; const values=formToProposal(form); if(!values.title||!values.secretariat_id||!payload.stagingPath)throw new Error('بيانات الرفع ناقصة.');
   const cycle=(await db.from('cycles').select('*').eq('is_current',true).single()).data; const {data:internalId,error:ierr}=await db.rpc('next_proposal_internal_id',{p_secretariat:values.secretariat_id}); if(ierr)throw ierr;
   const row:any={...values,submission_mode:'FILE_UPLOAD',internal_id:internalId,cycle_id:cycle.id,applicant_id:profile.id,status:'WITH_SECRETARY',submitted_at:new Date().toISOString(),current_version:1,secretary_due_at:hoursFromNow(Number(await setting(db,'secretary_sla_hours',48)))};
   const ins=await db.from('proposals').insert(row).select().single(); if(ins.error)throw ins.error; const p=ins.data;
   await db.from('proposal_versions').insert({proposal_id:p.id,version_no:1,source:'FILE_UPLOAD',created_by:profile.id,snapshot:proposalSnapshot(p),change_summary:'النسخة المرفوعة الأولى',is_current:true});
   await db.from('proposal_actions').insert({proposal_id:p.id,actor_id:profile.id,actor_role:profile.role,action_type:'CREATED',to_status:'WITH_SECRETARY',note_text:'تم تقديم مقترح مرفوع كملف'});
   await audit(db,profile,'PROPOSAL_UPLOAD_CREATE','PROPOSAL',p.id,null,p); await archiveProposalUpload(db,p,1,payload); await queueNotice(db,'NEW_PROPOSAL','PROPOSAL',p.id); return json({ok:true,proposal:p});
  }

  if(actionName==='PROPOSAL_REVISION'){
   let p=await getProposal(db,payload.proposalId); if(p.applicant_id!==profile.id)throw new Error('غير مسموح.'); if(!editableProposalStatuses.includes(p.status))throw new Error('لا يمكن تعديل المقترح في حالته الحالية.');
   const values=formToProposal(payload.form||{}); const next=(p.current_version||1)+1; const before={...p};
   const newStatus=payload.submit===false?p.status:(p.status==='DRAFT'?'WITH_SECRETARY':'REVISED'); const patch:any={...values,current_version:next,status:newStatus}; if(newStatus==='REVISED')patch.secretary_due_at=hoursFromNow(Number(await setting(db,'secretary_sla_hours',48)));
   const upd=await db.from('proposals').update(patch).eq('id',p.id).select().single(); if(upd.error)throw upd.error;p=upd.data;
   await db.from('proposal_versions').update({is_current:false}).eq('proposal_id',p.id).eq('is_current',true);
   await db.from('proposal_versions').insert({proposal_id:p.id,version_no:next,source:'STRUCTURED',created_by:profile.id,snapshot:proposalSnapshot(p),change_summary:'تعديل مقدم المقترح',is_current:true});
   await db.from('proposal_actions').insert({proposal_id:p.id,actor_id:profile.id,actor_role:profile.role,action_type:'REVISION_UPLOADED',from_status:before.status,to_status:newStatus,note_text:'تم حفظ نسخة معدلة'});
   await audit(db,profile,'PROPOSAL_REVISION','PROPOSAL',p.id,before,p,{version:next}); await queueProposalArtifacts(db,p,next); if(newStatus==='REVISED')await queueNotice(db,'REVISION_UPLOADED','PROPOSAL',p.id);
   return json({ok:true,proposal:p});
  }

  if(actionName==='PROPOSAL_REVISION_UPLOAD'){
   let p=await getProposal(db,payload.proposalId);if(p.applicant_id!==profile.id)throw new Error('غير مسموح.');if(!editableProposalStatuses.includes(p.status))throw new Error('لا يمكن تعديل المقترح في حالته الحالية.');validateStagingFile(profile,payload,true);if(!payload.stagingPath)throw new Error('اختر ملف PDF أو Word.');
   const next=(p.current_version||1)+1;const before={...p};const newStatus=p.status==='DRAFT'?'WITH_SECRETARY':'REVISED';
   const patch:any={current_version:next,status:newStatus,submission_mode:'FILE_UPLOAD'};if(newStatus==='REVISED'||newStatus==='WITH_SECRETARY')patch.secretary_due_at=hoursFromNow(Number(await setting(db,'secretary_sla_hours',48)));
   const upd=await db.from('proposals').update(patch).eq('id',p.id).select().single();if(upd.error)throw upd.error;p=upd.data;
   await db.from('proposal_versions').update({is_current:false}).eq('proposal_id',p.id).eq('is_current',true);
   await db.from('proposal_versions').insert({proposal_id:p.id,version_no:next,source:'FILE_UPLOAD',created_by:profile.id,snapshot:proposalSnapshot(p),change_summary:payload.changeSummary||'نسخة معدلة مرفوعة كملف',is_current:true});
   await db.from('proposal_actions').insert({proposal_id:p.id,actor_id:profile.id,actor_role:profile.role,action_type:'REVISION_FILE_UPLOADED',from_status:before.status,to_status:newStatus,note_text:'تم رفع نسخة معدلة كملف'});
   await audit(db,profile,'PROPOSAL_REVISION_UPLOAD','PROPOSAL',p.id,before,p,{version:next});await archiveProposalUpload(db,p,next,payload);await queueNotice(db,'REVISION_UPLOADED','PROPOSAL',p.id);
   return json({ok:true,proposal:p});
  }

  if(actionName.startsWith('PROPOSAL_')){
   let p=await getProposal(db,payload.proposalId);
   if(actionName==='PROPOSAL_FORWARD_GS'){
    if(!canManageSecretariat(profile,p.secretariat_id)||!['WITH_SECRETARY','REVISED'].includes(p.status))throw new Error('غير مسموح.'); p=await action(db,p,profile,'SECRETARY_FORWARDED','WITH_GS','أجاز السكرتير رفع المقترح إلى السكرتارية العامة.');await queueNotice(db,'WITH_GS','PROPOSAL',p.id);return json({ok:true,proposal:p});
   }
   if(actionName==='PROPOSAL_REQUEST_REVISION'){
    const allowed=(canManageSecretariat(profile,p.secretariat_id)&&['WITH_SECRETARY','REVISED'].includes(p.status))||(isGs(profile)&&p.status==='WITH_GS'); if(!allowed)throw new Error('غير مسموح.');
    const type=isGs(profile)?'GS_REVISION_REQUESTED':'SECRETARY_REVISION_REQUESTED';p=await action(db,p,profile,type,'REVISION_REQUESTED',payload.note||'طُلب تعديل المقترح.');await queueNotice(db,'REVISION_REQUESTED','PROPOSAL',p.id,{note:payload.note});return json({ok:true,proposal:p});
   }
   if(actionName==='PROPOSAL_APPROVE'){
    if(!isGs(profile)||p.status!=='WITH_GS')throw new Error('غير مسموح.'); p=await action(db,p,profile,'GS_APPROVED','APPROVED','تمت الإجازة النهائية للمقترح.');
    await db.from('proposal_versions').update({is_approved:true}).eq('proposal_id',p.id).eq('version_no',p.current_version);
    const secretary=(await db.from('profiles').select('id').eq('secretariat_id',p.secretariat_id).eq('role','SECRETARY').eq('active',true).limit(1).maybeSingle()).data?.id||null;
    const owner=secretary||p.applicant_id;
    await db.from('initiatives').insert({cycle_id:p.cycle_id,proposal_id:p.id,secretariat_id:p.secretariat_id,secretary_id:secretary,owner_id:owner,title:p.title,objective:p.primary_benefit,source_type:'APPROVED_PROPOSAL',status:'SETUP',setup_status:'AWAITING_SETUP',approval_status:'DRAFT',health:'ON_TRACK',target_due_at:p.needed_by||null});
    await db.from('proposals').update({execution_status:'NOT_STARTED'}).eq('id',p.id);
    await queueNotice(db,'APPROVED','PROPOSAL',p.id);return json({ok:true,proposal:p});
   }
   if(actionName==='PROPOSAL_REJECT'){if(!isGs(profile)||p.status!=='WITH_GS')throw new Error('غير مسموح.');p=await action(db,p,profile,'GS_REJECTED','NOT_APPROVED',payload.reason||'لم تتم الإجازة.');await queueNotice(db,'NOT_APPROVED','PROPOSAL',p.id);return json({ok:true,proposal:p});}
   if(actionName==='PROPOSAL_DEFER'){if(!isGs(profile)||p.status!=='WITH_GS')throw new Error('غير مسموح.');p=await action(db,p,profile,'GS_DEFERRED','DEFERRED',payload.reason||'تم تأجيل النظر.');await queueNotice(db,'DEFERRED','PROPOSAL',p.id);return json({ok:true,proposal:p});}
   if(actionName==='PROPOSAL_WITHDRAW'){if(p.applicant_id!==profile.id||p.status==='APPROVED'||terminalProposalStatuses.includes(p.status))throw new Error('لا يمكن سحب المقترح.');p=await action(db,p,profile,'WITHDRAWN','WITHDRAWN',payload.reason||'سحب مقدم الطلب المقترح.');await queueNotice(db,'WITHDRAWN','PROPOSAL',p.id);return json({ok:true,proposal:p});}
   if(actionName==='PROPOSAL_EXECUTION_STATUS'){if(!canManageSecretariat(profile,p.secretariat_id)&&!isGs(profile))throw new Error('غير مسموح.');if(p.status!=='APPROVED')throw new Error('المقترح غير مجاز.');const before={...p};const u=await db.from('proposals').update({execution_status:payload.status}).eq('id',p.id).select().single();if(u.error)throw u.error;await db.from('proposal_actions').insert({proposal_id:p.id,actor_id:profile.id,actor_role:profile.role,action_type:'EXECUTION_STATUS_CHANGED',from_status:p.status,to_status:p.status,note_text:`حالة التنفيذ: ${payload.status}`});await audit(db,profile,'EXECUTION_STATUS_CHANGED','PROPOSAL',p.id,before,u.data);await queueNotice(db,'EXECUTION_STATUS_CHANGED','PROPOSAL',p.id);return json({ok:true,proposal:u.data});}
  }

  if(actionName==='PROJECT_TEMPLATE_SUBMIT'){
   if(!['SECRETARY','ADMIN'].includes(profile.role))throw new Error('السكرتير المختص فقط ينشئ مشروعًا.');
   const sid=profile.role==='ADMIN'?payload.secretariatId:profile.secretariat_id;if(!sid)throw new Error('حدد السكرتارية.');
   const lead=(await db.from('profiles').select('*').eq('id',payload.leadId).eq('active',true).single()).data;if(!lead)throw new Error('اختر عضوًا فعّالًا كمسؤول للمشروع.');
   const title=String(payload.title||'').trim(),statement=String(payload.resultStatement||'').trim(),success=String(payload.successMeasure||'').trim();const startAt=isoDate(payload.startAt||new Date().toISOString()),dueAt=isoDate(payload.dueAt);const updateIntervalDays=Math.max(1,Math.min(30,Number(payload.updateIntervalDays||3)));
   if(!title||!statement||!dueAt)throw new Error('أكمل اسم المشروع والنتيجة المطلوبة وفترة التكليف.');if(!(payload.milestones||[]).length)throw new Error('أضف محطة إنجاز واحدة على الأقل.');
   const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;if(!cycle)throw new Error('لا توجد دورة حالية.');
   const secretaryId=profile.role==='SECRETARY'?profile.id:(payload.secretaryId||(await db.from('profiles').select('id').eq('secretariat_id',sid).eq('role','SECRETARY').eq('active',true).limit(1).maybeSingle()).data?.id);if(!secretaryId)throw new Error('لا يوجد سكرتير فعّال للسكرتارية.');
   let init:any=null;let result:any=null;
   if(payload.proposalId){init=(await db.from('initiatives').select('*').eq('proposal_id',payload.proposalId).maybeSingle()).data}
   if(init){const before={...init};const u=await db.from('initiatives').update({secretariat_id:sid,secretary_id:secretaryId,owner_id:lead.id,title,objective:statement,status:'SETUP',setup_status:'AWAITING_GS_APPROVAL',approval_status:'PENDING_GS',health:'ON_TRACK',assignment_start_at:startAt,target_due_at:dueAt,update_interval_days:updateIntervalDays,next_update_due_at:null,gs_review_note:null}).eq('id',init.id).select().single();if(u.error)throw u.error;init=u.data;const previousResults=(await db.from('results').select('id').eq('initiative_id',init.id)).data||[];const previousResultIds=previousResults.map((x:any)=>x.id);if(previousResultIds.length){const md=await db.from('milestones').delete().in('result_id',previousResultIds);if(md.error)throw md.error}result=(await db.from('results').select('*').eq('initiative_id',init.id).limit(1).maybeSingle()).data;if(result){const ru=await db.from('results').update({statement,success_measure:success||null,owner_id:lead.id,due_at:dueAt,assignment_status:'ACTIVE',assignment_feedback:null,accepted_at:null}).eq('id',result.id).select().single();if(ru.error)throw ru.error;result=ru.data}else{const rr=await db.from('results').insert({initiative_id:init.id,statement,success_measure:success||null,owner_id:lead.id,due_at:dueAt,assignment_status:'ACTIVE'}).select().single();if(rr.error)throw rr.error;result=rr.data}await audit(db,profile,'PROJECT_TEMPLATE_UPDATE','INITIATIVE',init.id,before,init)}
   else{const x=await db.from('initiatives').insert({cycle_id:cycle.id,plan_id:payload.planId||null,proposal_id:payload.proposalId||null,secretariat_id:sid,secretary_id:secretaryId,owner_id:lead.id,title,objective:statement,source_type:payload.proposalId?'APPROVED_PROPOSAL':(payload.sourceType||'DIRECT'),status:'SETUP',setup_status:'AWAITING_GS_APPROVAL',approval_status:'PENDING_GS',health:'ON_TRACK',assignment_start_at:startAt,target_due_at:dueAt,update_interval_days:updateIntervalDays,next_update_due_at:null}).select().single();if(x.error)throw x.error;init=x.data;const rr=await db.from('results').insert({initiative_id:init.id,statement,success_measure:success||null,owner_id:lead.id,due_at:dueAt,assignment_status:'ACTIVE'}).select().single();if(rr.error)throw rr.error;result=rr.data}
   const milestones=await insertTemplateMilestones(db,profile,init,result,payload.milestones||[]);await createTemplateSpecialPermissions(db,profile,init,payload.specialPermissions||[]);await audit(db,profile,'PROJECT_SUBMITTED_FOR_GS','INITIATIVE',init.id,null,init,{result_id:result.id,milestone_count:milestones.length});await queueNotice(db,'PROJECT_PENDING_GS','INITIATIVE',init.id,{gs_review:true});return json({ok:true,initiative:init,result,milestones});
  }

  if(actionName==='PROJECT_TEMPLATE_UPDATE'){
   const init=await getInitiative(db,payload.initiativeId);if(!canSuperviseProject(profile,init))throw new Error('السكرتير المختص فقط يعدل قرار التكليف.');const result=(await db.from('results').select('*').eq('initiative_id',init.id).limit(1).single()).data;const patch:any={};if(payload.title!==undefined)patch.title=String(payload.title||'').trim();if(payload.resultStatement!==undefined)patch.objective=String(payload.resultStatement||'').trim();if(payload.startAt!==undefined)patch.assignment_start_at=isoDate(payload.startAt);if(payload.dueAt!==undefined)patch.target_due_at=isoDate(payload.dueAt);if(payload.updateIntervalDays!==undefined){patch.update_interval_days=Math.max(1,Math.min(30,Number(payload.updateIntervalDays||3)));if(init.status==='ACTIVE')patch.next_update_due_at=addDaysIso(new Date().toISOString(),patch.update_interval_days);}if(payload.leadId!==undefined){const lead=(await db.from('profiles').select('*').eq('id',payload.leadId).eq('active',true).single()).data;if(!lead)throw new Error('العضو المحدد غير فعّال.');patch.owner_id=lead.id;await db.from('milestones').update({owner_id:lead.id}).eq('result_id',result.id);await db.from('project_permissions').update({requested_for:lead.id}).eq('initiative_id',init.id);await db.from('results').update({owner_id:lead.id}).eq('id',result.id)}
   const u=await db.from('initiatives').update(patch).eq('id',init.id).select().single();if(u.error)throw u.error;const rp:any={};if(payload.resultStatement!==undefined)rp.statement=String(payload.resultStatement||'').trim();if(payload.successMeasure!==undefined)rp.success_measure=payload.successMeasure||null;if(payload.dueAt!==undefined)rp.due_at=isoDate(payload.dueAt);if(Object.keys(rp).length){const ru=await db.from('results').update(rp).eq('id',result.id);if(ru.error)throw ru.error}await projectLedger(db,profile,init.id,'PROJECT_CHANGE','تعديل بيانات المشروع أو تكليف المسؤول',null,{previous_owner_id:init.owner_id,new_owner_id:u.data.owner_id,previous_due_at:init.target_due_at,new_due_at:u.data.target_due_at});await audit(db,profile,'PROJECT_TEMPLATE_UPDATE','INITIATIVE',init.id,init,u.data);return json({ok:true,initiative:u.data});
  }

  if(actionName==='PROJECT_OWNER_REASSIGN'){
   const init=await getInitiative(db,payload.initiativeId);
   if(!await canFollowProject(db,profile,init))throw new Error('تغيير مسؤول التنفيذ من اختصاص المشرف المباشر أو السكرتير.');
   if(['COMPLETED','CANCELLED'].includes(init.status)||init.lifecycle_state==='POSTPONED')throw new Error('المشروع غير نشط؛ لا يمكن تغيير المسؤول الآن.');
   const next=String(payload.ownerId||'');if(!next||next===init.owner_id)throw new Error('اختر مسؤولًا جديدًا مختلفًا.');
   const selected=(await db.from('project_supervision_assignments').select('supervisor_id').eq('initiative_id',init.id).maybeSingle()).data?.supervisor_id;
   if(next===selected&&next!==init.secretary_id)throw new Error('المسؤول الجديد لا يجوز أن يكون متابع نفسه. غيّر المتابع أولًا بواسطة السكرتير.');
   const {error}=await db.rpc('kmsa_v56_transfer_project_owner',{p_initiative:init.id,p_new_owner:next});if(error)throw error;
   await projectLedger(db,profile,init.id,'PROJECT_CHANGE','تغيير مسؤول التنفيذ',null,{previous_owner_id:init.owner_id,new_owner_id:next});
   await audit(db,profile,'PROJECT_OWNER_REASSIGN','INITIATIVE',init.id,{owner_id:init.owner_id},{owner_id:next});
   if(init.owner_id)await inboxNotify(db,init.owner_id,'PROJECT_OWNER_RELEASED',`انتهى تكليفك بتنفيذ: ${init.title}`,'انتقل التنفيذ إلى مسؤول جديد. يبقى سجل عملك السابق محفوظًا.','INITIATIVE',init.id,`/workspace/projects/${init.id}`);
   const sent=await inboxNotify(db,next,'PROJECT_OWNER_CHANGED',`أصبحت مسؤول تنفيذ: ${init.title}`,'اطلع على المحطات والنتائج والتوجيهات المسجلة.','INITIATIVE',init.id,`/workspace/projects/${init.id}`);
   return json({ok:true,warning:!sent?'نُقل التكليف لكن تعذر إيصال إشعار للمسؤول الجديد.':null});
  }

  if(actionName==='PROJECT_CLOSE_REQUEST'){
   const init=await getInitiative(db,payload.initiativeId);
   if(init.approval_status!=='APPROVED'||init.setup_status!=='ACTIVE'||['COMPLETED','CANCELLED'].includes(init.status)||init.lifecycle_state==='POSTPONED')throw new Error('يمكن طلب إنهاء مشروع نشط فقط.');
   if(!await canFollowProject(db,profile,init)||(profile.id===init.owner_id&&profile.id!==init.secretary_id))throw new Error('طلب إنهاء المشروع من اختصاص المتابع؛ ولا يراجع النائب عمله بنفسه.');
   const type=String(payload.type||'');if(!['SUCCEEDED','CANCELLED','POSTPONED'].includes(type))throw new Error('حدد نجاح المشروع أو إلغاءه أو تأجيله.');
   const reason=String(payload.reason||'').trim();if(reason.length<12)throw new Error('اكتب وصفًا واضحًا للنتيجة أو سبب القرار (12 حرفًا على الأقل).');
   const postponeDate=type==='POSTPONED'?String(payload.postponeUntilDate||''):null;
   const khartoumParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Khartoum',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
   const byType=(type:string)=>khartoumParts.find(x=>x.type===type)?.value||'';
   const todayInKhartoum=`${byType('year')}-${byType('month')}-${byType('day')}`;
   if(type==='POSTPONED'&&(!postponeDate||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(postponeDate)||Number.isNaN(Date.parse(postponeDate))||new Date(postponeDate).toISOString().slice(0,10)!==postponeDate||postponeDate<=todayInKhartoum))throw new Error('حدد تاريخ التأجيل (يوم/شهر/سنة) دون ساعة.');
   const resume=postponeDate?new Date(`${postponeDate}T12:00:00+02:00`).toISOString():null;
   if(type==='SUCCEEDED'){
    const results=await db.from('results').select('id').eq('initiative_id',init.id);if(results.error)throw results.error;
    const ids=(results.data||[]).map((x:any)=>x.id);const check=ids.length?await db.from('milestones').select('id,status,outcome_text,design_status').in('result_id',ids).neq('design_status','REJECTED'):{data:[],error:null};if(check.error)throw check.error;
    const milestones=check.data||[];
    if(!milestones.length||milestones.some((m:any)=>!['READY_FOR_VERIFICATION','VERIFIED'].includes(m.status)||!String(m.outcome_text||'').trim()))throw new Error('لا يمكن طلب إغلاق ناجح قبل إعلان نتائج واضحة لجميع المحطات المعتمدة.');
    for(const m of milestones){
     const latest=(await db.from('project_activity_entries').select('id').eq('milestone_id',m.id).eq('kind','MILESTONE_UPDATE').order('created_at',{ascending:false}).limit(1).maybeSingle()).data;
     if(!latest)continue;
     const review=(await db.from('milestone_supervision_events').select('event_type').eq('source_activity_id',latest.id).in('event_type',['RESULT_REVISION','RESULT_OK']).order('created_at',{ascending:false}).limit(1).maybeSingle()).data;
     if(review?.event_type==='RESULT_REVISION')throw new Error('هناك نتيجة طلب المشرف تعديلها ولم تُصحّح بعد؛ لا يمكن إغلاق المشروع بنجاح.');
    }
   }
   const pending=(await db.from('project_closure_requests').select('id').eq('initiative_id',init.id).eq('status','PENDING').maybeSingle()).data;
   if(pending)throw new Error('يوجد طلب إنهاء قيد القرار بالفعل.');
   const row=await db.from('project_closure_requests').insert({initiative_id:init.id,requested_by:profile.id,type,reason,resume_review_at:resume,postpone_until_date:postponeDate}).select().single();if(row.error)throw row.error;
   try{await projectLedger(db,profile,init.id,'PROJECT_CHANGE','طلب قرار مصير المشروع',null,{closure_request_id:row.data.id,type,reason,resume_review_at:resume,postpone_until_date:postponeDate})}catch(e){console.error('closure request ledger',e)}
   if(profile.id===init.secretary_id&&profile.role==='SECRETARY'){
    const {error}=await db.rpc('kmsa_v56_decide_closure',{p_request:row.data.id,p_actor:profile.id,p_approve:true,p_note:'قرار السكرتير المباشر'});
    if(error){console.error('direct closure decision pending',error);return json({ok:true,direct:false,request:row.data,warning:'سُجل الطلب لكن تعذر اعتماده تلقائيًا؛ افتح «قرارات المشاريع» لاستكماله.'});}
    try{await projectLedger(db,profile,init.id,'PROJECT_CHANGE','إقرار مصير المشروع من السكرتير',null,{closure_request_id:row.data.id,type})}catch(e){console.error('closure decision ledger',e)}
    return json({ok:true,direct:true,request:row.data});
   }
   if(!init.secretary_id)throw new Error('لا يوجد سكرتير معتمد لإجازة القرار.');
   const sent=await inboxNotify(db,init.secretary_id,'PROJECT_CLOSURE_PENDING',`مشروع ${init.title}: قرار ${type==='SUCCEEDED'?'إغلاق بنجاح':type==='CANCELLED'?'إلغاء':'تأجيل'} بانتظارك`,'المطلوب منك: راجع الطلب والسبب ثم اعتمد أو ارفض.','INITIATIVE',init.id,`/workspace/projects/${init.id}?action=closure`);
   return json({ok:true,request:row.data,warning:!sent?'سُجل الطلب لكن تعذر إرسال الإشعار للسكرتير.':null});
  }
  if(actionName==='PROJECT_CLOSE_DECIDE'){
   const req=(await db.from('project_closure_requests').select('*').eq('id',payload.requestId).single()).data;
   if(!req||req.status!=='PENDING')throw new Error('طلب الإغلاق غير موجود أو تم اتخاذ القرار فيه.');
   const init=await getInitiative(db,req.initiative_id);
   if(!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&init.secretary_id===profile.id)))throw new Error('البت في طلب إغلاق أو تأجيل المشروع من اختصاص السكرتير.');
   if(['COMPLETED','CANCELLED'].includes(init.status))throw new Error('المشروع مغلق بالفعل.');
   const decision=String(payload.decision||'');if(!['APPROVE','REJECT'].includes(decision))throw new Error('حدد الموافقة أو الرفض.');
   const note=String(payload.note||'').trim();if(decision==='REJECT'&&!note)throw new Error('اكتب سبب رفض طلب الإغلاق أو التأجيل.');
   const {error}=await db.rpc('kmsa_v56_decide_closure',{p_request:req.id,p_actor:profile.id,p_approve:decision==='APPROVE',p_note:note});if(error)throw error;
   try{await projectLedger(db,profile,init.id,'PROJECT_CHANGE',decision==='APPROVE'?'اعتماد قرار مصير المشروع':'رفض طلب إنهاء المشروع',null,{closure_request_id:req.id,type:req.type,decision,note})}catch(e){console.error('closure decision ledger',e)}
   void inboxNotify(db,req.requested_by,'PROJECT_CLOSURE_DECIDED',`مشروع ${init.title}: ${decision==='APPROVE'?'اعتُمد':'رُفض'} طلب ${req.type==='POSTPONED'?'التأجيل':'الإنهاء'}`,note||'راجع قرار السكرتير.','INITIATIVE',init.id,`/workspace/projects/${init.id}`);
   return json({ok:true});
  }
  if(actionName==='PROJECT_RESUME'){
   const init=await getInitiative(db,payload.initiativeId);
   if(!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&init.secretary_id===profile.id)))throw new Error('استئناف المشروع من اختصاص السكرتير.');
   if(init.lifecycle_state!=='POSTPONED')throw new Error('المشروع ليس مؤجلًا.');
   const u=await db.from('initiatives').update({lifecycle_state:'ACTIVE',resume_review_at:null,lifecycle_decided_at:new Date().toISOString(),lifecycle_decided_by:profile.id}).eq('id',init.id).eq('lifecycle_state','POSTPONED');if(u.error)throw u.error;
   {const schedule=await db.rpc('kmsa_v64_ensure_followup',{p_initiative:init.id});if(schedule.error)throw schedule.error;}
   await projectLedger(db,profile,init.id,'PROJECT_CHANGE','استئناف المشروع بعد تأجيله',null,{previous_state:'POSTPONED'});
   return json({ok:true});
  }
  if(actionName==='PROJECT_SUPERVISION_REQUEST_REVIEW'){
   const init=await getInitiative(db,payload.initiativeId);
   if(!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&init.secretary_id===profile.id)))throw new Error('طلب تقييم المتابع من اختصاص السكرتير.');
   if(init.approval_status!=='APPROVED'||['COMPLETED','CANCELLED'].includes(init.status)||init.lifecycle_state==='POSTPONED')throw new Error('هذا المشروع ليس قيد التنفيذ.');
   const assignment=(await db.from('project_supervision_assignments').select('supervisor_id,assigned_at').eq('initiative_id',init.id).maybeSingle());
   if(assignment.error)throw assignment.error;
   const delegatedId=assignment.data?.supervisor_id;
   if(!delegatedId||delegatedId===init.secretary_id)throw new Error('هذا المشروع ليس ذا إشراف مفوض.');
   const sourceQ=await db.from('project_activity_entries').select('id,initiative_id,kind,created_at,milestone_id,note').eq('id',payload.sourceActivityId).single();
   if(sourceQ.error)throw sourceQ.error;const source=sourceQ.data;
   if(source.initiative_id!==init.id||source.kind!=='MILESTONE_UPDATE')throw new Error('التحديث لا يتبع هذا المشروع.');
   if(assignment.data.assigned_at&&new Date(source.created_at)<new Date(assignment.data.assigned_at))throw new Error('التحديث سابق لتفويض هذا المتابع.');
   // Only the newest update on this station should be requested, not an obsolete version.
   const latest=(await db.from('project_activity_entries').select('id').eq('milestone_id',source.milestone_id).eq('kind','MILESTONE_UPDATE').order('created_at',{ascending:false}).limit(1).maybeSingle());
   if(latest.error)throw latest.error;
   if(latest.data?.id!==source.id)throw new Error('وصل تحديث أحدث للمحطة. راجع التحديث الجديد بدلًا من القديم.');
   const reviews=await db.from('milestone_supervision_events').select('id').eq('source_activity_id',source.id).eq('actor_id',delegatedId).in('event_type',['PROGRESS_OK','PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_OK','RESULT_REVISION']).limit(1);
   if(reviews.error)throw reviews.error;if(reviews.data?.length)throw new Error('النائب قيّم هذا التحديث بالفعل.');
   const previous=await db.from('project_supervision_followups').select('id,review_request_attempt,created_at,followup_due_at').eq('source_activity_id',source.id).eq('delegated_supervisor_id',delegatedId).not('review_request_attempt','is',null).order('review_request_attempt',{ascending:false});
   if(previous.error)throw previous.error;
   const attempts=previous.data||[];const attempt=attempts.length+1;
   if(attempt>2)throw new Error('أُرسل طلبا التقييم. إن لم يستجب النائب، اتخذ إجراءً إشرافيًا آخر أو أعد توزيع المتابعة.');
   const scheduleQ=await db.from('milestone_followup_schedules').select('interval_hours').eq('milestone_id',source.milestone_id).maybeSingle();if(scheduleQ.error)throw scheduleQ.error;
   const intervalHours=Number(scheduleQ.data?.interval_hours||48);
   const graceHours=Math.max(4,Math.min(24,Math.round(intervalHours/4)));
   const reminderHours=Math.max(4,Math.min(12,Math.round(intervalHours/4)));
   const age=Date.now()-new Date(source.created_at).getTime();
   if(attempt===1&&age<graceHours*3600000)throw new Error(`مهلة تقييم المستجد (${graceHours} ساعات) لم تنته بعد.`);
   if(attempt===2&&Date.now()<new Date(attempts[0].followup_due_at).getTime())throw new Error('مهلة الطلب الأول لم تنته بعد.');
   const now=new Date();const due=new Date(now.getTime()+reminderHours*3600000).toISOString();
   const message=attempt===1?'طلب تقييم أول': 'طلب تقييم ثانٍ — لم يصل تقييم التحديث بعد الطلب الأول';
   const req=await db.from('project_supervision_followups').insert({initiative_id:init.id,source_activity_id:source.id,delegated_supervisor_id:delegatedId,secretary_id:profile.id,action_kind:'REMIND',note:message,followup_due_at:due,review_request_attempt:attempt}).select().single();
   if(req.error){if(req.error.code==='23505')throw new Error('هذا الطلب سُجل بالفعل؛ حدّث الصفحة.');throw req.error;}
   // The request is durable even if notification delivery fails; never misreport the saved operation as failed.
   let notified=false;try{notified=!!await inboxNotify(db,delegatedId,`SUPERVISION_REVIEW_REQUEST_${attempt}`,`مشروع ${init.title}: ${message}`,`المطلوب تقييم تحديث «${source.note||'المحطة'}» خلال ${reminderHours} ساعات. الطلب رقم ${attempt} من 2.`, 'ACTIVITY',source.id,`/workspace/projects/${init.id}?milestone=${source.milestone_id}&action=review`)}catch(e){console.error('review request notification',e)}
   try{await projectLedger(db,profile,init.id,'PROJECT_CHANGE',message,source.milestone_id,{source_activity_id:source.id,review_request_attempt:attempt,supervisor_id:delegatedId,followup_due_at:due})}catch(e){console.error('request ledger followup',e)}
   return json({ok:true,attempt,dueAt:due,notificationSent:notified,warning:notified?null:'حُفظ طلب التقييم، لكن تعذر إظهار الإشعار للنائب. سيظل الطلب ظاهرًا داخل متابعة الإشراف.'});
  }
  if(actionName==='PROJECT_SUPERVISION_FOLLOWUP'){
   const init=await getInitiative(db,payload.initiativeId);
   if(!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&init.secretary_id===profile.id)))throw new Error('متابعة عمل النائب من اختصاص السكرتير.');
   const assignment=(await db.from('project_supervision_assignments').select('supervisor_id,assigned_at').eq('initiative_id',init.id).maybeSingle()).data;
   const assigned=assignment?.supervisor_id;
   if(!assigned||assigned===init.secretary_id)throw new Error('المشروع ليس مفوضًا لمتابع مستقل.');
   const source=(await db.from('project_activity_entries').select('id,initiative_id,kind,created_at').eq('id',payload.sourceActivityId).single()).data;
   if(!source||source.initiative_id!==init.id||source.kind!=='MILESTONE_UPDATE')throw new Error('اختر تحديثًا صحيحًا من هذا المشروع.');
   if(assignment?.assigned_at&&new Date(source.created_at)<new Date(assignment.assigned_at))throw new Error('هذا التحديث سابق لتكليف المتابع الحالي؛ لا يجوز محاسبته عليه.');
   const kind=String(payload.kind||'');if(!['REMIND','REASSIGN','DIRECT_REVIEW','CLARIFY'].includes(kind))throw new Error('نوع إجراء متابعة النائب غير صحيح.');
   const note=String(payload.note||'').trim();const due=isoDate(payload.dueAt);
   if(note.length<5||!due||new Date(due).getTime()<Date.now())throw new Error('اكتب الإجراء وحدد موعدًا لاحقًا لمتابعة نتيجته.');
   const u=await db.from('project_supervision_followups').insert({initiative_id:init.id,source_activity_id:source.id,delegated_supervisor_id:assigned,secretary_id:profile.id,action_kind:kind,note,followup_due_at:due}).select().single();if(u.error)throw u.error;
   await projectLedger(db,profile,init.id,'PROJECT_CHANGE','متابعة السكرتير لتفويض الإشراف',null,{source_activity_id:source.id,followup_id:u.data.id,kind,note,due_at:due});
   let notificationSent=false;try{notificationSent=!!await inboxNotify(db,assigned,'SUPERVISION_FOLLOWUP',`مشروع ${init.title}: توجيه من السكرتير`,`${note} · الموعد: ${due}`,'INITIATIVE',init.id,`/workspace/projects/${init.id}`)}catch(e){console.error('followup notification',e)}
   return json({ok:true,followup:u.data,warning:notificationSent?null:'سُجّل التدخل، ولكن تعذر إشعار المتابع تلقائيًا. تواصل معه عبر تيليجرام.'});
  }

  if(actionName==='PROJECT_RESUBMIT_GS'){
   const init=await getInitiative(db,payload.initiativeId);if(!canSuperviseProject(profile,init))throw new Error('السكرتير المختص فقط يعيد المشروع للاعتماد.');const u=await db.from('initiatives').update({approval_status:'PENDING_GS',setup_status:'AWAITING_GS_APPROVAL',gs_review_note:null}).eq('id',init.id).select().single();if(u.error)throw u.error;await audit(db,profile,'PROJECT_RESUBMIT_GS','INITIATIVE',init.id,init,u.data);await queueNotice(db,'PROJECT_PENDING_GS','INITIATIVE',init.id);return json({ok:true,initiative:u.data});
  }

  if(actionName==='PROJECT_GS_DECIDE'){
   if(!['GS','ADMIN'].includes(profile.role))throw new Error('اعتماد قرار التكليف من اختصاص السكرتير العام.');const init=await getInitiative(db,payload.initiativeId);if(init.approval_status!=='PENDING_GS')throw new Error('المشروع ليس بانتظار اعتماد السكرتير العام.');const result=(await db.from('results').select('*').eq('initiative_id',init.id).limit(1).single()).data;const milestones=(await db.from('milestones').select('*').eq('result_id',result.id).neq('design_status','REJECTED')).data||[];if(!result?.statement||!init.target_due_at||!init.owner_id||!milestones.length)throw new Error('قرار التكليف غير مكتمل: النتيجة والمسؤول والفترة ومحطات الإنجاز مطلوبة.');const approve=payload.decision==='APPROVE';const patch:any=approve?{approval_status:'APPROVED',setup_status:'ACTIVE',status:'ACTIVE',gs_review_note:payload.note||null,gs_approved_by:profile.id,gs_approved_at:new Date().toISOString(),activated_at:new Date().toISOString(),health:'ON_TRACK',next_update_due_at:null}:{approval_status:'RETURNED',setup_status:'AWAITING_GS_APPROVAL',gs_review_note:payload.note||'أعيد للسكرتير لاستكمال قرار التكليف.'};const u=await db.from('initiatives').update(patch).eq('id',init.id).select().single();if(u.error)throw u.error;if(approve){const schedule=await db.rpc('kmsa_v64_ensure_followup',{p_initiative:init.id});if(schedule.error)throw schedule.error;}if(approve&&init.proposal_id)await db.from('proposals').update({execution_status:'IN_PROGRESS'}).eq('id',init.proposal_id);await projectLedger(db,profile,init.id,'GS_DECISION',approve?'اعتماد قرار تكليف المشروع':'إعادة المشروع للمراجعة',null,{note:payload.note||null});await audit(db,profile,approve?'PROJECT_GS_APPROVE':'PROJECT_GS_RETURN','INITIATIVE',init.id,init,u.data,{note:payload.note||null});await queueNotice(db,approve?'PROJECT_ASSIGNED':'PROJECT_RETURNED_TO_SECRETARY','INITIATIVE',init.id,{lead_id:init.owner_id});return json({ok:true,initiative:u.data});
  }

  if(['PROJECT_SETUP_CREATE','PROJECT_SETUP_FROM_PROPOSAL','RESULT_ASSIGNMENT_ACCEPT','RESULT_ASSIGNMENT_RETURN','RESULT_ASSIGNMENT_REVISE'].includes(actionName)){
   throw new Error('هذا المسار قديم. استخدم قرار التكليف الجديد: السكرتير يجهز المشروع ومحطات الإنجاز ثم يرسله لاعتماد السكرتير العام، ولا توجد موافقة من مسؤول المشروع داخل المنصة.');
  }

  if(actionName==='MILESTONE_DESIGN_ADD'){
   const result=await getResult(db,payload.resultId);const init=result.initiative;if(!canSuperviseProject(profile,init))throw new Error('السكرتير المشرف فقط يضيف محطة إنجاز بعد إنشاء المشروع.');
   const title=String(payload.title||'').trim();if(!title)throw new Error('اكتب اسم محطة الإنجاز.');const mode=payload.deadlineMode==='RELATIVE'?'RELATIVE':'ABSOLUTE';let due:string|null=null,relativeTo:string|null=null,relativeDays:number|null=null,relativeHours=0;
   if(mode==='RELATIVE'){relativeTo=payload.relativeToMilestoneId||null;if(!relativeTo)throw new Error('حدد المحطة المرجعية.');const ref=await getMilestone(db,relativeTo);if(ref.result_id!==result.id)throw new Error('المحطة المرجعية يجب أن تكون في نفس المشروع.');relativeDays=Math.max(0,Number(payload.relativeDays||0));relativeHours=Math.max(0,Number(payload.relativeHours||0));due=addOffsetIso(actualOrPlannedBase(ref),relativeDays,relativeHours)}else{due=isoDate(payload.dueAt);if(!due)throw new Error('حدد موعد محطة الإنجاز.');}
   if(result.due_at&&new Date(due!)>new Date(result.due_at))throw new Error('موعد محطة الإنجاز لا يمكن أن يتجاوز الموعد النهائي للنتيجة.');
   const existing=(await db.from('milestones').select('sequence_no').eq('result_id',result.id).neq('design_status','REJECTED').order('sequence_no',{ascending:false}).limit(1).maybeSingle()).data;const sequenceNo=Number(existing?.sequence_no||0)+1;const ownerId=result.owner_id||init.owner_id;
   const row={result_id:result.id,secretariat_id:init.secretariat_id,owner_id:ownerId,title,description:payload.description||null,due_at:due,verification_criteria:String(payload.verificationCriteria||'').trim()||'تحقق المخرج المحدد للمحطة',priority:payload.priority||'NORMAL',created_by:profile.id,design_status:'APPROVED',sequence_no:sequenceNo,deadline_mode:mode,relative_days:relativeDays,relative_hours:relativeHours,relative_to_milestone_id:relativeTo,status:'NOT_STARTED',status_updated_at:new Date().toISOString()};
   const mm=await db.from('milestones').insert(row).select().single();if(mm.error)throw mm.error;if(init.setup_status==='ACTIVE'){const schedule=await db.rpc('kmsa_v64_ensure_followup',{p_initiative:init.id});if(schedule.error)throw schedule.error;}await projectLedger(db,profile,init.id,'DESIGN_CHANGE','إضافة محطة إنجاز: '+title,mm.data.id,{due_at:due});await audit(db,profile,'MILESTONE_DESIGN_ADD','MILESTONE',mm.data.id,null,mm.data,{initiative_id:init.id});return json({ok:true,milestone:mm.data});
  }

  if(actionName==='MILESTONE_DESIGN_UPDATE'){
   const m=await getMilestone(db,payload.milestoneId);const result=await getResult(db,m.result_id);const init=result.initiative;if(!isProjectLead(profile,init,result)&&!canSuperviseProject(profile,init))throw new Error('غير مسموح.');if(init.setup_status==='ACTIVE'&&m.design_status==='APPROVED'&&!canSuperviseProject(profile,init))throw new Error('بعد التفعيل، تعديل محطة معتمدة يحتاج السكرتير.');
   const patch:any={};if(payload.title!==undefined)patch.title=String(payload.title||'').trim();if(payload.description!==undefined)patch.description=payload.description||null;if(payload.verificationCriteria!==undefined)patch.verification_criteria=payload.verificationCriteria||null;if(payload.priority!==undefined)patch.priority=payload.priority||'NORMAL';
   if(payload.deadlineMode!==undefined||payload.dueAt!==undefined||payload.relativeDays!==undefined||payload.relativeToMilestoneId!==undefined){const mode=payload.deadlineMode==='RELATIVE'?'RELATIVE':'ABSOLUTE';patch.deadline_mode=mode;if(mode==='RELATIVE'){const refId=payload.relativeToMilestoneId||m.relative_to_milestone_id;if(!refId||refId===m.id)throw new Error('حدد محطة سابقة صالحة.');const ref=await getMilestone(db,refId);if(ref.result_id!==m.result_id)throw new Error('المحطة المرجعية يجب أن تكون في نفس المشروع.');let ancestor=ref;const visited=new Set([m.id]);while(ancestor){if(visited.has(ancestor.id))throw new Error('لا يمكن إنشاء دائرة بين مواعيد المحطات.');visited.add(ancestor.id);ancestor=ancestor.relative_to_milestone_id?await getMilestone(db,ancestor.relative_to_milestone_id):null;}const days=Math.max(0,Number(payload.relativeDays??m.relative_days??0));patch.relative_to_milestone_id=ref.id;patch.relative_days=days;patch.relative_hours=Math.max(0,Number(payload.relativeHours??m.relative_hours??0));patch.due_at=addOffsetIso(actualOrPlannedBase(ref),days,patch.relative_hours)}else{const due=isoDate(payload.dueAt||m.due_at);if(!due)throw new Error('حدد موعد المحطة.');patch.due_at=due;patch.relative_to_milestone_id=null;patch.relative_days=null;patch.relative_hours=0}}
   patch.status_updated_at=new Date().toISOString();const u=await db.from('milestones').update(patch).eq('id',m.id).select().single();if(u.error)throw u.error;await recalcDependentMilestones(db,m.id);await projectLedger(db,profile,init.id,'DESIGN_CHANGE','تعديل بيانات المحطة',m.id,{previous_due_at:m.due_at,new_due_at:u.data.due_at});await audit(db,profile,'MILESTONE_DESIGN_UPDATE','MILESTONE',m.id,m,u.data);return json({ok:true,milestone:u.data});
  }

  if(actionName==='MILESTONE_DESIGN_REMOVE'){
   const m=await getMilestone(db,payload.milestoneId);const result=await getResult(db,m.result_id);const init=result.initiative;if(!isProjectLead(profile,init,result)&&!canSuperviseProject(profile,init))throw new Error('غير مسموح.');if(init.setup_status==='ACTIVE'&&m.design_status==='APPROVED')throw new Error('بعد بدء التنفيذ لا يمكن استبعاد محطة معتمدة من التصميم بهذه الطريقة.');const u=await db.from('milestones').update({design_status:'REJECTED'}).eq('id',m.id).select().single();if(u.error)throw u.error;await projectLedger(db,profile,init.id,'DESIGN_CHANGE','استبعاد محطة من التصميم',m.id);await audit(db,profile,'MILESTONE_DESIGN_REMOVE','MILESTONE',m.id,m,u.data);return json({ok:true,milestone:u.data});
  }

  if(actionName==='PROJECT_ACTIVATE'){
   const init=await getInitiative(db,payload.initiativeId);if(!canSuperviseProject(profile,init))throw new Error('السكرتير المشرف فقط يفعّل المشروع.');const {data:results}=await db.from('results').select('*').eq('initiative_id',init.id);if(!(results||[]).length)throw new Error('حدد النتيجة أولًا.');if((results||[]).some((r:any)=>!['ACTIVE','ACCEPTED'].includes(r.assignment_status)))await db.from('results').update({assignment_status:'ACTIVE'}).in('id',(results||[]).map((r:any)=>r.id));
   const ids=(results||[]).map((r:any)=>r.id);const {data:ms}=await db.from('milestones').select('*').in('result_id',ids).neq('design_status','REJECTED');if(!(ms||[]).length)throw new Error('اتفقا على محطة إنجاز واحدة على الأقل قبل التفعيل.');for(const m of ms||[]){const r=(results||[]).find((x:any)=>x.id===m.result_id);if(r?.due_at&&new Date(m.due_at)>new Date(r.due_at))throw new Error(`موعد المحطة «${m.title}» بعد موعد النتيجة النهائي.`)}const {count:pendingSpecial}=await db.from('project_permissions').select('*',{count:'exact',head:true}).eq('initiative_id',init.id).eq('permission_type','SPECIAL').eq('status','PENDING');if((pendingSpecial||0)>0)throw new Error('هناك صلاحية خاصة لازمة ما زالت بانتظار الموافقة؛ أكمل مسار الصلاحيات قبل بدء التنفيذ.');
   await db.from('milestones').update({design_status:'APPROVED'}).in('result_id',ids).neq('design_status','REJECTED');await db.from('results').update({assignment_status:'ACTIVE'}).in('id',ids);const u=await db.from('initiatives').update({status:'ACTIVE',setup_status:'ACTIVE',activated_at:new Date().toISOString(),health:'ON_TRACK',next_update_due_at:null}).eq('id',init.id).select().single();if(u.error)throw u.error;{const schedule=await db.rpc('kmsa_v64_ensure_followup',{p_initiative:init.id});if(schedule.error)throw schedule.error;}if(init.proposal_id)await db.from('proposals').update({execution_status:'IN_PROGRESS'}).eq('id',init.proposal_id);await audit(db,profile,'PROJECT_ACTIVATE','INITIATIVE',init.id,init,u.data);await queueNotice(db,'PROJECT_ACTIVATED','INITIATIVE',init.id);return json({ok:true,initiative:u.data});
  }

  // The work happens outside the platform. This is an append-only visibility ledger.
  // Neither project lead nor secretary can silently overwrite a colleague's entry.
  if(actionName==='PROJECT_REFERENCE_ADD' || actionName==='PROJECT_SECRETARY_NOTE_ADD'){
   const init=await getInitiative(db,payload.initiativeId);
   if(init.approval_status!=='APPROVED'||init.setup_status!=='ACTIVE'||init.status==='COMPLETED'||init.status==='CANCELLED')throw new Error('هذا المشروع ليس في مرحلة التنفيذ.');
   const isNote=actionName==='PROJECT_SECRETARY_NOTE_ADD';
   if(isNote?!await canFollowProject(db,profile,init):!isProjectLead(profile,init))throw new Error('هذا الإجراء غير متاح لصلاحيتك.');
   let mid:string|null=payload.milestoneId||null;
   if(mid){const m=await getMilestone(db,mid);const r=await getResult(db,m.result_id);if(r.initiative.id!==init.id)throw new Error('المحطة ليست من هذا المشروع.');}
   const note=String(payload.note||'').trim();const url=String(payload.referenceUrl||'').trim();
   if(!note&&!url)throw new Error('أضف ملاحظة أو رابطًا.');
   if(url){let parsed:URL;try{parsed=new URL(url)}catch{throw new Error('رابط غير صالح. استخدم رابط https.')}if(parsed.protocol!=='https:')throw new Error('الرابط يجب أن يبدأ بـ https://');}
   const kind=isNote?'SECRETARY_NOTE':url?'REFERENCE':'LEAD_NOTE';
   const row=await db.from('project_activity_entries').insert({initiative_id:init.id,milestone_id:mid,author_id:profile.id,kind,note:note||null,reference_url:url||null}).select().single();if(row.error)throw row.error;
   await audit(db,profile,actionName,'INITIATIVE',init.id,null,row.data,{milestone_id:mid});
   return json({ok:true,entry:row.data});
  }

  if(actionName==='PROJECT_SUPERVISOR_ASSIGN'){
   const init=await getInitiative(db,payload.initiativeId);if(!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&init.secretary_id===profile.id)))throw new Error('تغيير المتابع المباشر من اختصاص السكرتير فقط.');if(['COMPLETED','CANCELLED'].includes(init.status)||init.lifecycle_state==='POSTPONED')throw new Error('لا يمكن تغيير المتابع لمشروع غير نشط.');
   const oldSupervisor=(await db.from('project_supervision_assignments').select('supervisor_id').eq('initiative_id',init.id).maybeSingle()).data?.supervisor_id||null;
   const selected=String(payload.supervisorId||'');if(selected===init.owner_id&&selected!==init.secretary_id)throw new Error('لا يمكن أن يكون النائب مسؤول التنفيذ والمتابع لنفسه.');
   if(!selected){const d=await db.from('project_supervision_assignments').delete().eq('initiative_id',init.id);if(d.error)throw d.error;await db.from('project_activity_entries').insert({initiative_id:init.id,author_id:profile.id,kind:'SUPERVISOR_ASSIGNMENT',note:'إلغاء تفويض المتابعة والعودة للسكرتير',details:{previous_supervisor_id:oldSupervisor,new_supervisor_id:init.secretary_id}});await audit(db,profile,'PROJECT_SUPERVISOR_UNASSIGN','INITIATIVE',init.id,null,null);if(oldSupervisor)await inboxNotify(db,oldSupervisor,'PROJECT_DELEGATION_ENDED',`انتهى تكليفك بمتابعة: ${init.title}`,'انتقلت المتابعة للسكرتير.','INITIATIVE',init.id,`/workspace/projects/${init.id}`);return json({ok:true});}
   if(selected===init.owner_id && !(selected===init.secretary_id && profile.role==='SECRETARY'))throw new Error('إذا كان مسؤول التنفيذ نائبًا أو عضوًا، يجب أن يكون المتابع شخصًا آخر.');
   const {data:user}=await db.from('profiles').select('id,active').eq('id',selected).maybeSingle();if(!user?.active)throw new Error('المتابع غير فعّال.');
   const q=await db.from('project_supervision_assignments').upsert({initiative_id:init.id,supervisor_id:selected,delegated_by:profile.id,assigned_at:new Date().toISOString()}).select().single();if(q.error)throw q.error;await db.from('project_activity_entries').insert({initiative_id:init.id,author_id:profile.id,kind:'SUPERVISOR_ASSIGNMENT',note:'تكليف متابع مباشر للمشروع',details:{previous_supervisor_id:oldSupervisor,new_supervisor_id:selected}});await audit(db,profile,'PROJECT_SUPERVISOR_ASSIGN','INITIATIVE',init.id,null,q.data);if(oldSupervisor&&oldSupervisor!==selected)await inboxNotify(db,oldSupervisor,'PROJECT_DELEGATION_ENDED',`انتهى تكليفك بمتابعة: ${init.title}`,'أصبح للمشروع متابع جديد.','INITIATIVE',init.id,`/workspace/projects/${init.id}`);await inboxNotify(db,selected,'PROJECT_SUPERVISOR_ASSIGNED',`كُلّفت بمتابعة المشروع: ${init.title}`,'سترى المشروع في مساحة العمل. المتابعة لا توقف تنفيذ المسؤول.','INITIATIVE',init.id,`/workspace/projects/${init.id}`);return json({ok:true,assignment:q.data});
  }

  if(['MILESTONE_COMPLETION_READ','MILESTONE_PROGRESS_REVIEW','MILESTONE_UPDATE_REQUEST'].includes(actionName)){
   const m=await getMilestone(db,payload.milestoneId);const r=await getResult(db,m.result_id);const init=r.initiative;
   if(!await canFollowProject(db,profile,init)||!reviewIdentityAllowed(profile,init,m))throw new Error('مراجعة عمل النائب أو العضو تحتاج مشرفًا آخر؛ السكرتير فقط يمكنه مراجعة مشروع ينفذه بنفسه.');
   if(init.approval_status!=='APPROVED'||init.setup_status!=='ACTIVE')throw new Error('المشروع لم يبدأ التنفيذ.');
   const kind=actionName==='MILESTONE_COMPLETION_READ'?'COMPLETION_READ':actionName==='MILESTONE_PROGRESS_REVIEW'?'PROGRESS_REVIEW':'UPDATE_REQUEST';
   if(kind==='COMPLETION_READ'&&!['READY_FOR_VERIFICATION','VERIFIED'].includes(m.status))throw new Error('لا يمكن إثبات الاطلاع على نتيجة قبل إعلان اكتمالها.');
   if(kind==='PROGRESS_REVIEW'&&!['IN_PROGRESS','AT_RISK','BLOCKED'].includes(m.status))throw new Error('تأكيد سير العمل للمحطة الجارية فقط.');
   if(kind==='UPDATE_REQUEST'&&['READY_FOR_VERIFICATION','VERIFIED','CANCELLED'].includes(m.status))throw new Error('المحطة مكتملة أو مغلقة.');
   const latestReview=(await db.from('milestone_supervision_events').select('id,created_at').eq('milestone_id',m.id).eq('actor_id',profile.id).eq('event_type',kind).order('created_at',{ascending:false}).limit(1)).data||[];
   if(kind==='COMPLETION_READ'&&latestReview.length)throw new Error('سُجل اطلاعك على النتيجة مسبقًا.');
   if(kind==='PROGRESS_REVIEW'&&latestReview.length&&Date.now()-new Date(latestReview[0].created_at).getTime()<12*3600000)throw new Error('سبق تسجيل متابعة هذه المحطة خلال 12 ساعة.');
   if(kind==='UPDATE_REQUEST'){
    const lastRequest=(await db.from('milestone_supervision_events').select('id').eq('milestone_id',m.id).eq('event_type','UPDATE_REQUEST').order('created_at',{ascending:false}).limit(1)).data||[];
    if(lastRequest.length){const answered=(await db.from('milestone_supervision_events').select('id').eq('related_request_id',lastRequest[0].id).eq('event_type','REQUEST_ANSWERED').maybeSingle()).data;
     if(!answered)throw new Error('هناك طلب تحديث مفتوح لهذه المحطة؛ انتظر رد المسؤول أو تابع معه خارج النظام.');}
   }
   const note=String(payload.note||'').trim();
   const q=await db.from('milestone_supervision_events').insert({initiative_id:init.id,milestone_id:m.id,actor_id:profile.id,event_type:kind,note:note||null}).select().single();if(q.error)throw q.error;
   const notificationSent=kind==='UPDATE_REQUEST'?await inboxNotify(db,m.owner_id,'MILESTONE_UPDATE_REQUEST',`مشروع ${init.title}: مطلوب تحديث «${m.title}»`,(note?`${note} · `:'')+'المطلوب منك: افتح المحطة وسجّل آخر ما حدث.','MILESTONE',m.id,`/workspace/projects/${init.id}?milestone=${m.id}&action=update`):true;
   await audit(db,profile,actionName,'MILESTONE',m.id,null,q.data);return json({ok:true,event:q.data,notificationSent,warning:!notificationSent?'تم تسجيل الطلب، لكن تعذر إرسال إشعار للمسؤول. تواصل معه مباشرة وتحقق من إعدادات الإشعارات.':null});
  }

  if(actionName==='MILESTONE_QUALITY_REVIEW'){
   const m=await getMilestone(db,payload.milestoneId);
   const r=await getResult(db,m.result_id);const init=r.initiative;
   if(!await canFollowProject(db,profile,init)||!reviewIdentityAllowed(profile,init,m))throw new Error('غير مصرح لك بمراجعة هذه المحطة. يجب أن يراجع عمل النائب السكرتير أو شخص آخر مفوض.');
   if(init.approval_status!=='APPROVED'||init.setup_status!=='ACTIVE')throw new Error('المشروع لم يبدأ التنفيذ.');
   const reviewKind=String(payload.reviewKind||'');
   if(!['PROGRESS_OK','PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_OK','RESULT_REVISION'].includes(reviewKind))throw new Error('نوع المراجعة غير صحيح.');
   const isResult=reviewKind.startsWith('RESULT_');
   if(isResult&&!['READY_FOR_VERIFICATION','VERIFIED'].includes(m.status))throw new Error('لا يمكن مراجعة النتيجة قبل إعلان اكتمال المحطة.');
   if(!isResult&&!['IN_PROGRESS','AT_RISK','BLOCKED'].includes(m.status))throw new Error('مراجعة التقدم مخصصة للمحطة الجارية.');
   const latest=(await db.from('project_activity_entries').select('id,created_at,details').eq('milestone_id',m.id).eq('kind','MILESTONE_UPDATE').order('created_at',{ascending:false}).limit(1).maybeSingle());
   if(latest.error)throw latest.error;
   if(!latest.data)throw new Error('لا يوجد تحديث من المسؤول لتقييمه.');
   const sourceId=latest.data.id;
   if(payload.expectedSourceActivityId&&payload.expectedSourceActivityId!==sourceId)throw new Error('وصل تحديث جديد أثناء المراجعة. افتح آخر تحديث ثم قيّمه.');
   const note=String(payload.note||'').trim();
   if(['PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_REVISION'].includes(reviewKind)&&!note)throw new Error('حدد ما الذي يحتاج متابعة أو تعديلًا.');
   const prior=await db.from('milestone_supervision_events').select('id').eq('milestone_id',m.id).eq('actor_id',profile.id).eq('source_activity_id',sourceId).in('event_type',['PROGRESS_OK','PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_OK','RESULT_REVISION']).limit(1);
   if(prior.error)throw prior.error;
   if(prior.data?.length)throw new Error('سبق تقييم هذا التحديث. يمكنك مراجعة التحديث الجديد بعد أن يسجله المسؤول.');
   const requiresCorrection=['PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_REVISION'].includes(reviewKind);
   let correctionDueAt:string|null=null;
   if(requiresCorrection){
    correctionDueAt=isoDate(payload.correctionDueAt) || new Date(Date.now()+24*3600000).toISOString();
    const delta=new Date(correctionDueAt).getTime()-Date.now();
    if(!Number.isFinite(delta)||delta<=0||delta>90*86400000)throw new Error('حدد موعد تحقق من التصحيح مستقبليًا خلال 90 يومًا.');
   }
   const q=await db.from('milestone_supervision_events').insert({initiative_id:init.id,milestone_id:m.id,actor_id:profile.id,event_type:reviewKind,source_activity_id:sourceId,note:note||null,correction_due_at:correctionDueAt}).select().single();
   if(q.error)throw q.error;
   // A revision is corrective feedback, not a gate: the lead may continue other milestones.
   if(reviewKind==='RESULT_REVISION'){
    if(init.status==='COMPLETED'){
     const reopened=await db.from('initiatives').update({status:'ACTIVE',completed_at:null}).eq('id',init.id);
     if(reopened.error)throw reopened.error;
     const rr=await db.from('results').update({assignment_status:'ACTIVE',completed_at:null}).eq('id',m.result_id);if(rr.error)throw rr.error;
    }
   }
   const reviewLabel=({PROGRESS_OK:'التقدم مناسب',PROGRESS_FOLLOW_UP:'التقدم غير كافٍ',PROGRESS_UNCLEAR:'التقدم غير واضح — مطلوب توضيح',RESULT_OK:'النتيجة مناسبة',RESULT_REVISION:'النتيجة تحتاج تعديلًا'} as Record<string,string>)[reviewKind];
   const notificationSent=await inboxNotify(db,m.owner_id,`MILESTONE_REVIEW_${reviewKind}`,`مشروع ${init.title}: ${isResult?'تقييم نتيجة':'تقييم تقدم'} «${m.title}»`,(note?`${reviewLabel}: ${note}`:reviewLabel)+(correctionDueAt?` · متابعة التصحيح قبل ${correctionDueAt}`:'')+(reviewKind==='RESULT_REVISION'?' · المطلوب: عدّل وصف النتيجة أو مخرجها.':['PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR'].includes(reviewKind)?' · المطلوب: وضح ما تحقق وحدّث المحطة وفق توجيه المشرف.':''),'MILESTONE',m.id,`/workspace/projects/${init.id}?milestone=${m.id}&action=update`);
   await audit(db,profile,'MILESTONE_QUALITY_REVIEW','MILESTONE',m.id,null,q.data,{source_activity_id:sourceId});
   return json({ok:true,review:q.data,notificationSent,warning:!notificationSent?'حُفظ التقييم، لكن تعذر إرسال الإشعار للمسؤول.':null});
  }

  if(actionName==='MILESTONE_DEADLINE_REQUEST'){
   const m=await getMilestone(db,payload.milestoneId);const r=await getResult(db,m.result_id);const init=r.initiative;
   if(!isProjectLead(profile,init,r)||m.owner_id!==profile.id)throw new Error('طلب تعديل الموعد من مسؤول المشروع فقط.');
   if(init.setup_status!=='ACTIVE'||['READY_FOR_VERIFICATION','VERIFIED','CANCELLED'].includes(m.status))throw new Error('لا يمكن تغيير موعد محطة مكتملة أو غير مفعلة.');
   const proposed=isoDate(payload.proposedDueAt);const reason=String(payload.reason||'').trim();
   if(!proposed||!reason)throw new Error('أدخل الموعد الجديد وسبب تغييره.');if(init.target_due_at&&new Date(proposed)>new Date(init.target_due_at))throw new Error('الموعد المطلوب يتجاوز الموعد النهائي للمشروع؛ يجب تعديل قرار التكليف أولًا.');
   if(new Date(proposed).getTime()===new Date(m.due_at).getTime())throw new Error('الموعد الجديد هو نفسه الموعد الحالي.');
   const q=await db.from('milestone_deadline_requests').insert({initiative_id:init.id,milestone_id:m.id,requested_by:profile.id,original_due_at:m.due_at,proposed_due_at:proposed,reason}).select().single();if(q.error)throw q.error;
   const assigned=(await db.from('project_supervision_assignments').select('supervisor_id').eq('initiative_id',init.id).maybeSingle()).data?.supervisor_id||init.secretary_id;
   if(assigned)await inboxNotify(db,assigned,'DEADLINE_CHANGE_REQUEST',`مشروع ${init.title}: طلب تغيير موعد «${m.title}»`,`${reason} · المطلوب منك: راجع الموعد المقترح ووافق أو ارفض.`,'MILESTONE',m.id,`/workspace/projects/${init.id}?milestone=${m.id}&action=deadline`);
   await audit(db,profile,actionName,'MILESTONE',m.id,null,q.data);return json({ok:true,request:q.data});
  }

  if(actionName==='MILESTONE_DEADLINE_DECIDE'){
   const q=(await db.from('milestone_deadline_requests').select('*').eq('id',payload.requestId).single()).data;if(!q||q.status!=='PENDING')throw new Error('الطلب غير موجود أو سبق البت فيه.');
   const m=await getMilestone(db,q.milestone_id);const r=await getResult(db,m.result_id);const init=r.initiative;
   if(!await canFollowProject(db,profile,init)||!reviewIdentityAllowed(profile,init,m))throw new Error('القرار من اختصاص المشرف. النائب لا يوافق على تعديل موعد عمله بنفسه.');
   const approved=payload.decision==='APPROVE';if(!approved&&payload.decision!=='REJECT')throw new Error('القرار غير صحيح.');
   if(['READY_FOR_VERIFICATION','VERIFIED','CANCELLED'].includes(m.status))throw new Error('المحطة مكتملة ولا يعدل موعدها.');
   if(approved&&init.target_due_at&&new Date(q.proposed_due_at)>new Date(init.target_due_at))throw new Error('الموعد المطلوب يتجاوز الموعد النهائي للمشروع.');
   if(approved){const u=await db.from('milestones').update({due_at:q.proposed_due_at,deadline_mode:'ABSOLUTE',relative_to_milestone_id:null,relative_days:null,relative_hours:0,status_updated_at:new Date().toISOString()}).eq('id',m.id);if(u.error)throw u.error;await recalcDependentMilestones(db,m.id);}
   const upd=await db.from('milestone_deadline_requests').update({status:approved?'APPROVED':'REJECTED',decided_by:profile.id,decided_at:new Date().toISOString(),decision_note:String(payload.note||'').trim()||null}).eq('id',q.id).eq('status','PENDING').select().single();if(upd.error)throw upd.error;
   await inboxNotify(db,q.requested_by,approved?'DEADLINE_APPROVED':'DEADLINE_REJECTED',`مشروع ${init.title}: ${approved?'قُبل':'رُفض'} تغيير موعد «${m.title}»`,approved?'تم اعتماد الموعد الجديد. راجع موعد المحطة في جدول المشروع.':'لم يُعتمد الموعد المطلوب. استمر وفق الموعد الحالي أو راجع ملاحظة المشرف.','MILESTONE',m.id,`/workspace/projects/${init.id}?milestone=${m.id}&action=deadline`);
   await audit(db,profile,actionName,'MILESTONE',m.id,q,upd.data);return json({ok:true,request:upd.data});
  }

  if(actionName==='MILESTONE_PROGRESS_UPDATE'){
   const m=await getMilestone(db,payload.milestoneId);const result=await getResult(db,m.result_id);const init=result.initiative;if(!isProjectLead(profile,init,result)||m.owner_id!==profile.id)throw new Error('مسؤول المشروع فقط يحدث حالة محطة الإنجاز.');if(init.approval_status!=='APPROVED'||init.setup_status!=='ACTIVE'||['COMPLETED','CANCELLED'].includes(init.status)||init.lifecycle_state==='POSTPONED')throw new Error('المشروع ليس قيد التنفيذ.');if(['VERIFIED','CANCELLED'].includes(m.status))throw new Error('المحطة مغلقة ولا يمكن تغييرها دون إجراء رسمي.');const allowed=['IN_PROGRESS','BLOCKED','READY_FOR_VERIFICATION'];const status=allowed.includes(payload.status)?payload.status:m.status;const updateType=String(payload.updateType||'PROGRESS');
   if(!['PROGRESS','NO_PROGRESS','BLOCKER'].includes(updateType))throw new Error('أنواع التحديث: تقدم جديد، لا يوجد تقدم، عائق / تأخر. تغيير الموعد له طلب مستقل.');
   const incomingNote=String(payload.leadNote||'').trim();const nextLeadNote=incomingNote||m.lead_note;const nextOutcome=payload.outcomeText??m.outcome_text;const nextStep=String(payload.nextStep||'').trim();if(status!=='READY_FOR_VERIFICATION'&&!incomingNote)throw new Error('اكتب إفادة محددة عمّا حدث منذ آخر تحديث، ولو لم يحدث تقدم.');if(status!=='READY_FOR_VERIFICATION'&&!nextStep)throw new Error('حدد الخطوة العملية القادمة ليتابعها المشرف.');const overdue=!!m.due_at&&new Date(m.due_at).getTime()<Date.now()&&!['VERIFIED','CANCELLED'].includes(status);if((overdue||['AT_RISK','BLOCKED'].includes(status))&&!String(nextLeadNote||'').trim())throw new Error('اكتب ملاحظة المسؤول لتوضيح سبب التعثر أو التأخير وما الذي سيحدث بعده.');if(status==='READY_FOR_VERIFICATION'&&!String(nextOutcome||'').trim())throw new Error('اكتب المخرج الفعلي الذي تحقق قبل إرساله للتحقق.');if(updateType==='COMPLETE'&&status!=='READY_FOR_VERIFICATION')throw new Error('إنجاز مكتمل يستلزم وضع المحطة مكتملة.');
   if(updateType==='BLOCKER'&&status!=='BLOCKED')throw new Error('حدد حالة مهددة أو متعثرة عند إضافة عائق.');
   if(status===m.status&&updateType!=='NO_PROGRESS'&&String(nextLeadNote||'')===String(m.lead_note||'')&&String(nextOutcome||'')===String(m.outcome_text||'')&&!nextStep)throw new Error('لم يطرأ تغيير على حالة المحطة أو تفاصيل التنفيذ.');
   const nowIso=new Date().toISOString();const patch:any={status,outcome_text:nextOutcome,lead_note:nextLeadNote,status_updated_at:nowIso};
   if(status==='READY_FOR_VERIFICATION'&&m.status!=='READY_FOR_VERIFICATION')patch.completed_reported_at=nowIso;const u=await db.from('milestones').update(patch).eq('id',m.id).select().single();if(u.error)throw u.error;const hh=await computedProjectHealth(db,init.id);const hres=await db.from('initiatives').update({health:hh}).eq('id',init.id);if(hres.error)throw hres.error;if(patch.completed_reported_at)await recalcDependentMilestones(db,m.id);if(status!==m.status||patch.completed_reported_at)await syncProjectCompletion(db,m.result_id);{const nextSchedule=await db.rpc('kmsa_v64_ensure_followup',{p_initiative:init.id});if(nextSchedule.error)console.error('v6.4 ensure next milestone',nextSchedule.error);}await audit(db,profile,'MILESTONE_PROGRESS_UPDATE','MILESTONE',m.id,m,u.data);
   let reviewerNotified=true;
   {
    const entry=await db.from('project_activity_entries').insert({initiative_id:init.id,milestone_id:m.id,author_id:profile.id,kind:'MILESTONE_UPDATE',note:String(payload.leadNote||'').trim()||null,status_after:status,details:{previous_status:m.status,outcome:nextOutcome||null,update_type:updateType,next_step:nextStep||null}}).select('id,created_at').single();if(entry.error)throw entry.error;
    // Advance ONLY the anchored checkpoint that this report satisfies.
    const schedule=await db.rpc('kmsa_v64_register_followup',{p_milestone:m.id,p_reported_at:entry.data?.created_at||nowIso});
    if(schedule.error)console.error('v6.4 check-in registration',schedule.error);
    // Notify the actual reviewer about this new version; a previous review never carries over.
    const delegate=(await db.from('project_supervision_assignments').select('supervisor_id').eq('initiative_id',init.id).maybeSingle()).data?.supervisor_id;
    const reviewerId=delegate||init.secretary_id;
    if(reviewerId&&reviewerId!==profile.id){
     reviewerNotified=await inboxNotify(db,reviewerId,status==='READY_FOR_VERIFICATION'?'PROJECT_RESULT_READY':'PROJECT_PROGRESS_UPDATED',
      `مشروع ${init.title}: ${status==='READY_FOR_VERIFICATION'?'نتيجة جديدة':'تحديث جديد'} في «${m.title}»`,
      status==='READY_FOR_VERIFICATION'?'المطلوب منك: راجع النتيجة المسجلة وقيّم جودتها.':`المطلوب منك: راجع التقدم الأخير وقيّمه. ${String(payload.leadNote||'').trim()}`,
      'MILESTONE',m.id,`/workspace/projects/${init.id}?milestone=${m.id}&action=review`);
    }
    const requests=(await db.from('milestone_supervision_events').select('id,created_at').eq('milestone_id',m.id).eq('event_type','UPDATE_REQUEST').order('created_at',{ascending:false}).limit(1)).data||[];
    if(requests.length&&new Date(requests[0].created_at).getTime()<Date.now()){
     const answered=(await db.from('milestone_supervision_events').select('id').eq('related_request_id',requests[0].id).eq('event_type','REQUEST_ANSWERED').maybeSingle()).data;
     if(!answered)await db.from('milestone_supervision_events').insert({initiative_id:init.id,milestone_id:m.id,actor_id:profile.id,event_type:'REQUEST_ANSWERED',related_request_id:requests[0].id,note:'رد المسؤول بتحديث المحطة'});
    }
   }
   if(status==='READY_FOR_VERIFICATION'&&m.status==='READY_FOR_VERIFICATION'&&nextOutcome!==m.outcome_text)await syncProjectCompletion(db,m.result_id);
   if(['AT_RISK','BLOCKED','READY_FOR_VERIFICATION'].includes(status)){try{await queueNotice(db,status==='READY_FOR_VERIFICATION'?'MILESTONE_READY':'PROJECT_NEEDS_ATTENTION','MILESTONE',m.id,{status})}catch(e){reviewerNotified=false;console.error('Nonfatal notification failure',e)}}return json({ok:true,milestone:u.data,warning:!reviewerNotified?'حُفظ التحديث لكن تعذر إرسال الإشعار للمشرف. تأكد من صندوق الإشعارات أو أخبر المتابع مباشرة.':null});
  }
  if(actionName==='MILESTONE_SECRETARY_NOTE'){
   const m=await getMilestone(db,payload.milestoneId);const result=await getResult(db,m.result_id);const init=result.initiative;if(!await canFollowProject(db,profile,init))throw new Error('المتابع المباشر فقط يضيف ملاحظته.');if(init.approval_status!=='APPROVED'||init.setup_status!=='ACTIVE')throw new Error('لا تضاف ملاحظات تنفيذية قبل اعتماد المشروع.');const u=await db.from('milestones').update({secretary_note:payload.note||null}).eq('id',m.id).select().single();if(u.error)throw u.error;await audit(db,profile,'MILESTONE_SECRETARY_NOTE','MILESTONE',m.id,m,u.data);if(String(payload.note||'').trim()){const entry=await db.from('project_activity_entries').insert({initiative_id:init.id,milestone_id:m.id,author_id:profile.id,kind:'SECRETARY_NOTE',note:String(payload.note).trim()});if(entry.error)throw entry.error;}return json({ok:true,milestone:u.data});
  }

  if(actionName==='PROJECT_UPDATE_ADD'){
   // v6.4: a project-level periodic note must not compete with the milestone's
   // checkpoint or reset its deadline. Historical project_updates remain intact.
   throw new Error('تم توحيد إفادات التنفيذ: افتح المحطة الجارية واختر «تحديث». لا توجد إفادة دورية ثانية على مستوى المشروع.');
  }

  if(actionName==='PROJECT_PERMISSION_REQUEST'){
   const init=await getInitiative(db,payload.initiativeId);const result=(await db.from('results').select('*').eq('initiative_id',init.id).eq('owner_id',profile.id).limit(1).maybeSingle()).data;const supervisor=canSuperviseProject(profile,init);if(!supervisor&&!isProjectLead(profile,init,result))throw new Error('غير مسموح.');const scope=payload.scopeType||'OWN_SECRETARIAT';if(!String(payload.title||'').trim())throw new Error('اكتب الصلاحية المطلوبة.');if(scope==='CROSS_SECRETARIAT'&&!payload.targetSecretariatId)throw new Error('حدد السكرتارية صاحبة الاختصاص المتداخل.');if(scope==='CROSS_SECRETARIAT'&&payload.targetSecretariatId===init.secretariat_id)throw new Error('هذه الصلاحية داخل اختصاص السكرتارية نفسها.');
   const key=payload.permissionKey||`SPECIAL_${crypto.randomUUID()}`;const row:any={initiative_id:init.id,permission_key:key,title:String(payload.title).trim(),description:payload.description||null,permission_type:'SPECIAL',scope_type:scope,target_secretariat_id:scope==='CROSS_SECRETARIAT'?payload.targetSecretariatId:null,requested_by:profile.id,requested_for:init.owner_id,rationale:payload.rationale||null,status:'PENDING'};
   const r=await db.from('project_permissions').insert(row).select().single();if(r.error)throw r.error;const approvalCount=await createPermissionApprovals(db,r.data,init,profile,scope,row.target_secretariat_id);const permission=approvalCount?await syncPermissionApprovalState(db,r.data.id):(await db.from('project_permissions').update({status:'ACTIVE',decided_by:profile.id,decided_at:new Date().toISOString()}).eq('id',r.data.id).select().single()).data;
   await audit(db,profile,'PROJECT_PERMISSION_REQUEST','INITIATIVE',init.id,null,permission,{scope,approval_count:approvalCount});if(permission.status==='PENDING')await queueNotice(db,'PROJECT_PERMISSION_PENDING','INITIATIVE',init.id,{permission_id:r.data.id,scope});return json({ok:true,permission});
  }

  if(actionName==='PROJECT_PERMISSION_DECIDE'){
   let approval:any=null;if(payload.approvalId){approval=(await db.from('project_permission_approvals').select('*,permission:project_permissions(*,initiative:initiatives(*))').eq('id',payload.approvalId).single()).data}else if(payload.permissionId){const rows=(await db.from('project_permission_approvals').select('*,permission:project_permissions(*,initiative:initiatives(*))').eq('permission_id',payload.permissionId).eq('status','PENDING')).data||[];approval=rows.find((a:any)=>a.approval_kind==='PROJECT_SECRETARY'&&canSuperviseProject(profile,a.permission.initiative))||rows.find((a:any)=>a.approval_kind==='TARGET_SECRETARY'&&(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===a.target_secretariat_id)))||rows.find((a:any)=>a.approval_kind==='EXECUTIVE_COMMITTEE'&&['GS','PRESIDENT','ADMIN'].includes(profile.role))}
   if(!approval)throw new Error('لا يوجد طلب موافقة متاح لك.');if(approval.status!=='PENDING')throw new Error('تم البت في هذه الموافقة مسبقًا.');const perm=approval.permission;let allowed=false;if(approval.approval_kind==='PROJECT_SECRETARY')allowed=canSuperviseProject(profile,perm.initiative);if(approval.approval_kind==='TARGET_SECRETARY')allowed=profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===approval.target_secretariat_id);if(approval.approval_kind==='EXECUTIVE_COMMITTEE')allowed=['GS','PRESIDENT','ADMIN'].includes(profile.role);if(!allowed)throw new Error('ليست لديك صلاحية البت في هذه الموافقة.');const approve=payload.decision==='APPROVE';if(approve&&approval.approval_kind==='EXECUTIVE_COMMITTEE'&&!payload.decisionId)throw new Error('الصلاحية المؤسسية تحتاج قرارًا مسجلًا للجنة التنفيذية.');
   const au=await db.from('project_permission_approvals').update({status:approve?'APPROVED':'REJECTED',decided_by:profile.id,decided_at:new Date().toISOString(),decision_id:payload.decisionId||null,note:payload.note||null}).eq('id',approval.id).select().single();if(au.error)throw au.error;const permission=await syncPermissionApprovalState(db,perm.id);if(approve&&approval.approval_kind==='EXECUTIVE_COMMITTEE')await db.from('project_permissions').update({decision_id:payload.decisionId,decided_by:profile.id}).eq('id',perm.id);
   await audit(db,profile,'PROJECT_PERMISSION_DECIDE','INITIATIVE',perm.initiative_id,approval,au.data,{decision:payload.decision,permission_status:permission.status});if(permission.status==='ACTIVE'||permission.status==='REJECTED')await queueNotice(db,permission.status==='ACTIVE'?'PROJECT_PERMISSION_GRANTED':'PROJECT_PERMISSION_REJECTED','INITIATIVE',perm.initiative_id);else await queueNotice(db,'PROJECT_PERMISSION_PENDING','INITIATIVE',perm.initiative_id,{permission_id:perm.id});return json({ok:true,permission,approval:au.data});
  }

  if(actionName==='PROJECT_INTERVENTION_ADD'){
   const init=await getInitiative(db,payload.initiativeId);if(!await canFollowProject(db,profile,init))throw new Error('المتابع المباشر فقط يسجل التدخل.');if(init.approval_status!=='APPROVED'||init.setup_status!=='ACTIVE'||init.status==='COMPLETED')throw new Error('لا يمكن تسجيل تدخل تنفيذي قبل اعتماد المشروع أو بعد إغلاقه.');if(!String(payload.actionText||'').trim())throw new Error('حدد إجراء التدخل الذي نفذته أو ستنفذه، لا مجرد ملاحظة.');const r=await db.from('project_interventions').insert({initiative_id:init.id,result_id:payload.resultId||null,milestone_id:payload.milestoneId||null,secretary_id:profile.id,trigger_type:payload.triggerType||'EARLY_WARNING',reason:payload.reason||null,action_text:payload.actionText,due_at:payload.dueAt||null}).select().single();if(r.error)throw r.error;const entry=await db.from('project_activity_entries').insert({initiative_id:init.id,milestone_id:payload.milestoneId||null,author_id:profile.id,kind:'INTERVENTION',note:payload.actionText,details:{reason:payload.reason||null,follow_up_at:payload.dueAt||null}});if(entry.error)throw entry.error;await audit(db,profile,'PROJECT_INTERVENTION_ADD','INITIATIVE',init.id,null,r.data);await queueNotice(db,'SECRETARY_INTERVENTION','INITIATIVE',init.id);return json({ok:true,intervention:r.data});
  }

  if(actionName==='PROJECT_INTERVENTION_CLOSE'){
   const intervention=(await db.from('project_interventions').select('*,initiative:initiatives(*)').eq('id',payload.interventionId).single()).data;if(!intervention||!await canFollowProject(db,profile,intervention.initiative))throw new Error('غير مسموح.');const u=await db.from('project_interventions').update({status:'CLOSED',closed_at:new Date().toISOString()}).eq('id',intervention.id).select().single();if(u.error)throw u.error;await audit(db,profile,'PROJECT_INTERVENTION_CLOSE','INITIATIVE',intervention.initiative_id,intervention,u.data);return json({ok:true});
  }

  if(actionName==='PROJECT_OVERSIGHT_NOTE'){
   if(!hasOversight(profile))throw new Error('غير مسموح.');const init=await getInitiative(db,payload.initiativeId);const r=await db.from('oversight_notes').insert({secretariat_id:init.secretariat_id,initiative_id:init.id,created_by:profile.id,note:payload.note,severity:payload.severity||'INFO'}).select().single();if(r.error)throw r.error;await audit(db,profile,'PROJECT_OVERSIGHT_NOTE','INITIATIVE',init.id,null,r.data);await queueNotice(db,'PROJECT_OVERSIGHT_NOTE','INITIATIVE',init.id);return json({ok:true,note:r.data});
  }

  if(actionName==='PLAN_CREATE'){
   if(!['SECRETARY','ADMIN'].includes(profile.role))throw new Error('غير مسموح.'); const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;
   const sid=profile.role==='ADMIN'?payload.secretariatId:profile.secretariat_id; const r=await db.from('plans').insert({cycle_id:cycle.id,secretariat_id:sid,title:payload.title,period_start:payload.periodStart||null,period_end:payload.periodEnd||null,status:'ACTIVE',created_by:profile.id}).select().single();if(r.error)throw r.error;await audit(db,profile,'PLAN_CREATE','PLAN',r.data.id,null,r.data);return json({ok:true,plan:r.data});
  }
  if(actionName==='INITIATIVE_CREATE'){
   const sid=profile.role==='ADMIN'?payload.secretariatId:profile.secretariat_id;if(!canManageSecretariat(profile,sid))throw new Error('غير مسموح.');const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;
   const r=await db.from('initiatives').insert({cycle_id:cycle.id,plan_id:payload.planId||null,secretariat_id:sid,owner_id:payload.ownerId,title:payload.title,objective:payload.objective||null,source_type:'PLAN',status:'ACTIVE'}).select().single();if(r.error)throw r.error;await audit(db,profile,'INITIATIVE_CREATE','INITIATIVE',r.data.id,null,r.data);return json({ok:true,initiative:r.data});
  }
  if(actionName==='RESULT_CREATE'){
   const init=(await db.from('initiatives').select('*').eq('id',payload.initiativeId).single()).data;if(!init||!canManageSecretariat(profile,init.secretariat_id))throw new Error('غير مسموح.');const r=await db.from('results').insert({initiative_id:init.id,statement:payload.statement,success_measure:payload.successMeasure||null,owner_id:payload.ownerId||init.owner_id,due_at:payload.dueAt||null}).select().single();if(r.error)throw r.error;await audit(db,profile,'RESULT_CREATE','RESULT',r.data.id,null,r.data);return json({ok:true,result:r.data});
  }

  if(actionName==='MILESTONE_CREATE'){
   const result=(await db.from('results').select('*,initiative:initiatives(*)').eq('id',payload.resultId).single()).data;if(!result)throw new Error('النتيجة غير موجودة.');const sid=result.initiative.secretariat_id;if(!canManageSecretariat(profile,sid))throw new Error('غير مسموح.');
   const ownerId=payload.ownerId||result.owner_id||result.initiative.owner_id;const mm=await db.from('milestones').insert({result_id:result.id,secretariat_id:sid,owner_id:ownerId,title:payload.title,due_at:payload.dueAt,verification_criteria:payload.verificationCriteria,description:payload.description||null,priority:payload.priority||'NORMAL',created_by:profile.id}).select().single();if(mm.error)throw mm.error;await audit(db,profile,'MILESTONE_CREATE','MILESTONE',mm.data.id,null,mm.data);return json({ok:true,milestone:mm.data});
  }

  if(actionName==='MILESTONE_CREATE_QUICK'){
   if(!['SECRETARY','ADMIN'].includes(profile.role))throw new Error('غير مسموح.');const sid=profile.role==='ADMIN'?(payload.secretariatId||profile.secretariat_id):profile.secretariat_id;if(!sid)throw new Error('حدد السكرتارية.');const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;
   let init=(await db.from('initiatives').select('*').eq('secretariat_id',sid).eq('source_type','DIRECT').eq('status','ACTIVE').limit(1).maybeSingle()).data;
   if(!init){const x=await db.from('initiatives').insert({cycle_id:cycle.id,secretariat_id:sid,owner_id:profile.id,title:'أعمال تشغيلية مباشرة',objective:'محطات تشغيلية لم ترتبط بعد بخطة تفصيلية',source_type:'DIRECT',status:'ACTIVE'}).select().single();if(x.error)throw x.error;init=x.data}
   const rr=await db.from('results').insert({initiative_id:init.id,statement:payload.title,success_measure:payload.verificationCriteria,owner_id:payload.ownerId||profile.id,due_at:payload.dueAt}).select().single();if(rr.error)throw rr.error;
   const mm=await db.from('milestones').insert({result_id:rr.data.id,secretariat_id:sid,owner_id:payload.ownerId||profile.id,title:payload.title,due_at:payload.dueAt,verification_criteria:payload.verificationCriteria,created_by:profile.id}).select().single();if(mm.error)throw mm.error;await audit(db,profile,'MILESTONE_CREATE','MILESTONE',mm.data.id,null,mm.data);return json({ok:true,milestone:mm.data});
  }

  if(['COMMITMENT_UPSERT','EVIDENCE_ADD','EVIDENCE_FILE_ADD','BLOCKER_OPEN','INTERVENTION_ADD','MILESTONE_VERIFY','GS_OVERSIGHT_NOTE'].includes(actionName)){
   let m=await getMilestone(db,payload.milestoneId); const before={...m};
   if(actionName!=='GS_OVERSIGHT_NOTE'){const res=await getResult(db,m.result_id);const initiative=res.initiative;if(initiative.approval_status!=='APPROVED'||initiative.setup_status!=='ACTIVE'||['COMPLETED','CANCELLED'].includes(initiative.status))throw new Error('لم تبدأ مرحلة التنفيذ أو أُغلق المشروع.');}
   if(['COMMITMENT_UPSERT','EVIDENCE_ADD','EVIDENCE_FILE_ADD','BLOCKER_OPEN'].includes(actionName)&&['VERIFIED','CANCELLED'].includes(m.status))throw new Error('المحطة مغلقة ولا تقبل تحديثات جديدة.');
   if(actionName==='COMMITMENT_UPSERT'){if(m.owner_id!==profile.id)throw new Error('المالك فقط يحدث التزامه الأسبوعي.');const monday=new Date();monday.setUTCHours(0,0,0,0);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));const week=monday.toISOString().slice(0,10);const r=await db.from('weekly_commitments').upsert({milestone_id:m.id,owner_id:profile.id,week_start:week,commitment_text:payload.text,target_at:payload.targetAt||null,status:'OPEN'},{onConflict:'milestone_id,week_start'}).select().single();if(r.error)throw r.error;if(m.status==='NOT_STARTED')await db.from('milestones').update({status:'IN_PROGRESS'}).eq('id',m.id);await audit(db,profile,'COMMITMENT_UPSERT','MILESTONE',m.id,before,r.data);return json({ok:true});}
   if(actionName==='EVIDENCE_ADD'){if(m.owner_id!==profile.id)throw new Error('المالك فقط يرفع الدليل.');const r=await db.from('milestone_evidence').insert({milestone_id:m.id,submitted_by:profile.id,evidence_type:payload.evidenceType||'NOTE',note:payload.note||null,url:payload.url||null,drive_file_id:payload.driveFileId||null}).select().single();if(r.error)throw r.error;await db.from('milestones').update({status:'READY_FOR_VERIFICATION'}).eq('id',m.id);await audit(db,profile,'EVIDENCE_ADD','MILESTONE',m.id,before,r.data);await queueNotice(db,'MILESTONE_READY','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='EVIDENCE_FILE_ADD'){if(m.owner_id!==profile.id)throw new Error('المالك فقط يرفع الدليل.');validateStagingFile(profile,payload,false);await queueJob(db,'ARCHIVE_STAGING_EVIDENCE','MILESTONE',m.id,{mode:'ARCHIVE_STAGING_EVIDENCE',milestone_id:m.id,storage_path:payload.stagingPath,file_name:payload.fileName,mime_type:payload.mimeType,note:payload.note||null,submitted_by:profile.id,submit_for_verification:payload.submitForVerification!==false});kickBackgroundWorker();await audit(db,profile,'EVIDENCE_FILE_QUEUED','MILESTONE',m.id,before,null);return json({ok:true,archiving:true});}
   if(actionName==='BLOCKER_OPEN'){if(m.owner_id!==profile.id)throw new Error('المالك فقط يسجل العائق.');const r=await db.from('blockers').insert({milestone_id:m.id,opened_by:profile.id,description:payload.description,severity:payload.severity||'MEDIUM'}).select().single();if(r.error)throw r.error;await db.from('milestones').update({status:'BLOCKED'}).eq('id',m.id);await audit(db,profile,'BLOCKER_OPEN','MILESTONE',m.id,before,r.data);await queueNotice(db,'MILESTONE_BLOCKED','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='INTERVENTION_ADD'){if(!canManageSecretariat(profile,m.secretariat_id))throw new Error('السكرتير المختص فقط يضيف تدخلًا.');const r=await db.from('interventions').insert({milestone_id:m.id,secretary_id:profile.id,action_text:payload.actionText,due_at:payload.dueAt||null}).select().single();if(r.error)throw r.error;await audit(db,profile,'INTERVENTION_ADD','MILESTONE',m.id,before,r.data);await queueNotice(db,'SECRETARY_INTERVENTION','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='MILESTONE_VERIFY'){const r=await getResult(db,m.result_id);const project=r.initiative;if(m.owner_id===profile.id&&!reviewIdentityAllowed(profile,project,m))throw new Error('لا يجوز للنائب أو العضو مراجعة إنجازه بنفسه.');const gsReviewer=isGs(profile)&&m.owner_id===project.secretary_id;if(!canManageSecretariat(profile,m.secretariat_id)&&!gsReviewer)throw new Error('السكرتير المختص أو GS في حالة تعارض المسؤولية فقط يتحقق من الإنجاز.');if(m.status!=='READY_FOR_VERIFICATION')throw new Error('المحطة ليست جاهزة للتحقق.');const decision=payload.decision==='VERIFIED'?'VERIFIED':'RETURNED';await db.from('verifications').insert({milestone_id:m.id,verifier_id:profile.id,decision,note:payload.note||null});const patch=decision==='VERIFIED'?{status:'VERIFIED',verified_at:new Date().toISOString()}:{status:'IN_PROGRESS',verified_at:null};const u=await db.from('milestones').update(patch).eq('id',m.id).select().single();if(u.error)throw u.error;if(decision==='VERIFIED'){await db.from('blockers').update({status:'RESOLVED',resolved_by:profile.id,resolved_at:new Date().toISOString(),resolution:'أُغلق تلقائيًا بعد تحقق المحطة'}).eq('milestone_id',m.id).eq('status','OPEN');await db.from('interventions').update({status:'CLOSED',closed_at:new Date().toISOString()}).eq('milestone_id',m.id).eq('status','OPEN')}await audit(db,profile,'MILESTONE_VERIFY','MILESTONE',m.id,before,u.data,{decision});if(decision==='VERIFIED')await syncProjectCompletion(db,m.result_id);await queueNotice(db,decision==='VERIFIED'?'MILESTONE_VERIFIED':'MILESTONE_RETURNED','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='GS_OVERSIGHT_NOTE'){if(!hasOversight(profile))throw new Error('غير مسموح.');const r=await db.from('oversight_notes').insert({secretariat_id:m.secretariat_id,milestone_id:m.id,created_by:profile.id,note:payload.note,severity:payload.severity||'INFO'}).select().single();if(r.error)throw r.error;await audit(db,profile,'GS_OVERSIGHT_NOTE','MILESTONE',m.id,null,r.data);await queueNotice(db,'GS_OVERSIGHT_NOTE','MILESTONE',m.id);return json({ok:true});}
  }


  if(actionName==='MEETING_CREATE'){
   if(!['SECRETARY','GS','PRESIDENT','ADMIN'].includes(profile.role))throw new Error('غير مسموح.');const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;const r=await db.from('meetings').insert({cycle_id:cycle.id,title:payload.title,held_at:payload.heldAt||new Date().toISOString(),chair_id:profile.id,status:'OPEN',created_by:profile.id}).select().single();if(r.error)throw r.error;await audit(db,profile,'MEETING_CREATE','MEETING',r.data.id,null,r.data);return json({ok:true,meeting:r.data});
  }
  if(actionName==='DECISION_CREATE'){
   if(!['GS','PRESIDENT','ADMIN'].includes(profile.role))throw new Error('السجل الرسمي متاح للسكرتارية العامة والرئيس فقط.');const sid=payload.secretariatId||null;const decisionType=['GENERAL','APPOINTMENT','DELEGATION','ADMINISTRATIVE','EXECUTIVE_COMMITTEE','OTHER'].includes(payload.decisionType)?payload.decisionType:'GENERAL';const r=await db.from('decisions').insert({meeting_id:null,secretariat_id:sid,title:String(payload.title||'').trim(),decision_text:String(payload.decisionText||'').trim(),decision_type:decisionType,owner_id:payload.ownerId||null,due_at:null,status:'RECORDED',created_by:profile.id}).select().single();if(r.error)throw r.error;await audit(db,profile,'DECISION_CREATE','DECISION',r.data.id,null,r.data);return json({ok:true,decision:r.data});
  }
  if(actionName==='DECISION_TO_MILESTONE'){
   throw new Error('للتنفيذ: أنشئ مشروعًا من السكرتارية المعنية واربط القرار في الوصف عند الحاجة. السجل الرسمي لا ينشئ مهام تلقائيًا.');
  }


  if(actionName==='PROPOSAL_DOCUMENT_RETRY'){
   const p=await getProposal(db,payload.proposalId);const allowed=p.applicant_id===profile.id||hasOversight(profile)||(profile.role==='SECRETARY'&&profile.secretariat_id===p.secretariat_id);if(!allowed)throw new Error('غير مسموح.');
   const v=(await db.from('proposal_versions').select('*').eq('proposal_id',p.id).eq('version_no',p.current_version).single()).data;if(!v)throw new Error('نسخة المقترح غير موجودة.');
   if(v.pdf_drive_file_id)return json({ok:true,alreadyReady:true});
   if(v.source==='FILE_UPLOAD'){
    const previous=(await db.from('background_jobs').select('payload').eq('job_type','ARCHIVE_STAGING_PROPOSAL').eq('entity_id',p.id).order('created_at',{ascending:false}).limit(20)).data||[];
    const old=previous.find((j:any)=>Number(j.payload?.version_no)===Number(p.current_version)&&j.payload?.storage_path);
    if(!old)throw new Error('النسخة المرفوعة تحتاج إعادة رفع الملف؛ لا يمكن استبدالها تلقائيًا بنموذج فارغ.');
    await queueJob(db,'ARCHIVE_STAGING_PROPOSAL','PROPOSAL',p.id,old.payload,`proposal-upload:${p.id}:${p.current_version}`);kickBackgroundWorker();
   }else await queueProposalArtifacts(db,p,p.current_version);
   await audit(db,profile,'PROPOSAL_DOCUMENT_RETRY','PROPOSAL',p.id,null,{version:p.current_version});return json({ok:true});
  }

  if(actionName==='ROUTINE_CREATE'){
   if(!['SECRETARY','ADMIN'].includes(profile.role))throw new Error('السكرتير المختص فقط ينشئ عملًا دوريًا.');
   const sid=profile.role==='ADMIN'?payload.secretariatId:profile.secretariat_id;if(!sid)throw new Error('حدد السكرتارية.');
   const owner=(await db.from('profiles').select('*').eq('id',payload.ownerId).eq('active',true).single()).data;if(!owner)throw new Error('اختر مسؤولًا فعّالًا.');
   const cadence=['WEEKLY','MONTHLY','QUARTERLY','CUSTOM'].includes(payload.cadence)?payload.cadence:'WEEKLY';const firstDue=isoDate(payload.firstDueAt);if(!firstDue)throw new Error('حدد أول موعد للاستحقاق.');
   const intervalDays=cadence==='CUSTOM'?Math.max(1,Number(payload.intervalDays||1)):null;
   const r=await db.from('routine_obligations').insert({secretariat_id:sid,secretary_id:profile.role==='SECRETARY'?profile.id:(payload.secretaryId||null),owner_id:owner.id,title:String(payload.title||'').trim(),description:payload.description||null,expected_output:payload.expectedOutput||null,cadence,interval_days:intervalDays,next_due_at:firstDue,created_by:profile.id}).select().single();if(r.error)throw r.error;await audit(db,profile,'ROUTINE_CREATE','ROUTINE',r.data.id,null,r.data);return json({ok:true,obligation:r.data});
  }
  if(actionName==='ROUTINE_UPDATE_SUBMIT'){
   const o=(await db.from('routine_obligations').select('*').eq('id',payload.obligationId).single()).data;if(!o||o.owner_id!==profile.id)throw new Error('هذا الالتزام الدوري غير مسند إليك.');
   const report=String(payload.reportNote||'').trim();if(!report)throw new Error('اكتب تقريرًا مختصرًا عن العمل الدوري.');
   const status=['COMPLETED','AT_RISK','BLOCKED'].includes(payload.status)?payload.status:'COMPLETED';const due=o.next_due_at;const r=await db.from('routine_updates').insert({obligation_id:o.id,due_at:due,submitted_by:profile.id,status,report_note:report,output_text:payload.outputText||null,evidence_url:payload.evidenceUrl||null}).select().single();if(r.error)throw r.error;
   let next=new Date(due);if(o.cadence==='WEEKLY')next.setUTCDate(next.getUTCDate()+7);else if(o.cadence==='MONTHLY')next.setUTCMonth(next.getUTCMonth()+1);else if(o.cadence==='QUARTERLY')next.setUTCMonth(next.getUTCMonth()+3);else next.setUTCDate(next.getUTCDate()+Number(o.interval_days||1));
   if(status==='COMPLETED'){const advance=await db.from('routine_obligations').update({next_due_at:next.toISOString()}).eq('id',o.id).eq('next_due_at',due);if(advance.error)throw advance.error;}await audit(db,profile,'ROUTINE_UPDATE_SUBMIT','ROUTINE',o.id,null,r.data);if(status!=='COMPLETED')await queueNotice(db,'ROUTINE_NEEDS_ATTENTION','ROUTINE',o.id,{status});return json({ok:true,update:r.data,nextDueAt:status==='COMPLETED'?next.toISOString():due});
  }
  if(actionName==='ROUTINE_SECRETARY_NOTE'){
   const o=(await db.from('routine_obligations').select('*').eq('id',payload.obligationId).single()).data;if(!o||!(profile.role==='ADMIN'||o.secretary_id===profile.id||(profile.role==='SECRETARY'&&profile.secretariat_id===o.secretariat_id)))throw new Error('السكرتير المختص فقط يضيف ملاحظته.');
   const latest=(await db.from('routine_updates').select('*').eq('obligation_id',o.id).order('submitted_at',{ascending:false}).limit(1).maybeSingle()).data;if(!latest)throw new Error('لا يوجد تقرير دوري لإضافة ملاحظة عليه.');
   const u=await db.from('routine_updates').update({secretary_note:payload.note||null}).eq('id',latest.id).select().single();if(u.error)throw u.error;await audit(db,profile,'ROUTINE_SECRETARY_NOTE','ROUTINE',o.id,latest,u.data);return json({ok:true,update:u.data});
  }
  if(actionName==='ROUTINE_DEACTIVATE'){
   const o=(await db.from('routine_obligations').select('*').eq('id',payload.obligationId).single()).data;if(!o||!(profile.role==='ADMIN'||o.secretary_id===profile.id||(profile.role==='SECRETARY'&&profile.secretariat_id===o.secretariat_id)))throw new Error('غير مسموح.');
   const u=await db.from('routine_obligations').update({active:false}).eq('id',o.id).select().single();if(u.error)throw u.error;await audit(db,profile,'ROUTINE_DEACTIVATE','ROUTINE',o.id,o,u.data);return json({ok:true});
  }

  // ----- Lightweight operational positions: only what directly affects follow-up -----
  if(actionName==='POSITION_CREATE'){
   if(!['SECRETARY','ADMIN'].includes(profile.role))throw new Error('السكرتير المختص فقط ينشئ صفة تشغيلية.');
   const sid=profile.role==='ADMIN'?payload.secretariatId:profile.secretariat_id;if(!sid)throw new Error('حدد السكرتارية.');const title=String(payload.title||'').trim();if(!title)throw new Error('اكتب اسم الصفة.');
   const cycleId=(await db.from('cycles').select('id').eq('is_current',true).single()).data?.id;if(!cycleId)throw new Error('لا توجد دورة حالية.');
   const r=await db.from('operational_positions').insert({secretariat_id:sid,cycle_id:cycleId,title,description:payload.description||null,created_by:profile.id}).select().single();if(r.error)throw r.error;await audit(db,profile,'POSITION_CREATE','POSITION',r.data.id,null,r.data);return json({ok:true,position:r.data});
  }
  if(actionName==='POSITION_UPDATE'){
   const pos=(await db.from('operational_positions').select('*').eq('id',payload.positionId).single()).data;if(!pos||!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===pos.secretariat_id)))throw new Error('غير مسموح.');
   const patch:any={};if(payload.title!==undefined){const title=String(payload.title||'').trim();if(!title)throw new Error('اكتب اسم الصفة.');patch.title=title}if(payload.description!==undefined)patch.description=payload.description||null;if(payload.active!==undefined)patch.active=!!payload.active;const u=await db.from('operational_positions').update(patch).eq('id',pos.id).select().single();if(u.error)throw u.error;
   if(payload.active===false&&pos.active!==false){const endedAt=new Date().toISOString();const activeAssignments=(await db.from('position_assignments').select('id').eq('position_id',pos.id).eq('active',true)).data||[];const assignmentIds=activeAssignments.map((x:any)=>x.id);if(assignmentIds.length){await db.from('position_assignments').update({active:false,ends_at:endedAt}).in('id',assignmentIds);await db.from('routine_obligations').update({active:false}).in('position_assignment_id',assignmentIds).eq('active',true)}await db.from('position_duty_templates').update({active:false}).eq('position_id',pos.id).eq('active',true);await db.from('position_event_templates').update({active:false}).eq('position_id',pos.id).eq('active',true);const future=(await db.from('work_events').select('id').eq('position_id',pos.id).eq('status','SCHEDULED').gte('scheduled_at',endedAt)).data||[];const eventIds=future.map((x:any)=>x.id);if(eventIds.length){await db.from('event_attendance').delete().eq('status','PENDING').in('event_id',eventIds);await db.from('work_events').update({status:'CANCELLED',notes:'أُلغي تلقائيًا بعد إيقاف الصفة التشغيلية.'}).in('id',eventIds)}}
   await audit(db,profile,'POSITION_UPDATE','POSITION',pos.id,pos,u.data);return json({ok:true,position:u.data});
  }
  if(actionName==='POSITION_ASSIGN'){
   const pos=(await db.from('operational_positions').select('*').eq('id',payload.positionId).single()).data;if(!pos||!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===pos.secretariat_id)))throw new Error('غير مسموح.');
   const currentId=(await db.from('cycles').select('id').eq('is_current',true).single()).data?.id;if(!currentId||pos.cycle_id!==currentId)throw new Error('لا يمكن تعديل تكليف في دورة سابقة.');
   const member=(await db.from('profiles').select('*').eq('id',payload.profileId).eq('active',true).single()).data;if(!member)throw new Error('اختر عضوًا فعّالًا.');
   const membership=(await db.from('cycle_memberships').select('id').eq('cycle_id',currentId).eq('profile_id',member.id).is('ended_at',null).maybeSingle()).data;if(!membership)throw new Error('هذا الشخص غير مسجل ضمن الدورة الحالية.');
   const a=await db.from('position_assignments').insert({position_id:pos.id,cycle_id:currentId,profile_id:member.id,scope_label:payload.scopeLabel||null,assignment_detail:String(payload.assignmentDetail||'').trim().slice(0,500)||null,starts_at:payload.startsAt||new Date().toISOString(),created_by:profile.id}).select().single();if(a.error)throw a.error;
   const secretaryId=profile.role==='SECRETARY'?profile.id:(await db.from('profiles').select('id').eq('role','SECRETARY').eq('secretariat_id',pos.secretariat_id).eq('active',true).limit(1).maybeSingle()).data?.id||null;
   const duties=(await db.from('position_duty_templates').select('*').eq('position_id',pos.id).eq('active',true)).data||[];for(const d of duties){const base=new Date();base.setUTCDate(base.getUTCDate()+Number(d.first_due_after_days||d.interval_days||7));await db.from('routine_obligations').insert({secretariat_id:pos.secretariat_id,secretary_id:secretaryId,owner_id:member.id,title:d.title,description:d.description,expected_output:d.expected_output,cadence:'CUSTOM',interval_days:d.interval_days,next_due_at:base.toISOString(),created_by:profile.id,source_type:'POSITION',position_assignment_id:a.data.id,duty_template_id:d.id});}
   const futureEvents=(await db.from('work_events').select('id').eq('position_id',pos.id).eq('status','SCHEDULED').gte('scheduled_at',new Date().toISOString())).data||[];for(const e of futureEvents)await db.from('event_attendance').upsert({event_id:e.id,profile_id:member.id,assignment_id:a.data.id},{onConflict:'event_id,profile_id'});
   await audit(db,profile,'POSITION_ASSIGN','POSITION_ASSIGNMENT',a.data.id,null,a.data);await inboxNotify(db,member.id,'POSITION_ASSIGNED',`تم إسناد صفة: ${pos.title}`,payload.scopeLabel?`النطاق: ${payload.scopeLabel}`:'ستظهر لك الالتزامات المرتبطة بهذه الصفة تلقائيًا.','POSITION',pos.id,'/workspace/routine');return json({ok:true,assignment:a.data});
  }
  if(actionName==='POSITION_ASSIGNMENT_END'){
   const a=(await db.from('position_assignments').select('*,position:operational_positions(*)').eq('id',payload.assignmentId).single()).data;if(!a||!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===a.position.secretariat_id)))throw new Error('غير مسموح.');const currentId=(await db.from('cycles').select('id').eq('is_current',true).single()).data?.id;if(a.cycle_id!==currentId)throw new Error('لا يمكن إنهاء تكليف دورة سابقة.');const u=await db.from('position_assignments').update({active:false,ends_at:payload.endsAt||new Date().toISOString()}).eq('id',a.id).select().single();if(u.error)throw u.error;await db.from('routine_obligations').update({active:false}).eq('position_assignment_id',a.id).eq('active',true);const futureEvents=(await db.from('work_events').select('id').eq('position_id',a.position_id).eq('status','SCHEDULED').gte('scheduled_at',new Date().toISOString())).data||[];const eventIds=futureEvents.map((x:any)=>x.id);if(eventIds.length)await db.from('event_attendance').delete().eq('assignment_id',a.id).eq('status','PENDING').in('event_id',eventIds);await audit(db,profile,'POSITION_ASSIGNMENT_END','POSITION_ASSIGNMENT',a.id,a,u.data);return json({ok:true});
  }
  if(actionName==='POSITION_DUTY_CREATE'){
   const pos=(await db.from('operational_positions').select('*').eq('id',payload.positionId).single()).data;if(!pos||!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===pos.secretariat_id)))throw new Error('غير مسموح.');const title=String(payload.title||'').trim();if(!title)throw new Error('اكتب اسم الالتزام.');const interval=Math.max(1,Math.min(365,Number(payload.intervalDays||7)));const first=Math.max(0,Math.min(365,Number(payload.firstDueAfterDays??interval)));
   const d=await db.from('position_duty_templates').insert({position_id:pos.id,title,description:payload.description||null,expected_output:payload.expectedOutput||null,interval_days:interval,first_due_after_days:first,created_by:profile.id}).select().single();if(d.error)throw d.error;
   const secretaryId=profile.role==='SECRETARY'?profile.id:(await db.from('profiles').select('id').eq('role','SECRETARY').eq('secretariat_id',pos.secretariat_id).eq('active',true).limit(1).maybeSingle()).data?.id||null;const assignments=(await db.from('position_assignments').select('*').eq('position_id',pos.id).eq('active',true)).data||[];for(const a of assignments){const due=new Date();due.setUTCDate(due.getUTCDate()+first);await db.from('routine_obligations').insert({secretariat_id:pos.secretariat_id,secretary_id:secretaryId,owner_id:a.profile_id,title,description:payload.description||null,expected_output:payload.expectedOutput||null,cadence:'CUSTOM',interval_days:interval,next_due_at:due.toISOString(),created_by:profile.id,source_type:'POSITION',position_assignment_id:a.id,duty_template_id:d.data.id});}
   await audit(db,profile,'POSITION_DUTY_CREATE','POSITION_DUTY',d.data.id,null,d.data);return json({ok:true,duty:d.data});
  }
  if(actionName==='POSITION_DUTY_UPDATE'){
   const d=(await db.from('position_duty_templates').select('*,position:operational_positions(*)').eq('id',payload.dutyId).single()).data;if(!d||!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===d.position.secretariat_id)))throw new Error('غير مسموح.');const interval=Math.max(1,Math.min(365,Number(payload.intervalDays??d.interval_days)));const first=Math.max(0,Math.min(365,Number(payload.firstDueAfterDays??interval)));const patch:any={interval_days:interval,first_due_after_days:first};if(payload.title!==undefined)patch.title=String(payload.title||'').trim();if(payload.description!==undefined)patch.description=payload.description||null;if(payload.expectedOutput!==undefined)patch.expected_output=payload.expectedOutput||null;if(payload.active!==undefined)patch.active=!!payload.active;const u=await db.from('position_duty_templates').update(patch).eq('id',d.id).select().single();if(u.error)throw u.error;
   if(patch.active===false)await db.from('routine_obligations').update({active:false}).eq('duty_template_id',d.id).eq('active',true);else{const due=new Date(payload.effectiveFrom||new Date());due.setUTCDate(due.getUTCDate()+first);await db.from('routine_obligations').update({title:u.data.title,description:u.data.description,expected_output:u.data.expected_output,cadence:'CUSTOM',interval_days:interval,next_due_at:due.toISOString(),active:true}).eq('duty_template_id',d.id).eq('active',true)}await audit(db,profile,'POSITION_DUTY_UPDATE','POSITION_DUTY',d.id,d,u.data);return json({ok:true,duty:u.data});
  }

  // ----- Quick tasks: a light path for work that does not deserve a project -----
  if(actionName==='TASK_CREATE'){
   if(!['SECRETARY','GS','PRESIDENT','ADMIN'].includes(profile.role))throw new Error('غير مسموح بإسناد مهمة.');const sid=profile.role==='SECRETARY'?profile.secretariat_id:payload.secretariatId;if(!sid)throw new Error('حدد السكرتارية.');const assignee=(await db.from('profiles').select('*').eq('id',payload.assigneeId).eq('active',true).single()).data;if(!assignee)throw new Error('اختر شخصًا فعّالًا.');const title=String(payload.title||'').trim();if(!title)throw new Error('اكتب المهمة.');const r=await db.from('quick_tasks').insert({secretariat_id:sid,title,description:payload.description||null,assignee_id:assignee.id,assigned_by:profile.id,due_at:isoDate(payload.dueAt),priority:payload.priority||'NORMAL'}).select().single();if(r.error)throw r.error;await audit(db,profile,'TASK_CREATE','TASK',r.data.id,null,r.data);await inboxNotify(db,assignee.id,'TASK_ASSIGNED',`مهمة جديدة: ${title}`,payload.description||null,'TASK',r.data.id,'/workspace/tasks');return json({ok:true,task:r.data});
  }
  if(actionName==='TASK_UPDATE'){
   const t=(await db.from('quick_tasks').select('*').eq('id',payload.taskId).single()).data;if(!t)throw new Error('المهمة غير موجودة.');const manager=profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===t.secretariat_id)||t.assigned_by===profile.id;const owner=t.assignee_id===profile.id;if(!manager&&!owner)throw new Error('غير مسموح.');const patch:any={};if(payload.status!==undefined){const allowed=['OPEN','IN_PROGRESS','WAITING_EXTERNAL','BLOCKED','DONE','CANCELLED'];if(!allowed.includes(payload.status))throw new Error('حالة غير صالحة.');patch.status=payload.status;if(payload.status==='DONE')patch.completed_at=new Date().toISOString()}if(payload.assigneeNote!==undefined&&owner)patch.assignee_note=payload.assigneeNote||null;if(payload.evidenceUrl!==undefined&&owner)patch.evidence_url=payload.evidenceUrl||null;if(payload.secretaryNote!==undefined&&manager)patch.secretary_note=payload.secretaryNote||null;if(payload.dueAt!==undefined&&manager)patch.due_at=isoDate(payload.dueAt);if(payload.priority!==undefined&&manager)patch.priority=payload.priority;const u=await db.from('quick_tasks').update(patch).eq('id',t.id).select().single();if(u.error)throw u.error;await audit(db,profile,'TASK_UPDATE','TASK',t.id,t,u.data);if(['BLOCKED','WAITING_EXTERNAL'].includes(u.data.status))await inboxNotify(db,t.assigned_by,'TASK_NEEDS_ATTENTION',`المهمة تحتاج متابعة: ${t.title}`,u.data.assignee_note||null,'TASK',t.id,'/workspace/tasks');return json({ok:true,task:u.data});
  }

  // ----- Recurring events for groups such as academic representatives -----
  if(actionName==='EVENT_TEMPLATE_CREATE'){
   if(!['SECRETARY','ADMIN'].includes(profile.role))throw new Error('السكرتير المختص فقط ينشئ اجتماعًا دوريًا.');const pos=(await db.from('operational_positions').select('*').eq('id',payload.positionId).single()).data;if(!pos||!(profile.role==='ADMIN'||profile.secretariat_id===pos.secretariat_id))throw new Error('غير مسموح.');const title=String(payload.title||'').trim();const next=isoDate(payload.nextEventAt);if(!title||!next)throw new Error('اكتب اسم الاجتماع وموعده القادم.');const interval=Math.max(1,Math.min(365,Number(payload.intervalDays||30)));const r=await db.from('position_event_templates').insert({position_id:pos.id,title,description:payload.description||null,interval_days:interval,next_event_at:next,created_by:profile.id}).select().single();if(r.error)throw r.error;await audit(db,profile,'EVENT_TEMPLATE_CREATE','EVENT_TEMPLATE',r.data.id,null,r.data);kickBackgroundWorker();return json({ok:true,template:r.data});
  }
  if(actionName==='EVENT_TEMPLATE_UPDATE'){
   if(!['SECRETARY','ADMIN'].includes(profile.role))throw new Error('السكرتير المختص فقط يعدّل الاجتماع الدوري.');const t=(await db.from('position_event_templates').select('*,position:operational_positions(*)').eq('id',payload.templateId).single()).data;if(!t||!(profile.role==='ADMIN'||profile.secretariat_id===t.position.secretariat_id))throw new Error('غير مسموح.');const patch:any={};if(payload.title!==undefined){const title=String(payload.title||'').trim();if(!title)throw new Error('اكتب اسم الاجتماع.');patch.title=title}if(payload.description!==undefined)patch.description=payload.description||null;if(payload.intervalDays!==undefined)patch.interval_days=Math.max(1,Math.min(365,Number(payload.intervalDays||30)));if(payload.nextEventAt!==undefined){const next=isoDate(payload.nextEventAt);if(!next)throw new Error('حدد الموعد القادم.');patch.next_event_at=next}if(payload.active!==undefined)patch.active=!!payload.active;const u=await db.from('position_event_templates').update(patch).eq('id',t.id).select().single();if(u.error)throw u.error;
   if(payload.active===false){const now=new Date().toISOString();const future=(await db.from('work_events').select('id').eq('template_id',t.id).eq('status','SCHEDULED').gte('scheduled_at',now)).data||[];const eventIds=future.map((x:any)=>x.id);if(eventIds.length){await db.from('event_attendance').delete().eq('status','PENDING').in('event_id',eventIds);await db.from('work_events').update({status:'CANCELLED',notes:'أُلغي تلقائيًا بعد إيقاف الاجتماع الدوري.'}).in('id',eventIds)}}
   await audit(db,profile,'EVENT_TEMPLATE_UPDATE','EVENT_TEMPLATE',t.id,t,u.data);kickBackgroundWorker();return json({ok:true,template:u.data});
  }

  if(actionName==='EVENT_ATTENDANCE_SET'){
   const a=(await db.from('event_attendance').select('*,event:work_events(*)').eq('id',payload.attendanceId).single()).data;if(!a||!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===a.event.secretariat_id)))throw new Error('غير مسموح.');const status=['PRESENT','ABSENT','EXCUSED','PENDING'].includes(payload.status)?payload.status:'PENDING';const u=await db.from('event_attendance').update({status,note:payload.note||null,recorded_by:profile.id,recorded_at:new Date().toISOString()}).eq('id',a.id).select().single();if(u.error)throw u.error;await audit(db,profile,'EVENT_ATTENDANCE_SET','EVENT',a.event_id,a,u.data);return json({ok:true,attendance:u.data});
  }
  if(actionName==='EVENT_UPDATE'){
   const e=(await db.from('work_events').select('*').eq('id',payload.eventId).single()).data;if(!e||!(profile.role==='ADMIN'||(profile.role==='SECRETARY'&&profile.secretariat_id===e.secretariat_id)))throw new Error('غير مسموح.');const patch:any={};if(payload.status!==undefined)patch.status=payload.status;if(payload.notes!==undefined)patch.notes=payload.notes||null;if(payload.outcomes!==undefined)patch.outcomes=payload.outcomes||null;const u=await db.from('work_events').update(patch).eq('id',e.id).select().single();if(u.error)throw u.error;await audit(db,profile,'EVENT_UPDATE','EVENT',e.id,e,u.data);return json({ok:true,event:u.data});
  }

  if(actionName==='ROUTINE_EDIT'){
   const o=(await db.from('routine_obligations').select('*').eq('id',payload.obligationId).single()).data;if(!o||!(profile.role==='ADMIN'||o.secretary_id===profile.id||(profile.role==='SECRETARY'&&profile.secretariat_id===o.secretariat_id)))throw new Error('غير مسموح.');if(o.source_type==='POSITION')throw new Error('هذا الالتزام مرتبط بصفة تشغيلية؛ عدّل القاعدة من تبويب الصفات حتى تتغير للجميع دون فقد التاريخ.');const cadence=['WEEKLY','MONTHLY','QUARTERLY','CUSTOM'].includes(payload.cadence)?payload.cadence:o.cadence;const interval=cadence==='CUSTOM'?Math.max(1,Number(payload.intervalDays||o.interval_days||1)):null;const patch:any={cadence,interval_days:interval};if(payload.title!==undefined)patch.title=payload.title;if(payload.description!==undefined)patch.description=payload.description||null;if(payload.expectedOutput!==undefined)patch.expected_output=payload.expectedOutput||null;if(payload.nextDueAt!==undefined)patch.next_due_at=isoDate(payload.nextDueAt);const u=await db.from('routine_obligations').update(patch).eq('id',o.id).select().single();if(u.error)throw u.error;await audit(db,profile,'ROUTINE_EDIT','ROUTINE',o.id,o,u.data);return json({ok:true,obligation:u.data});
  }

  if(actionName==='NOTIFICATION_MARK_READ'){
   const q=await db.from('user_notifications').update({read_at:new Date().toISOString()}).eq('id',payload.notificationId).eq('profile_id',profile.id);if(q.error)throw q.error;return json({ok:true});
  }
  if(actionName==='NOTIFICATION_MARK_ALL_READ'){
   const q=await db.from('user_notifications').update({read_at:new Date().toISOString()}).eq('profile_id',profile.id).is('read_at',null);if(q.error)throw q.error;return json({ok:true});
  }

  if(actionName==='ACCOUNT_EMAIL_CHANGE'){
   const email=String(payload.email||'').trim().toLowerCase();const currentPassword=String(payload.currentPassword||'');
   if(!email||!currentPassword)throw new Error('أدخل البريد الجديد وكلمة السر الحالية.');
   const verify=anonClient();const {error:verifyError}=await verify.auth.signInWithPassword({email:profile.email,password:currentPassword});if(verifyError)throw new Error('كلمة السر الحالية غير صحيحة.');
   const existing=(await db.from('profiles').select('id').eq('email',email).neq('id',profile.id).maybeSingle()).data;if(existing)throw new Error('هذا البريد مستخدم في حساب آخر.');
   const before={...profile};const {error:authError}=await db.auth.admin.updateUserById(profile.auth_user_id,{email,email_confirm:true});if(authError)throw authError;
   const upd=await db.from('profiles').update({email}).eq('id',profile.id).select().single();if(upd.error)throw upd.error;await audit(db,profile,'ACCOUNT_EMAIL_CHANGE','PROFILE',profile.id,before,upd.data);return json({ok:true});
  }
  if(actionName==='ACCOUNT_PASSWORD_CHANGE'){
   const currentPassword=String(payload.currentPassword||'');const newPassword=String(payload.newPassword||'');if(!currentPassword||newPassword.length<8)throw new Error('أدخل كلمة السر الحالية وكلمة جديدة من 8 أحرف على الأقل.');
   const verify=anonClient();const {error:verifyError}=await verify.auth.signInWithPassword({email:profile.email,password:currentPassword});if(verifyError)throw new Error('كلمة السر الحالية غير صحيحة.');
   const {error:authError}=await db.auth.admin.updateUserById(profile.auth_user_id,{password:newPassword});if(authError)throw authError;await db.from('profiles').update({must_change_password:false}).eq('id',profile.id);await audit(db,profile,'ACCOUNT_PASSWORD_CHANGE','PROFILE',profile.id,null,{changed:true});return json({ok:true});
  }

  if(actionName==='PASSWORD_CHANGED')throw new Error('غيّر كلمة المرور باستخدام كلمتك الحالية أو المؤقتة للتأكد من هوية صاحب الحساب.');

  if(actionName==='ADMIN_SETTINGS_UPDATE'){if(profile.role!=='ADMIN')throw new Error('غير مسموح.');for(const [key,value] of Object.entries(payload.settings||{})){if(key==='current_cycle')throw new Error('تغيير الدورة يتم من إدارة الدورات فقط.');await db.from('system_settings').upsert({key,value,updated_by:profile.id,updated_at:new Date().toISOString()})}await audit(db,profile,'ADMIN_SETTINGS_UPDATE','SYSTEM',null,null,payload.settings);return json({ok:true});}
  if(actionName==='ADMIN_USER_ASSIGNMENT'||actionName==='ADMIN_USER_ROLE')throw new Error('المناصب القيادية تُعيَّن داخل تهيئة الدورة فقط.');

  if(actionName==='FILE_DOWNLOAD'||actionName==='TEMPLATE_DOWNLOAD'){
   const bridge=Deno.env.get('DRIVE_BRIDGE_URL');const secret=Deno.env.get('DRIVE_BRIDGE_SECRET');if(!bridge||!secret)throw new Error('Drive bridge not configured');
   let reqBody:any;
   if(actionName==='TEMPLATE_DOWNLOAD'){reqBody={secret,action:'GET_TEMPLATE'};}
   else {
    const driveFileId=String(payload.driveFileId||'');if(!driveFileId)throw new Error('File ID required');
    const asset=(await db.from('file_assets').select('*').eq('drive_file_id',driveFileId).maybeSingle()).data;if(!asset)throw new Error('الملف غير مسجل في النظام.');
    let allowed=false;
    if(asset.entity_type==='PROPOSAL'){const fp=await getProposal(db,asset.entity_id);allowed=fp.applicant_id===profile.id||hasOversight(profile)||(profile.role==='SECRETARY'&&profile.secretariat_id===fp.secretariat_id);}
    if(asset.entity_type==='MILESTONE'){const fm=await getMilestone(db,asset.entity_id);allowed=fm.owner_id===profile.id||hasOversight(profile)||(profile.role==='SECRETARY'&&profile.secretariat_id===fm.secretariat_id);}
    if(!allowed)throw new Error('غير مسموح بتنزيل هذا الملف.');reqBody={secret,action:'GET_FILE',driveFileId};
   }
   const r=await fetch(bridge,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reqBody)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'تعذر تنزيل الملف');return json(d);
  }

  if(actionName==='TELEGRAM_LINK_CREATE'){
   const token=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''); const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));const tokenHash=Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('');
   await db.from('telegram_link_tokens').insert({profile_id:profile.id,token_hash:tokenHash,expires_at:new Date(Date.now()+15*60000).toISOString()}); const bot=Deno.env.get('TELEGRAM_BOT_USERNAME')||''; return json({ok:true,url:`https://t.me/${bot}?start=link_${token}`,expiresMinutes:15});
  }

  return json({error:`Unknown action ${actionName}`},400);
 }catch(e:any){console.error(e);const msg=e?.message==='UNAUTHORIZED'?'UNAUTHORIZED':(e?.message||'حدث خطأ غير متوقع.');return json({error:msg},msg==='UNAUTHORIZED'?401:400)}
});
