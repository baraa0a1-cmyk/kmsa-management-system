/** Non-destructive router overlay. The original views remain at /classic. */
import {readFileSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.cwd(),app=resolve(root,'apps/web/src/App.tsx'),backup=resolve(root,'apps/web/src/App.tsx.before-flow-v7');
const op=process.argv[2]||'--activate';
if(!existsSync(app))throw new Error('شغّل الأمر من جذر مشروع KMSA، حيث يوجد apps/web/src/App.tsx');
if(op==='--restore'){
 if(!existsSync(backup))throw new Error('لا توجد نسخة احتياطية قبل v7؛ لا تغيير.');
 copyFileSync(backup,app);console.log('استُعيدت المسارات السابقة. لا بيانات حُذفت.');process.exit(0);
}
let source=readFileSync(app,'utf8');if(source.includes("import ProjectFlowHome from './features/project-flow/ProjectFlowHome'")){
 console.log('Flow v7 مفعل مسبقًا. لم نغير شيئًا.');process.exit(0);
}
const projectsRoute=/\<Route\s+path="\/workspace\/projects"\s+element=\{\<WorkspaceOnly\>\<WorkspaceProjectsPage\s*\/\>\<\/WorkspaceOnly\>\}\s*\/\>/;
const detailRoute=/\<Route\s+path="\/workspace\/projects\/:id"\s+element=\{\<WorkspaceOnly\>\<WorkspaceProjectPage\s*\/\>\<\/WorkspaceOnly\>\}\s*\/\>/;
if(!source.includes("import WorkspaceProjectPage from './pages/WorkspaceProjectPage'"))throw new Error('تعذر العثور على استيراد تفاصيل المشروع؛ راجع الملف بدل إجراء استبدال غير آمن.');
if(!projectsRoute.test(source)||!detailRoute.test(source))throw new Error('مسارات المشاريع الحالية ليست بالشكل المتوقع. لم نعدّل الملف؛ يلزم مراجعة مسارات App.tsx.');
if(op==='--check'){console.log('المسارات متوافقة ويمكن تثبيت Flow v7.');process.exit(0)}
if(op!=='--activate')throw new Error('الاستخدام: node scripts/install-flow-v7.mjs --check | --activate | --restore');
copyFileSync(app,backup);
source=source.replace("import WorkspaceProjectPage from './pages/WorkspaceProjectPage';", "import WorkspaceProjectPage from './pages/WorkspaceProjectPage';\nimport ProjectFlowHome from './features/project-flow/ProjectFlowHome';\nimport ProjectFlowDetail from './features/project-flow/ProjectFlowDetail';");
source=source.replace(projectsRoute,`<Route path="/workspace/projects" element={<WorkspaceOnly><ProjectFlowHome/></WorkspaceOnly>}/>\n  <Route path="/workspace/projects/classic" element={<WorkspaceOnly><WorkspaceProjectsPage/></WorkspaceOnly>}/>`);
source=source.replace(detailRoute,`<Route path="/workspace/projects/:id" element={<WorkspaceOnly><ProjectFlowDetail/></WorkspaceOnly>}/>\n  <Route path="/workspace/projects/:id/classic" element={<WorkspaceOnly><WorkspaceProjectPage/></WorkspaceOnly>}/>`);
writeFileSync(app,source,'utf8');console.log('فُعّلت واجهتا Flow v7. بقيت الواجهة الكاملة القديمة متاحة ضمن /classic.');
