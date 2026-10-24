KMSA — إصلاح Build لصفحة WorkspaceStructurePage

سبب الخطأ:
صفحة WorkspaceStructurePage تستورد organizationStructure وأنواع Org*، لكن api.ts وtypes.ts في النسخة الحالية لا يصدّرانها.

طريقة التطبيق:
1) فك الضغط داخل المجلد الرئيسي للمشروع:
   C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2

2) وافق على استبدال الملفين:
   apps\web\src\lib\api.ts
   apps\web\src\lib\types.ts

3) من PowerShell:
   cd C:\Users\baraa\Desktop\KMSA_Management_System_GitHub_v2\apps\web
   npm.cmd run build

الإصلاح يضيف:
- OrgBodyType
- OrgBody
- OrgPosition
- OrgMembership
- OrgAppointment
- OrgStructureSnapshot
- organizationStructure()

ملاحظة:
هذا Patch يعالج أخطاء TypeScript الظاهرة في سجل البناء (missing exports وما نتج عنها من implicit any).
