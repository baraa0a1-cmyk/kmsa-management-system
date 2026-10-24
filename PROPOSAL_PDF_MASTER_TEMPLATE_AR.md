# تثبيت شكل PDF المقترح على القالب الرسمي

النظام يستطيع الاستمرار باستخدام `PROPOSAL_TEMPLATE_DOCX_ID` كما كان سابقًا، لكن تحويل DOCX إلى Google Docs قد يسبب اختلافات طفيفة في المسافات أو الجداول.

لأفضل ثبات بصري:

1. افتح ملف Word الرسمي للمقترح في Google Drive باستخدام Google Docs.
2. راجع التنسيق يدويًا مرة واحدة حتى يصبح مطابقًا للشكل الذي تريد اعتماده رسميًا.
3. تأكد أن الـplaceholders مثل `{{TITLE}}` و`{{APPLICANT_NAME}}` وغيرها ما زالت موجودة في أماكنها.
4. انسخ File ID الخاص بملف Google Docs.
5. Apps Script → Project Settings → Script Properties → Add property:

`PROPOSAL_TEMPLATE_GOOGLE_DOC_ID`

والقيمة = File ID لنسخة Google Docs المعتمدة.

6. اترك `PROPOSAL_TEMPLATE_DOCX_ID` موجودًا أيضًا؛ يستخدمه النظام لتحميل النموذج Word، ويعمل كـfallback إذا لم يوجد Google Docs Master.

بعد ذلك سيستخدم توليد PDF النسخة Google Docs المعتمدة مباشرة، ثم يستبدل الحقول ويصدر PDF وDOCX. وهذا أكثر ثباتًا من تحويل Word في كل مرة.
