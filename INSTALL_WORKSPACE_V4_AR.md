# ترقية KMSA Operating System v4

هذه النسخة تركز على المتابعة والإنجاز، ولا تحاول تحويل الهيكلة واللوائح إلى بيروقراطية رقمية.

## ماذا تضيف v4؟

- مهام سريعة للأعمال الصغيرة التي لا تستحق مشروعًا كاملًا.
- مناصب/صفات عمل خفيفة فقط عندما نحتاج تطبيق التزام دوري أو اجتماع على عدة أشخاص.
- التزامات دورية مستقلة لكل شخص، حتى لو كانت القاعدة مشتركة.
- تغيير دورية الالتزام أو الاجتماع مستقبلًا دون حذف التاريخ السابق.
- اجتماع جماعي واحد مع حضور مستقل لكل شخص ومخرجات فعلية للاجتماع.
- تحسين مسار المقترحات: إنشاء/رفع من مساحة العمل، تنزيل النموذج مباشرة، PDF وWord، وتعديل البنود أو رفع نسخة جديدة.
- أولوية أعلى لتوليد مستندات المقترحات، مع منع التكرار واسترداد Jobs العالقة.
- مركز تنبيهات داخل النظام مرتبط بأفعال مطلوبة، لا إشعارات عامة.
- واجهة سكرتير تبدأ بما يحتاج الانتباه الآن، وControl Tower للسكرتير العام.
- تقارير رسمية PDF/طباعة، مع CSV كبيانات خام فقط.
- شاشة سلامة تشغيلية للقيادة، ومعيار قبول رسمي قبل إعلان النظام جاهزًا.

## قبل البدء

يُفترض أن Workspace v3 مطبق على قاعدة البيانات الحالية. ملف v4 هو ترقية فوقه ولا يعيد إنشاء النظام من الصفر.

## 1) فك التحديث فوق المشروع الحالي

افتح PowerShell داخل:

`C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2`

ثم:

```powershell
Expand-Archive -Path "$HOME\Downloads\KMSA_Workspace_v4_FINAL.zip" -DestinationPath "." -Force
```

## 2) ترقية قاعدة البيانات

افتح الملف:

`KMSA_WORKSPACE_V4_UPGRADE_ALL.sql`

انسخ محتواه كاملًا، ثم:

Supabase → SQL Editor → New query → Paste → Run

تشغيل عادي، وليس RLS simulation.

المتوقع عند النجاح:

`Success. No rows returned`

## 3) إعادة نشر Edge Functions

من PowerShell داخل المشروع:

```powershell
npx.cmd supabase@latest functions deploy --use-api
```

## 4) تحديث Google Drive Bridge

افتح مشروع Apps Script الذي تستخدمه كـ KMSA Drive Archive Bridge.

استبدل محتوى `Code.gs` بمحتوى:

`google-apps-script\DriveBridge.gs`

ثم:

Deploy → Manage deployments → Edit → New version → Deploy

لا تغيّر رابط الـ `/exec` ما دمت تعدل الـdeployment الحالي نفسه.

لثبات شكل PDF راجع:

`PROPOSAL_PDF_MASTER_TEMPLATE_AR.md`

ويُفضّل ضبط Script Property:

`PROPOSAL_TEMPLATE_GOOGLE_DOC_ID`

على نسخة Google Docs المعتمدة بصريًا من النموذج الرسمي، مع إبقاء `PROPOSAL_TEMPLATE_DOCX_ID` لتحميل نموذج Word وFallback.

## 5) رفع الواجهة إلى GitHub

```powershell
git add .
git commit -m "Upgrade KMSA operating system v4"
git push
```

انتظر GitHub Actions حتى يصبح أخضر، ثم Hard Refresh للموقع.

## 6) لا تعتبر النظام جاهزًا بعد النشر مباشرة

بعد نجاح النشر افتح:

`docs/KMSA_ACCEPTANCE_TEST_V4_AR.md`

ونفذ اختبارات القبول الحرجة على البيئة الحية. نجاح Build يعني أن النسخة نُشرت؛ لا يعني أن النظام الإصلاحي اجتاز الاختبار المؤسسي.

## 7) أول Smoke Test بعد التثبيت

1. السكرتير الأكاديمي يسند مهمة سريعة لشخص.
2. ينشئ منصب/صفة «أمين أكاديمي»، ويسندها لشخصين بنطاقين مختلفين.
3. يضيف تقريرًا دوريًا مشتركًا؛ يجب أن يظهر استحقاق مستقل لكل شخص.
4. يضيف اجتماعًا دوريًا؛ يجب أن تظهر قائمة حضور مستقلة لكل شخص.
5. يغير دورية التقرير والاجتماع؛ يجب أن يتغير المستقبل فقط.
6. يرسل Proposal من Workspace دون الرجوع لبوابة العضو.
7. يتأكد أن PDF/Word يظهران وأن حالة التوليد لا تبقى عالقة.
8. GS يفتح المتابعة العامة ويرى المشاريع والمهام والدوري والمقترحات والاستثناءات.

إذا فشل أي بند، سجله قبل إضافة Features جديدة.

## فحص ثابت اختياري قبل Git Push

```powershell
node scripts/v4-static-readiness.mjs
```

المتوقع في هذه الحزمة: `38/38 static readiness checks passed.`
