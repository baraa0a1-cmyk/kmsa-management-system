/** Minimal additive CI insertion. Never replace the user's actual GitHub workflow. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const filename=resolve(root,'.github/workflows/deploy-pages.yml');
if(!existsSync(filename))throw new Error('تعذر العثور على ملف GitHub Actions؛ لا شيء تغير.');
let source=readFileSync(filename,'utf8');
if(source.includes('check-flow-v7-1.mjs')){console.log('اختبار v7.1 موجود بالفعل في GitHub Actions.');process.exit(0)}
const anchor=/^(\s*)- name: Build\s*$/m;
const match=source.match(anchor);
if(!match)throw new Error('لم أجد خطوة Build في ملف النشر. لا شيء تغير؛ راجع الملف يدويًا.');
const indent=match[1];
const extra=`${indent}- name: Verify KMSA Flow v7\n${indent}  run: node ../../scripts/check-flow-v7.mjs\n${indent}- name: Verify KMSA Flow v7.1\n${indent}  run: node ../../scripts/check-flow-v7-1.mjs\n`;
source=source.replace(anchor,()=>extra+match[0]);
writeFileSync(filename,source);
console.log('أضيف اختبارا v7 وv7.1 قبل البناء على فرع main دون تغيير النشر أو أسرار Supabase.');
