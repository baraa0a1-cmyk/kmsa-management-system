import type { ExecutionStatus, MilestoneStatus, ProposalStatus, Role } from './types';

export const roleLabel: Record<Role,string> = {
  APPLICANT:'عضو الجمعية العمومية', MEMBER:'عضو الجمعية العمومية', SECRETARY:'سكرتير', GS:'السكرتير العام', PRESIDENT:'رئيس اللجنة التنفيذية', ADMIN:'مدير النظام'
};
export const proposalStatusLabel: Record<ProposalStatus,string> = {
  DRAFT:'مسودة', WITH_SECRETARY:'لدى السكرتير المختص', REVISION_REQUESTED:'يحتاج تعديلًا', REVISED:'تم رفع تعديل', WITH_GS:'لدى السكرتارية العامة', APPROVED:'مجاز', NOT_APPROVED:'غير مجاز', DEFERRED:'مؤجل', WITHDRAWN:'مسحوب'
};
export const executionStatusLabel: Record<ExecutionStatus,string> = {
  NOT_STARTED:'لم يبدأ', IN_PROGRESS:'جارٍ التنفيذ', AT_RISK:'مهدد', BLOCKED:'متعثر', COMPLETED:'مكتمل', CANCELLED:'ملغى'
};
export const milestoneStatusLabel: Record<MilestoneStatus,string> = {
  NOT_STARTED:'لم يبدأ', IN_PROGRESS:'جارٍ التنفيذ', AT_RISK:'مهدد', BLOCKED:'متعثر', READY_FOR_VERIFICATION:'جاهز للتحقق', VERIFIED:'متحقق', CANCELLED:'ملغى'
};

export function formatDate(v?: string | null) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('ar-SD', {dateStyle:'medium'}).format(new Date(v));
}
export function formatDateTime(v?: string | null) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('ar-SD', {dateStyle:'medium', timeStyle:'short'}).format(new Date(v));
}


const secretaryByCode:Record<string,string>={
  FIN:'السكرتير المالي', EXT:'سكرتير العلاقات الخارجية', ACAD:'السكرتير الأكاديمي', HEA:'سكرتير التثقيف الصحي',
  SS:'السكرتير الاجتماعي الرياضي', CM:'السكرتير الثقافي الإعلامي', GS:'السكرتير العام'
};
export function secretaryTitle(secretariat?:{code?:string|null;name_ar?:string|null}|null){
  if(!secretariat)return 'السكرتير';
  return secretaryByCode[String(secretariat.code||'').toUpperCase()]||`سكرتير ${secretariat.name_ar||''}`.trim();
}
export function profileTitle(profile?:{role?:Role;secretariat?:{code?:string|null;name_ar?:string|null}|null}|null){
  if(!profile)return '';
  if(profile.role==='SECRETARY')return secretaryTitle(profile.secretariat);
  return roleLabel[profile.role as Role]||String(profile.role||'');
}
