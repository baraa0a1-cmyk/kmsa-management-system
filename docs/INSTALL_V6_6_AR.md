# تحديث KMSA v6.6 — خطوات مختصرة

### 1. خذ نسخة احتياطية

احفظ نسخة من مشروع Git الحالي ونسخة من قاعدة Supabase. جرّب SQL على مشروع تجريبي عند الإمكان. **نفّذ `KMSA_V6_6_UPGRADE.sql` مرة واحدة فقط** من Supabase → SQL Editor بعد التأكد من أن v6.5 مثبت.

لا تشغل ملف SQL مرتين، ولا تعد تشغيل SQL من الإصدارات القديمة.

### 2. ثبت ملفات التحديث — PowerShell

ضع `KMSA_v6_6_INTERFACE_NOTIFICATIONS_UPDATE.zip` في Downloads ثم انسخ هذا النص:

```powershell
$Project = "C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2"
$Zip = Join-Path $env:USERPROFILE "Downloads\KMSA_v6_6_INTERFACE_NOTIFICATIONS_UPDATE.zip"
Expand-Archive -LiteralPath $Zip -DestinationPath $Project -Force
Set-Location $Project
Push-Location apps\web
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "فشل بناء الواجهة. لا تكمل التثبيت." }
Pop-Location
node scripts\v6-6-check.mjs
if ($LASTEXITCODE -ne 0) { throw "فشلت اختبارات v6.6. توقف." }
node scripts\v6-5-check.mjs
if ($LASTEXITCODE -ne 0) { throw "فشلت اختبارات v6.5. توقف." }
```

### 3. نشر الوظيفة والتحديث عبر GitHub

تحتاج فقط إلى إعادة نشر `workflow`، ولا تحتاج إلى `supabase login` أو `supabase link` إذا كان المشروع مربوطًا وجلسة CLI صالحة:

```powershell
Set-Location $Project
npx.cmd supabase@latest functions deploy workflow --use-api
if ($LASTEXITCODE -ne 0) { throw "تعذر نشر workflow." }

git add .github/workflows/deploy-pages.yml
 git add apps/web/src/components/AppShell.tsx apps/web/src/components/NotificationBell.tsx apps/web/src/components/KmsaDateTimePicker.tsx
 git add apps/web/src/lib/api.ts apps/web/src/pages/WorkspaceProjectsPage.tsx apps/web/src/pages/WorkspaceProjectPage.tsx apps/web/src/styles.css
 git add supabase/functions/workflow/index.ts supabase/migrations/0025_notification_resolution_v6_6.sql KMSA_V6_6_UPGRADE.sql
 git add scripts/v5-4-check.mjs scripts/v5-7-check.mjs scripts/v5-8-check.mjs scripts/v6-6-check.mjs
 git add docs/INSTALL_V6_6_AR.md V6_6_CHANGELOG_AR.md
 git diff --cached --stat
 git commit -m "KMSA v6.6 - notification resolution and project UX"
 git push
```

### 4. اختبار فعلي في المشروع

1. ارفع تحديثًا بحساب المسؤول. افحص ظهور العدد الأحمر في «متابعة الإشراف» عند وجود تقييم مطلوب من السكرتير.
2. افتح إشعار التحديث بحساب المتابع، ثم أغلق النافذة **دون تقييم**. يجب أن يظل الإشعار غير منجز.
3. افتحه مرة أخرى وسجّل التقييم. يجب أن يصبح «تمت الاستجابة» ولا يفتح الإجراء مجددًا. لاحظ أن مجرد القراءة ليس إنجازًا.
4. جرّب تحديثين متتابعين قبل التقييم؛ الإشعار القديم الذي استبدلته مراجعة التحديث الجديد يجب أن يظهر «استُبدل بتحديث أحدث».
5. افتح قائمة الإشعارات في طرف الشاشة وفي وضع الهاتف، وتأكد من ظهور النص كاملًا وقابليته للتمرير.
6. في تفاصيل المشروع، اضغط ⓘ بجوار آخر تقييم وافتح التعليق كاملًا.
7. افتح اختيار موعد التصحيح أو تغيير الموعد؛ يجب أن يظهر التقويم والوقت داخل الموقع وليس منتقي المتصفح.
8. اضغط شعار الرابطة في مساحة العمل للعودة إلى `/workspace`.

**حدود التحقق:** لا تتوفر هنا قاعدة Supabase الخاصة بك للاختبار المباشر، ولم ينجح بناء Vite محليًا بسبب اعتماد Rollup الخاص بنظام التشغيل، بينما نجح فحص TypeScript واختبارات المشروع الثابتة. لا تنشر في الإنتاج قبل اختبار قاعدة تجريبية إن أمكن.
