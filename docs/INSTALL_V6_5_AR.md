# تثبيت تحديث KMSA v6.5 — تعليمات قصيرة وكاملة

## قبل النشر
- خذ نسخة احتياطية من قاعدة Supabase الحية أولاً، واختبر SQL على نسخة تجريبية إن أمكن.
- هذا التحديث يعتمد على وجود SQL الإصدار v6.4، ويضيف SQL واحدًا **مرة واحدة**: `KMSA_V6_5_UPGRADE.sql`. لا تعِد تنفيذ ملف SQL بعد نجاحه.
- فك حزمة تحديث الملفات فوق مشروع Git المحلي، وليس المجلد الكامل البديل. هذا الإصدار **لا يتطلب Supabase login أو Project Ref جديدًا** إذا كان الربط والاعتماد السابقان صحيحين.
- **ترتيب النشر:** SQL أولاً، ثم وظيفتا Supabase `workflow` و`scheduled-monitor`، ثم GitHub Pages. لا تنشر الواجهة قبل SQL.

## أ) قاعدة البيانات
افتح Supabase Dashboard → SQL Editor والصق محتوى `KMSA_V6_5_UPGRADE.sql`، ثم Run. تأكد من نجاح التنفيذ بالكامل.

## ب) استبدال الملفات والبناء
نزّل `KMSA_v6_5_SUPERVISION_UPDATE.zip` إلى Downloads ثم شغّل PowerShell:

```powershell
$Project = 'C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2'
$Zip = Join-Path $env:USERPROFILE 'Downloads\KMSA_v6_5_SUPERVISION_UPDATE.zip'
Expand-Archive -LiteralPath $Zip -DestinationPath $Project -Force
Set-Location $Project

Push-Location apps\web
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'فشل بناء الموقع؛ لا ترفع الملفات' }
node ..\..\scripts\v6-5-check.mjs
if ($LASTEXITCODE -ne 0) { throw 'فشل فحص v6.5' }
node ..\..\scripts\v6-4-check.mjs
if ($LASTEXITCODE -ne 0) { throw 'فشل فحص v6.4' }
node ..\..\scripts\v6-4-flow-smoke.mjs
if ($LASTEXITCODE -ne 0) { throw 'فشل محاكاة المتابعة' }
Pop-Location
```

إذا لم يكن `node_modules` موجودًا أصلًا، شغّل `npm.cmd ci` مرة واحدة داخل `apps\web` قبل البناء. لا يلزم إعادة تثبيت الاعتماديات إن كانت موجودة.

## ج) نشر وظيفتي Supabase — باستخدام الربط السابق

```powershell
Set-Location $Project
npx.cmd supabase@latest functions deploy workflow --use-api
if ($LASTEXITCODE -ne 0) { throw 'لم تنجح وظيفة workflow' }
npx.cmd supabase@latest functions deploy scheduled-monitor --use-api
if ($LASTEXITCODE -ne 0) { throw 'لم تنجح وظيفة scheduled-monitor' }
```

لا تستخدم أمر `supabase login` أو `supabase link` إلا إن طلب CLI ذلك صراحة بسبب فقدان الجلسة أو الربط. يجب أن تكون جدولة `scheduled-monitor` مفعلة بالفعل في مشروع Supabase لكي تصل تنبيهات المواعيد دون فتح الموقع.

## د) GitHub — الأوامر كاملة

```powershell
Set-Location $Project
git status
git add .github/workflows/deploy-pages.yml
git add apps/web/src/lib/api.ts apps/web/src/lib/types.ts apps/web/src/lib/projectFollowup.ts apps/web/src/lib/supervisionOverview.ts
git add apps/web/src/pages/WorkspaceProjectPage.tsx apps/web/src/pages/WorkspaceProjectsPage.tsx apps/web/src/pages/WorkspaceSupervisionPage.tsx apps/web/src/pages/WorkspaceHomePage.tsx apps/web/src/styles.css
git add supabase/functions/workflow/index.ts supabase/functions/scheduled-monitor/index.ts supabase/migrations/0024_supervision_cycle_v6_5.sql
git add scripts/v5-static-check.mjs scripts/v5-followup-check.mjs scripts/v5-2-check.mjs scripts/v5-3-check.mjs scripts/v5-5-check.mjs scripts/v5-6-check.mjs scripts/v5-7-check.mjs scripts/v6-4-check.mjs scripts/v6-4-flow-smoke.mjs scripts/v6-5-check.mjs
git add KMSA_V6_5_UPGRADE.sql V6_5_CHANGELOG_AR.md docs/INSTALL_V6_5_AR.md
git diff --cached --stat
git commit -m 'KMSA v6.5 - project supervision and temporary pause'
git push
```

إذا كانت البيئة تحت GitHub Pages وانتقل بناء Actions إلى الأخطاء، افتح آخر تشغيل واطلع على أول خطأ فعلي قبل `exit code 1`.

## هـ) سيناريو اختبار واقعي (ثلاثة حسابات)
1. مشروع باثنتين من المحطات الجاريتين مع مسؤول ومشرف مفوض وسكرتير.
2. لم يرسل المسؤول شيئًا: أدخل بحساب المشرف، وافتح المشروع وسجل «لم يبدأ العمل» من دون انتظار تحديث.
3. أدخل بحساب المسؤول، وقدم إفادة تشمل ما تحقق والخطوة التالية؛ تحقق من موعد الإفادة التالية 24 ساعة.
4. تحقق من موعد المشرف 12 ساعة على **المشروع نفسه**، لا بطاقة منفصلة لكل محطة.
5. بعد التواصل في تيليجرام، سجل توجيهًا وموعد مراجعة؛ قدم إفادة أحدث دون إنهاء التوجيه؛ تحقق من بقائه حتى يضغط المشرف «التحقق من التنفيذ» ويسجل نتيجة واضحة.
6. طلب توقف بسبب امتحانات وعدم وجود بديل، ثم اعتماد السكرتير؛ تحقق من توقف المطالبات وإزاحة مواعيد الإنجاز، ثم استئناف مبكر إن لزم.
7. اختبر كل زر من الحساب المخول به، ولا تُعد العمل المحفوظ مرفوضًا قبل مراجعة سجل المشروع.

## القيود الحالية
لا تدعي الحزمة أنها اختُبرت على بيانات Supabase الحية؛ خذ نسخة احتياطية واعتمد اختبارًا تجريبيًا قبل نشرها لجميع سكرتاريات الرابطة.
