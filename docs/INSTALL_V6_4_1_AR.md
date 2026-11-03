# تثبيت إصلاح GitHub Actions v6.4.1

**لا حاجة لتنفيذ SQL أو إعادة نشر وظائف Supabase أو تسجيل الدخول من جديد.**

1. حمّل ملف `KMSA_v6_4_1_BUILD_FIX.zip` وضعه في Downloads.
2. افتح PowerShell وشغّل الأوامر التالية (إذا كان مجلد المشروع مختلفًا عدل سطر `$Project` فقط):

```powershell
$Project = "C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2"
$Zip = Join-Path $env:USERPROFILE "Downloads\KMSA_v6_4_1_BUILD_FIX.zip"
Expand-Archive -LiteralPath $Zip -DestinationPath $Project -Force
Set-Location $Project
cd apps\web
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "فشل بناء الموقع؛ لا ترفع الملفات إلى GitHub." }
cd ..\..
node scripts\v5-static-check.mjs
if ($LASTEXITCODE -ne 0) { throw "فشل فحص التوافق." }
node scripts\v6-4-check.mjs
if ($LASTEXITCODE -ne 0) { throw "فشل فحص v6.4." }
node scripts\v6-4-flow-smoke.mjs
if ($LASTEXITCODE -ne 0) { throw "فشل اختبار السلوك." }
git status
git add .github/workflows/deploy-pages.yml scripts/v5-static-check.mjs scripts/v5-followup-check.mjs scripts/v5-3-check.mjs scripts/v5-5-check.mjs scripts/v5-6-check.mjs scripts/v5-7-check.mjs
 git diff --cached --stat
 git commit -m "KMSA v6.4.1 - fix CI checks for followup"
 git push
```

مهم: في حال فشل `npm.cmd run build` في جهازك لا تواصل بقية الأوامر؛ أرسل أول سطر خطأ حقيقي يظهر قبل Exit code 1. لا تنفّذ أوامر `supabase login` أو `supabase link` لهذه الحزمة.
