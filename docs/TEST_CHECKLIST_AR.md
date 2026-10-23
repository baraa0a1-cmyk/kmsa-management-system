# Checklist قبل الإطلاق الرسمي

اختبر بحسابات وهمية على الأقل: Member، Secretary، GS، Admin، Applicant.

## الدخول
- [ ] الدخول بالبريد + كلمة السر.
- [ ] الدخول بالرقم الجامعي + نفس كلمة السر.
- [ ] رقم جامعي خاطئ لا يكشف هل الحساب موجود.
- [ ] الحساب المستورد يُجبر على تغيير كلمة السر أول مرة.

## RLS
- [ ] Applicant لا يرى Proposal لشخص آخر.
- [ ] Member لا يرى بيانات سكرتارية أخرى إلا ما تسمح به السياسة.
- [ ] Secretary لا يرى/يدير خارج سكرتاريته.
- [ ] GS يرى الصورة العامة.
- [ ] GS لا يستطيع Intervention أو Verification بدل السكرتير.

## المتابعة
- [ ] Secretary ينشئ Plan/Initiative/Result/Milestone.
- [ ] Owner يضيف Weekly Commitment.
- [ ] Owner يسجل Blocker.
- [ ] Secretary يضيف Intervention.
- [ ] Owner يرفع Evidence.
- [ ] الحالة تصبح READY_FOR_VERIFICATION.
- [ ] Owner لا يستطيع جعلها VERIFIED.
- [ ] Secretary يتحقق أو يعيدها.
- [ ] عند التحقق تغلق العوائق والتدخلات المفتوحة.
- [ ] Weekly Report يعكس نفس البيانات بلا إدخال تقرير جديد.

## المقترحات
- [ ] Applicant ينشئ structured proposal.
- [ ] Word/PDF لا يبطئ حفظ المقترح.
- [ ] الملفات تظهر لاحقًا في Version.
- [ ] Template download يعمل.
- [ ] Upload ready PDF/DOCX ينتقل من staging إلى Drive.
- [ ] Secretary يطلب تعديلًا.
- [ ] Applicant يرفع Version جديدة.
- [ ] Secretary يرفع إلى GS.
- [ ] GS approve/reject/defer/revision.
- [ ] Approved proposal ينشئ Initiative تنفيذية تلقائيًا.
- [ ] execution_status منفصل عن approval status.

## Drive
- [ ] Folder المقترح ثابت بالـinternal ID حتى لو تغير العنوان.
- [ ] V1 وV2 لا تختلط بياناتهما.
- [ ] Evidence files تذهب إلى Drive وتحذف من staging.
- [ ] الملفات ليست عامة Anyone-with-link.

## Telegram
- [ ] ربط Telegram من الموقع.
- [ ] New proposal notification.
- [ ] Revision requested notification.
- [ ] Milestone blocked / ready notification.
- [ ] الروابط تفتح الصفحة الصحيحة في GitHub Pages.

## Cron/SLA
- [ ] Background job ينتقل PENDING → DONE.
- [ ] الفشل يعاد تلقائيًا حتى 5 محاولات.
- [ ] Due-soon لا يتكرر بشكل مزعج.
- [ ] Overdue notification يعمل.

## GitHub
- [ ] push إلى main يشغل Action.
- [ ] build ينجح.
- [ ] GitHub Pages تُحدث بدون رفع ملفات يدويًا.
