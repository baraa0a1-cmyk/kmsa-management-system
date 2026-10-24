# KMSA — الإصدار الخامس: نظام المتابعة والتنفيذ

**ابدأ من [INSTALL_V5_AR.md](INSTALL_V5_AR.md).** هذه النسخة مبنية على الكود الذي رفعته بتاريخ 24 أكتوبر 2026، مع إصلاح أسباب فشل TypeScript وتبسيط العمل إلى مشروع/مهمة/التزام دوري/مقترح.

**أولًا:** نفذ `CHECK_V5.cmd` داخل مجلد المشروع بعد فك تحديث v5. **ثانيًا:** تحقق من قاعدة البيانات عبر `V5_PREFLIGHT_READ_ONLY.sql`، ثم انشر Edge Functions، وافحص Supabase Cron والأرشيف وRLS. **ثالثًا:** طبق اختبارات `docs/V5_ACCEPTANCE_AR.md` قبل استخدامها مؤسسيًا.

لا تُضاف شاشة لتشكيل مكاتب/لجان/هيكل إداري؛ راجع [نطاق الإصلاح](docs/V5_SCOPE_AND_LIMITATIONS_AR.md).

---

# KMSA Management System — Operating System v4

نظام متابعة وتنفيذ ومساءلة لرابطة طلاب كلية الطب — جامعة الخرطوم.

## ما هو النظام؟

ليس نظامًا للهيكلة، وليس مجرد Proposal System. مركزه هو العمل الحقيقي:

`Result → Responsible person → Continuous update → Early warning → Secretary intervention → Evidence → Institutional learning`

## مسارات العمل الأساسية

- **المشاريع:** نتيجة، مسؤول، Deadline، محطات إنجاز، تحديث دوري، دليل، عائق، تدخل وتحقق.
- **المهام السريعة:** تكليف صغير مباشر لا يحتاج Project/Milestones.
- **العمل الدوري:** استحقاقات متكررة ومخرجات مستقلة لكل شخص.
- **المقترحات:** Form أو Upload، Versions، PDF/Word، مراجعة وإجازة ومتابعة زمنية.

توجد «مناصب/صفات عمل» خفيفة فقط عندما نحتاج تطبيق نفس التزام أو اجتماع على عدة أشخاص. لا توجد محاولة لبناء Organogram تفصيلي داخل النظام.

## الرقابة الإصلاحية

- المسؤول لا ينتظر اقتراب Deadline؛ للمشروع Update cadence مستقل.
- التعثر وغياب التحديث يظهران قبل الفشل النهائي.
- تدخل السكرتير نفسه قابل للرؤية، وليس تقصير المنفذ فقط.
- GS يرى المشاريع والمهام والدوري والمقترحات والاستثناءات عبر السكرتاريات.
- لا تُكتب تقارير موازية لإعادة إدخال نفس العمل؛ التقارير تُستخرج من سجل التنفيذ.

## المستندات والأرشيف

Google Drive هو الأرشيف الدائم للمستندات. Supabase يحفظ قاعدة العمل وMetadata وFile IDs وسجل النسخ. توليد المقترحات يدعم Google Docs Master Template ثم PDF/DOCX، مع Queue مقاومة للتكرار وWatchdog للـJobs العالقة.

## المعمارية

```text
GitHub Repository
   └─ GitHub Actions → GitHub Pages (React/Vite UI)
                           │
                           ▼
                       Supabase
                 ┌─────────┼──────────┐
                 │         │          │
             PostgreSQL   Auth   Edge Functions
                 │                    │
                 │                    ├─ Notifications
                 │                    └─ Apps Script Drive Bridge
                 │                               │
                 └────────────────────────── Google Drive Archive
```

## أين أبدأ؟

- التثبيت: `INSTALL_WORKSPACE_V4_AR.md`
- فلسفة النطاق: `docs/KMSA_V4_REFORM_SCOPE_AR.md`
- اختبار الجاهزية: `docs/KMSA_ACCEPTANCE_TEST_V4_AR.md`
- تثبيت قالب المقترح: `PROPOSAL_PDF_MASTER_TEMPLATE_AR.md`

## فحص ثابت قبل النشر

يمكن تشغيل:

```bash
node scripts/v4-static-readiness.mjs
```

هذا يفحص اكتمال مكونات v4 الأساسية وتطابق SQL وعدم وجود Secret واضح في المصدر. لا يغني عن اختبار البيئة الحية.
