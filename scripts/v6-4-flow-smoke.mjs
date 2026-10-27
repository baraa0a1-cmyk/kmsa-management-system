/** Simulated data-flow tests. No live Supabase or credentials required. */
import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
// Make the smoke test portable across repository root and apps/web execution.
const ts = createRequire(new URL('../apps/web/package.json',import.meta.url))('typescript');
const original=fs.readFileSync(new URL('../apps/web/src/lib/projectFollowup.ts',import.meta.url),'utf8');
const transpiled=ts.transpileModule(original,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
let db={};
const query=(table)=>{
 const conditions=[];let order='created_at';let desc=true;
 const q={
  select(){return q},in(field,values){conditions.push(r=>values.includes(r[field]));return q},eq(field,val){conditions.push(r=>r[field]===val);return q},not(field,op,val){if(op==='is'&&val===null)conditions.push(r=>r[field]!==null);return q},
  order(field,{ascending=false}={}){order=field;desc=!ascending;return q},
  range(first,last){let rows=(db[table]||[]).filter(r=>conditions.every(f=>f(r)));rows.sort((a,b)=>{const x=a[order],y=b[order];return desc?String(y).localeCompare(String(x)):String(x).localeCompare(String(y))});return Promise.resolve({data:rows.slice(first,last+1),error:null})}
 };return q;
};
const supabase={from:table=>query(table)};
const mod={exports:{}};const runner=vm.runInNewContext(`(function(require,module,exports){${transpiled}\n})`,{Date,Map,Set,Math,Number,console});
runner(name=>{if(name==='./supabase')return {supabase};throw new Error('Unexpected require '+name)},mod,mod.exports);
const {loadProjectFollowup,reviewerGraceHours}=mod.exports;
const now=Date.now();const iso=(hours)=>new Date(now+hours*3600e3).toISOString();
const p={project_id:'p1',secretariat_id:'secret',project_title:'تجربة متابعة',setup_status:'ACTIVE',approval_status:'APPROVED',project_status:'ACTIVE',lifecycle_state:'ACTIVE',lead_id:'lead',secretary_id:'sec',secretary_name:'سكرتير'};
const test=async(name,setup,validate)=>{
 db={project_supervision_assignments:[],milestone_followup_schedules:[],results:[{id:'r1',initiative_id:'p1',created_at:iso(-80)}],milestones:[{id:'m1',result_id:'r1',title:'محطة 3 أيام',status:'IN_PROGRESS',design_status:'APPROVED',due_at:iso(12),sequence_no:1}],project_activity_entries:[],milestone_supervision_events:[],project_supervision_followups:[]};
 setup(db);const result=await loadProjectFollowup([p],'sec');const okay=validate(result.items[0],result);
 if(!okay)throw new Error('FAILED: '+name+'; '+JSON.stringify(result.items[0]));
 console.log('PASS '+name);
};
await test('Missed checkpoint causes missing-report action',d=>{d.milestone_followup_schedules=[{milestone_id:'m1',initiative_id:'p1',interval_hours:24,next_due_at:iso(-2),last_report_at:null}]},x=>x.issue==='NO_REPORT'&&x.secretaryAction==='REQUEST_UPDATE');
await test('Upcoming station does not demand an update',d=>{d.milestones[0].status='NOT_STARTED'},x=>x.issue==='PLANNED'&&!x.secretaryAction);
await test('Submitted checkin awaiting deputy review triggers action at adaptive 6h window',d=>{d.project_supervision_assignments=[{initiative_id:'p1',supervisor_id:'deputy',assigned_at:iso(-60),supervisor:{full_name:'النائب'}}];d.project_activity_entries=[{id:'u1',initiative_id:'p1',milestone_id:'m1',kind:'MILESTONE_UPDATE',created_at:iso(-8),note:'تم جمع المصادر',status_after:'IN_PROGRESS'}];d.milestone_followup_schedules=[{milestone_id:'m1',initiative_id:'p1',interval_hours:24,next_due_at:iso(16),last_report_at:iso(-8)}]},x=>x.issue==='UNREVIEWED'&&x.secretaryAction==='REQUEST_REVIEW'&&x.delegated);
await test('A prior review does not approve a newer update',d=>{d.project_supervision_assignments=[{initiative_id:'p1',supervisor_id:'deputy',assigned_at:iso(-60),supervisor:{full_name:'النائب'}}];d.project_activity_entries=[{id:'u2',initiative_id:'p1',milestone_id:'m1',kind:'MILESTONE_UPDATE',created_at:iso(-9),note:'الجديد',status_after:'IN_PROGRESS'},{id:'u1',initiative_id:'p1',milestone_id:'m1',kind:'MILESTONE_UPDATE',created_at:iso(-14),note:'القديم',status_after:'IN_PROGRESS'}];d.milestone_supervision_events=[{id:'rv',milestone_id:'m1',initiative_id:'p1',source_activity_id:'u1',actor_id:'deputy',event_type:'PROGRESS_OK',created_at:iso(-12)}];d.milestone_followup_schedules=[{milestone_id:'m1',initiative_id:'p1',interval_hours:24,next_due_at:iso(16),last_report_at:iso(-9)}]},x=>x.update?.id==='u2'&&!x.review&&x.secretaryAction==='REQUEST_REVIEW');
await test('After two ignored reminders, secretary escalation is due',d=>{d.project_supervision_assignments=[{initiative_id:'p1',supervisor_id:'deputy',assigned_at:iso(-80),supervisor:{full_name:'النائب'}}];d.project_activity_entries=[{id:'u1',initiative_id:'p1',milestone_id:'m1',kind:'MILESTONE_UPDATE',created_at:iso(-50),note:'تم جمع المصادر',status_after:'IN_PROGRESS'}];d.milestone_followup_schedules=[{milestone_id:'m1',initiative_id:'p1',interval_hours:24,next_due_at:iso(6),last_report_at:iso(-50)}];d.project_supervision_followups=[1,2].map(attempt=>({id:'f'+attempt,initiative_id:'p1',source_activity_id:'u1',delegated_supervisor_id:'deputy',review_request_attempt:attempt,followup_due_at:iso(-2),created_at:iso(-12)}))},x=>x.secretaryAction==='ESCALATE');
await test('Corrective action remains visible until check-in or new evaluation',d=>{d.project_activity_entries=[{id:'u1',initiative_id:'p1',milestone_id:'m1',kind:'MILESTONE_UPDATE',created_at:iso(-16),note:'تقدم ضعيف',status_after:'IN_PROGRESS'}];d.milestone_supervision_events=[{id:'r1',initiative_id:'p1',milestone_id:'m1',actor_id:'sec',source_activity_id:'u1',event_type:'PROGRESS_FOLLOW_UP',note:'المسودة غدًا',correction_due_at:iso(4),created_at:iso(-15)}];d.milestone_followup_schedules=[{milestone_id:'m1',initiative_id:'p1',interval_hours:24,next_due_at:iso(12),last_report_at:iso(-16)}]},x=>x.issue==='CORRECTING'&&!x.secretaryAction);
await test('Expired correction requires secretary intervention',d=>{d.project_activity_entries=[{id:'u1',initiative_id:'p1',milestone_id:'m1',kind:'MILESTONE_UPDATE',created_at:iso(-16),note:'تقدم ضعيف',status_after:'IN_PROGRESS'}];d.milestone_supervision_events=[{id:'r1',initiative_id:'p1',milestone_id:'m1',actor_id:'sec',source_activity_id:'u1',event_type:'PROGRESS_FOLLOW_UP',note:'المسودة غدًا',correction_due_at:iso(-1),created_at:iso(-15)}];d.milestone_followup_schedules=[{milestone_id:'m1',initiative_id:'p1',interval_hours:24,next_due_at:iso(12),last_report_at:iso(-16)}]},x=>x.issue==='CORRECTION_OVERDUE'&&x.secretaryAction==='CHECK_CORRECTION');
if(reviewerGraceHours({interval_hours:24})!==6||reviewerGraceHours({interval_hours:72})!==18)throw new Error('Adaptive grace formula changed');
console.log('PASS Adaptive grace for 1-day and 3-day checkpoints');console.log('v6.4: 8/8 behavioral smoke tests passed (simulated database)');
