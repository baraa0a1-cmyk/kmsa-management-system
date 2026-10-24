import { adminClient, corsHeaders, env, inboxNotify, json } from '../_shared/common.ts';

function toBase64(bytes:Uint8Array){let s='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)s+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(s)}
async function ensureAsset(db:any,row:any){if(!row.drive_file_id)return;const existing=(await db.from('file_assets').select('id').eq('drive_file_id',row.drive_file_id).limit(1).maybeSingle()).data;if(!existing){const result=await db.from('file_assets').insert(row);if(result.error)throw result.error}}

// Older milestone upload route must not bypass the v5.2 relative-deadline/completion semantics.
async function rebaseChildren(db:any,baseId:string,seen=new Set<string>()){
 if(seen.has(baseId))throw new Error('Cyclic milestone dependency');seen.add(baseId);
 const base=(await db.from('milestones').select('*').eq('id',baseId).single()).data;
 const deps=(await db.from('milestones').select('*').eq('relative_to_milestone_id',baseId).eq('deadline_mode','RELATIVE')).data||[];
 for(const child of deps){const when=new Date(new Date(base.completed_reported_at||base.due_at).getTime()+(Number(child.relative_days||0)*24+Number(child.relative_hours||0))*3600000).toISOString();const r=await db.from('milestones').update({due_at:when,status_updated_at:new Date().toISOString()}).eq('id',child.id).not('status','in','("READY_FOR_VERIFICATION","VERIFIED","CANCELLED")');if(r.error)throw r.error;await rebaseChildren(db,child.id,new Set(seen));}
}
async function reportArchivedEvidenceCompletion(db:any,m:any){
 if(['VERIFIED','CANCELLED'].includes(m.status))return;
 const completedAt=m.completed_reported_at||new Date().toISOString();
 const r=await db.from('milestones').update({status:'READY_FOR_VERIFICATION',completed_reported_at:completedAt,status_updated_at:new Date().toISOString()}).eq('id',m.id);if(r.error)throw r.error;
 await rebaseChildren(db,m.id);
 const all=(await db.from('milestones').select('status,design_status').eq('result_id',m.result_id).neq('design_status','REJECTED')).data||[];
 const active=all.filter((x:any)=>x.design_status==='APPROVED');
 if(active.length&&active.every((x:any)=>['READY_FOR_VERIFICATION','VERIFIED'].includes(x.status))){
  const result=await db.from('results').update({assignment_status:'COMPLETED',completed_at:completedAt}).eq('id',m.result_id).select('initiative_id').single();if(result.error)throw result.error;
  const results=(await db.from('results').select('assignment_status').eq('initiative_id',result.data.initiative_id)).data||[];
  if(results.length&&results.every((x:any)=>x.assignment_status==='COMPLETED')){const closed=await db.from('initiatives').update({status:'COMPLETED',health:'ON_TRACK',completed_at:completedAt}).eq('id',result.data.initiative_id);if(closed.error)throw closed.error;}
 }
}

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 try{
  const provided=req.headers.get('x-internal-secret')||''; if(provided!==env('FUNCTION_INTERNAL_SECRET'))return json({error:'forbidden'},403);
  const body=await req.json(); const db=adminClient(); const bridge=env('DRIVE_BRIDGE_URL'); const secret=env('DRIVE_BRIDGE_SECRET');
  if(body.mode==='ARCHIVE_STAGING_EVIDENCE'){
    const submitForVerification=body.submit_for_verification!==false;
    const m=(await db.from('milestones').select('*,secretariat:secretariats(code,name_ar)').eq('id',body.milestone_id).single()).data;if(!m)throw new Error('Milestone not found');
    const existing=(await db.from('milestone_evidence').select('drive_file_id').eq('source_storage_path',body.storage_path).eq('milestone_id',m.id).not('drive_file_id','is',null).limit(1).maybeSingle()).data;if(existing?.drive_file_id){if(submitForVerification)await reportArchivedEvidenceCompletion(db,m);await ensureAsset(db,{entity_type:'MILESTONE',entity_id:m.id,file_kind:'EVIDENCE',file_name:body.file_name||'attachment',mime_type:body.mime_type||null,drive_file_id:existing.drive_file_id,uploaded_by:body.submitted_by});await db.storage.from('staging').remove([body.storage_path]);return json({ok:true,fileId:existing.drive_file_id,reused:true});}
    const dl=await db.storage.from('staging').download(body.storage_path);if(dl.error||!dl.data)throw dl.error||new Error('Staging file missing');const bytes=new Uint8Array(await dl.data.arrayBuffer());if(bytes.length>10*1024*1024)throw new Error('الملف أكبر من 10MB في النسخة الحالية.');
    const resp=await fetch(bridge,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,action:'ARCHIVE_GENERIC',category:'Milestone Evidence',entityId:m.id,entityTitle:m.title,fileName:body.file_name,mimeType:body.mime_type,uploadKey:body.storage_path.split('/').pop(),base64:toBase64(bytes)})});const out=await resp.json();if(!resp.ok||!out.ok)throw new Error(out.error||'Drive archive failed');
    await db.from('milestone_evidence').insert({milestone_id:m.id,submitted_by:body.submitted_by,evidence_type:'FILE',note:body.note||null,drive_file_id:out.fileId,source_storage_path:body.storage_path});if(submitForVerification)await reportArchivedEvidenceCompletion(db,m);await ensureAsset(db,{entity_type:'MILESTONE',entity_id:m.id,file_kind:'EVIDENCE',file_name:out.fileName||body.file_name,mime_type:body.mime_type||null,drive_file_id:out.fileId,uploaded_by:body.submitted_by});await db.storage.from('staging').remove([body.storage_path]);
    const result=(await db.from('results').select('initiative:initiatives(secretary_id)').eq('id',m.result_id).maybeSingle()).data;
    const secretaryId=result?.initiative?.secretary_id;
    if(submitForVerification&&secretaryId)await inboxNotify(db,secretaryId,'EVIDENCE_READY',`دليل إنجاز مؤرشف: ${m.title}`,'تم حفظ الدليل في الأرشيف. يستطيع المشرف تسجيل الاطلاع دون تعطيل التنفيذ.','MILESTONE',m.id,`/workspace/milestones/${m.id}`);
    return json({ok:true,...out});
  }
  const proposal_id=body.proposal_id; const version_no=body.version_no;
  const p=(await db.from('proposals').select('*, secretariat:secretariats(code,name_ar)').eq('id',proposal_id).single()).data;
  const v=(await db.from('proposal_versions').select('*').eq('proposal_id',proposal_id).eq('version_no',version_no).single()).data;
  if(!p||!v)throw new Error('Proposal/version not found');

  // Idempotency: if the requested artifacts already exist, never create a duplicate Drive copy.
  if(body.mode==='ARCHIVE_STAGING_PROPOSAL'){
    const mime=String(body.mime_type||'');
    const ready=mime==='application/pdf'
      ? !!(v.original_upload_drive_file_id&&v.pdf_drive_file_id)
      : !!(v.original_upload_drive_file_id&&v.pdf_drive_file_id&&v.docx_drive_file_id);
    if(ready)return json({ok:true,reused:true,folderId:p.drive_folder_id,originalId:v.original_upload_drive_file_id,pdfId:v.pdf_drive_file_id,docxId:v.docx_drive_file_id,docId:v.doc_drive_file_id});
  }else if(v.pdf_drive_file_id&&v.docx_drive_file_id){
    return json({ok:true,reused:true,folderId:p.drive_folder_id,pdfId:v.pdf_drive_file_id,docxId:v.docx_drive_file_id,docId:v.doc_drive_file_id});
  }

  let out:any;
  if(body.mode==='ARCHIVE_STAGING_PROPOSAL'){
    const dl=await db.storage.from('staging').download(body.storage_path); if(dl.error||!dl.data)throw dl.error||new Error('Staging file missing');
    const bytes=new Uint8Array(await dl.data.arrayBuffer()); if(bytes.length>12*1024*1024)throw new Error('الملف أكبر من 12MB.');
    const mime=String(body.mime_type||'');const pdf=mime==='application/pdf';const docx=mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if(!pdf&&!docx)throw new Error('صيغة المقترح غير مدعومة.');
    if(pdf&&String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw new Error('محتوى الملف لا يطابق صيغة PDF.');
    if(docx&&!(bytes[0]===0x50&&bytes[1]===0x4b))throw new Error('محتوى الملف لا يطابق صيغة DOCX.');
    const resp=await fetch(bridge,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,action:'ARCHIVE_UPLOAD',proposal:{id:p.id,internalId:p.internal_id,title:p.title,secretariatCode:p.secretariat?.code,secretariatName:p.secretariat?.name_ar,driveFolderId:p.drive_folder_id},versionNo:v.version_no,fileName:body.file_name,mimeType:body.mime_type,uploadKey:body.storage_path.split('/').pop(),base64:toBase64(bytes)})});
    out=await resp.json(); if(!resp.ok||!out.ok)throw new Error(out.error||'Drive archive failed'); /* staging cleanup follows successful metadata commit */
  } else {
    const resp=await fetch(bridge,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,action:'GENERATE_PROPOSAL',proposal:{id:p.id,internalId:p.internal_id,title:p.title,secretariatCode:p.secretariat?.code,secretariatName:p.secretariat?.name_ar,driveFolderId:p.drive_folder_id},version:{versionNo:v.version_no,snapshot:v.snapshot}})});
    out=await resp.json(); if(!resp.ok||!out.ok)throw new Error(out.error||'Drive bridge failed');
  }
  if(!out.pdfId)throw new Error('لم يكتمل توليد PDF؛ لن تعتبر العملية ناجحة.');
  if(body.mode!=='ARCHIVE_STAGING_PROPOSAL'&&(!out.docxId||!out.docId))throw new Error('لم يكتمل توليد Word؛ يجب إعادة المحاولة.');
  if(body.mode==='ARCHIVE_STAGING_PROPOSAL'&&body.mime_type!=='application/pdf'&&!out.docxId)throw new Error('لم يكتمل تحويل DOCX؛ يجب إعادة المحاولة.');
  const versionUpdate=await db.from('proposal_versions').update({doc_drive_file_id:out.docId||v.doc_drive_file_id||null,pdf_drive_file_id:out.pdfId||v.pdf_drive_file_id||null,docx_drive_file_id:out.docxId||v.docx_drive_file_id||null,original_upload_drive_file_id:out.originalId||v.original_upload_drive_file_id||null}).eq('id',v.id);
  if(versionUpdate.error)throw versionUpdate.error;
  if(out.folderId&&!p.drive_folder_id){const folderSaved=await db.from('proposals').update({drive_folder_id:out.folderId}).eq('id',p.id);if(folderSaved.error)throw folderSaved.error;}
  if(out.originalId)await ensureAsset(db,{entity_type:'PROPOSAL',entity_id:p.id,file_kind:'ORIGINAL',file_name:out.originalName||body.file_name||'original',mime_type:body.mime_type||null,drive_file_id:out.originalId,version_no:v.version_no});
  if(out.pdfId)await ensureAsset(db,{entity_type:'PROPOSAL',entity_id:p.id,file_kind:'PDF',file_name:`${p.internal_id}_V${String(v.version_no).padStart(2,'0')}.pdf`,mime_type:'application/pdf',drive_file_id:out.pdfId,version_no:v.version_no});
  if(out.docxId)await ensureAsset(db,{entity_type:'PROPOSAL',entity_id:p.id,file_kind:'DOCX',file_name:`${p.internal_id}_V${String(v.version_no).padStart(2,'0')}.docx`,mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',drive_file_id:out.docxId,version_no:v.version_no});
  if(body.mode==='ARCHIVE_STAGING_PROPOSAL')await db.storage.from('staging').remove([body.storage_path]);
  return json({ok:true,...out});
 }catch(e:any){console.error(e);return json({error:e?.message||String(e)},500)}
});
