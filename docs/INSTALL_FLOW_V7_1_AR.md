# تثبيت KMSA Flow v7.1 على `main`

> المتطلبات: تم تثبيت Flow v7.0 (ترحيل `0026`) وv6.5/v6.6. حافظ على نسخة احتياطية من قاعدة Supabase. لا تشغل SQL من الإصدارات السابقة مرة أخرى.

## 1. افحص النسخة الحالية وفك حزمة التحديث

احفظ ملف `KMSA_Flow_v7_1_Update.zip` في Downloads، ثم افتح PowerShell:

```powershell
$Project = 'C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2'
Set-Location $Project

git switch main
git pull origin main
git status

$Zip = Join-Path $env:USERPROFILE 'Downloads\KMSA_Flow_v7_1_Update.zip'
Expand-Archive -LiteralPath $Zip -DestinationPath $Project -Force

node scripts\enable-flow-v7-1-ci.mjs
node scripts\check-flow-v7.mjs
if ($LASTEXITCODE -ne 0) { throw 'فشل فحص Flow v7' }
node scripts\check-flow-v7-1.mjs
if ($LASTEXITCODE -ne 0) { throw 'فشل فحص Flow v7.1' }

Push-Location apps\web
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'فشل بناء الواجهة؛ توقف ولا ترفع إلى main' }
Pop-Location
```

إذا كانت الاعتماديات غير مثبتة في `apps\web`، نفّذ `npm.cmd ci` داخل هذا المجلد ثم أعد البناء. لا داعي لذلك إذا كان البناء الحالي ينجح.

## 2. قاعدة البيانات — نفذ SQL مرة واحدة

1. خذ نسخة احتياطية من قاعدة Supabase الحية. إذا استطعت، نفذ الترحيل على قاعدة تجريبية فيها محطات فعلية أولًا.
2. افتح Supabase → **SQL Editor**.
3. انسخ ملف `KMSA_FLOW_V7_1_UPGRADE.sql` كاملًا واضغط Run.
4. **تأكد من نجاح المعاملة كاملة**؛ لا تنفذ الملف مرة ثانية بعد نجاحه.

هذا الترحيل يضيف نطاق المحطات للتحقق، ويضمن بدء ساعة كل مشروع، ويضيف حفظ التحقق والمشكلة ضمن معاملة واحدة، ويضبط التوقف المؤقت، ويحفظ مراجعات المستجدات ضمن السجل القديم حتى لا تتكرر المهام.

## 3. نشر وظيفة Supabase الجديدة

بعد نجاح SQL فقط:

```powershell
Set-Location $Project
npx.cmd supabase@latest functions deploy project-flow --use-api
if ($LASTEXITCODE -ne 0) { throw 'فشل نشر project-flow؛ لا ترفع الواجهة' }
```

لا تحتاج `supabase login` أو `supabase link` مرة أخرى إذا كانت الجلسة والوصلة السابقة سليمتين. تأكد أن المشروع المربوط هو قاعدة البيانات المقصودة قبل تنفيذ SQL والنشر.

## 4. رفع التحديث إلى `main` وتشغيل GitHub Actions

```powershell
Set-Location $Project

git add .github/workflows/deploy-pages.yml

git add apps/web/src/features/project-flow/ProjectFlowDetail.tsx
git add apps/web/src/features/project-flow/ProjectFlowHome.tsx
git add apps/web/src/features/project-flow/flowApi.ts
git add apps/web/src/features/project-flow/flowRules.ts
git add apps/web/src/features/project-flow/projectFlow.css

git add supabase/functions/project-flow/index.ts
git add supabase/migrations/0027_flow_accountability_v7_1.sql

git add KMSA_FLOW_V7_1_UPGRADE.sql FLOW_V7_1_CHANGELOG_AR.md
git add docs/INSTALL_FLOW_V7_1_AR.md

git add scripts/check-flow-v7.mjs scripts/check-flow-v7-1.mjs scripts/enable-flow-v7-1-ci.mjs

git diff --cached --stat
git commit -m 'KMSA Flow v7.1 - practical followup without Telegram bureaucracy'
git push origin main
```

سيتحقق GitHub Actions من Flow v7 وv7.1 ثم يبني الموقع من `main`.

## 5. اختبارات قبول مباشرة بعد الرفع

استخدم **مسؤولًا ومشرفًا وسكرتيرًا** بمشروعات فعلية أو تجريبية:

1. ابدأ مشروعًا جديدًا دون إفادة؛ تحقق من أول استحقاق بعد 24 ساعة باستخدام ساعة اختبار، وليس انتظار يوم كامل في الإنتاج.
2. في مشروع بمحطتين نشطتين، اجعل المشرف يحدد محطة واحدة: يجب أن تبقى الأخرى غير مشمولة، ولا يختفي استحقاق المشروع كله.
3. سجّل تحققًا سلبيًا: يظهر طلب المعالجة والموعد **داخل النموذج نفسه**؛ وبعد الحفظ تظهر مشكلة مفتوحة واحدة، دون الحاجة إلى فتح نافذة «توجد مشكلة» منفصلة.
4. تواصل مع المشرف عبر تيليجرام دون تسجيل إجراء في KMSA: ينبغي ألا يختفي التأخر تلقائيًا.
5. حدّث محطتين بنتيجتين مختلفتين؛ يجب أن تحتفظ كل محطة بوصفها الصحيح.
6. أرسل نتيجة محطة للمراجعة، ثم ارفضها، وعدّلها، ثم اقبلها؛ يجب أن تبقى ظاهرة حتى الاعتماد الرسمي.
7. اختبر التوقف بسبب الامتحانات والاستئناف المبكر، مع مراجعة مواعيد المشكلات المفتوحة.
8. اختبر إشعار التقييم القديم من v6.6، والتأكد أنه يفتح نافذة الإجراء الصحيح.
9. تحقق من عدم تكرار مطالبة v6.5 بتقييم تحديث سبق أن تحققت منه عبر Flow.

**الاختبار المحلي الذي أُنجز:** TypeScript بلا أخطاء، 33/33 فحص v7 و56/56 فحص v7.1. **لم يكتمل اختبار Vite في بيئة Linux بسبب اعتماد Rollup المفقود**؛ ولذلك يجب الاعتماد على البناء عندك وGitHub Actions، مع الاختبار الحقيقي للـSQL على Supabase.

## التراجع

إذا حدث خلل في الواجهة بعد النشر، استرجع Commit التحديث عبر `git revert` ثم `git push origin main`. ترحيل SQL إضافي ولا يحذف البيانات القديمة، وليس مطلوبًا محاولة إزالته يدويًا على الفور. 
