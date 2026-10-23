# KMSA Management System

نظام مؤسسي لإدارة عمل رابطة طلاب كلية الطب — جامعة الخرطوم.

هذه النسخة ليست Proposal System. المقترحات Module ضمن نظام أوسع يدير:

- المستخدمين والأدوار والسكرتاريات والدورات.
- الخطط ومسارات التنفيذ والنتائج.
- Milestones القابلة للتحقق.
- الالتزامات الأسبوعية من نفس سجل العمل، دون تقارير موازية.
- الأدلة، العوائق، تدخلات السكرتير، والتحقق.
- رقابة السكرتارية العامة على أداء السكرتير دون التدخل المباشر في عمل المالك.
- المقترحات من التقديم إلى القرار ثم التنفيذ.
- Versions وAudit Trail.
- الاجتماعات وسجل القرارات وتحويل القرار إلى Milestone.
- لوحة الأداء والتقرير الأسبوعي.
- Google Drive للأرشيف وWord/PDF.
- Telegram للإشعارات والمتابعة فقط.

## المبدأ التشغيلي

`Result → Milestone → Weekly Commitment → Evidence → Exception/Blocker → Secretary Intervention → Verification`

كل خطوة في هذه الحلقة محفوظة في قاعدة واحدة. التقرير الأسبوعي والـDashboard يقرآن منها مباشرة.

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
                 │                    ├─ Telegram Bot
                 │                    └─ Apps Script Drive Bridge
                 │                               │
                 └────────────────────────── Google Drive
```

لا توجد أسرار داخل GitHub Pages. المفتاح الموجود في الواجهة هو مفتاح Supabase publishable/anon المصمم للاستخدام في العميل، والحماية الفعلية بواسطة RLS والـEdge Functions.

## هيكل المشروع

- `apps/web/` الواجهة.
- `supabase/migrations/` Schema + RLS + reporting.
- `supabase/functions/` الـWorkflow والخدمات الخلفية.
- `google-apps-script/` جسر Google Drive وWord/PDF.
- `.github/workflows/` نشر GitHub Pages تلقائيًا.
- `docs/` دليل التشغيل والأدوار والاختبارات والاستيراد.

ابدأ من: `docs/START_HERE_AR.md`.
