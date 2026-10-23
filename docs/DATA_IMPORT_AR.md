# استيراد المستخدمين لاحقًا

عندما تتوفر الداتا، نحتاج لكل شخص قدر الإمكان:

- `university_id`
- `email`
- `full_name`
- `role`
- `secretariat_code`
- `initial_password`
- `active`

يوجد مثال في `scripts/users_template.csv`.

## قواعد مهمة

1. `university_id` يجب أن يكون فريدًا.
2. `email` يجب أن يكون فريدًا.
3. لا تستخدم كلمة مرور أولية واحدة للجميع.
4. كلمة المرور الأولية تستخدم مرة واحدة في `auth.admin.createUser` ولا تُخزن في `profiles`.
5. كل حساب مستورد يأخذ `must_change_password=true`، فيُجبر صاحبه على تغييرها عند أول دخول.

## الأدوار المقبولة

`APPLICANT | MEMBER | SECRETARY | GS | ADMIN`

## ما سنفعله عندما ترفع الملف

سنراجع الأعمدة، ننظف الأرقام الجامعية والبريد، نطابق أسماء السكرتاريات مع الأكواد، ثم نولد JSON صالحًا لـ`admin-import-users` أو نضيف واجهة استيراد داخل Admin إذا كان ذلك أنسب لحجم الملف.
