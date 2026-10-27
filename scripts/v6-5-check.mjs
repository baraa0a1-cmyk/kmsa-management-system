// KMSA v6.5: project-first oversight regression, running both at repo root and apps/web.
import fs from 'node:fs';
const file=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sql=file('supabase/migrations/0024_supervision_cycle_v6_5.sql');
const wf=file('supabase/functions/workflow/index.ts');
const monitor=file('supabase/functions/scheduled-monitor/index.ts');
const ui=file('apps/web/src/pages/WorkspaceProjectPage.tsx');
const desk=file('apps/web/src/pages/WorkspaceSupervisionPage.tsx');
const overview=file('apps/web/src/lib/supervisionOverview.ts');
const ledger=file('apps/web/src/lib/projectFollowup.ts');
const api=file('apps/web/src/lib/api.ts');
const types=file('apps/web/src/lib/types.ts');
const checks=[
 ['Daily reporting schedule is exactly 24h',sql.includes('interval_hours=24')&&sql.includes("now()+interval '24 hours'")],
 ['Independent supervisor verification due every 12h',sql.includes("now()+interval '12 hours'")&&sql.includes('project_supervision_schedule')],
 ['New schedule starts at activation and follows assignment',wf.includes("kmsa_v65_ensure_supervision")&&sql.includes('supervisor_id IS DISTINCT FROM')],
 ['Supervision works without a project activity source ID',wf.includes("actionName==='PROJECT_SUPERVISION_CHECK_ADD'")&&sql.includes('CREATE TABLE public.project_supervision_checks')&&!sql.slice(sql.indexOf('CREATE TABLE public.project_supervision_checks'),sql.indexOf('CREATE INDEX kmsa_v65_checks_latest')).includes('source_activity_id')],
 ['Supervision captures explicit actual verification method',wf.includes("['TELEGRAM','OUTPUT','OTHER']")&&sql.includes('verification_method text NOT NULL')],
 ['Supervisor cannot casually self-review deputy work',wf.includes('profile.id===init.owner_id')&&wf.includes('السكرتير')],
 ['Mandatory active check has substantive note',sql.includes('length(trim(note))>=8')],
 ['Unverified work treated distinctly from no-work',wf.includes("'NO_WORK','BLOCKED','UNVERIFIED'")],
 ['Supervisor next action stays open until independently resolved',sql.includes('CREATE TABLE public.project_supervision_actions')&&wf.includes("actionName==='PROJECT_SUPERVISION_ACTION_RESOLVE'" )],
 ['Correction/new update does not automatically close earlier action',ledger.includes('positiveAfterCorrection')&&ui.includes("status==='OPEN'")],
 ['Report missing does not block independent verification',ui.includes('PROJECT_SUPERVISION_CHECK_ADD')&&ui.includes('لم يسجل المتابع تحققًا بعد')],
 ['Direct update request is available in project details',ui.includes("openAction('update-request',m)")],
 ['Repeat update request is rate limited, not permanently locked',wf.includes('6*3600000')&&wf.includes('سبق إرسال طلب إفادة')],
 ['Project can be paused for exams, priority or other necessity',sql.includes("'EXAMS','PRIORITY','OTHER'")&&ui.includes('امتحانات المسؤول')],
 ['Secretary approves pause; owner cannot directly authorize it',wf.includes("actionName==='PROJECT_PAUSE_DECIDE'")&&wf.includes('من صلاحية السكرتير')],
 ['Pause has date-only end and max 30 days',sql.includes('pause_until_date date NOT NULL')&&wf.includes('daySpan>30')],
 ['Pause decision is atomic and extends milestone deadlines',sql.includes('CREATE FUNCTION public.kmsa_v65_decide_pause')&&sql.includes('m.due_at+make_interval(days=>v_days)')],
 ['Early resumption restores unused paused days',sql.includes('CREATE FUNCTION public.kmsa_v65_end_pause')&&sql.includes('m.due_at-make_interval(days=>v_unused)')],
 ['Past pauses do not count as current pauses',overview.includes("pause.pause_until_date>=today")&&ledger.includes('pausedProjects')],
 ['Paused projects do not accept progress updates',wf.includes("actionName==='MILESTONE_PROGRESS_UPDATE'")&&wf.includes('if(await isExecutionPaused(db,init.id))')],
 ['Paused projects do not generate mandatory reminders',monitor.includes('pausedIds.has(clock.initiative_id)')],
 ['Late independent supervisor check notifies actual supervisor',monitor.includes('KMSA_V65_SUPERVISOR_CHECK')&&monitor.includes('clock.supervisor_id')],
 ['Daily report reminder is due-clock based',monitor.includes('KMSA_V65_RESPONSIBLE_CHECKIN')&&monitor.includes('milestone_followup_schedules')],
 ['Notification throttling prevents hourly cron spam',monitor.includes('recently(db,event,\'MILESTONE\'')&&monitor.includes('recently(db,event,\'INITIATIVE\'')],
 ['One project card can contain multiple active stations',desk.includes('row.active.map')&&overview.includes('activeStations')],
 ['No separate per-station supervision cards',desk.includes('key={row.project.project_id}')],
 ['Supervisor filter and late-only filter in same screen',desk.includes('جميع المشرفين')&&desk.includes('المتأخرات فقط')],
 ['Project details show immediate status and actions near top',ui.includes('v65-execution-overview')&&ui.includes('v65-main-actions')],
 ['Historical sheet remains behind disclosure',ui.includes('v64-milestone-details')&&ui.includes('<details')],
 ['Secretary can request actual supervisor verification',wf.includes("actionName==='PROJECT_SUPERVISION_REQUEST_CHECK'")&&desk.includes('PROJECT_SUPERVISION_REQUEST_CHECK')],
 ['Atomic responsible update stores progress and activity together',sql.includes('CREATE FUNCTION public.kmsa_v65_save_milestone_progress')&&sql.includes('INSERT INTO public.project_activity_entries')&&wf.includes("db.rpc('kmsa_v65_save_milestone_progress'")],
 ['Atomic RPCs are service role only',sql.includes('REVOKE ALL ON FUNCTION public.kmsa_v65_save_milestone_progress')&&sql.includes('TO service_role')],
 ['New data tables have strict RLS and no authenticated writes',sql.includes('ENABLE ROW LEVEL SECURITY')&&sql.includes('REVOKE INSERT, UPDATE, DELETE')],
 ['Archived cycles are protected by unchanged getInitiative',wf.includes("هذا المشروع يتبع دورة مؤرشفة")],
 ['Manual closure remains a separate decision',wf.includes("actionName==='PROJECT_CLOSE_DECIDE'")],
 ['Updated bundle supplies independent supervisor history',api.includes('project_supervision_checks')&&types.includes('SupervisionCheck')],
 ['CI includes v6.5 checks and fixed cwd-independent tests',file('.github/workflows/deploy-pages.yml').includes('v6-5-check.mjs')&&!file('scripts/v6-4-check.mjs').includes('process.cwd()')]
];
let fail=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)fail++}
console.log(`v6.5 safeguards ${checks.length-fail}/${checks.length}`);if(fail)process.exit(1);
