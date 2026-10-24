import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const candidates = [process.cwd(), path.resolve(scriptDir, '..')];
const root = candidates.find((p) => fs.existsSync(path.join(p, 'apps', 'web', 'src')));
if (!root) {
  console.error('❌ لم أجد مجلد المشروع. شغّل الملف من داخل KMSA_Management_System_GitHub_v2 أو ضع مجلد الإصلاح داخله.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(root, `KMSA_FIX18_BACKUP_${stamp}`);
fs.mkdirSync(backupRoot, { recursive: true });

const changed = [];
const warnings = [];

function patch(rel, transforms) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    warnings.push(`${rel}: الملف غير موجود`);
    return;
  }
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  for (const t of transforms) {
    const before = src;
    if (t.regex) src = src.replace(t.regex, t.to);
    else src = src.split(t.from).join(t.to);
    if (before === src) warnings.push(`${rel}: لم أجد النمط: ${t.label}`);
  }
  if (src !== original) {
    const backup = path.join(backupRoot, rel);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.writeFileSync(backup, original, 'utf8');
    fs.writeFileSync(file, src, 'utf8');
    changed.push(rel);
  }
}

patch('apps/web/src/components/AppShell.tsx', [
  {
    label: 'تاريخ الإشعار الآمن',
    from: "new Intl.DateTimeFormat('ar-SD',{dateStyle:'short',timeStyle:'short'}).format(new Date(n.created_at))",
    to: "n.created_at?new Intl.DateTimeFormat('ar-SD',{dateStyle:'short',timeStyle:'short'}).format(new Date(n.created_at)):'—'"
  }
]);

patch('apps/web/src/pages/WorkspaceHomePage.tsx', [
  {
    label: 'status اختياري في attention',
    regex: /\.includes\(t\.status\)/g,
    to: ".includes(t.status||'')"
  },
  {
    label: 'days_to_due قد يكون undefined',
    from: "t.days_to_due!==null&&t.days_to_due<=1",
    to: "typeof t.days_to_due==='number'&&t.days_to_due<=1"
  }
]);

patch('apps/web/src/pages/WorkspaceOversightPage.tsx', [
  {
    label: 'status اختياري في إحصاءات المهام',
    regex: /\.includes\(x\.status\)/g,
    to: ".includes(x.status||'')"
  },
  {
    label: 'status اختياري في فلترة المهام',
    regex: /\.includes\(r\.status\)/g,
    to: ".includes(r.status||'')"
  },
  {
    label: 'فهرسة taskStatus الآمنة',
    from: "taskStatus[r.status]||r.status",
    to: "(taskStatus as Record<string,string>)[r.status||'']||r.status||'—'"
  }
]);

patch('apps/web/src/pages/WorkspaceReportsPage.tsx', [
  {
    label: 'status اختياري في ملخص المهام',
    regex: /\.includes\(x\.status\)/g,
    to: ".includes(x.status||'')"
  }
]);

patch('apps/web/src/pages/WorkspaceRoutinePage.tsx', [
  {
    label: 'إعادة فتح منصب فقط عند وجود id',
    from: "if(reopenPosition&&selectedPosition)await openPosition(selectedPosition.position_id)",
    to: "if(reopenPosition&&selectedPosition?.position_id)await openPosition(selectedPosition.position_id)"
  },
  {
    label: 'فتح بطاقة منصب فقط عند وجود id',
    from: "onClick={()=>openPosition(p.position_id)}",
    to: "onClick={()=>{if(p.position_id)void openPosition(p.position_id)}}"
  },
  {
    label: 'عنوان الالتزام الاختياري',
    from: "title:d.title,description:d.description||'',expectedOutput:d.expected_output||'',intervalDays:d.interval_days,firstDueAfterDays:d.first_due_after_days",
    to: "title:d.title||'',description:d.description||'',expectedOutput:d.expected_output||'',intervalDays:d.interval_days??7,firstDueAfterDays:d.first_due_after_days??7"
  },
  {
    label: 'عنوان/فترة الاجتماع الاختيارية',
    from: "title:x.title,description:x.description||'',intervalDays:x.interval_days,nextEventAt:x.next_event_at?new Date(x.next_event_at).toISOString().slice(0,16):''",
    to: "title:x.title||'',description:x.description||'',intervalDays:x.interval_days??30,nextEventAt:x.next_event_at?new Date(x.next_event_at).toISOString().slice(0,16):''"
  }
]);

patch('apps/web/src/pages/WorkspaceTasksPage.tsx', [
  {
    label: 'status اختياري في فلترة المهام',
    regex: /\.includes\(r\.status\)/g,
    to: ".includes(r.status||'')"
  },
  {
    label: 'fallback لحالة المهمة عند التحرير',
    from: "setUpdate({status:r.status,assigneeNote:",
    to: "setUpdate({status:r.status||'NOT_STARTED',assigneeNote:"
  },
  {
    label: 'فهرسة أولوية المهمة الآمنة',
    from: "priorityLabel[r.priority]||r.priority",
    to: "(priorityLabel as Record<string,string>)[r.priority||'']||r.priority||'—'"
  },
  {
    label: 'فهرسة حالة المهمة الآمنة',
    from: "statusLabel[r.status]||r.status",
    to: "(statusLabel as Record<string,string>)[r.status||'']||r.status||'—'"
  }
]);

console.log(`✅ تم تعديل ${changed.length} ملفات:`);
for (const f of changed) console.log(`   - ${f}`);
console.log(`\n🛟 النسخ الاحتياطية: ${backupRoot}`);
if (warnings.length) {
  console.log('\n⚠️ ملاحظات (قد تعني أن نسخة الملف لديك مختلفة قليلًا):');
  for (const w of warnings) console.log(`   - ${w}`);
}
console.log('\nالخطوة التالية:');
console.log('  cd apps\\web');
console.log('  npm.cmd run build');
