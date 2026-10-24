# تثبيت KMSA Workspace v2 على النظام الحالي

لا تنشئ مشروع Supabase أو GitHub جديدًا. هذه ترقية فوق النظام الموجود.

## 1. فك ملف التحديث فوق مجلد المشروع

في PowerShell داخل:

`C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2`

نفّذ:

```powershell
Expand-Archive -Path "$HOME\Downloads\KMSA_Workspace_v2_FINAL.zip" -DestinationPath "." -Force
```

## 2. ترقية قاعدة البيانات

افتح الملف الموجود في جذر المشروع:

`KMSA_WORKSPACE_V2_UPGRADE_ALL.sql`

انسخ محتواه كاملًا ثم افتح:

Supabase → SQL Editor → New query

الصق المحتوى واضغط Run عادي بدون RLS simulation.

إذا ظهر خطأ يقول إن هناك أكثر من سكرتير فعّال لنفس السكرتارية، صحح الحسابات أولاً من جدول `profiles` ثم أعد تشغيل الملف.

## 3. إعادة نشر Edge Functions

في PowerShell:

```powershell
npx.cmd supabase@latest functions deploy --use-api
```

## 4. رفع الكود إلى GitHub

```powershell
git add .
git commit -m "Upgrade KMSA workspace v2"
git push
```

انتظر GitHub Actions حتى يصبح أخضر.

## 5. اختبار سريع

1. ادخل كـ Admin وافتح الحسابات.
2. اجعل الحساب التجريبي سكرتيرًا وحدد السكرتارية الأكاديمية.
3. ادخل بحساب السكرتير → بوابة العضو → مساحة العمل.
4. أنشئ مشروعًا وابحث عن أي عضو كمسؤول.
5. أضف نتيجة ومحطات إنجاز وأرسل القرار إلى GS.
6. ادخل بحساب GS واعتمد القرار.
7. ادخل بحساب العضو المسؤول؛ يجب أن يظهر زر مساحة العمل والمشروع مباشرة دون طلب قبول.
8. حدّث إحدى المحطات وسجل ملاحظة/مخرج.
9. ادخل كـ السكرتير وسجل تدخلًا ثم افتح المتابعة العامة كـ GS.
10. جرّب المقترحات: PDF، حالة المسار، والفلاتر/التصدير.
