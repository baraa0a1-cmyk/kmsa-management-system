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
   if(profile.id!==init.owner_id){
    const resultRows=await db.from('results').select('id').eq('initiative_id',init.id);
    if(resultRows.error)throw resultRows.error;
    const resultIds=(resultRows.data||[]).map((x:any)=>x.id);
    const ownMilestones=resultIds.length?await db.from('milestones').select('id').in('result_id',resultIds).eq('owner_id',profile.id).limit(1):{data:[]};
    if((ownMilestones as any).error)throw (ownMilestones as any).error;
    if(!(ownMilestones.data||[]).length)throw new Error('يستطيع مسؤول التنفيذ المعين فقط تحديث محطاته.');
   }
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
   const gsIndependent=profile.role==='GS'&&init.owner_id===init.secretary_id;
   if(!secretary&&!delegate&&!gsIndependent)throw new Error('التحقق متاح للمتابع المعين أو السكرتير المختص فقط.');
   if(profile.id===init.owner_id)throw new Error('لا يجوز للطالب مراجعة عمله بنفسه.');
   const assessment=String(p.assessment||'');const channel=String(p.channel||'');const note=str(p.note);
   if(!['ON_TRACK','SLOW','NO_WORK','BLOCKED','UNVERIFIED','WAITING_EXTERNAL'].includes(assessment)||!['TELEGRAM','OUTPUT','OTHER'].includes(channel)||(assessment!=='ON_TRACK'&&note.length<6))
    throw new Error('حدد النتيجة وطريقة التحقق واكتب خلاصة محددة لما تأكدت منه.');
   const checked=Array.isArray(p.milestoneIds)?p.milestoneIds:[];
   if(checked.some((x:unknown)=>!uuid(x))||new Set(checked).size!==checked.length)throw new Error('اختيار المحطات غير صحيح.');
   const reviewAt=iso(p.nextReviewAt);
   if(assessment==='WAITING_EXTERNAL'&&(!reviewAt||new Date(reviewAt).getTime()>Date.now()+7*86400000))
    throw new Error('انتظار الجهة الخارجية يحتاج موعد مراجعة خلال أسبوع، ولا يتجاوز موعد التسليم.');
   const negative=['SLOW','NO_WORK','BLOCKED','UNVERIFIED'].includes(assessment);
   const required=str(p.followupText,1500),due=iso(p.followupDueAt);
   if(negative&&required&&(!due||new Date(due).getTime()<=Date.now()))throw new Error('عند إنشاء إجراء مستقل حدد موعد مراجعته.');
   if(!uuid(p.requestKey))throw new Error('معرف العملية مطلوب لمنع التكرار.');
   const who=uuid(p.followupResponsibleId)?p.followupResponsibleId:(assessment==='UNVERIFIED'?profile.id:init.owner_id);
   const {data,error}=await db.rpc('kmsa_flow_record_check_v71',{
    p_initiative:init.id,p_actor:profile.id,p_kind:delegate?'DELEGATE':'SECRETARY_DIRECT',p_request_key:p.requestKey,
    p_assessment:assessment,p_channel:channel,p_note:note,p_review_at:reviewAt,p_milestone_ids:checked,
    p_issue_text:negative&&required?required:null,p_issue_due:negative&&required?due:null,p_issue_responsible:negative&&required?who:null
   });
   if(error)throw new Error(error.message);
   return json({ok:true,...(data||{})});
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
   // Archived actions remain readable. We no longer create a "contacted on Telegram" record.
   return fail('تدخل السكرتير يتم عبر تيليجرام؛ يحفظ النظام القرارات المؤثرة فقط. استخدم إدارة التكليف أو تعديل الموعد عند اتخاذ قرار.',410);
  }
  return fail('إجراء غير معروف.',400);
 }catch(e:any){const msg=String(e?.message||'تعذر تنفيذ الإجراء.');console.error('project-flow',msg);
  return json({error:msg},msg.includes('صلاحية')||msg.includes('يجوز')||msg.includes('مسؤول')?403:400);}
});
