import fs from 'node:fs';
const src=(name)=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const admin=src('apps/web/src/pages/AdminPage.tsx');
const imp=src('apps/web/src/components/KmsaImportReview.tsx');
const sql=src('supabase/migrations/0019_v6_admin_safety.sql');
const workflow=src('supabase/functions/workflow/index.ts');
const cycle=src('apps/web/src/components/KmsaCycleSwitchPanel.tsx');
const tests=[
 ['No obsolete cycle activation JSX',!admin.includes("false&&cycle.status==='DRAFT'")],
 ['Safe cycle-switch UI in place',admin.includes('KmsaCycleSwitchPanel')&&cycle.includes('kmsa_switch_current_cycle')],
 ['No browser-native confirmation calls',!admin.includes('window.confirm(')],
 ['All CSV row selection is supported',admin.includes('selectedImportRows')&&imp.includes('displayed.slice(page*25')],
 ['Every selected row needs confirmed server validation',imp.includes("if(!checked)return 'checking'")&&imp.includes("checked.status==='READY'?'ready':'review'")],
 ['Selected CSV with same filename triggers fresh validation',admin.includes('fileRevision')&&admin.includes('setFileRevision(n=>n+1)')],
 ['Backend duplicate IDs checked',workflow.includes(".eq('university_id',uid)")],
 ['Old unsafe activation endpoint disabled',workflow.includes('اعتماد الدورة متاح فقط من واجهة إدارة v6 الآمنة.')],
 ['Shared initial passwords require change',workflow.includes('must_change_password:true')],
 ['Reset of other admin accounts blocked',workflow.includes("candidate.role==='ADMIN'")],
 ['Migration never deletes cycle or project data',!(/delete\s+from\s+public\.(cycles|initiatives|proposals)/i.test(sql))],
 ['Cycle switch checks original current cycle and typed confirmation',sql.includes('CYCLE_CHANGED_RELOAD')&&sql.includes('EXPLICIT_CONFIRMATION_REQUIRED')],
];
let fail=0;for(const [label,ok] of tests){console.log(`${ok?'PASS':'FAIL'} ${label}`);fail+=!ok;}console.log(`v6 integration: ${tests.length-fail}/${tests.length}`);if(fail)process.exitCode=1;
