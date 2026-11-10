import fs from 'node:fs';import {createRequire} from 'node:module';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const req=createRequire(new URL('../apps/web/package.json',import.meta.url));
const ts=req('typescript');
const compiled=ts.transpileModule(read('apps/web/src/features/project-flow/flowRules.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const r=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const now=Date.parse('2026-11-03T12:00:00.000Z');const at=h=>new Date(now+h*3600000).toISOString();
const ui=read('apps/web/src/features/project-flow/ProjectFlowDetail.tsx');
const home=read('apps/web/src/features/project-flow/ProjectFlowHome.tsx');
const api=read('apps/web/src/features/project-flow/flowApi.ts');
const edge=read('supabase/functions/project-flow/index.ts');
const sql=read('supabase/migrations/0027_flow_accountability_v7_1.sql');
const tests=[
 ['No-report 24h begins at project baseline',r.documentationLate(null,now,24,at(-26))],
 ['No-report at 23h is not late',!r.documentationLate(null,now,24,at(-23))],
 ['Missing baseline is unknown, not falsely accused',!r.documentationLate(null,now,24,null)],
 ['Old report at 27h is late',r.documentationLate(at(-27),now,24,at(-40))],
 ['New report takes priority over old baseline',!r.documentationLate(at(-2),now,24,at(-55))],
 ['Approved pause moves report baseline forward',!r.documentationLate(at(-28),now,24,at(-2))],
 ['Approved pause resets old check baseline',r.supervisorDueAt(at(-2),null,{created_at:at(-40),assessment:'ON_TRACK',next_review_at:null})===at(10)],
 ['Delegated check due after 12h',r.supervisorDueAt(at(-4),null,null)===at(8)],
 ['Supervisor reassignment starts new clock',r.supervisorDueAt(at(-40),at(-3),null)===at(9)],
 ['External wait beyond 7d is capped',r.supervisorDueAt(now.toString(),null,{created_at:at(0),assessment:'WAITING_EXTERNAL',next_review_at:at(24*20)})===at(24*7)],
 ['One station checked does not cover the other',r.incompleteScope(['a','b'],['a']).length===1],
 ['All selected stations count as covered',r.incompleteScope(['a','b'],['a','b']).length===0],
 ['Zero stations covered is not a full project check',r.incompleteScope(['a'],[]).length===1],
 ['Negative checks are recognized as risk',r.negativeAssessment('NO_WORK')&&r.negativeAssessment('BLOCKED')],
 ['A normal check is not a deficiency',!r.negativeAssessment('ON_TRACK')],
 ['Secretary has no penalty during grace',!r.secretaryHasMissedAction({due:at(-10),now,delegated:true})],
 ['Unresolved delegated check over 24h demands secretary decision',r.secretaryHasMissedAction({due:at(-30),now,delegated:true})],
 ['Telegram secretary contact does NOT close overdue obligation',r.secretaryHasMissedAction({due:at(-30),now,delegated:true,secretaryAction:{created_at:at(-20),review_at:at(4)}})],
 ['Direct secretary check is not deputy negligence',!r.secretaryHasMissedAction({due:at(-30),now,delegated:false})],
 ['No secretary-intervention form',!ui.includes("form==='secretary'")&&!ui.includes('تدخل السكرتير')],
 ['No standalone contact-on-Telegram write action in UI',!ui.includes("flowAction('SECRETARY_ACTION'")],
 ['Server rejects bureaucratic intervention log',edge.includes("if(action==='SECRETARY_ACTION')")&&edge.includes('410')],
 ['Single check form owns next action',ui.includes('followupText')&&ui.includes('followupDue')&&ui.includes("form==='check'")],
 ['Negative verification creates issue in single SQL transaction',sql.includes('kmsa_flow_record_check_v71')&&sql.includes('INSERT INTO public.kmsa_flow_issues')],
 ['No issue duplication for repeated checks of same open duty',sql.includes("i.status='OPEN'")&&sql.includes('v_issue IS NULL')],
 ['Only one check for same request key',sql.includes('p_request_key')&&sql.includes('SELECT id INTO v_id')],
 ['Newly active projects automatically get a baseline',sql.includes('CREATE TRIGGER kmsa_flow_v71_start_clock')],
 ['All current active stages are loaded from every result',api.includes('fetchMilestonesForResults')&&api.includes('resultIds.flatMap')],
 ['Future NOT_STARTED stages are not forced into check scope',api.includes('workStages.length?workStages')&&sql.includes('WHERE NOT EXISTS (SELECT 1 FROM work)')],
 ['Check stores selected station scope',sql.includes('milestone_ids uuid[]')&&edge.includes('p_milestone_ids:checked')],
 ['Partial checks never reset full-project legacy due clock',sql.includes('v_required <@ p_milestone_ids')],
 ['Old v6.5 supervisory clock synchronized after real full check',sql.includes('UPDATE public.project_supervision_schedule')],
 ['Old progress-review ledger synchronizes on real check',sql.includes('INSERT INTO public.milestone_supervision_events')&&sql.includes('source_activity_id')],
 ['Final results never accepted by periodic check alone',sql.includes("v_status NOT IN ('IN_PROGRESS','AT_RISK','BLOCKED')")],
 ['Final result review counts as project check without duplicate entry',sql.includes('kmsa_flow_accept_result_as_check')&&sql.includes("NEW.event_type NOT IN ('RESULT_OK','RESULT_REVISION')")],
 ['Old notification action links handled in new UI',ui.includes("action==='review'")&&ui.includes("action==='update'")&&ui.includes("/classic?")],
 ['Pause recovery resets fresh supervisor due baseline',sql.includes('kmsa_flow_baselines SET started_at=now()')&&sql.includes('NEW.pause_until_date+1')],
 ['Review window excludes days during an approved pause',!r.documentationLate(at(-50),now,24,at(-1))],
 ['New temporary pause blocks check in SQL',sql.includes('PROJECT_TEMPORARILY_PAUSED')],
 ['Approved pause extends open issue review dates',sql.includes('kmsa_flow_adjust_pause_obligations')&&sql.includes('make_interval(days=>NEW.applied_days)')],
 ['Early resume removes unused pause days',sql.includes('OLD.applied_days-NEW.applied_days')],
 ['External waiting capped to week and deadline',sql.includes("interval '7 days'")&&sql.includes('p_review_at>v_earliest')],
 ['Clear truthful per-station note on batch edits',sql.includes("v_item->>'note'")&&ui.includes('selectedCount>1?v.note.trim()')],
 ['Next steps remain per station',sql.includes("v_item->>'nextStep'")&&ui.includes('selectedCount>1?v.nextStep.trim()')],
 ['Rejected result remains editable in v7.1',ui.includes("e.event_type==='RESULT_REVISION'")&&ui.includes('editableStages')],
 ['READY results appear among active-stage review list',ui.includes("'READY_FOR_VERIFICATION'].includes(m.status)")],
 ['Accepted results require explicit secretary verification',ui.includes("workflow('MILESTONE_VERIFY'")],
 ['Progress percentage counts VERIFIED only',ui.includes("m.status==='VERIFIED'")&&api.includes('verifiedMilestones')],
 ['Project lists count all result milestones',api.includes('totalMilestones=projectStages.length')&&home.includes('e.verifiedMilestones')],
 ['Negative or missing report causes visible attention',api.includes('needsAttention')&&api.includes('reportStale||needsCheck')],
 ['Supervisor cards show more than one active stage',home.includes('e.activeMilestones.map')],
 ['Project pause not falsely labeled active',home.includes("e.paused?'متوقف مؤقتًا'")],
 ['Supervisor cannot self-review their project',edge.includes('profile.id===init.owner_id')],
 ['SQL RPC writes service-role only',sql.includes('REVOKE ALL ON FUNCTION public.kmsa_flow_record_check_v71')&&sql.includes('TO service_role')],
 ['No DROP TABLE, TRUNCATE or historical row delete',!/(DROP TABLE|TRUNCATE|DELETE FROM public\.milestones)/i.test(sql)],
 ['Required issue linked to check',sql.includes('check_id')&&sql.includes('p_issue_text')],
];
let errors=0;for(const [label,ok] of tests){console.log(`${ok?'PASS':'FAIL'} ${label}`);if(!ok)errors++}
console.log(`KMSA Flow v7.1: ${tests.length-errors}/${tests.length} checks passed`);if(errors)process.exitCode=1;
