# ابدأ من هنا

## ما الذي نبنيه؟

هذا هو **KMSA Management System**. لا تبدأ بنشر الواجهة قبل تجهيز قاعدة البيانات، لأن الواجهة مجرد باب للنظام.

## الترتيب الصحيح

1. أنشئ Supabase Project.
2. طبّق migrations بالترتيب ثم `seed.sql`.
3. أنشئ أول Admin.
4. أنشئ Google Drive Archive Folder وحضّر Proposal Template.
5. انشر Apps Script Drive Bridge.
6. انشر Supabase Edge Functions واضبط Secrets.
7. اضبط Cron لمراقبة التأخير والـBackground Jobs.
8. أنشئ GitHub Repository وارفع المشروع كاملًا.
9. ضع Supabase URL وPublishable/Anon Key في GitHub Actions Secrets.
10. فعّل GitHub Pages من GitHub Actions.
11. اختبر النظام بالأدوار المختلفة قبل إدخال الداتا الحقيقية.
12. عند استلام داتا المستخدمين، استوردها ثم أعط كل شخص كلمة مرور أولية مختلفة؛ أول دخول يجبره على تغييرها.

اقرأ `DEPLOYMENT_AR.md` للخطوات التفصيلية.
