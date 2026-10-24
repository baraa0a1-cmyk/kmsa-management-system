# تثبيت Workspace v1 على النظام الحالي

نفّذ بالترتيب فقط.

## 1) استبدال الملفات
فك `KMSA_Workspace_v1.zip` داخل جذر مشروعك الحالي ووافق على Replace.

PowerShell من داخل مجلد المشروع:

```powershell
Expand-Archive -Path "$HOME\Downloads\KMSA_Workspace_v1.zip" -DestinationPath "." -Force
```

## 2) ترقية قاعدة البيانات
في Supabase:

`SQL Editor → New query`

افتح `KMSA_WORKSPACE_UPGRADE.sql` من جذر المشروع، انسخ محتواه كاملًا، ثم **Run normally / بدون RLS simulation**.

إذا ظهر `Success. No rows returned` فانتقل للخطوة التالية.

## 3) نشر Edge Functions
في PowerShell داخل المشروع:

```powershell
npx.cmd supabase@latest functions deploy --use-api
```

## 4) GitHub

```powershell
git add .
git commit -m "Add KMSA execution workspace"
git push
```

انتظر حتى يصبح GitHub Action أخضر.

## 5) الاختبار الأول
استخدم حساب `secretary.test@example.com` وحساب `head.test@example.com`:

1. السكرتير: بوابة العضو → مساحة العمل → المشاريع والنتائج → مشروع جديد.
2. اكتب النتيجة ومعيار النجاح والموعد واختر رئيس المكتب/اللجنة.
3. رئيس المكتب: مساحة العمل → يراجع التكليف ويقبله أو يعيده للتعديل.
4. بعد القبول: الطرفان يضعان Milestones.
5. اطلب صلاحية خاصة وجرب مسار الموافقات.
6. السكرتير يفعّل المشروع.
7. رئيس المكتب يحدث الواقع، يسجل عائقًا/طلب دعم، ويرفع Evidence.
8. السكرتير يسجل Intervention قبل التأخير ويتحقق من الإنجاز.
9. بعد ذلك اختبر GS/PRESIDENT من صفحة الرقابة العامة.

راجع `docs/WORKSPACE_V1_AR.md` لفهم المنطق، و`docs/TEST_CHECKLIST_AR.md` للاختبار الكامل.
