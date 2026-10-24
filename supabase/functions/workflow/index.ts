import { anonClient, audit, canManageSecretariat, corsHeaders, hasOversight, hoursFromNow, isGs, json, queueJob, requestUser, setting } from '../_shared/common.ts';

const editableProposalStatuses=['DRAFT','WITH_SECRETARY','REVISION_REQUESTED','REVISED','DEFERRED'];
const terminalProposalStatuses=['NOT_APPROVED','WITHDRAWN'];

function proposalSnapshot(p:any){
 const keys=['title','applicant_name','applicant_email','secretariat_id','proposed_period','needed_by','urgency','urgency_reason','primary_beneficiaries','trigger_reality','primary_benefit','secondary_benefits','intervention','success_criterion','context_factors','funding_needed','funding_dependence','estimated_cost','funding_source'];
 return Object.fromEntries(keys.map(k=>[k,p[k]??null]));
}
function formToProposal(form:any){return {
 title:String(form.title||'').trim(), applicant_name:String(form.applicantName||'').trim(), applicant_email:String(form.applicantEmail||'').trim().toLowerCase(),
 secretariat_id:form.secretariatId, proposed_period:form.proposedPeriod||null, needed_by:form.neededBy?new Date(form.neededBy).toISOString():null,
 urgency_reason:form.urgencyReason||null, primary_beneficiaries:form.primaryBeneficiaries||null, trigger_reality:form.triggerReality||null,
 primary_benefit:form.primaryBenefit||null, secondary_benefits:form.secondaryBenefits||null, intervention:form.intervention||null,
 success_criterion:form.successCriterion||null, context_factors:form.contextFactors||null, funding_needed:form.fundingNeeded||'UNKNOWN',
 funding_dependence:form.fundingDependence||'UNKNOWN', estimated_cost:form.estimatedCost||null, funding_source:form.fundingSource||null
}}
async function getProposal(db:any,id:string){const {data,error}=await db.from('proposals').select('*').eq('id',id).single();if(error)throw error;return data}
async function getMilestone(db:any,id:string){const {data,error}=await db.from('milestones').select('*').eq('id',id).single();if(error)throw error;return data}
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
async function queueProposalArtifacts(db:any,p:any,versionNo:number){await queueJob(db,'DOCUMENT_PROPOSAL','PROPOSAL',p.id,{proposal_id:p.id,version_no:versionNo});kickBackgroundWorker();}
async function queueNotice(db:any,event:string,entityType:string,entityId:string,payload:any={}){await queueJob(db,'TELEGRAM_NOTIFY',entityType,entityId,{event,...payload});}
async function getInitiative(db:any,id:string){const {data,error}=await db.from('initiatives').select('*').eq('id',id).single();if(error)throw error;return data}
async function getResult(db:any,id:string){const {data,error}=await db.from('results').select('*,initiative:initiatives(*)').eq('id',id).single();if(error)throw error;return data}
function canSuperviseProject(profile:any,initiative:any){return profile.role==='ADMIN'||initiative.secretary_id===profile.id||(profile.role==='SECRETARY'&&profile.secretariat_id===initiative.secretariat_id)}
function isProjectLead(profile:any,initiative:any,result?:any){return initiative.owner_id===profile.id||result?.owner_id===profile.id}
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
 const {data:result}=await db.from('results').select('*,initiative:initiatives(*)').eq('id',resultId).single();if(!result)return;
 const {data:milestones}=await db.from('milestones').select('status,design_status').eq('result_id',resultId).neq('design_status','REJECTED');
 const active=(milestones||[]).filter((m:any)=>m.design_status==='APPROVED');
 if(active.length&&active.every((m:any)=>['VERIFIED','CANCELLED'].includes(m.status))){
  await db.from('results').update({assignment_status:'COMPLETED',completed_at:new Date().toISOString()}).eq('id',resultId);
  const {data:results}=await db.from('results').select('assignment_status').eq('initiative_id',result.initiative_id);
  if((results||[]).length&&(results||[]).every((r:any)=>r.assignment_status==='COMPLETED')){
   await db.from('initiatives').update({status:'COMPLETED',health:'ON_TRACK',completed_at:new Date().toISOString()}).eq('id',result.initiative_id);
   if(result.initiative?.proposal_id)await db.from('proposals').update({execution_status:'COMPLETED'}).eq('id',result.initiative.proposal_id);
  }
 }
}


function isoDate(v:any){if(!v)return null;const d=new Date(v);if(Number.isNaN(d.getTime()))return null;return d.toISOString()}
function addDaysIso(base:string,days:number){const d=new Date(base);d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString()}
async function recalcDependentMilestones(db:any,milestoneId:string){
 const base=await getMilestone(db,milestoneId);const {data:list,error}=await db.from('milestones').select('*').eq('relative_to_milestone_id',milestoneId).eq('deadline_mode','RELATIVE');if(error)throw error;
 for(const m of list||[]){const due=addDaysIso(base.due_at,Number(m.relative_days||0));await db.from('milestones').update({due_at:due,status_updated_at:new Date().toISOString()}).eq('id',m.id);await recalcDependentMilestones(db,m.id)}
}
async function insertTemplateMilestones(db:any,profile:any,init:any,result:any,items:any[]){
 const created:any[]=[];
 for(let idx=0;idx<items.length;idx++){
  const item=items[idx]||{};const mode=item.deadlineMode==='RELATIVE'?'RELATIVE':'ABSOLUTE';let due:string|null=null;let relativeTo:string|null=null;let relativeDays:number|null=null;
  if(mode==='RELATIVE'){
   const refIndex=item.relativeToIndex===undefined?idx-1:Number(item.relativeToIndex);if(refIndex<0||!created[refIndex])throw new Error(`حدد المحطة السابقة للمحطة رقم ${idx+1}.`);
   relativeTo=created[refIndex].id;relativeDays=Math.max(0,Number(item.relativeDays||0));due=addDaysIso(created[refIndex].due_at,relativeDays);
  }else{due=isoDate(item.dueAt);if(!due)throw new Error(`حدد موعد المحطة رقم ${idx+1}.`)}
  const row={result_id:result.id,secretariat_id:init.secretariat_id,owner_id:init.owner_id,title:String(item.title||'').trim(),description:item.description||null,due_at:due,status:'NOT_STARTED',verification_criteria:String(item.verificationCriteria||item.outcomeDefinition||'').trim()||'تحقق النتيجة المحددة للمحطة',priority:item.priority||'NORMAL',created_by:profile.id,design_status:'APPROVED',sequence_no:idx+1,deadline_mode:mode,relative_days:relativeDays,relative_to_milestone_id:relativeTo,status_updated_at:new Date().toISOString()};
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

  if(actionName==='PROPOSAL_CREATE'){
   const values=formToProposal(payload.form||{}); if(!values.title||!values.secretariat_id)throw new Error('بيانات المقترح الأساسية ناقصة.');
   const cycle=(await db.from('cycles').select('*').eq('is_current',true).single()).data; if(!cycle)throw new Error('لا توجد دورة حالية.');
   const {data:internalId,error:ierr}=await db.rpc('next_proposal_internal_id',{p_secretariat:values.secretariat_id}); if(ierr)throw ierr;
   const submit=payload.submit!==false; const proposalRow:any={...values,internal_id:internalId,cycle_id:cycle.id,applicant_id:profile.id,status:submit?'WITH_SECRETARY':'DRAFT',submitted_at:submit?new Date().toISOString():null,current_version:1};
   if(submit)proposalRow.secretary_due_at=hoursFromNow(Number(await setting(db,'secretary_sla_hours',48)));
   const ins=await db.from('proposals').insert(proposalRow).select().single(); if(ins.error)throw ins.error; const p=ins.data;
   await db.from('proposal_versions').insert({proposal_id:p.id,version_no:1,source:'STRUCTURED',created_by:profile.id,snapshot:proposalSnapshot(p),change_summary:'النسخة الأولى',is_current:true});
   await db.from('proposal_actions').insert({proposal_id:p.id,actor_id:profile.id,actor_role:profile.role,action_type:'CREATED',from_status:null,to_status:p.status,note_text:submit?'تم تقديم المقترح':'تم حفظ المسودة'});
   await audit(db,profile,'PROPOSAL_CREATE','PROPOSAL',p.id,null,p,{submit}); await queueProposalArtifacts(db,p,1); if(submit)await queueNotice(db,'NEW_PROPOSAL','PROPOSAL',p.id);
   return json({ok:true,proposal:p});
  }


  if(actionName==='PROPOSAL_UPLOAD_CREATE'){
   const form=payload.form||{}; const values=formToProposal(form); if(!values.title||!values.secretariat_id||!payload.stagingPath)throw new Error('بيانات الرفع ناقصة.');
   const cycle=(await db.from('cycles').select('*').eq('is_current',true).single()).data; const {data:internalId,error:ierr}=await db.rpc('next_proposal_internal_id',{p_secretariat:values.secretariat_id}); if(ierr)throw ierr;
   const row:any={...values,internal_id:internalId,cycle_id:cycle.id,applicant_id:profile.id,status:'WITH_SECRETARY',submitted_at:new Date().toISOString(),current_version:1,secretary_due_at:hoursFromNow(Number(await setting(db,'secretary_sla_hours',48)))};
   const ins=await db.from('proposals').insert(row).select().single(); if(ins.error)throw ins.error; const p=ins.data;
   await db.from('proposal_versions').insert({proposal_id:p.id,version_no:1,source:'FILE_UPLOAD',created_by:profile.id,snapshot:proposalSnapshot(p),change_summary:'النسخة المرفوعة الأولى',is_current:true});
   await db.from('proposal_actions').insert({proposal_id:p.id,actor_id:profile.id,actor_role:profile.role,action_type:'CREATED',to_status:'WITH_SECRETARY',note_text:'تم تقديم مقترح مرفوع كملف'});
   await audit(db,profile,'PROPOSAL_UPLOAD_CREATE','PROPOSAL',p.id,null,p); await queueJob(db,'ARCHIVE_STAGING_PROPOSAL','PROPOSAL',p.id,{mode:'ARCHIVE_STAGING_PROPOSAL',proposal_id:p.id,version_no:1,storage_path:payload.stagingPath,file_name:payload.fileName,mime_type:payload.mimeType}); kickBackgroundWorker(); await queueNotice(db,'NEW_PROPOSAL','PROPOSAL',p.id); return json({ok:true,proposal:p});
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
   const title=String(payload.title||'').trim(),statement=String(payload.resultStatement||'').trim(),success=String(payload.successMeasure||'').trim();const startAt=isoDate(payload.startAt||new Date().toISOString()),dueAt=isoDate(payload.dueAt);
   if(!title||!statement||!dueAt)throw new Error('أكمل اسم المشروع والنتيجة المطلوبة وفترة التكليف.');if(!(payload.milestones||[]).length)throw new Error('أضف محطة إنجاز واحدة على الأقل.');
   const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;if(!cycle)throw new Error('لا توجد دورة حالية.');
   const secretaryId=profile.role==='SECRETARY'?profile.id:(payload.secretaryId||(await db.from('profiles').select('id').eq('secretariat_id',sid).eq('role','SECRETARY').eq('active',true).limit(1).maybeSingle()).data?.id);if(!secretaryId)throw new Error('لا يوجد سكرتير فعّال للسكرتارية.');
   let init:any=null;let result:any=null;
   if(payload.proposalId){init=(await db.from('initiatives').select('*').eq('proposal_id',payload.proposalId).maybeSingle()).data}
   if(init){const before={...init};const u=await db.from('initiatives').update({secretariat_id:sid,secretary_id:secretaryId,owner_id:lead.id,title,objective:statement,status:'SETUP',setup_status:'AWAITING_GS_APPROVAL',approval_status:'PENDING_GS',health:'ON_TRACK',assignment_start_at:startAt,target_due_at:dueAt,gs_review_note:null}).eq('id',init.id).select().single();if(u.error)throw u.error;init=u.data;const previousResults=(await db.from('results').select('id').eq('initiative_id',init.id)).data||[];const previousResultIds=previousResults.map((x:any)=>x.id);if(previousResultIds.length){const md=await db.from('milestones').delete().in('result_id',previousResultIds);if(md.error)throw md.error}result=(await db.from('results').select('*').eq('initiative_id',init.id).limit(1).maybeSingle()).data;if(result){const ru=await db.from('results').update({statement,success_measure:success||null,owner_id:lead.id,due_at:dueAt,assignment_status:'ACTIVE',assignment_feedback:null,accepted_at:null}).eq('id',result.id).select().single();if(ru.error)throw ru.error;result=ru.data}else{const rr=await db.from('results').insert({initiative_id:init.id,statement,success_measure:success||null,owner_id:lead.id,due_at:dueAt,assignment_status:'ACTIVE'}).select().single();if(rr.error)throw rr.error;result=rr.data}await audit(db,profile,'PROJECT_TEMPLATE_UPDATE','INITIATIVE',init.id,before,init)}
   else{const x=await db.from('initiatives').insert({cycle_id:cycle.id,plan_id:payload.planId||null,proposal_id:payload.proposalId||null,secretariat_id:sid,secretary_id:secretaryId,owner_id:lead.id,title,objective:statement,source_type:payload.proposalId?'APPROVED_PROPOSAL':(payload.sourceType||'DIRECT'),status:'SETUP',setup_status:'AWAITING_GS_APPROVAL',approval_status:'PENDING_GS',health:'ON_TRACK',assignment_start_at:startAt,target_due_at:dueAt}).select().single();if(x.error)throw x.error;init=x.data;const rr=await db.from('results').insert({initiative_id:init.id,statement,success_measure:success||null,owner_id:lead.id,due_at:dueAt,assignment_status:'ACTIVE'}).select().single();if(rr.error)throw rr.error;result=rr.data}
   const milestones=await insertTemplateMilestones(db,profile,init,result,payload.milestones||[]);await createTemplateSpecialPermissions(db,profile,init,payload.specialPermissions||[]);await audit(db,profile,'PROJECT_SUBMITTED_FOR_GS','INITIATIVE',init.id,null,init,{result_id:result.id,milestone_count:milestones.length});await queueNotice(db,'PROJECT_PENDING_GS','INITIATIVE',init.id,{gs_review:true});return json({ok:true,initiative:init,result,milestones});
  }

  if(actionName==='PROJECT_TEMPLATE_UPDATE'){
   const init=await getInitiative(db,payload.initiativeId);if(!canSuperviseProject(profile,init))throw new Error('السكرتير المختص فقط يعدل قرار التكليف.');const result=(await db.from('results').select('*').eq('initiative_id',init.id).limit(1).single()).data;const patch:any={};if(payload.title!==undefined)patch.title=String(payload.title||'').trim();if(payload.resultStatement!==undefined)patch.objective=String(payload.resultStatement||'').trim();if(payload.startAt!==undefined)patch.assignment_start_at=isoDate(payload.startAt);if(payload.dueAt!==undefined)patch.target_due_at=isoDate(payload.dueAt);if(payload.leadId!==undefined){const lead=(await db.from('profiles').select('*').eq('id',payload.leadId).eq('active',true).single()).data;if(!lead)throw new Error('العضو المحدد غير فعّال.');patch.owner_id=lead.id;await db.from('milestones').update({owner_id:lead.id}).eq('result_id',result.id);await db.from('project_permissions').update({requested_for:lead.id}).eq('initiative_id',init.id);await db.from('results').update({owner_id:lead.id}).eq('id',result.id)}
   const u=await db.from('initiatives').update(patch).eq('id',init.id).select().single();if(u.error)throw u.error;const rp:any={};if(payload.resultStatement!==undefined)rp.statement=String(payload.resultStatement||'').trim();if(payload.successMeasure!==undefined)rp.success_measure=payload.successMeasure||null;if(payload.dueAt!==undefined)rp.due_at=isoDate(payload.dueAt);if(Object.keys(rp).length){const ru=await db.from('results').update(rp).eq('id',result.id);if(ru.error)throw ru.error}await audit(db,profile,'PROJECT_TEMPLATE_UPDATE','INITIATIVE',init.id,init,u.data);return json({ok:true,initiative:u.data});
  }

  if(actionName==='PROJECT_RESUBMIT_GS'){
   const init=await getInitiative(db,payload.initiativeId);if(!canSuperviseProject(profile,init))throw new Error('السكرتير المختص فقط يعيد المشروع للاعتماد.');const u=await db.from('initiatives').update({approval_status:'PENDING_GS',setup_status:'AWAITING_GS_APPROVAL',gs_review_note:null}).eq('id',init.id).select().single();if(u.error)throw u.error;await audit(db,profile,'PROJECT_RESUBMIT_GS','INITIATIVE',init.id,init,u.data);await queueNotice(db,'PROJECT_PENDING_GS','INITIATIVE',init.id);return json({ok:true,initiative:u.data});
  }

  if(actionName==='PROJECT_GS_DECIDE'){
   if(!['GS','ADMIN'].includes(profile.role))throw new Error('اعتماد قرار التكليف من اختصاص السكرتير العام.');const init=await getInitiative(db,payload.initiativeId);if(init.approval_status!=='PENDING_GS')throw new Error('المشروع ليس بانتظار اعتماد السكرتير العام.');const result=(await db.from('results').select('*').eq('initiative_id',init.id).limit(1).single()).data;const milestones=(await db.from('milestones').select('*').eq('result_id',result.id).neq('design_status','REJECTED')).data||[];if(!result?.statement||!init.target_due_at||!init.owner_id||!milestones.length)throw new Error('قرار التكليف غير مكتمل: النتيجة والمسؤول والفترة ومحطات الإنجاز مطلوبة.');const approve=payload.decision==='APPROVE';const patch:any=approve?{approval_status:'APPROVED',setup_status:'ACTIVE',status:'ACTIVE',gs_review_note:payload.note||null,gs_approved_by:profile.id,gs_approved_at:new Date().toISOString(),activated_at:new Date().toISOString(),health:'ON_TRACK'}:{approval_status:'RETURNED',setup_status:'AWAITING_GS_APPROVAL',gs_review_note:payload.note||'أعيد للسكرتير لاستكمال قرار التكليف.'};const u=await db.from('initiatives').update(patch).eq('id',init.id).select().single();if(u.error)throw u.error;if(approve&&init.proposal_id)await db.from('proposals').update({execution_status:'IN_PROGRESS'}).eq('id',init.proposal_id);await audit(db,profile,approve?'PROJECT_GS_APPROVE':'PROJECT_GS_RETURN','INITIATIVE',init.id,init,u.data,{note:payload.note||null});await queueNotice(db,approve?'PROJECT_ASSIGNED':'PROJECT_RETURNED_TO_SECRETARY','INITIATIVE',init.id,{lead_id:init.owner_id});return json({ok:true,initiative:u.data});
  }

  if(actionName==='PROJECT_SETUP_CREATE'){
   if(!['SECRETARY','ADMIN'].includes(profile.role))throw new Error('السكرتير المختص فقط يبدأ مشروعًا جديدًا.');
   const sid=profile.role==='ADMIN'?payload.secretariatId:profile.secretariat_id;if(!sid)throw new Error('حدد السكرتارية.');
   const lead=(await db.from('profiles').select('*').eq('id',payload.leadId).eq('active',true).single()).data;if(!lead||!['MEMBER','SECRETARY'].includes(lead.role))throw new Error('اختر رئيس مكتب/لجنة أو مسؤول نتيجة فعّال.');
   const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;if(!cycle)throw new Error('لا توجد دورة حالية.');
   const secretaryId=profile.role==='SECRETARY'?profile.id:(payload.secretaryId||(await db.from('profiles').select('id').eq('secretariat_id',sid).eq('role','SECRETARY').eq('active',true).limit(1).maybeSingle()).data?.id||profile.id);
   const ins=await db.from('initiatives').insert({cycle_id:cycle.id,plan_id:payload.planId||null,secretariat_id:sid,secretary_id:secretaryId,owner_id:lead.id,title:String(payload.title||'').trim(),objective:payload.objective||payload.resultStatement||null,source_type:payload.sourceType||'DIRECT',status:'SETUP',setup_status:'AWAITING_LEAD',health:'ON_TRACK',target_due_at:payload.dueAt||null}).select().single();if(ins.error)throw ins.error;
   const rr=await db.from('results').insert({initiative_id:ins.data.id,statement:payload.resultStatement,success_measure:payload.successMeasure||null,owner_id:lead.id,due_at:payload.dueAt||null,assignment_status:'PENDING_ACCEPTANCE'}).select().single();if(rr.error)throw rr.error;
   await ensureStandardPermissions(db,ins.data,lead.id,secretaryId);await audit(db,profile,'PROJECT_SETUP_CREATE','INITIATIVE',ins.data.id,null,ins.data,{result_id:rr.data.id});await queueNotice(db,'RESULT_ASSIGNMENT','INITIATIVE',ins.data.id,{lead_id:lead.id});return json({ok:true,initiative:ins.data,result:rr.data});
  }

  if(actionName==='PROJECT_SETUP_FROM_PROPOSAL'){
   const p=await getProposal(db,payload.proposalId);if(p.status!=='APPROVED')throw new Error('المقترح غير مجاز.');if(!canManageSecretariat(profile,p.secretariat_id))throw new Error('السكرتير المختص فقط يهيئ تنفيذ المقترح.');
   const lead=(await db.from('profiles').select('*').eq('id',payload.leadId).eq('active',true).single()).data;if(!lead||!['MEMBER','SECRETARY'].includes(lead.role))throw new Error('اختر مسؤول نتيجة فعّال.');
   let init=(await db.from('initiatives').select('*').eq('proposal_id',p.id).maybeSingle()).data; if(!init)throw new Error('لم يتم إنشاء مسار التنفيذ للمقترح.');
   const before={...init};const upd=await db.from('initiatives').update({secretary_id:profile.id,owner_id:lead.id,objective:payload.resultStatement||p.primary_benefit||p.title,target_due_at:payload.dueAt||p.needed_by||null,status:'SETUP',setup_status:'AWAITING_LEAD',health:'ON_TRACK'}).eq('id',init.id).select().single();if(upd.error)throw upd.error;init=upd.data;
   let rr=(await db.from('results').select('*').eq('initiative_id',init.id).limit(1).maybeSingle()).data;if(rr){const x=await db.from('results').update({statement:payload.resultStatement,success_measure:payload.successMeasure||null,owner_id:lead.id,due_at:payload.dueAt||p.needed_by||null,assignment_status:'PENDING_ACCEPTANCE',assignment_feedback:null,accepted_at:null}).eq('id',rr.id).select().single();if(x.error)throw x.error;rr=x.data}else{const x=await db.from('results').insert({initiative_id:init.id,statement:payload.resultStatement,success_measure:payload.successMeasure||null,owner_id:lead.id,due_at:payload.dueAt||p.needed_by||null,assignment_status:'PENDING_ACCEPTANCE'}).select().single();if(x.error)throw x.error;rr=x.data}
   await ensureStandardPermissions(db,init,lead.id,profile.id);await audit(db,profile,'PROJECT_SETUP_FROM_PROPOSAL','INITIATIVE',init.id,before,init,{proposal_id:p.id,result_id:rr.id});await queueNotice(db,'RESULT_ASSIGNMENT','INITIATIVE',init.id,{lead_id:lead.id});return json({ok:true,initiative:init,result:rr});
  }

  if(actionName==='RESULT_ASSIGNMENT_ACCEPT'){
   const result=await getResult(db,payload.resultId);if(result.owner_id!==profile.id)throw new Error('هذا التكليف ليس موجهًا إليك.');if(!['PENDING_ACCEPTANCE','DRAFT'].includes(result.assignment_status))throw new Error('تم التعامل مع التكليف مسبقًا.');
   const r=await db.from('results').update({assignment_status:'ACCEPTED',accepted_at:new Date().toISOString()}).eq('id',result.id).select().single();if(r.error)throw r.error;await db.from('initiatives').update({setup_status:'CO_DESIGN'}).eq('id',result.initiative_id);await audit(db,profile,'RESULT_ASSIGNMENT_ACCEPT','RESULT',result.id,result,r.data);await queueNotice(db,'RESULT_ACCEPTED','INITIATIVE',result.initiative_id);return json({ok:true,result:r.data});
  }

  if(actionName==='RESULT_ASSIGNMENT_RETURN'){
   const result=await getResult(db,payload.resultId);if(result.owner_id!==profile.id)throw new Error('هذا التكليف ليس موجهًا إليك.');if(result.assignment_status!=='PENDING_ACCEPTANCE')throw new Error('لا يمكن إعادة التكليف في حالته الحالية.');const feedback=String(payload.feedback||'').trim();if(!feedback)throw new Error('اكتب ما الذي يحتاج تعديلًا في النتيجة أو الموعد.');
   const r=await db.from('results').update({assignment_status:'CHANGES_REQUESTED',assignment_feedback:feedback,accepted_at:null}).eq('id',result.id).select().single();if(r.error)throw r.error;await audit(db,profile,'RESULT_ASSIGNMENT_RETURN','RESULT',result.id,result,r.data);await queueNotice(db,'RESULT_ASSIGNMENT_RETURNED','INITIATIVE',result.initiative_id,{feedback});return json({ok:true,result:r.data});
  }

  if(actionName==='RESULT_ASSIGNMENT_REVISE'){
   const result=await getResult(db,payload.resultId);const init=result.initiative;if(!canSuperviseProject(profile,init))throw new Error('السكرتير المشرف فقط يعدّل التكليف.');if(!['CHANGES_REQUESTED','PENDING_ACCEPTANCE'].includes(result.assignment_status))throw new Error('التكليف ليس في مرحلة التعديل.');const statement=String(payload.resultStatement||'').trim();const dueAt=payload.dueAt||null;if(!statement||!dueAt)throw new Error('حدد النتيجة المطلوبة والموعد النهائي.');
   const r=await db.from('results').update({statement,success_measure:payload.successMeasure||null,due_at:dueAt,assignment_status:'PENDING_ACCEPTANCE',assignment_feedback:null,accepted_at:null}).eq('id',result.id).select().single();if(r.error)throw r.error;await db.from('initiatives').update({objective:statement,target_due_at:dueAt,setup_status:'AWAITING_LEAD'}).eq('id',init.id);await audit(db,profile,'RESULT_ASSIGNMENT_REVISE','RESULT',result.id,result,r.data);await queueNotice(db,'RESULT_ASSIGNMENT','INITIATIVE',init.id,{lead_id:result.owner_id});return json({ok:true,result:r.data});
  }

  if(actionName==='MILESTONE_DESIGN_ADD'){
   const result=await getResult(db,payload.resultId);const init=result.initiative;if(!canSuperviseProject(profile,init))throw new Error('السكرتير المشرف فقط يضيف محطة إنجاز بعد إنشاء المشروع.');
   const title=String(payload.title||'').trim();if(!title)throw new Error('اكتب اسم محطة الإنجاز.');const mode=payload.deadlineMode==='RELATIVE'?'RELATIVE':'ABSOLUTE';let due:string|null=null,relativeTo:string|null=null,relativeDays:number|null=null;
   if(mode==='RELATIVE'){relativeTo=payload.relativeToMilestoneId||null;if(!relativeTo)throw new Error('حدد المحطة المرجعية.');const ref=await getMilestone(db,relativeTo);if(ref.result_id!==result.id)throw new Error('المحطة المرجعية يجب أن تكون في نفس المشروع.');relativeDays=Math.max(0,Number(payload.relativeDays||0));due=addDaysIso(ref.due_at,relativeDays)}else{due=isoDate(payload.dueAt);if(!due)throw new Error('حدد موعد محطة الإنجاز.');}
   if(result.due_at&&new Date(due!)>new Date(result.due_at))throw new Error('موعد محطة الإنجاز لا يمكن أن يتجاوز الموعد النهائي للنتيجة.');
   const existing=(await db.from('milestones').select('sequence_no').eq('result_id',result.id).neq('design_status','REJECTED').order('sequence_no',{ascending:false}).limit(1).maybeSingle()).data;const sequenceNo=Number(existing?.sequence_no||0)+1;const ownerId=result.owner_id||init.owner_id;
   const row={result_id:result.id,secretariat_id:init.secretariat_id,owner_id:ownerId,title,description:payload.description||null,due_at:due,verification_criteria:String(payload.verificationCriteria||'').trim()||'تحقق المخرج المحدد للمحطة',priority:payload.priority||'NORMAL',created_by:profile.id,design_status:'APPROVED',sequence_no:sequenceNo,deadline_mode:mode,relative_days:relativeDays,relative_to_milestone_id:relativeTo,status:'NOT_STARTED',status_updated_at:new Date().toISOString()};
   const mm=await db.from('milestones').insert(row).select().single();if(mm.error)throw mm.error;await audit(db,profile,'MILESTONE_DESIGN_ADD','MILESTONE',mm.data.id,null,mm.data,{initiative_id:init.id});return json({ok:true,milestone:mm.data});
  }

  if(actionName==='MILESTONE_DESIGN_UPDATE'){
   const m=await getMilestone(db,payload.milestoneId);const result=await getResult(db,m.result_id);const init=result.initiative;if(!isProjectLead(profile,init,result)&&!canSuperviseProject(profile,init))throw new Error('غير مسموح.');if(init.setup_status==='ACTIVE'&&m.design_status==='APPROVED'&&!canSuperviseProject(profile,init))throw new Error('بعد التفعيل، تعديل محطة معتمدة يحتاج السكرتير.');
   const patch:any={};if(payload.title!==undefined)patch.title=String(payload.title||'').trim();if(payload.description!==undefined)patch.description=payload.description||null;if(payload.verificationCriteria!==undefined)patch.verification_criteria=payload.verificationCriteria||null;if(payload.priority!==undefined)patch.priority=payload.priority||'NORMAL';
   if(payload.deadlineMode!==undefined||payload.dueAt!==undefined||payload.relativeDays!==undefined||payload.relativeToMilestoneId!==undefined){const mode=payload.deadlineMode==='RELATIVE'?'RELATIVE':'ABSOLUTE';patch.deadline_mode=mode;if(mode==='RELATIVE'){const refId=payload.relativeToMilestoneId||m.relative_to_milestone_id;if(!refId||refId===m.id)throw new Error('حدد محطة سابقة صالحة.');const ref=await getMilestone(db,refId);if(ref.result_id!==m.result_id)throw new Error('المحطة المرجعية يجب أن تكون في نفس المشروع.');const days=Math.max(0,Number(payload.relativeDays??m.relative_days??0));patch.relative_to_milestone_id=ref.id;patch.relative_days=days;patch.due_at=addDaysIso(ref.due_at,days)}else{const due=isoDate(payload.dueAt||m.due_at);if(!due)throw new Error('حدد موعد المحطة.');patch.due_at=due;patch.relative_to_milestone_id=null;patch.relative_days=null}}
   patch.status_updated_at=new Date().toISOString();const u=await db.from('milestones').update(patch).eq('id',m.id).select().single();if(u.error)throw u.error;await recalcDependentMilestones(db,m.id);await audit(db,profile,'MILESTONE_DESIGN_UPDATE','MILESTONE',m.id,m,u.data);return json({ok:true,milestone:u.data});
  }

  if(actionName==='MILESTONE_DESIGN_REMOVE'){
   const m=await getMilestone(db,payload.milestoneId);const result=await getResult(db,m.result_id);const init=result.initiative;if(!isProjectLead(profile,init,result)&&!canSuperviseProject(profile,init))throw new Error('غير مسموح.');if(init.setup_status==='ACTIVE'&&m.design_status==='APPROVED')throw new Error('بعد بدء التنفيذ لا يمكن استبعاد محطة معتمدة من التصميم بهذه الطريقة.');const u=await db.from('milestones').update({design_status:'REJECTED'}).eq('id',m.id).select().single();if(u.error)throw u.error;await audit(db,profile,'MILESTONE_DESIGN_REMOVE','MILESTONE',m.id,m,u.data);return json({ok:true,milestone:u.data});
  }

  if(actionName==='PROJECT_ACTIVATE'){
   const init=await getInitiative(db,payload.initiativeId);if(!canSuperviseProject(profile,init))throw new Error('السكرتير المشرف فقط يفعّل المشروع.');const {data:results}=await db.from('results').select('*').eq('initiative_id',init.id);if(!(results||[]).length)throw new Error('حدد النتيجة أولًا.');if((results||[]).some((r:any)=>!['ACTIVE','ACCEPTED'].includes(r.assignment_status)))await db.from('results').update({assignment_status:'ACTIVE'}).in('id',(results||[]).map((r:any)=>r.id));
   const ids=(results||[]).map((r:any)=>r.id);const {data:ms}=await db.from('milestones').select('*').in('result_id',ids).neq('design_status','REJECTED');if(!(ms||[]).length)throw new Error('اتفقا على محطة إنجاز واحدة على الأقل قبل التفعيل.');for(const m of ms||[]){const r=(results||[]).find((x:any)=>x.id===m.result_id);if(r?.due_at&&new Date(m.due_at)>new Date(r.due_at))throw new Error(`موعد المحطة «${m.title}» بعد موعد النتيجة النهائي.`)}const {count:pendingSpecial}=await db.from('project_permissions').select('*',{count:'exact',head:true}).eq('initiative_id',init.id).eq('permission_type','SPECIAL').eq('status','PENDING');if((pendingSpecial||0)>0)throw new Error('هناك صلاحية خاصة لازمة ما زالت بانتظار الموافقة؛ أكمل مسار الصلاحيات قبل بدء التنفيذ.');
   await db.from('milestones').update({design_status:'APPROVED'}).in('result_id',ids).neq('design_status','REJECTED');await db.from('results').update({assignment_status:'ACTIVE'}).in('id',ids);const u=await db.from('initiatives').update({status:'ACTIVE',setup_status:'ACTIVE',activated_at:new Date().toISOString(),health:'ON_TRACK'}).eq('id',init.id).select().single();if(u.error)throw u.error;if(init.proposal_id)await db.from('proposals').update({execution_status:'IN_PROGRESS'}).eq('id',init.proposal_id);await audit(db,profile,'PROJECT_ACTIVATE','INITIATIVE',init.id,init,u.data);await queueNotice(db,'PROJECT_ACTIVATED','INITIATIVE',init.id);return json({ok:true,initiative:u.data});
  }

  if(actionName==='MILESTONE_PROGRESS_UPDATE'){
   const m=await getMilestone(db,payload.milestoneId);const result=await getResult(db,m.result_id);const init=result.initiative;if(!isProjectLead(profile,init,result)||m.owner_id!==profile.id)throw new Error('مسؤول المشروع فقط يحدث حالة محطة الإنجاز.');if(init.approval_status!=='APPROVED'||init.setup_status!=='ACTIVE')throw new Error('المشروع لم يعتمد بعد.');const allowed=['NOT_STARTED','IN_PROGRESS','AT_RISK','BLOCKED','READY_FOR_VERIFICATION'];const status=allowed.includes(payload.status)?payload.status:m.status;const nextLeadNote=payload.leadNote??m.lead_note;const nextOutcome=payload.outcomeText??m.outcome_text;const overdue=!!m.due_at&&new Date(m.due_at).getTime()<Date.now()&&!['VERIFIED','CANCELLED'].includes(status);if((overdue||['AT_RISK','BLOCKED'].includes(status))&&!String(nextLeadNote||'').trim())throw new Error('اكتب ملاحظة المسؤول لتوضيح سبب التعثر أو التأخير وما الذي سيحدث بعده.');if(status==='READY_FOR_VERIFICATION'&&!String(nextOutcome||'').trim())throw new Error('اكتب المخرج الفعلي الذي تحقق قبل إرساله للتحقق.');const patch:any={status,outcome_text:nextOutcome,lead_note:nextLeadNote,status_updated_at:new Date().toISOString()};const u=await db.from('milestones').update(patch).eq('id',m.id).select().single();if(u.error)throw u.error;await db.from('initiatives').update({last_update_at:new Date().toISOString(),health:status==='BLOCKED'?'BLOCKED':status==='AT_RISK'?'AT_RISK':init.health==='BLOCKED'||init.health==='AT_RISK'?'WATCH':init.health}).eq('id',init.id);await audit(db,profile,'MILESTONE_PROGRESS_UPDATE','MILESTONE',m.id,m,u.data);if(['AT_RISK','BLOCKED','READY_FOR_VERIFICATION'].includes(status))await queueNotice(db,status==='READY_FOR_VERIFICATION'?'MILESTONE_READY':'PROJECT_NEEDS_ATTENTION','MILESTONE',m.id,{status});return json({ok:true,milestone:u.data});
  }
  if(actionName==='MILESTONE_SECRETARY_NOTE'){
   const m=await getMilestone(db,payload.milestoneId);const result=await getResult(db,m.result_id);const init=result.initiative;if(!canSuperviseProject(profile,init))throw new Error('السكرتير المشرف فقط يضيف ملاحظته.');const u=await db.from('milestones').update({secretary_note:payload.note||null}).eq('id',m.id).select().single();if(u.error)throw u.error;await audit(db,profile,'MILESTONE_SECRETARY_NOTE','MILESTONE',m.id,m,u.data);return json({ok:true,milestone:u.data});
  }

  if(actionName==='PROJECT_UPDATE_ADD'){
   const init=await getInitiative(db,payload.initiativeId);const result=(await db.from('results').select('*').eq('initiative_id',init.id).eq('owner_id',profile.id).limit(1).maybeSingle()).data;if(!isProjectLead(profile,init,result))throw new Error('مسؤول النتيجة فقط يحدّث واقع التنفيذ.');if(init.setup_status!=='ACTIVE')throw new Error('المشروع لم يبدأ التنفيذ بعد.');
   const health=['ON_TRACK','WATCH','AT_RISK','BLOCKED'].includes(payload.health)?payload.health:'ON_TRACK';const r=await db.from('project_updates').insert({initiative_id:init.id,result_id:result?.id||null,author_id:profile.id,health,progress_note:payload.progressNote,next_step:payload.nextStep||null,next_check_at:payload.nextCheckAt||null,assistance_needed:payload.assistanceNeeded||null}).select().single();if(r.error)throw r.error;await db.from('initiatives').update({health,last_update_at:new Date().toISOString()}).eq('id',init.id);await audit(db,profile,'PROJECT_UPDATE_ADD','INITIATIVE',init.id,null,r.data);if(health!=='ON_TRACK'||payload.assistanceNeeded)await queueNotice(db,'PROJECT_NEEDS_ATTENTION','INITIATIVE',init.id,{health});return json({ok:true,update:r.data});
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
   const init=await getInitiative(db,payload.initiativeId);if(!canSuperviseProject(profile,init))throw new Error('السكرتير المشرف فقط يسجل التدخل.');const r=await db.from('project_interventions').insert({initiative_id:init.id,result_id:payload.resultId||null,milestone_id:payload.milestoneId||null,secretary_id:profile.id,trigger_type:payload.triggerType||'EARLY_WARNING',reason:payload.reason||null,action_text:payload.actionText,due_at:payload.dueAt||null}).select().single();if(r.error)throw r.error;if(init.health==='ON_TRACK')await db.from('initiatives').update({health:'WATCH'}).eq('id',init.id);await audit(db,profile,'PROJECT_INTERVENTION_ADD','INITIATIVE',init.id,null,r.data);await queueNotice(db,'SECRETARY_INTERVENTION','INITIATIVE',init.id);return json({ok:true,intervention:r.data});
  }

  if(actionName==='PROJECT_INTERVENTION_CLOSE'){
   const intervention=(await db.from('project_interventions').select('*,initiative:initiatives(*)').eq('id',payload.interventionId).single()).data;if(!intervention||!canSuperviseProject(profile,intervention.initiative))throw new Error('غير مسموح.');const u=await db.from('project_interventions').update({status:'CLOSED',closed_at:new Date().toISOString()}).eq('id',intervention.id).select().single();if(u.error)throw u.error;await audit(db,profile,'PROJECT_INTERVENTION_CLOSE','INITIATIVE',intervention.initiative_id,intervention,u.data);return json({ok:true});
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

  if(['COMMITMENT_UPSERT','EVIDENCE_ADD','BLOCKER_OPEN','INTERVENTION_ADD','MILESTONE_VERIFY','GS_OVERSIGHT_NOTE'].includes(actionName)){
   let m=await getMilestone(db,payload.milestoneId); const before={...m};
   if(actionName==='COMMITMENT_UPSERT'){if(m.owner_id!==profile.id)throw new Error('المالك فقط يحدث التزامه الأسبوعي.');const monday=new Date();monday.setUTCHours(0,0,0,0);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));const week=monday.toISOString().slice(0,10);const r=await db.from('weekly_commitments').upsert({milestone_id:m.id,owner_id:profile.id,week_start:week,commitment_text:payload.text,target_at:payload.targetAt||null,status:'OPEN'},{onConflict:'milestone_id,week_start'}).select().single();if(r.error)throw r.error;if(m.status==='NOT_STARTED')await db.from('milestones').update({status:'IN_PROGRESS'}).eq('id',m.id);await audit(db,profile,'COMMITMENT_UPSERT','MILESTONE',m.id,before,r.data);return json({ok:true});}
   if(actionName==='EVIDENCE_ADD'){if(m.owner_id!==profile.id)throw new Error('المالك فقط يرفع الدليل.');const r=await db.from('milestone_evidence').insert({milestone_id:m.id,submitted_by:profile.id,evidence_type:payload.evidenceType||'NOTE',note:payload.note||null,url:payload.url||null,drive_file_id:payload.driveFileId||null}).select().single();if(r.error)throw r.error;await db.from('milestones').update({status:'READY_FOR_VERIFICATION'}).eq('id',m.id);await audit(db,profile,'EVIDENCE_ADD','MILESTONE',m.id,before,r.data);await queueNotice(db,'MILESTONE_READY','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='EVIDENCE_FILE_ADD'){if(m.owner_id!==profile.id)throw new Error('المالك فقط يرفع الدليل.');if(!payload.stagingPath)throw new Error('الملف غير موجود.');await queueJob(db,'ARCHIVE_STAGING_EVIDENCE','MILESTONE',m.id,{mode:'ARCHIVE_STAGING_EVIDENCE',milestone_id:m.id,storage_path:payload.stagingPath,file_name:payload.fileName,mime_type:payload.mimeType,note:payload.note||null,submitted_by:profile.id});kickBackgroundWorker();await db.from('milestones').update({status:'READY_FOR_VERIFICATION'}).eq('id',m.id);await audit(db,profile,'EVIDENCE_FILE_QUEUED','MILESTONE',m.id,before,null);await queueNotice(db,'MILESTONE_READY','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='BLOCKER_OPEN'){if(m.owner_id!==profile.id)throw new Error('المالك فقط يسجل العائق.');const r=await db.from('blockers').insert({milestone_id:m.id,opened_by:profile.id,description:payload.description,severity:payload.severity||'MEDIUM'}).select().single();if(r.error)throw r.error;await db.from('milestones').update({status:'BLOCKED'}).eq('id',m.id);await audit(db,profile,'BLOCKER_OPEN','MILESTONE',m.id,before,r.data);await queueNotice(db,'MILESTONE_BLOCKED','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='INTERVENTION_ADD'){if(!canManageSecretariat(profile,m.secretariat_id))throw new Error('السكرتير المختص فقط يضيف تدخلًا.');const r=await db.from('interventions').insert({milestone_id:m.id,secretary_id:profile.id,action_text:payload.actionText,due_at:payload.dueAt||null}).select().single();if(r.error)throw r.error;await audit(db,profile,'INTERVENTION_ADD','MILESTONE',m.id,before,r.data);await queueNotice(db,'SECRETARY_INTERVENTION','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='MILESTONE_VERIFY'){if(!canManageSecretariat(profile,m.secretariat_id))throw new Error('السكرتير المختص فقط يتحقق من الإنجاز.');if(m.status!=='READY_FOR_VERIFICATION')throw new Error('المحطة ليست جاهزة للتحقق.');const decision=payload.decision==='VERIFIED'?'VERIFIED':'RETURNED';await db.from('verifications').insert({milestone_id:m.id,verifier_id:profile.id,decision,note:payload.note||null});const patch=decision==='VERIFIED'?{status:'VERIFIED',verified_at:new Date().toISOString()}:{status:'IN_PROGRESS',verified_at:null};const u=await db.from('milestones').update(patch).eq('id',m.id).select().single();if(u.error)throw u.error;if(decision==='VERIFIED'){await db.from('blockers').update({status:'RESOLVED',resolved_by:profile.id,resolved_at:new Date().toISOString(),resolution:'أُغلق تلقائيًا بعد تحقق المحطة'}).eq('milestone_id',m.id).eq('status','OPEN');await db.from('interventions').update({status:'CLOSED',closed_at:new Date().toISOString()}).eq('milestone_id',m.id).eq('status','OPEN')}await audit(db,profile,'MILESTONE_VERIFY','MILESTONE',m.id,before,u.data,{decision});if(decision==='VERIFIED')await syncProjectCompletion(db,m.result_id);await queueNotice(db,decision==='VERIFIED'?'MILESTONE_VERIFIED':'MILESTONE_RETURNED','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='GS_OVERSIGHT_NOTE'){if(!hasOversight(profile))throw new Error('غير مسموح.');const r=await db.from('oversight_notes').insert({secretariat_id:m.secretariat_id,milestone_id:m.id,created_by:profile.id,note:payload.note,severity:payload.severity||'INFO'}).select().single();if(r.error)throw r.error;await audit(db,profile,'GS_OVERSIGHT_NOTE','MILESTONE',m.id,null,r.data);await queueNotice(db,'GS_OVERSIGHT_NOTE','MILESTONE',m.id);return json({ok:true});}
  }


  if(actionName==='MEETING_CREATE'){
   if(!['SECRETARY','GS','PRESIDENT','ADMIN'].includes(profile.role))throw new Error('غير مسموح.');const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;const r=await db.from('meetings').insert({cycle_id:cycle.id,title:payload.title,held_at:payload.heldAt||new Date().toISOString(),chair_id:profile.id,status:'OPEN',created_by:profile.id}).select().single();if(r.error)throw r.error;await audit(db,profile,'MEETING_CREATE','MEETING',r.data.id,null,r.data);return json({ok:true,meeting:r.data});
  }
  if(actionName==='DECISION_CREATE'){
   if(!['SECRETARY','GS','PRESIDENT','ADMIN'].includes(profile.role))throw new Error('غير مسموح.');const sid=profile.role==='SECRETARY'?profile.secretariat_id:(payload.secretariatId||profile.secretariat_id||null);const r=await db.from('decisions').insert({meeting_id:payload.meetingId||null,secretariat_id:sid,title:payload.title,decision_text:payload.decisionText,owner_id:payload.ownerId||null,due_at:payload.dueAt||null,status:'OPEN',created_by:profile.id}).select().single();if(r.error)throw r.error;await audit(db,profile,'DECISION_CREATE','DECISION',r.data.id,null,r.data);return json({ok:true,decision:r.data});
  }
  if(actionName==='DECISION_TO_MILESTONE'){
   const d=(await db.from('decisions').select('*').eq('id',payload.decisionId).single()).data;if(!d)throw new Error('القرار غير موجود.');if(!(profile.role==='ADMIN'||profile.role==='GS'||profile.role==='PRESIDENT'||canManageSecretariat(profile,d.secretariat_id)))throw new Error('غير مسموح.');if(!d.secretariat_id)throw new Error('حدد السكرتارية المسؤولة عن تنفيذ القرار أولًا.');if(!d.owner_id||!d.due_at)throw new Error('يجب تحديد مسؤول نتيجة وموعد للقرار قبل تحويله للمتابعة.');const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;const secretary=(await db.from('profiles').select('id').eq('secretariat_id',d.secretariat_id).eq('role','SECRETARY').eq('active',true).limit(1).maybeSingle()).data;if(!secretary?.id)throw new Error('لا يوجد سكرتير فعّال مرتبط بالسكرتارية المسؤولة.');const lead=(await db.from('profiles').select('*').eq('id',d.owner_id).eq('active',true).single()).data;if(!lead||!['MEMBER','SECRETARY'].includes(lead.role))throw new Error('مسؤول القرار يجب أن يكون مسؤول نتيجة فعّالًا.');const x=await db.from('initiatives').insert({cycle_id:cycle.id,secretariat_id:d.secretariat_id,secretary_id:secretary.id,owner_id:d.owner_id,title:d.title,objective:d.decision_text,source_type:'DECISION',status:'SETUP',setup_status:'AWAITING_LEAD',health:'ON_TRACK',target_due_at:d.due_at}).select().single();if(x.error)throw x.error;const rr=await db.from('results').insert({initiative_id:x.data.id,statement:d.decision_text,success_measure:'تنفيذ القرار كما أُجيز مع دليل قابل للتحقق',owner_id:d.owner_id,due_at:d.due_at,assignment_status:'PENDING_ACCEPTANCE'}).select().single();if(rr.error)throw rr.error;await ensureStandardPermissions(db,x.data,d.owner_id,secretary.id);await db.from('decisions').update({status:'IN_TRACKING',related_entity_type:'INITIATIVE',related_entity_id:x.data.id}).eq('id',d.id);await audit(db,profile,'DECISION_TO_PROJECT','DECISION',d.id,d,{initiative_id:x.data.id,result_id:rr.data.id});await queueNotice(db,'RESULT_ASSIGNMENT','INITIATIVE',x.data.id,{lead_id:d.owner_id});return json({ok:true,initiative:x.data,result:rr.data});
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

  if(actionName==='PASSWORD_CHANGED'){await db.from('profiles').update({must_change_password:false}).eq('id',profile.id);await audit(db,profile,'PASSWORD_CHANGED','PROFILE',profile.id,null,{must_change_password:false});return json({ok:true});}

  if(actionName==='ADMIN_SETTINGS_UPDATE'){if(profile.role!=='ADMIN')throw new Error('غير مسموح.');for(const [key,value] of Object.entries(payload.settings||{})){await db.from('system_settings').upsert({key,value,updated_by:profile.id,updated_at:new Date().toISOString()})}await audit(db,profile,'ADMIN_SETTINGS_UPDATE','SYSTEM',null,null,payload.settings);return json({ok:true});}
  if(actionName==='ADMIN_USER_ASSIGNMENT'){
   if(profile.role!=='ADMIN')throw new Error('غير مسموح.');const role=String(payload.role||'APPLICANT');let secretariatId=payload.secretariatId||null;if(role==='SECRETARY'){if(!secretariatId)throw new Error('حدد السكرتارية لهذا السكرتير.');const other=(await db.from('profiles').select('id,full_name').eq('role','SECRETARY').eq('secretariat_id',secretariatId).eq('active',true).neq('id',payload.userId).limit(1).maybeSingle()).data;if(other)throw new Error(`يوجد سكرتير فعّال لهذه السكرتارية: ${other.full_name}`)}else secretariatId=null;const before=(await db.from('profiles').select('*').eq('id',payload.userId).single()).data;const r=await db.from('profiles').update({role,secretariat_id:secretariatId}).eq('id',payload.userId).select().single();if(r.error)throw r.error;await audit(db,profile,'ADMIN_USER_ASSIGNMENT','PROFILE',payload.userId,before,r.data);return json({ok:true,profile:r.data});
  }
  if(actionName==='ADMIN_USER_ROLE'){if(profile.role!=='ADMIN')throw new Error('غير مسموح.');const before=(await db.from('profiles').select('*').eq('id',payload.userId).single()).data;const r=await db.from('profiles').update({role:payload.role}).eq('id',payload.userId).select().single();if(r.error)throw r.error;await audit(db,profile,'ADMIN_USER_ROLE','PROFILE',payload.userId,before,r.data);return json({ok:true});}

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
