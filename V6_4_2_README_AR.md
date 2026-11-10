# KMSA v6.4.2 — إصلاح مسارات اختبارات GitHub Actions

هذا الإصلاح لا يعدّل واجهة المستخدم أو SQL أو وظيفة Supabase.
يصلح ملفين فقط:
- scripts/v6-4-check.mjs
- scripts/v6-4-flow-smoke.mjs

المشكلة: GitHub Actions يشغّل اختبارات Node من apps/web، بينما الملفان السابقان اعتبرا مجلد التشغيل هو جذر المشروع.
الحل: تحديد المسارات بالنسبة إلى مكان ملف الاختبار نفسه عبر import.meta.url.

بعد فك الضغط فوق جذر المشروع، نفذ:

```powershell
cd "C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2"
node scripts\v6-4-check.mjs
if ($LASTEXITCODE -ne 0) { throw "Test failed" }
node scripts\v6-4-flow-smoke.mjs
if ($LASTEXITCODE -ne 0) { throw "Smoke test failed" }
cd apps\web
node ..\..\scripts\v6-4-check.mjs
if ($LASTEXITCODE -ne 0) { throw "CI static test failed" }
node ..\..\scripts\v6-4-flow-smoke.mjs
if ($LASTEXITCODE -ne 0) { throw "CI smoke test failed" }
cd ..\..
git add scripts/v6-4-check.mjs scripts/v6-4-flow-smoke.mjs
git commit -m "Fix v6.4 CI test paths"
git push
```

لا حاجة لتشغيل Supabase login/link أو SQL أو إعادة نشر Edge Functions.
تم اجتياز 16 مجموعة من اختبارات CI من داخل apps/web محليًا؛ لم يُختبر البناء النهائي على GitHub، ولا Supabase الحي.
