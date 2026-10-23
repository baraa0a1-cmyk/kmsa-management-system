# طريقة العمل بعد الإطلاق

GitHub هو مصدر الكود الوحيد.

```text
تعديل الكود
→ git commit
→ git push origin main
→ GitHub Actions يبني الموقع
→ GitHub Pages ينشر النسخة الجديدة
```

لا ترفع ZIP إلى استضافة يدوية عند كل تعديل.

قاعدة البيانات لها migrations داخل `supabase/migrations`. أي تغيير Schema يجب أن يكتب Migration جديدة بدل تعديل قاعدة الإنتاج يدويًا بلا سجل.
