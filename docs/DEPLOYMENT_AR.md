# دليل النشر — GitHub + Supabase + Google Drive

> نفّذ الخطوات بالترتيب. لا تنشر الواجهة أولًا.

## A) Supabase

### 1. إنشاء المشروع
أنشئ Project جديدًا واحفظ:
- Project URL
- Publishable/Anon key
- Project ref

لا تضع `service_role` في GitHub أو الواجهة.

### 2. تطبيق قاعدة البيانات
من جذر المشروع، بعد تثبيت Supabase CLI وتسجيل الدخول:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

ثم شغّل محتوى `supabase/seed.sql` مرة واحدة من SQL Editor، أو عبر CLI بالطريقة التي تعتمدها.

### 3. إيقاف التسجيل العام
لأن الحسابات ستأتي من قاعدة بيانات الرابطة، عطّل Public Signups من إعدادات Auth. إنشاء الحسابات يتم إداريًا.

### 4. إنشاء أول Admin
من Supabase Dashboard:
1. Authentication → Users → Add user.
2. أنشئ حسابك ببريد وكلمة مرور.
3. انسخ UUID الخاص بالمستخدم.
4. من SQL Editor نفذ بعد استبدال القيم:

```sql
insert into public.profiles(auth_user_id,university_id,email,full_name,role,active,must_change_password)
values(
  'AUTH_USER_UUID',
  'YOUR_UNIVERSITY_ID',
  'YOUR_EMAIL',
  'اسم المدير',
  'ADMIN',
  true,
  false
);
```

## B) Google Drive Archive

### 1. Drive
أنشئ مجلدًا رئيسيًا، مثال:
`KMSA Management Archive`

انسخ Folder ID.

### 2. Template
ارفع نموذج المقترح الرسمي بصيغة DOCX إلى Drive وانسخ File ID.

يستخدم الجسر placeholders التالية إن كانت موجودة في القالب:

```text
{{INTERNAL_ID}}
{{TITLE}}
{{APPLICANT_NAME}}
{{APPLICANT_EMAIL}}
{{SECRETARIAT_NAME}}
{{PROPOSED_PERIOD}}
{{NEEDED_BY}}
{{URGENCY_REASON}}
{{PRIMARY_BENEFICIARIES}}
{{TRIGGER_REALITY}}
{{PRIMARY_BENEFIT}}
{{SECONDARY_BENEFITS}}
{{INTERVENTION}}
{{SUCCESS_CRITERION}}
{{CONTEXT_FACTORS}}
{{FUNDING_NEEDED}}
{{FUNDING_DEPENDENCE}}
{{ESTIMATED_COST}}
{{FUNDING_SOURCE}}
{{VERSION_NO}}
```

### 3. Apps Script Bridge
أنشئ Apps Script standalone project.

أضف:
- `google-apps-script/DriveBridge.gs`
- إعدادات `google-apps-script/appsscript.json`

من Project Settings → Script Properties أضف:
- `BRIDGE_SECRET`: قيمة عشوائية طويلة.
- `ARCHIVE_ROOT_FOLDER_ID`: Folder ID.
- `PROPOSAL_TEMPLATE_DOCX_ID`: Template ID.

Deploy → New deployment → Web app:
- Execute as: Me
- Who has access: Anyone

الأمان هنا ليس اعتمادًا على “Anyone”؛ كل request يجب أن يحمل `BRIDGE_SECRET` ولا يوجد secret في المتصفح.

انسخ Web App `/exec` URL.

## C) Supabase Edge Functions

### 1. Secrets
اضبط القيم التالية في Supabase Secrets:

```text
DRIVE_BRIDGE_URL=<Apps Script /exec URL>
DRIVE_BRIDGE_SECRET=<نفس BRIDGE_SECRET>
FUNCTION_INTERNAL_SECRET=<random long secret>
CRON_SECRET=<random long secret>
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_BOT_USERNAME=<username without @>
TELEGRAM_WEBHOOK_SECRET=<random long secret>
SYSTEM_BASE_URL=<GitHub Pages URL لاحقًا>
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` تكون متاحة تلقائيًا في بيئة Edge Functions على Supabase hosted.

### 2. Deploy functions

```bash
npx supabase functions deploy login-by-identifier --no-verify-jwt
npx supabase functions deploy workflow
npx supabase functions deploy document-job --no-verify-jwt
npx supabase functions deploy telegram-notify --no-verify-jwt
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy scheduled-monitor --no-verify-jwt
npx supabase functions deploy admin-import-users
```

## D) GitHub

### 1. Repository
أنشئ Repository جديدًا على GitHub، مثال:
`kmsa-management-system`

للاستخدام المجاني مع GitHub Pages اجعله Public. لا توجد أسرار في الكود المرفوع.

ارفع محتويات هذا المشروع إلى الجذر ثم push إلى `main`.

### 2. Actions Secrets
Repository → Settings → Secrets and variables → Actions → New repository secret:

```text
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

### 3. Pages
Repository → Settings → Pages → Source → GitHub Actions.

Workflow الموجود في `.github/workflows/deploy-pages.yml` سيقوم بـ:
1. تثبيت dependencies.
2. build للـReact app.
3. رفع `apps/web/dist` كـPages artifact.
4. نشره.

بعد نجاح Action سيظهر رابط شبيه:
`https://USERNAME.github.io/kmsa-management-system/`

ضع هذا الرابط في `SYSTEM_BASE_URL` في Supabase secrets ثم أعد deploy لـ`telegram-notify` إن لزم.

## E) Telegram

اضبط Webhook للبوت إلى:

```text
https://YOUR_PROJECT.supabase.co/functions/v1/telegram-webhook?secret=TELEGRAM_WEBHOOK_SECRET
```

يمكنك استخدام curl:

```bash
curl -X POST "https://api.telegram.org/botBOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR_PROJECT.supabase.co/functions/v1/telegram-webhook?secret=YOUR_SECRET"}'
```

المستخدم يضغط “ربط Telegram” من Dashboard، يحصل على deep link صالح 15 دقيقة، ثم يضغط Start في البوت.

## F) Background Jobs وSLA

شغّل `scheduled-monitor` كل دقيقة من Supabase Cron / Integrations → Cron، أو استخدم `supabase/cron.example.sql` بعد وضع القيم الصحيحة.

هذه الوظيفة:
- تعالج Word/PDF ورفع Drive.
- تعالج Telegram notifications.
- تنبه قرب المهلة.
- تنبه عند التأخير.
- تحول milestone المتأخر من NOT_STARTED/IN_PROGRESS إلى AT_RISK تلقائيًا.

## G) استيراد المستخدمين
لا تستورد الداتا قبل نجاح Checklist التجريبي.

بعدها راجع `DATA_IMPORT_AR.md`.
