import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const apiPath = path.join(root, 'apps', 'web', 'src', 'lib', 'api.ts');
const typesPath = path.join(root, 'apps', 'web', 'src', 'lib', 'types.ts');

for (const p of [apiPath, typesPath]) {
  if (!fs.existsSync(p)) {
    console.error(`لم أجد الملف: ${p}`);
    console.error('شغّل هذا الملف من المجلد الرئيسي للمشروع KMSA_Management_System_GitHub_v2');
    process.exit(1);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(apiPath, `${apiPath}.bak-${stamp}`);
fs.copyFileSync(typesPath, `${typesPath}.bak-${stamp}`);

let types = fs.readFileSync(typesPath, 'utf8');
let api = fs.readFileSync(apiPath, 'utf8');

function hasType(name) {
  return new RegExp(`export\\s+(?:interface|type|class)\\s+${name}\\b`).test(types);
}
function hasApi(name) {
  return new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(api) ||
         new RegExp(`export\\s+const\\s+${name}\\b`).test(api);
}

// RoutineObligationRow exists in older v3, but the new UI expects these provenance fields.
if (!/interface\s+RoutineObligationRow[\s\S]*?position_title\??\s*:/.test(types)) {
  types += `\n\n// KMSA compatibility extension — Workspace comprehensive update\nexport interface RoutineObligationRow {\n  source_type?: string | null;\n  position_title?: string | null;\n  scope_label?: string | null;\n  source_id?: string | null;\n}\n`;
}

const typeDefs = {
  UserNotification: `export interface UserNotification {\n  [key:string]: any;\n  id?: string; event_type?: string; title?: string; message?: string; entity_type?: string; entity_id?: string;\n  created_at?: string; read_at?: string | null; href?: string | null; status?: string;\n}`,
  QuickTaskRow: `export interface QuickTaskRow {\n  [key:string]: any;\n  task_id?: string; id?: string; secretariat_id?: string; secretariat_name?: string; title?: string; description?: string | null;\n  owner_id?: string; owner_name?: string; assigned_by?: string | null; assigned_by_name?: string | null; due_at?: string | null;\n  priority?: string; status?: string; note?: string | null; evidence_url?: string | null; overdue?: boolean; days_to_due?: number | null; created_at?: string; updated_at?: string;\n}`,
  ReadinessSnapshot: `export interface ReadinessSnapshot {\n  [key:string]: any;\n  ready?: boolean; critical_count?: number; warning_count?: number; projects_needing_attention?: number;\n  secretary_response_needed?: number; overdue_routines?: number; overdue_tasks?: number; overdue_proposals?: number; failed_document_jobs?: number; stuck_jobs?: number;\n}`,
  OperationalPositionRow: `export interface OperationalPositionRow {\n  [key:string]: any;\n  id?: string; position_id?: string; secretariat_id?: string; secretariat_name?: string; title?: string; scope_label?: string | null; active?: boolean;\n  assignee_id?: string | null; assignee_name?: string | null; created_at?: string; updated_at?: string;\n}`,
  PositionAssignment: `export interface PositionAssignment {\n  [key:string]: any;\n  id?: string; position_id?: string; profile_id?: string; assignee_id?: string; assignee_name?: string; scope_label?: string | null;\n  starts_at?: string | null; ends_at?: string | null; active?: boolean; status?: string; created_at?: string;\n}`,
  PositionDutyTemplate: `export interface PositionDutyTemplate {\n  [key:string]: any;\n  id?: string; position_id?: string; title?: string; description?: string | null; expected_output?: string | null; cadence?: string; interval_days?: number | null; active?: boolean;\n}`,
  PositionEventTemplate: `export interface PositionEventTemplate {\n  [key:string]: any;\n  id?: string; position_id?: string; title?: string; description?: string | null; cadence?: string; interval_days?: number | null; active?: boolean;\n}`,
  WorkEventRow: `export interface WorkEventRow {\n  [key:string]: any;\n  event_id?: string; id?: string; secretariat_id?: string; secretariat_name?: string; title?: string; starts_at?: string | null; due_at?: string | null;\n  owner_id?: string | null; owner_name?: string | null; status?: string; participant_count?: number; attended_count?: number; absent_count?: number; excused_count?: number;\n}`,
  EventAttendance: `export interface EventAttendance {\n  [key:string]: any;\n  id?: string; event_id?: string; profile_id?: string; attendee_id?: string; attendee_name?: string; status?: string; note?: string | null; recorded_at?: string | null;\n}`
};

for (const [name, def] of Object.entries(typeDefs)) {
  if (!hasType(name)) types += `\n\n// KMSA compatibility type\n${def}\n`;
}

const compatHelper = `\n\n// -----------------------------------------------------------------------------\n// KMSA compatibility readers for the comprehensive Workspace update.\n// These readers prefer the new RPC/view names when installed and degrade safely\n// to the matching table (or an empty result) instead of crashing the shell.\n// -----------------------------------------------------------------------------\nasync function kmsaCompatRpc(name:string, params:Record<string,any> = {}) {\n  const { data, error } = await supabase.rpc(name, params);\n  if (!error) return data;\n  const missing = error.code === 'PGRST202' || error.code === '42883' || /Could not find the function|does not exist/i.test(error.message || '');\n  if (missing) return null;\n  throw error;\n}\nasync function kmsaCompatTable(table:string, select='*') {\n  const { data, error } = await supabase.from(table).select(select);\n  if (error) return [];\n  return data || [];\n}\n`;
if (!/function\s+kmsaCompatRpc\b/.test(api)) api += compatHelper;

const apiDefs = {
  notificationFeed: `export async function notificationFeed(..._args:any[]): Promise<any[]> {\n  const rpc = await kmsaCompatRpc('notification_feed');\n  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);\n  return await kmsaCompatTable('user_notifications');\n}`,
  quickTaskSheet: `export async function quickTaskSheet(..._args:any[]): Promise<any[]> {\n  const rpc = await kmsaCompatRpc('quick_task_sheet');\n  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);\n  const rows:any[] = await kmsaCompatTable('quick_tasks');\n  return rows;\n}`,
  readinessSnapshot: `export async function readinessSnapshot(..._args:any[]): Promise<any> {\n  const rpc = await kmsaCompatRpc('readiness_snapshot');\n  if (rpc !== null) return Array.isArray(rpc) && rpc.length === 1 ? rpc[0] : rpc;\n  // Safe fallback: derive the most important readiness signals from readers that\n  // already exist in v3. This keeps oversight usable even before the RPC is added.\n  const [projects, routines, proposals] = await Promise.all([\n    workspaceProjectSheet().catch(()=>[]),\n    routineObligationSheet().catch(()=>[]),\n    proposalTrackingSheet().catch(()=>[])\n  ]);\n  const p:any[] = projects as any[]; const r:any[] = routines as any[]; const pr:any[] = proposals as any[];\n  const snapshot:any = {\n    ready: false,\n    projects_needing_attention: p.filter(x=>x.needs_attention).length,\n    secretary_response_needed: p.filter(x=>x.secretary_response_needed).length,\n    overdue_routines: r.filter(x=>x.overdue).length,\n    overdue_proposals: pr.filter(x=>x.overdue).length,\n    critical_count: p.filter(x=>x.secretary_response_needed).length + r.filter(x=>x.overdue).length + pr.filter(x=>x.overdue).length\n  };\n  snapshot.ready = snapshot.critical_count === 0;\n  return snapshot;\n}`,
  operationalPositions: `export async function operationalPositions(..._args:any[]): Promise<any[]> {\n  const rpc = await kmsaCompatRpc('operational_position_sheet');\n  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);\n  return await kmsaCompatTable('operational_positions');\n}`,
  positionAssignments: `export async function positionAssignments(...args:any[]): Promise<any[]> {\n  const rpc = await kmsaCompatRpc('position_assignment_sheet');\n  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);\n  const rows:any[] = await kmsaCompatTable('position_assignments');\n  const positionId = typeof args[0] === 'string' ? args[0] : args[0]?.positionId;\n  return positionId ? rows.filter((x:any)=>x.position_id===positionId) : rows;\n}`,
  positionDutyTemplates: `export async function positionDutyTemplates(...args:any[]): Promise<any[]> {\n  const rpc = await kmsaCompatRpc('position_duty_template_sheet');\n  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);\n  const rows:any[] = await kmsaCompatTable('position_duty_templates');\n  const positionId = typeof args[0] === 'string' ? args[0] : args[0]?.positionId;\n  return positionId ? rows.filter((x:any)=>x.position_id===positionId) : rows;\n}`,
  positionEventTemplates: `export async function positionEventTemplates(...args:any[]): Promise<any[]> {\n  const rpc = await kmsaCompatRpc('position_event_template_sheet');\n  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);\n  const rows:any[] = await kmsaCompatTable('position_event_templates');\n  const positionId = typeof args[0] === 'string' ? args[0] : args[0]?.positionId;\n  return positionId ? rows.filter((x:any)=>x.position_id===positionId) : rows;\n}`,
  workEventSheet: `export async function workEventSheet(..._args:any[]): Promise<any[]> {\n  const rpc = await kmsaCompatRpc('work_event_sheet');\n  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);\n  return await kmsaCompatTable('work_events');\n}`,
  eventAttendance: `export async function eventAttendance(...args:any[]): Promise<any[]> {\n  const eventId = typeof args[0] === 'string' ? args[0] : args[0]?.eventId;\n  const rpc = eventId ? await kmsaCompatRpc('event_attendance_sheet',{p_event_id:eventId}) : null;\n  if (rpc !== null) return Array.isArray(rpc) ? rpc : (rpc?.items || []);\n  const rows:any[] = await kmsaCompatTable('event_attendance');\n  return eventId ? rows.filter((x:any)=>x.event_id===eventId) : rows;\n}`
};

for (const [name, def] of Object.entries(apiDefs)) {
  if (!hasApi(name)) api += `\n\n// KMSA compatibility API\n${def}\n`;
}

fs.writeFileSync(typesPath, types, 'utf8');
fs.writeFileSync(apiPath, api, 'utf8');

console.log('✅ تم إصلاح lib/types.ts و lib/api.ts مع إنشاء نسخ احتياطية.');
console.log('الخطوة التالية: cd apps/web ثم npm.cmd run build');
