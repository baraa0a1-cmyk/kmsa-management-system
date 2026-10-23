import { audit, canManageSecretariat, corsHeaders, hoursFromNow, isGs, json, queueJob, requestUser, setting } from '../_shared/common.ts';

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
async function queueProposalArtifacts(db:any,p:any,versionNo:number){await queueJob(db,'DOCUMENT_PROPOSAL','PROPOSAL',p.id,{proposal_id:p.id,version_no:versionNo});}
async function queueNotice(db:any,event:string,entityType:string,entityId:string,payload:any={}){await queueJob(db,'TELEGRAM_NOTIFY',entityType,entityId,{event,...payload});}

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
   await audit(db,profile,'PROPOSAL_UPLOAD_CREATE','PROPOSAL',p.id,null,p); await queueJob(db,'ARCHIVE_STAGING_PROPOSAL','PROPOSAL',p.id,{mode:'ARCHIVE_STAGING_PROPOSAL',proposal_id:p.id,version_no:1,storage_path:payload.stagingPath,file_name:payload.fileName,mime_type:payload.mimeType}); await queueNotice(db,'NEW_PROPOSAL','PROPOSAL',p.id); return json({ok:true,proposal:p});
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
    const owner=(await db.from('profiles').select('id').eq('secretariat_id',p.secretariat_id).eq('role','SECRETARY').eq('active',true).limit(1).maybeSingle()).data?.id||p.applicant_id;
    await db.from('initiatives').insert({cycle_id:p.cycle_id,proposal_id:p.id,secretariat_id:p.secretariat_id,owner_id:owner,title:p.title,objective:p.primary_benefit,source_type:'APPROVED_PROPOSAL',status:'ACTIVE'});
    await queueNotice(db,'APPROVED','PROPOSAL',p.id);return json({ok:true,proposal:p});
   }
   if(actionName==='PROPOSAL_REJECT'){if(!isGs(profile)||p.status!=='WITH_GS')throw new Error('غير مسموح.');p=await action(db,p,profile,'GS_REJECTED','NOT_APPROVED',payload.reason||'لم تتم الإجازة.');await queueNotice(db,'NOT_APPROVED','PROPOSAL',p.id);return json({ok:true,proposal:p});}
   if(actionName==='PROPOSAL_DEFER'){if(!isGs(profile)||p.status!=='WITH_GS')throw new Error('غير مسموح.');p=await action(db,p,profile,'GS_DEFERRED','DEFERRED',payload.reason||'تم تأجيل النظر.');await queueNotice(db,'DEFERRED','PROPOSAL',p.id);return json({ok:true,proposal:p});}
   if(actionName==='PROPOSAL_WITHDRAW'){if(p.applicant_id!==profile.id||p.status==='APPROVED'||terminalProposalStatuses.includes(p.status))throw new Error('لا يمكن سحب المقترح.');p=await action(db,p,profile,'WITHDRAWN','WITHDRAWN',payload.reason||'سحب مقدم الطلب المقترح.');await queueNotice(db,'WITHDRAWN','PROPOSAL',p.id);return json({ok:true,proposal:p});}
   if(actionName==='PROPOSAL_EXECUTION_STATUS'){if(!canManageSecretariat(profile,p.secretariat_id)&&!isGs(profile))throw new Error('غير مسموح.');if(p.status!=='APPROVED')throw new Error('المقترح غير مجاز.');const before={...p};const u=await db.from('proposals').update({execution_status:payload.status}).eq('id',p.id).select().single();if(u.error)throw u.error;await db.from('proposal_actions').insert({proposal_id:p.id,actor_id:profile.id,actor_role:profile.role,action_type:'EXECUTION_STATUS_CHANGED',from_status:p.status,to_status:p.status,note_text:`حالة التنفيذ: ${payload.status}`});await audit(db,profile,'EXECUTION_STATUS_CHANGED','PROPOSAL',p.id,before,u.data);await queueNotice(db,'EXECUTION_STATUS_CHANGED','PROPOSAL',p.id);return json({ok:true,proposal:u.data});}
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
   if(actionName==='EVIDENCE_FILE_ADD'){if(m.owner_id!==profile.id)throw new Error('المالك فقط يرفع الدليل.');if(!payload.stagingPath)throw new Error('الملف غير موجود.');await queueJob(db,'ARCHIVE_STAGING_EVIDENCE','MILESTONE',m.id,{mode:'ARCHIVE_STAGING_EVIDENCE',milestone_id:m.id,storage_path:payload.stagingPath,file_name:payload.fileName,mime_type:payload.mimeType,note:payload.note||null,submitted_by:profile.id});await db.from('milestones').update({status:'READY_FOR_VERIFICATION'}).eq('id',m.id);await audit(db,profile,'EVIDENCE_FILE_QUEUED','MILESTONE',m.id,before,null);await queueNotice(db,'MILESTONE_READY','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='BLOCKER_OPEN'){if(m.owner_id!==profile.id)throw new Error('المالك فقط يسجل العائق.');const r=await db.from('blockers').insert({milestone_id:m.id,opened_by:profile.id,description:payload.description,severity:payload.severity||'MEDIUM'}).select().single();if(r.error)throw r.error;await db.from('milestones').update({status:'BLOCKED'}).eq('id',m.id);await audit(db,profile,'BLOCKER_OPEN','MILESTONE',m.id,before,r.data);await queueNotice(db,'MILESTONE_BLOCKED','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='INTERVENTION_ADD'){if(!canManageSecretariat(profile,m.secretariat_id))throw new Error('السكرتير المختص فقط يضيف تدخلًا.');const r=await db.from('interventions').insert({milestone_id:m.id,secretary_id:profile.id,action_text:payload.actionText,due_at:payload.dueAt||null}).select().single();if(r.error)throw r.error;await audit(db,profile,'INTERVENTION_ADD','MILESTONE',m.id,before,r.data);await queueNotice(db,'SECRETARY_INTERVENTION','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='MILESTONE_VERIFY'){if(!canManageSecretariat(profile,m.secretariat_id))throw new Error('السكرتير المختص فقط يتحقق من الإنجاز.');if(m.status!=='READY_FOR_VERIFICATION')throw new Error('المحطة ليست جاهزة للتحقق.');const decision=payload.decision==='VERIFIED'?'VERIFIED':'RETURNED';await db.from('verifications').insert({milestone_id:m.id,verifier_id:profile.id,decision,note:payload.note||null});const patch=decision==='VERIFIED'?{status:'VERIFIED',verified_at:new Date().toISOString()}:{status:'IN_PROGRESS',verified_at:null};const u=await db.from('milestones').update(patch).eq('id',m.id).select().single();if(u.error)throw u.error;if(decision==='VERIFIED'){await db.from('blockers').update({status:'RESOLVED',resolved_by:profile.id,resolved_at:new Date().toISOString(),resolution:'أُغلق تلقائيًا بعد تحقق المحطة'}).eq('milestone_id',m.id).eq('status','OPEN');await db.from('interventions').update({status:'CLOSED',closed_at:new Date().toISOString()}).eq('milestone_id',m.id).eq('status','OPEN')}await audit(db,profile,'MILESTONE_VERIFY','MILESTONE',m.id,before,u.data,{decision});await queueNotice(db,decision==='VERIFIED'?'MILESTONE_VERIFIED':'MILESTONE_RETURNED','MILESTONE',m.id);return json({ok:true});}
   if(actionName==='GS_OVERSIGHT_NOTE'){if(!isGs(profile))throw new Error('غير مسموح.');const r=await db.from('oversight_notes').insert({secretariat_id:m.secretariat_id,milestone_id:m.id,created_by:profile.id,note:payload.note,severity:payload.severity||'INFO'}).select().single();if(r.error)throw r.error;await audit(db,profile,'GS_OVERSIGHT_NOTE','MILESTONE',m.id,null,r.data);await queueNotice(db,'GS_OVERSIGHT_NOTE','MILESTONE',m.id);return json({ok:true});}
  }


  if(actionName==='MEETING_CREATE'){
   if(!['SECRETARY','GS','ADMIN'].includes(profile.role))throw new Error('غير مسموح.');const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;const r=await db.from('meetings').insert({cycle_id:cycle.id,title:payload.title,held_at:payload.heldAt||new Date().toISOString(),chair_id:profile.id,status:'OPEN',created_by:profile.id}).select().single();if(r.error)throw r.error;await audit(db,profile,'MEETING_CREATE','MEETING',r.data.id,null,r.data);return json({ok:true,meeting:r.data});
  }
  if(actionName==='DECISION_CREATE'){
   if(!['SECRETARY','GS','ADMIN'].includes(profile.role))throw new Error('غير مسموح.');const sid=profile.role==='SECRETARY'?profile.secretariat_id:(payload.secretariatId||profile.secretariat_id||null);const r=await db.from('decisions').insert({meeting_id:payload.meetingId||null,secretariat_id:sid,title:payload.title,decision_text:payload.decisionText,owner_id:payload.ownerId||null,due_at:payload.dueAt||null,status:'OPEN',created_by:profile.id}).select().single();if(r.error)throw r.error;await audit(db,profile,'DECISION_CREATE','DECISION',r.data.id,null,r.data);return json({ok:true,decision:r.data});
  }
  if(actionName==='DECISION_TO_MILESTONE'){
   const d=(await db.from('decisions').select('*').eq('id',payload.decisionId).single()).data;if(!d)throw new Error('القرار غير موجود.');if(!(profile.role==='ADMIN'||profile.role==='GS'||canManageSecretariat(profile,d.secretariat_id)))throw new Error('غير مسموح.');if(!d.owner_id||!d.due_at)throw new Error('يجب تحديد مسؤول وموعد للقرار قبل تحويله للمتابعة.');const cycle=(await db.from('cycles').select('id').eq('is_current',true).single()).data;let init=(await db.from('initiatives').select('*').eq('secretariat_id',d.secretariat_id).eq('source_type','DECISION').eq('status','ACTIVE').limit(1).maybeSingle()).data;if(!init){const x=await db.from('initiatives').insert({cycle_id:cycle.id,secretariat_id:d.secretariat_id,owner_id:d.owner_id,title:'قرارات تحتاج متابعة',objective:'تحويل القرارات إلى التزامات قابلة للتحقق',source_type:'DECISION',status:'ACTIVE'}).select().single();if(x.error)throw x.error;init=x.data}const rr=await db.from('results').insert({initiative_id:init.id,statement:d.decision_text,success_measure:'تنفيذ القرار كما هو مع دليل قابل للتحقق',owner_id:d.owner_id,due_at:d.due_at}).select().single();if(rr.error)throw rr.error;const mm=await db.from('milestones').insert({result_id:rr.data.id,secretariat_id:d.secretariat_id,owner_id:d.owner_id,title:d.title,due_at:d.due_at,verification_criteria:'دليل يثبت تنفيذ القرار',created_by:profile.id}).select().single();if(mm.error)throw mm.error;await db.from('decisions').update({status:'IN_TRACKING',related_entity_type:'MILESTONE',related_entity_id:mm.data.id}).eq('id',d.id);await audit(db,profile,'DECISION_TO_MILESTONE','DECISION',d.id,d,{milestone_id:mm.data.id});return json({ok:true,milestone:mm.data});
  }

  if(actionName==='PASSWORD_CHANGED'){await db.from('profiles').update({must_change_password:false}).eq('id',profile.id);await audit(db,profile,'PASSWORD_CHANGED','PROFILE',profile.id,null,{must_change_password:false});return json({ok:true});}

  if(actionName==='ADMIN_SETTINGS_UPDATE'){if(profile.role!=='ADMIN')throw new Error('غير مسموح.');for(const [key,value] of Object.entries(payload.settings||{})){await db.from('system_settings').upsert({key,value,updated_by:profile.id,updated_at:new Date().toISOString()})}await audit(db,profile,'ADMIN_SETTINGS_UPDATE','SYSTEM',null,null,payload.settings);return json({ok:true});}
  if(actionName==='ADMIN_USER_ROLE'){if(profile.role!=='ADMIN')throw new Error('غير مسموح.');const before=(await db.from('profiles').select('*').eq('id',payload.userId).single()).data;const r=await db.from('profiles').update({role:payload.role}).eq('id',payload.userId).select().single();if(r.error)throw r.error;await audit(db,profile,'ADMIN_USER_ROLE','PROFILE',payload.userId,before,r.data);return json({ok:true});}

  if(actionName==='FILE_DOWNLOAD'||actionName==='TEMPLATE_DOWNLOAD'){
   const bridge=Deno.env.get('DRIVE_BRIDGE_URL');const secret=Deno.env.get('DRIVE_BRIDGE_SECRET');if(!bridge||!secret)throw new Error('Drive bridge not configured');
   let reqBody:any;
   if(actionName==='TEMPLATE_DOWNLOAD'){reqBody={secret,action:'GET_TEMPLATE'};}
   else {
    const driveFileId=String(payload.driveFileId||'');if(!driveFileId)throw new Error('File ID required');
    const asset=(await db.from('file_assets').select('*').eq('drive_file_id',driveFileId).maybeSingle()).data;if(!asset)throw new Error('الملف غير مسجل في النظام.');
    let allowed=false;
    if(asset.entity_type==='PROPOSAL'){const fp=await getProposal(db,asset.entity_id);allowed=fp.applicant_id===profile.id||isGs(profile)||(profile.role==='SECRETARY'&&profile.secretariat_id===fp.secretariat_id);}
    if(asset.entity_type==='MILESTONE'){const fm=await getMilestone(db,asset.entity_id);allowed=fm.owner_id===profile.id||isGs(profile)||((profile.role==='SECRETARY'||profile.role==='MEMBER')&&profile.secretariat_id===fm.secretariat_id);}
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
