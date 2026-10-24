/** KMSA Drive Archive Bridge
 * Script Properties required:
 * BRIDGE_SECRET, ARCHIVE_ROOT_FOLDER_ID
 * Proposal template: prefer PROPOSAL_TEMPLATE_GOOGLE_DOC_ID for stable PDF layout.
 * Keep PROPOSAL_TEMPLATE_DOCX_ID as the downloadable Word template and fallback generator.
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (String(body.secret || '') !== String(PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET') || '')) return json_({ok:false,error:'forbidden'});
    if (body.action === 'GENERATE_PROPOSAL') return json_(generateProposal_(body.proposal, body.version));
    if (body.action === 'GET_FILE') return json_(getFile_(body.driveFileId));
    if (body.action === 'ARCHIVE_UPLOAD') return json_(archiveUpload_(body));
    if (body.action === 'ARCHIVE_GENERIC') return json_(archiveGeneric_(body));
    if (body.action === 'GET_TEMPLATE') return json_(getTemplate_());
    return json_({ok:false,error:'unknown action'});
  } catch (err) { console.error(err && err.stack ? err.stack : err); return json_({ok:false,error:String(err && err.message ? err.message : err)}); }
}
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function props_(){ return PropertiesService.getScriptProperties(); }
function getOrCreateFolder_(parent, name) { const it=parent.getFoldersByName(name); return it.hasNext()?it.next():parent.createFolder(name); }
function sanitize_(s){return String(s||'').replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,' ').trim().slice(0,120);}
function proposalFolder_(p){
  const root=DriveApp.getFolderById(props_().getProperty('ARCHIVE_ROOT_FOLDER_ID'));
  if (p.driveFolderId) { try { return DriveApp.getFolderById(p.driveFolderId); } catch(e) {} }
  const proposals=getOrCreateFolder_(root,'Proposals');
  const secName=sanitize_((p.secretariatCode||'GENERAL')+(p.secretariatName?' - '+p.secretariatName:''));
  const secFolder=getOrCreateFolder_(proposals,secName||'GENERAL');
  const folderName=sanitize_(p.internalId + ' - ' + p.title);
  const found=secFolder.getFoldersByName(folderName); return found.hasNext()?found.next():secFolder.createFolder(folderName);
}
function importDocxAsGoogleDoc_(templateId, parentId, name) {
  const blob=DriveApp.getFileById(templateId).getBlob();
  const boundary='kmsa_boundary_'+new Date().getTime();
  const metadata={name:name,mimeType:'application/vnd.google-apps.document',parents:[parentId]};
  const pre='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: '+blob.getContentType()+'\r\n\r\n';
  const post='\r\n--'+boundary+'--';
  const bytes=[].concat(Utilities.newBlob(pre).getBytes(),blob.getBytes(),Utilities.newBlob(post).getBytes());
  const r=UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'post',contentType:'multipart/related; boundary='+boundary,payload:bytes,headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  if(r.getResponseCode()>=300)throw new Error('Template import failed: '+r.getContentText());
  return JSON.parse(r.getContentText()).id;
}
function createWorkingProposalDoc_(parentId, name) {
  const masterDocId=String(props_().getProperty('PROPOSAL_TEMPLATE_GOOGLE_DOC_ID')||'').trim();
  if(masterDocId){
    const source=DriveApp.getFileById(masterDocId);
    return source.makeCopy(name,DriveApp.getFolderById(parentId)).getId();
  }
  const docxId=String(props_().getProperty('PROPOSAL_TEMPLATE_DOCX_ID')||'').trim();
  if(!docxId) throw new Error('Proposal template missing: set PROPOSAL_TEMPLATE_GOOGLE_DOC_ID or PROPOSAL_TEMPLATE_DOCX_ID');
  return importDocxAsGoogleDoc_(docxId,parentId,name);
}

function replacePlaceholders_(docId, values) {
  const requests=Object.keys(values).map(k=>({replaceAllText:{containsText:{text:'{{'+k+'}}',matchCase:true},replaceText:String(values[k]==null?'':values[k])}}));
  const r=UrlFetchApp.fetch('https://docs.googleapis.com/v1/documents/'+encodeURIComponent(docId)+':batchUpdate',{method:'post',contentType:'application/json',payload:JSON.stringify({requests:requests}),headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  if(r.getResponseCode()>=300)throw new Error('Placeholder replacement failed: '+r.getContentText());
}
function exportDoc_(docId, mime, name){
  const r=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(docId)+'/export?mimeType='+encodeURIComponent(mime),{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  if(r.getResponseCode()>=300)throw new Error('Export failed: '+r.getContentText());
  return r.getBlob().setName(name);
}
function generateProposal_(p,v){
  if(!p||!v||!v.snapshot)throw new Error('Missing proposal/version snapshot');
  const folder=proposalFolder_(p); const versions=getOrCreateFolder_(folder,'Versions'); const n=Number(v.versionNo||1); const base=sanitize_(p.internalId+'_V'+('00'+n).slice(-2));
  const docId=createWorkingProposalDoc_(versions.getId(),base+' - Working');
  const s=v.snapshot;
  replacePlaceholders_(docId,{
    INTERNAL_ID:p.internalId,TITLE:s.title||p.title,APPLICANT_NAME:s.applicant_name||'',APPLICANT_EMAIL:s.applicant_email||'',
    SECRETARIAT_NAME:p.secretariatName||'',PROPOSED_PERIOD:s.proposed_period||'',NEEDED_BY:s.needed_by||'',URGENCY_REASON:s.urgency_reason||'',
    PRIMARY_BENEFICIARIES:s.primary_beneficiaries||'',TRIGGER_REALITY:s.trigger_reality||'',PRIMARY_BENEFIT:s.primary_benefit||'',
    SECONDARY_BENEFITS:s.secondary_benefits||'',INTERVENTION:s.intervention||'',SUCCESS_CRITERION:s.success_criterion||'',CONTEXT_FACTORS:s.context_factors||'',
    FUNDING_NEEDED:s.funding_needed||'',FUNDING_DEPENDENCE:s.funding_dependence||'',ESTIMATED_COST:s.estimated_cost||'',FUNDING_SOURCE:s.funding_source||'',VERSION_NO:n
  });
  const pdf=versions.createFile(exportDoc_(docId,'application/pdf',base+'.pdf'));
  const docx=versions.createFile(exportDoc_(docId,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',base+'.docx'));
  return {ok:true,folderId:folder.getId(),docId:docId,pdfId:pdf.getId(),docxId:docx.getId()};
}
function getFile_(id){
  if(!id)throw new Error('driveFileId missing'); const f=DriveApp.getFileById(id); const b=f.getBlob();
  return {ok:true,fileName:f.getName(),mimeType:b.getContentType(),base64:Utilities.base64Encode(b.getBytes())};
}
function getTemplate_(){ const id=props_().getProperty('PROPOSAL_TEMPLATE_DOCX_ID'); if(!id)throw new Error('Template missing'); return getFile_(id); }


function importBlobAsGoogleDoc_(blob, parentId, name) {
  const boundary='kmsa_boundary_'+new Date().getTime();
  const metadata={name:name,mimeType:'application/vnd.google-apps.document',parents:[parentId]};
  const pre='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: '+blob.getContentType()+'\r\n\r\n';
  const post='\r\n--'+boundary+'--';
  const bytes=[].concat(Utilities.newBlob(pre).getBytes(),blob.getBytes(),Utilities.newBlob(post).getBytes());
  const r=UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'post',contentType:'multipart/related; boundary='+boundary,payload:bytes,headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  if(r.getResponseCode()>=300)throw new Error('Upload import failed: '+r.getContentText());
  return JSON.parse(r.getContentText()).id;
}
function archiveUpload_(body){
  const p=body.proposal||{}; const folder=proposalFolder_(p); const versions=getOrCreateFolder_(folder,'Versions'); const n=Number(body.versionNo||1); const base=sanitize_(p.internalId+'_V'+('00'+n).slice(-2));
  const bytes=Utilities.base64Decode(String(body.base64||'')); const mime=String(body.mimeType||'application/octet-stream'); const originalName=sanitize_(body.fileName||base); const blob=Utilities.newBlob(bytes,mime,originalName); const original=versions.createFile(blob);
  let docId='',pdfId='',docxId='';
  if(mime==='application/pdf'){pdfId=original.getId();}
  else if(mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'){
    docId=importBlobAsGoogleDoc_(blob,versions.getId(),base+' - Imported');
    pdfId=versions.createFile(exportDoc_(docId,'application/pdf',base+'.pdf')).getId();
    docxId=original.getId();
  }
  return {ok:true,folderId:folder.getId(),originalId:original.getId(),originalName:original.getName(),docId:docId,pdfId:pdfId,docxId:docxId};
}

function archiveGeneric_(body){
  const root=DriveApp.getFolderById(props_().getProperty('ARCHIVE_ROOT_FOLDER_ID'));
  const category=getOrCreateFolder_(root,sanitize_(body.category||'General Files'));
  const entity=getOrCreateFolder_(category,sanitize_((body.entityId||'entity')+' - '+(body.entityTitle||'')));
  const bytes=Utilities.base64Decode(String(body.base64||'')); const mime=String(body.mimeType||'application/octet-stream');
  const file=entity.createFile(Utilities.newBlob(bytes,mime,sanitize_(body.fileName||'attachment')));
  return {ok:true,fileId:file.getId(),fileName:file.getName(),folderId:entity.getId()};
}
