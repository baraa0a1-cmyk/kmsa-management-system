# ملاحظات الأمان

- لا تضع `SUPABASE_SERVICE_ROLE_KEY` في GitHub Actions أو Vite env.
- `VITE_SUPABASE_ANON_KEY` / publishable key ليس سرًا؛ الحماية بواسطة RLS.
- لا تضع Telegram bot token أو Drive bridge secret في المستودع.
- كل mutation حساس يمر عبر Edge Function `workflow`.
- كل download يعاد فحص صلاحية المستخدم قبل طلب الملف من Drive.
- Apps Script Web App لا يعتمد على سرية الرابط؛ يعتمد على `BRIDGE_SECRET`.
- `admin-import-users` يقبل فقط جلسة Admin.
- كلمات السر لا تدخل جدول `profiles`.
- أوقف Public Signups إذا كان النظام سيعتمد قاعدة المستخدمين الرسمية.
- أنشئ Secrets طويلة وعشوائية مختلفة لكل غرض.
