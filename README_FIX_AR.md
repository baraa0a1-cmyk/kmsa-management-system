# KMSA v5.1 — GitHub Actions Build Fix

## المشكلة المثبتة محليًا

الاختبار القديم `scripts/v5-static-check.mjs` يفشل في اختبارين بعد تحديث v5.1:
1. يبحث عن اسم متغير وصياغة قديمة لفحص `ON_TRACK`، بدل تحليل `computedProjectHealth` التي تتحقق فعليًا من العوائق المفتوحة والمحطات المتعثرة.
2. يبحث عن `setProjectReport` القديم، بدل `setReport` الحالي الذي لا يُصفّر إدخال المستخدم إلا بعد نجاح API.

بسبب ذلك يرجع الاختبار `exit code 1`؛ وهذا سبب كافٍ لإيقاف GitHub Actions حتى لو كان TypeScript صحيحًا.

## الحل

الملفان في هذه الحزمة يستبدلان نظيريهما في جذر مشروع v5.1:
- `scripts/v5-static-check.mjs` — تعديل اختباري الحماية ليطابقا منطق v5.1 الفعلي.
- `.github/workflows/deploy-pages.yml` — تشغيل فاحص v5.1 الإضافي قبل البناء أيضًا.

**لا توجد تغييرات على منطق الرابطة ولا SQL ولا Edge Functions ولا Google Apps Script.**

## التثبيت على Windows

1. افتح PowerShell في مجلد مشروع GitHub الذي تستخدمه.
2. خذ نسخة من الملفين إذا كنت قد عدّلتهما يدويًا.
3. فك الحزمة في جذر المشروع مع الاستبدال، مثلاً:

```powershell
Expand-Archive -Path "$HOME\Downloads\KMSA_v5_1_GitHub_Build_Fix.zip" -DestinationPath "." -Force
```

4. اختبر:

```powershell
cd apps\web
node ..\..\scripts\v5-static-check.mjs
node ..\..\scripts\v5-followup-check.mjs
npm run build
cd ..\..
```

5. إذا نجحت، ارفع التعديل:

```powershell
git add scripts/v5-static-check.mjs .github/workflows/deploy-pages.yml
git commit -m "Fix v5.1 GitHub build guardrails"
git push
```

6. افتح GitHub Actions وتأكد من نجاح **Verify v5 monitoring invariants** و**Verify v5.1 project follow-up invariants** و**Build**.

## نتائج التحقق على المصدر المرفق

- v5 static checker: ناجح بالكامل بعد الإصلاح (23 اختبارًا).
- v5.1 follow-up checker: 24/24 ناجح.
- TypeScript: ناجح دون أخطاء.
- لم يكتمل Vite build المحلي لغياب optional Rollup binary الخاص ببيئة Linux. CI يثبّت الحزم باستخدام `npm ci` على Ubuntu، وهذه خطوة تحتاج تأكيدًا من GitHub Actions.

إذا بقي Build يفشل، يجب قراءة سطر الخطأ الحقيقي داخل خطوة Build؛ `exit code 1` وحده لا يحدد خطأً آخر.
