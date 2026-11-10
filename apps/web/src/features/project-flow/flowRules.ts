/** KMSA Flow 7.1 — one clock per obligation, never a "contacted" checkbox. */
export type CheckClock={created_at:string;assessment:string;next_review_at:string|null;milestone_ids?:string[]};
export type SecretaryClock={created_at:string;review_at:string|null}; // historical v7 events: read-only
const time=(value:string|null|undefined)=>value?Date.parse(value):NaN;
export const negativeAssessment=(assessment:string|null|undefined)=>['SLOW','NO_WORK','BLOCKED','UNVERIFIED'].includes(assessment||'');
export function supervisorDueAt(baseline:string|null,assignedAt:string|null,lastCheck:CheckClock|null):string|null{
 const dates=[baseline,assignedAt].map(time).filter(Number.isFinite);
 const candidate=lastCheck?.created_at?time(lastCheck.created_at):NaN;
 const anchorTimes=[...dates,candidate].filter(Number.isFinite);
 const anchor=anchorTimes.length?new Date(Math.max(...anchorTimes)).toISOString():null;
 if(lastCheck?.assessment==='WAITING_EXTERNAL'&&lastCheck.next_review_at&&time(lastCheck.created_at)>=Math.max(...dates,0)){
   const max=Date.parse(anchor||'')+7*86400000;
   return new Date(Math.min(time(lastCheck.next_review_at),max)).toISOString();
 }
 return anchor&&Number.isFinite(time(anchor))?new Date(time(anchor)+12*3600000).toISOString():null;
}
/** Contact happened on Telegram; it is NOT an audited decision and never clears the missing check. */
export function secretaryHasMissedAction(input:{due:string|null;now:number;delegated:boolean;latestCheck?:CheckClock|null;secretaryAction?:SecretaryClock|null;graceHours?:number}):boolean{
 const {due,now,delegated}=input;
 return !!delegated&&Number.isFinite(time(due))&&time(due)<now-(input.graceHours??24)*3600000;
}
/** Baseline is mandatory for first report; silence is missing information, never proof of no work. */
export function documentationLate(lastReport:string|null|undefined,now:number,hours=24,baseline?:string|null):boolean{
 const candidate=[time(lastReport),time(baseline)].filter(Number.isFinite);
 return candidate.length>0&&Math.max(...candidate)<now-hours*3600000;
}
export function incompleteScope(required:string[],checked:string[]|null|undefined):string[]{
 const seen=new Set(checked||[]);
 return required.filter(id=>!seen.has(id));
}
