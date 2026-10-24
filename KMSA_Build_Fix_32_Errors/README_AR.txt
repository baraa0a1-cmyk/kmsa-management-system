KMSA — Build Fix for the 32 TypeScript errors
==============================================

هذا الإصلاح لا يستبدل صفحات Workspace الأحدث عندك ولا يرجع المشروع إلى نسخة أقدم.
هو يصلح طبقة الربط الناقصة فقط في:
- apps/web/src/lib/types.ts
- apps/web/src/lib/api.ts

طريقة الاستخدام:
1) فك الضغط داخل المجلد الرئيسي:
   C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2

2) افتح PowerShell داخل المجلد الرئيسي وشغّل:
   node .\apply_kmsa_build_fix.mjs

3) ثم:
   cd apps\web
   npm.cmd run build

السكريبت ينشئ نسخة احتياطية تلقائيًا من api.ts و types.ts قبل التعديل.
