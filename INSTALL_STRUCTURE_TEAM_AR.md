# تثبيت تحديث الهيكلة والفريق

هذا التحديث يضيف ملف **الهيكلة والفريق** داخل مساحة عمل السكرتير دون تغيير بيانات المشاريع أو المقترحات الحالية.

## 1) فك التحديث فوق المشروع الحالي
من PowerShell داخل:

`C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2`

نفّذ:

```powershell
Expand-Archive -Path "$HOME\Downloads\KMSA_Structure_Team_v1.zip" -DestinationPath "." -Force
```

## 2) ترقية قاعدة البيانات
افتح الملف الموجود في جذر المشروع:

`KMSA_STRUCTURE_TEAM_UPGRADE.sql`

انسخ محتواه كاملًا ثم:

Supabase → SQL Editor → New query → Paste → Run عادي بدون RLS simulation.

المتوقع: `Success. No rows returned`

## 3) نشر Workflow فقط

```powershell
npx.cmd supabase@latest functions deploy workflow --use-api
```

لا تحتاج إلى تعديل Google Apps Script أو Secrets لهذا التحديث.

## 4) رفع الواجهة إلى GitHub

```powershell
git add .
git commit -m "Add flexible structure and team workspace"
git push
```

بعد أن يصبح GitHub Action أخضر، حدّث الموقع وافتح:

**مساحة العمل → الهيكل والفريق**

## اختبار سريع
1. أضف منصبًا إشرافيًا مثل «نائب السكرتير».
2. عيّن له عضوًا تجريبيًا.
3. أضف لجنة أو مكتبًا وحدد أنه يشرف عليه ذلك النائب.
4. افتح الجسم وأضف مسؤولًا وأعضاء.
5. جمّد الجسم وتأكد أنه انتقل إلى تبويب «المجمد».
6. أعد تفعيله وتأكد أنه عاد للهيكل الحالي.

لا تستخدم بيانات حقيقية قبل نجاح هذا الاختبار.
