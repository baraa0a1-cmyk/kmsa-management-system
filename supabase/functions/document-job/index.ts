import { adminClient, corsHeaders, env, json } from '../_shared/common.ts';

function toBase64(bytes:Uint8Array){let s='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)s+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(s)}

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 try{
  const provided=req.headers.get('x-internal-secret')||''; if(provided!==env('FUNCTION_INTERNAL_SECRET'))return json({error:'forbidden'},403);
  const body=await req.json(); const db=adminClient(); const bridge=env('DRIVE_BRIDGE_URL'); const secret=env('DRIVE_BRIDGE_SECRET');
  if(body.mode==='ARCHIVE_STAGING_EVIDENCE'){
    const m=(await db.from('milestones').select('*,secretariat:secretariats(code,name_ar)').eq('id',body.milestone_id).single()).data;if(!m)throw new Error('Milestone not found');
    const dl=await db.storage.from('staging').download(body.storage_path);if(dl.error||!dl.data)throw dl.error||new Error('Staging file missing');const bytes=new Uint8Array(await dl.data.arrayBuffer());if(bytes.length>10*1024*1024)throw new Error('الملف أكبر من 10MB في النسخة الحالية.');
    const resp=await fetch(bridge,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,action:'ARCHIVE_GENERIC',category:'Milestone Evidence',entityId:m.id,entityTitle:m.title,fileName:body.file_name,mimeType:body.mime_type,base64:toBase64(bytes)})});const out=await resp.json();if(!resp.ok||!out.ok)throw new Error(out.error||'Drive archive failed');await db.storage.from('staging').remove([body.storage_path]);
    await db.from('milestone_evidence').insert({milestone_id:m.id,submitted_by:body.submitted_by,evidence_type:'FILE',note:body.note||null,drive_file_id:out.fileId});await db.from('file_assets').insert({entity_type:'MILESTONE',entity_id:m.id,file_kind:'EVIDENCE',file_name:out.fileName||body.file_name,mime_type:body.mime_type||null,drive_file_id:out.fileId,uploaded_by:body.submitted_by});return json({ok:true,...out});
  }
  const proposal_id=body.proposal_id; const version_no=body.version_no;
  const p=(await db.from('proposals').select('*, secretariat:secretariats(code,name_ar)').eq('id',proposal_id).single()).data;
  const v=(await db.from('proposal_versions').select('*').eq('proposal_id',proposal_id).eq('version_no',version_no).single()).data;
  if(!p||!v)throw new Error('Proposal/version not found');

  let out:any;
  if(body.mode==='ARCHIVE_STAGING_PROPOSAL'){
    const dl=await db.storage.from('staging').download(body.storage_path); if(dl.error||!dl.data)throw dl.error||new Error('Staging file missing');
    const bytes=new Uint8Array(await dl.data.arrayBuffer()); if(bytes.length>10*1024*1024)throw new Error('الملف أكبر من 10MB في النسخة الحالية.');
    const resp=await fetch(bridge,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,action:'ARCHIVE_UPLOAD',proposal:{id:p.id,internalId:p.internal_id,title:p.title,secretariatCode:p.secretariat?.code,secretariatName:p.secretariat?.name_ar,driveFolderId:p.drive_folder_id},versionNo:v.version_no,fileName:body.file_name,mimeType:body.mime_type,base64:toBase64(bytes)})});
    out=await resp.json(); if(!resp.ok||!out.ok)throw new Error(out.error||'Drive archive failed'); await db.storage.from('staging').remove([body.storage_path]);
  } else {
    const resp=await fetch(bridge,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,action:'GENERATE_PROPOSAL',proposal:{id:p.id,internalId:p.internal_id,title:p.title,secretariatCode:p.secretariat?.code,secretariatName:p.secretariat?.name_ar,driveFolderId:p.drive_folder_id},version:{versionNo:v.version_no,snapshot:v.snapshot}})});
    out=await resp.json(); if(!resp.ok||!out.ok)throw new Error(out.error||'Drive bridge failed');
  }
  await db.from('proposal_versions').update({doc_drive_file_id:out.docId||null,pdf_drive_file_id:out.pdfId||null,docx_drive_file_id:out.docxId||null,original_upload_drive_file_id:out.originalId||null}).eq('id',v.id);
  if(out.folderId&&!p.drive_folder_id)await db.from('proposals').update({drive_folder_id:out.folderId}).eq('id',p.id);
  const assets:any[]=[];if(out.originalId)assets.push({entity_type:'PROPOSAL',entity_id:p.id,file_kind:'ORIGINAL',file_name:out.originalName||body.file_name||'original',mime_type:body.mime_type||null,drive_file_id:out.originalId,version_no:v.version_no});
  if(out.pdfId)assets.push({entity_type:'PROPOSAL',entity_id:p.id,file_kind:'PDF',file_name:`${p.internal_id}_V${String(v.version_no).padStart(2,'0')}.pdf`,mime_type:'application/pdf',drive_file_id:out.pdfId,version_no:v.version_no});
  if(out.docxId)assets.push({entity_type:'PROPOSAL',entity_id:p.id,file_kind:'DOCX',file_name:`${p.internal_id}_V${String(v.version_no).padStart(2,'0')}.docx`,mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',drive_file_id:out.docxId,version_no:v.version_no});
  if(assets.length)await db.from('file_assets').insert(assets);
  return json({ok:true,...out});
 }catch(e:any){console.error(e);return json({error:e?.message||String(e)},500)}
});
