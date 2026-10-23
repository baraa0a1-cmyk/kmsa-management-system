# معمارية النظام

## 1. الواجهة
React + TypeScript + Vite، عربية RTL، Responsive، منشورة كStatic App على GitHub Pages.

الواجهة لا تحتوي service role ولا Telegram token ولا Drive secret.

## 2. الهوية
Supabase Auth هو المصدر الوحيد لكلمات السر والجلسات.

الدخول بحقل موحد:
- إذا كانت القيمة بريدًا إلكترونيًا: تسجيل دخول بالبريد.
- إذا كانت رقمًا جامعيًا: Edge Function تحل الرقم إلى البريد داخليًا ثم تتحقق من نفس كلمة السر.

`profiles` يخزن الرقم الجامعي والاسم والدور والسكرتارية، لكنه لا يخزن كلمة السر.

## 3. الصلاحيات
أدوار النظام:
- `APPLICANT`: المقترحات الخاصة به فقط.
- `MEMBER`: العمل داخل سكرتاريته + مقترحاته.
- `SECRETARY`: متابعة سكرتاريته، تدخلات، تحقق، مراجعة المقترحات.
- `GS`: قراءة شاملة ورقابة وقرارات المقترحات، دون تنفيذ تدخلات السكرتير أو تحقق Milestones بدلًا عنه.
- `ADMIN`: إدارة النظام.

كل الجداول المكشوفة عليها RLS. الكتابات الحساسة لا تتم مباشرة من المتصفح؛ تمر عبر `workflow` Edge Function.

## 4. نموذج المتابعة

```text
Plan
  ↓
Initiative
  ↓
Result
  ↓
Milestone
  ├─ Weekly Commitment  ← يحدثه المالك
  ├─ Evidence           ← يرفعه المالك
  ├─ Blocker            ← يسجله المالك
  ├─ Intervention       ← يسجله السكرتير
  └─ Verification       ← يعتمدها السكرتير

GS → Oversight Note على السكرتارية، وليس تعديل عمل المالك مباشرة.
```

Milestone لا يصبح `VERIFIED` بمجرد تغيير owner للحالة. يرفع Evidence فيصبح `READY_FOR_VERIFICATION`، ثم السكرتير يتحقق أو يعيده.

## 5. المقترحات

```text
DRAFT
→ WITH_SECRETARY
→ REVISION_REQUESTED / REVISED
→ WITH_GS
→ APPROVED / NOT_APPROVED / DEFERRED
→ WITHDRAWN (قبل الإجازة)
```

بعد `APPROVED` ينشئ النظام Initiative تنفيذية مرتبطة بالمقترح، لأن قرار الإجازة ليس نهاية دورة الحياة.

`proposal_status` منفصل عن `execution_status`.

## 6. التقارير
التقرير الأسبوعي ليس form منفصلًا. RPC `weekly_report()` يجمع من:
- milestone
- weekly commitment
- evidence
- blocker
- intervention
- verification

## 7. الملفات
Google Drive هو الأرشيف النهائي.

Supabase Storage `staging` مؤقت فقط لرفع الملفات من المتصفح. بعد النقل إلى Drive يحذف الملف المؤقت.

## 8. الخدمات البطيئة
توليد Word/PDF، نقل الملفات، Telegram notifications، والتنبيهات تعمل كBackground Jobs. حفظ البيانات اليومية لا ينتظرها.
