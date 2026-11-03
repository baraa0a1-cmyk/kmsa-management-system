/** KMSA Flow 7.0 — small, separate API. Never overwrite the existing workflow. */
import { audit, corsHeaders, json, requestUser } from '../_shared/common.ts';

const uuid=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const str=(v:unknown,max=2500)=>typeof v==='string'?v.trim().slice(0,max):'';
const iso=(v:unknown)=>{if(!v)return null;const d=new Date(String(v));return Number.isFinite(d.getTime())?d.toISOString():null};
const fail=(msg:string,status=400)=>json({error:msg},status);
async function loadActiveProject(db:any,id:string){
 if(!uuid(id))throw new Error('معرف المشروع غير صحيح.');
 const {data,error}=await db.from('initiatives').select('*').eq('id',id).single();if(error||!data)throw new Error('المشروع غير موجود.');
 const {data:cycle,error:ce}=await db.from('cycles').select('id').eq('is_current',true).single();
 if(ce||!cycle||data.cycle_id!==cycle.id)throw new Error('الدورة مؤرشفة، ولا يمكن تنفيذ إجراء عليها.');
 return data;
}
async function getAssignedSupervisor(db:any,id:string){
 const {data,error}=await db.from('project_supervision_assignments').select('supervisor_id,assigned_at').eq('initiative_id',id).maybeSingle();if(error)throw error;return data;
}
function active(init:any){return init.approval_status==='APPROVED'&&init.setup_status==='ACTIVE'&&!['COMPLETED','CANCELLED'].includes(init.status)&&init.lifecycle_state!=='POSTPONED'}
function isSecretary(p:any,i:any){return p.role==='SECRETARY'&&i.secretary_id===p.id&&i.secretariat_id===p.secretariat_id}
function requireActive(i:any){if(!active(i))throw new Error('المشروع ليس قيد التنفيذ.');}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
 try{
  const {profile,db}=await requestUser(req);
  const body=await req.json().catch(()=>null);
  const action=String(body?.action||'');const p=body?.payload||{};
  if(!uuid(p.initiativeId))throw new Error('اختر مشروعًا صحيحًا.');
  const init=await loadActiveProject(db,p.initiativeId);
  if(action==='BATCH_UPDATE'){
   requireActive(init);
   if(profile.id!==init.owner_id && !(await db.from('results').select('id').eq('initiative_id',init.id).eq('owner_id',profile.id).limit(1)).data?.length)
    throw new Error('يستطيع مسؤول التنفيذ المعين فقط تحديث محطاته.');
   if(!uuid(p.requestKey))throw new Error('معرف العملية مطلوب لمنع التكرار.');
   const items=Array.isArray(p.items)?p.items:[];
   if(items.length<1||items.length>8||!items.every((x:any)=>uuid(x.milestoneId)&&['NOT_STARTED','IN_PROGRESS','AT_RISK','BLOCKED','READY_FOR_VERIFICATION'].includes(x.status)))
    throw new Error('حدد من محطة واحدة حتى ثماني محطات، وحالة صحيحة لكل منها.');
   const note=str(p.note,3000),nextStep=str(p.nextStep,1000);
   if(note.length<8)throw new Error('اكتب ما حدث بصورة مختصرة (8 حروف على الأقل).');
   if(items.some((x:any)=>x.status!=='READY_FOR_VERIFICATION')&&!nextStep)throw new Error('حدد الخطوة القادمة للمحطات الجارية.');
   const {data,error}=await db.rpc('kmsa_flow_batch_progress',{p_initiative:init.id,p_author:profile.id,p_request_key:p.requestKey,p_note:note,p_next_step:nextStep,p_items:items});
   if(error)throw new Error(error.message);
   return json({ok:true,...(data||{})});
  }
  if(action==='CHECK_ADD'){
   requireActive(init);
   const assignment=await getAssignedSupervisor(db,init.id);
   const secretary=isSecretary(profile,init);
   const delegate=assignment?.supervisor_id===profile.id&&profile.id!==init.secretary_id;
   if(!secretary&&!delegate)throw new Error('التحقق الإشرافي متاح للمتابع المعين أو سكرتير المشروع فقط.');
   if(profile.id===init.owner_id)throw new Error('لا يجوز اعتماد تحقق إشرافي على عمل الشخص نفسه. عيّن متابعًا آخر للمحطة.');
   const assessment=String(p.assessment||'');const channel=String(p.channel||'');const note=str(p.note);
   if(!['ON_TRACK','SLOW','NO_WORK','BLOCKED','UNVERIFIED','WAITING_EXTERNAL'].includes(assessment)||!['TELEGRAM','OUTPUT','OTHER'].includes(channel))throw new Error('حدد نتيجة التحقق وطريقته.');
   if(assessment!=='ON_TRACK'&&note.length<6)throw new Error('صف ما اكتشفته في التحقق باختصار.');
   const reviewAt=iso(p.nextReviewAt);
   if(assessment==='WAITING_EXTERNAL'&&!reviewAt)throw new Error('حدد موعد مراجعة رد الجهة الخارجية.');
   if(reviewAt&&(new Date(reviewAt).getTime()<=Date.now()||new Date(reviewAt).getTime()>Date.now()+30*86400000))throw new Error('موعد المراجعة يجب أن يكون مستقبلًا خلال 30 يومًا.');
   if(!uuid(p.requestKey))throw new Error('معرف العملية مطلوب.');
   const existing=(await db.from('kmsa_flow_checks').select('id').eq('initiative_id',init.id).eq('actor_id',profile.id).eq('request_key',p.requestKey).maybeSingle()).data;
   if(existing)return json({ok:true,alreadySaved:true,checkId:existing.id});
   const {data,error}=await db.from('kmsa_flow_checks').insert({initiative_id:init.id,actor_id:profile.id,actor_kind:delegate?'DELEGATE':'SECRETARY_DIRECT',request_key:p.requestKey,assessment,channel,note:note||null,next_review_at:reviewAt}).select('id').single();
   if(error){if(error.code==='23505')return json({ok:true,alreadySaved:true});throw error;}
   await audit(db,profile,'FLOW_SUPERVISION_CHECK','INITIATIVE',init.id,null,{checkId:data.id,assessment,channel});
   return json({ok:true,checkId:data.id});
  }
  if(action==='ISSUE_OPEN'){
   requireActive(init);
   const assignment=await getAssignedSupervisor(db,init.id);
   if(!isSecretary(profile,init)&&assignment?.supervisor_id!==profile.id)throw new Error('فتح مشكلة إشرافية من صلاحية المتابع المعين أو السكرتير.');
   const description=str(p.description,1600);
   if(description.length<6)throw new Error('اكتب المشكلة التي تتطلب معالجة.');
   const due=iso(p.dueAt);
   if(due&&new Date(due).getTime()<Date.now())throw new Error('موعد المعالجة يجب أن يكون مستقبلًا.');
   const responsibleId=uuid(p.responsibleId)?p.responsibleId:init.owner_id;
   if(![init.owner_id,init.secretary_id,assignment?.supervisor_id].includes(responsibleId))throw new Error('المسؤول عن المعالجة غير مرتبط بهذا المشروع.');
   if(p.milestoneId){
    const ms=await db.from('milestones').select('result_id').eq('id',p.milestoneId).single();
    if(ms.error||!ms.data)throw new Error('المحطة غير موجودة.');
    const res=await db.from('results').select('initiative_id').eq('id',ms.data.result_id).single();
    if(res.error||res.data?.initiative_id!==init.id)throw new Error('المحطة ليست ضمن المشروع.');
   }
   if(!uuid(p.requestKey))throw new Error('معرف العملية مطلوب.');
   const existed=(await db.from('kmsa_flow_issues').select('id').eq('initiative_id',init.id).eq('opened_by',profile.id).eq('request_key',p.requestKey).maybeSingle()).data;
   if(existed)return json({ok:true,alreadySaved:true,issueId:existed.id});
   const {data,error}=await db.from('kmsa_flow_issues').insert({initiative_id:init.id,milestone_id:uuid(p.milestoneId)?p.milestoneId:null,opened_by:profile.id,request_key:p.requestKey,responsible_id:responsibleId,description,due_at}).select('id').single();if(error){if(error.code==='23505')return json({ok:true,alreadySaved:true});throw error;}
   await audit(db,profile,'FLOW_ISSUE_OPEN','INITIATIVE',init.id,null,{issueId:data.id});return json({ok:true,issueId:data.id});
  }
  if(action==='ISSUE_CLOSE'){
   const {data:issue,error:ie}=await db.from('kmsa_flow_issues').select('*').eq('initiative_id',init.id).eq('id',p.issueId).single();if(ie||!issue)throw new Error('المشكلة غير موجودة.');
   const assigned=await getAssignedSupervisor(db,init.id);
   if(!isSecretary(profile,init)&&assigned?.supervisor_id!==profile.id)throw new Error('إغلاق المشكلة يحتاج تحقق المتابع أو السكرتير.');
   if(issue.status!=='OPEN')return json({ok:true,alreadyClosed:true});
   const resolution=str(p.resolution,1000);if(resolution.length<6)throw new Error('وضح كيف تأكدت من معالجة المشكلة.');
   const {data,error}=await db.from('kmsa_flow_issues').update({status:'RESOLVED',resolution_note:resolution,closed_by:profile.id,closed_at:new Date().toISOString()}).eq('id',issue.id).eq('status','OPEN').select('id').maybeSingle();if(error)throw error;
   await audit(db,profile,'FLOW_ISSUE_CLOSE','INITIATIVE',init.id,issue,{resolution});return json({ok:true,issueId:data?.id});
  }
  if(action==='SECRETARY_ACTION'){
   if(!isSecretary(profile,init))throw new Error('هذا التوثيق من صلاحية السكرتير المعين فقط.');
   const reason=str(p.reason,1000),outcome=str(p.outcome,1000),kind=String(p.kind||'');
   if(reason.length<6||outcome.length<6||!['CONTACTED','REASSIGNED','TEMP_UNAVAILABLE','ESCALATED','OTHER'].includes(kind))throw new Error('اختر الإجراء وأدخل ما حدث ونتيجته.');
   const reviewAt=iso(p.reviewAt);
   if(!uuid(p.requestKey))throw new Error('معرف العملية مطلوب.');
   const existed=(await db.from('kmsa_flow_secretary_actions').select('id').eq('initiative_id',init.id).eq('secretary_id',profile.id).eq('request_key',p.requestKey).maybeSingle()).data;
   if(existed)return json({ok:true,alreadySaved:true,id:existed.id});
   const {data,error}=await db.from('kmsa_flow_secretary_actions').insert({initiative_id:init.id,secretary_id:profile.id,request_key:p.requestKey,reason,action_kind:kind,outcome_note:outcome,review_at:reviewAt}).select('id').single();if(error){if(error.code==='23505')return json({ok:true,alreadySaved:true});throw error;}
   await audit(db,profile,'FLOW_SECRETARY_ACTION','INITIATIVE',init.id,null,{id:data.id,kind});return json({ok:true,id:data.id});
  }
  return fail('إجراء غير معروف.',400);
 }catch(e:any){const msg=String(e?.message||'تعذر تنفيذ الإجراء.');console.error('project-flow',msg);
  return json({error:msg},msg.includes('صلاحية')||msg.includes('يجوز')||msg.includes('مسؤول')?403:400);}
});
