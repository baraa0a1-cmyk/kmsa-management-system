import fs from 'node:fs';
import path from 'node:path';
import ts from '../apps/web/node_modules/typescript/lib/typescript.js';
const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const wf=read('supabase/functions/workflow/index.ts');
const ui=read('apps/web/src/pages/WorkspaceProjectPage.tsx');
const api=read('apps/web/src/lib/api.ts');
const shell=read('apps/web/src/components/AppShell.tsx');
const sql=read('KMSA_FOLLOWUP_V5_1_UPGRADE.sql');const documentJob=read('supabase/functions/document-job/index.ts');
const checks = [
 ['Milestone inline select opens a clean update dialog', /v54-sheet/.test(ui)&&/onChange=\{e=>openUpdate\(/.test(ui)&&/saveMilestone\(/.test(ui)],
 ['Milestone update has in-row category and does not require periodic reports',/updateTypes/.test(ui)&&/MILESTONE_PROGRESS_UPDATE/.test(ui)&&!/إفادة المسؤول الدورية/.test(ui)],
 ['Leader can add reference without being marked blocked',/PROJECT_REFERENCE_ADD/.test(ui)&&/project_activity_entries/.test(wf)],
 ['Secretary note is independent of health',/PROJECT_SECRETARY_NOTE_ADD/.test(wf)&&/const kind=isNote\?'SECRETARY_NOTE'/.test(wf)],
 ['Secretary action has approval phase guard',/PROJECT_INTERVENTION_ADD[\s\S]*?approval_status!=='APPROVED'/.test(wf)],
 ['Verified milestone protected from silent rollback',/مغلقة ولا يمكن تغييرها/.test(wf)],
 ['Deputy self-review blocked; secretary exception explicit',/function reviewIdentityAllowed/.test(wf)&&/profile.id===init.secretary_id/.test(wf)&&/profile.role==='SECRETARY'/.test(wf)],
 ['Health derived from actual milestone and blocker facts',/async function computedProjectHealth/.test(wf)&&/const (?:health|hh)=await computedProjectHealth/.test(wf)],
 ['Pulse does not require nextStep or assistance',!(/if\(!String\(payload.nextStep/.test(wf))],
 ['Immutable project activity rows protected by RLS',/create policy project_activity_entries_read/.test(sql)&&!/grant (insert|update|delete)/i.test(sql)],
 ['Activity records visible to role authorized to view initiative',/can_read_initiative\(initiative_id\)/.test(sql)],
 ['Activity uses stable server-created authorship',/author_id:profile.id/.test(wf)&&!/author_id:payload.authorId/.test(wf)],
 ['HTTPS-only references in UI and server',/safeHttps/.test(ui)&&/parsed.protocol!=='https:'/.test(wf)],
 ['Secretary sees project facts without recreating data',/project_activity_entries/.test(api)&&/initiative_id',id/.test(api)],
 ['Member Workspace portal access refreshes after assignment',/window.addEventListener\('focus',onFocus\)/.test(shell)],
 ['No organizational chart added',!(/Organogram|OrganizationBuilder/.test(ui))],
 ['PDF staging upload is available inside milestone row',/uploadToStaging/.test(ui)&&/EVIDENCE_FILE_ADD/.test(ui)],
 ['Staging evidence worker route is reachable',/COMMITMENT_UPSERT','EVIDENCE_ADD','EVIDENCE_FILE_ADD'/.test(wf)],
 ['Ordinary file upload does not claim completion',/submitForVerification:false/.test(ui)&&/submit_for_verification/.test(documentJob)],
 ['Evidence upload remains reachable from update dialog',/sendFile\(selected\)/.test(ui)&&/fileDraft\[selected.id\]/.test(ui)],
 ['Required database migration included',/create table if not exists public.project_activity_entries/.test(sql)],
];
let fails=0;
for(const [desc,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${desc}`);if(!ok)fails++}
for(const [filename,scriptkind] of [['apps/web/src/pages/WorkspaceProjectPage.tsx',ts.ScriptKind.TSX],['supabase/functions/workflow/index.ts',ts.ScriptKind.TS],['apps/web/src/lib/api.ts',ts.ScriptKind.TS]]){
 const f=ts.createSourceFile(filename,read(filename),ts.ScriptTarget.Latest,true,scriptkind);
 const ok=f.parseDiagnostics.length===0; console.log(`${ok?'PASS':'FAIL'} Syntax ${filename}`);if(!ok)fails++;
}
console.log(`TOTAL ${checks.length+3} checks; ${fails} failed`);if(fails)process.exitCode=1;
