/** KMSA Flow 7.2 — one clock per obligation, never a "contacted" checkbox. */
export type CheckClock={created_at:string;assessment:string;next_review_at:string|null;milestone_ids?:string[]};
export type SecretaryClock={created_at:string;review_at:string|null}; // historical v7 events: read-only
const time=(value:string|null|undefined)=>value?Date.parse(value):NaN;
export const negativeAssessment=(assessment:string|null|undefined)=>['SLOW','NO_WORK','BLOCKED','UNVERIFIED'].includes(assessment||'');
export function supervisorDueAt(baseline:string|null,assignedAt:string|null,lastCheck:CheckClock|null):string|null{
 const dates=[baseline,assignedAt].map(time).filter(Number.isFinite);
 const candidate=lastCheck?.created_at?time(lastCheck.created_at):NaN;
 const anchorTimes=[...dates,candidate].filter(Number.isFinite);
 const anchor=anchorTimes.length?new Date(Math.max(...anchorTimes)).toISOString():null;
 return anchor&&Number.isFinite(time(anchor))?new Date(time(anchor)+24*3600000).toISOString():null;
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

/** Accumulate independent partial verifications into a *new* complete project round.
    The previous completed round cannot be reused to reset the clock. */
export function coverageCycle(required:string[],checks:CheckClock[],startAt:string|null):{lastComplete:CheckClock|null;uncovered:string[]}{
 if(!required.length)return {lastComplete:null,uncovered:[]};
 const start=time(startAt);
 const chronological=[...checks].filter(c=>Number.isFinite(time(c.created_at))&&(!Number.isFinite(start)||time(c.created_at)>=start)).sort((a,b)=>time(a.created_at)-time(b.created_at));
 let seen=new Set<string>(),lastComplete:CheckClock|null=null;
 let opened=NaN;
 for(const c of chronological){
  const t=time(c.created_at);
  if(Number.isFinite(opened)&&t-opened>24*3600000){seen=new Set();opened=NaN}
  const scope=(c.milestone_ids||[]).filter(id=>required.includes(id));
  if(!scope.length)continue;
  if(!Number.isFinite(opened))opened=t;
  for(const id of scope)seen.add(id);
  if(required.every(id=>seen.has(id))){lastComplete=c;seen=new Set();opened=NaN}
 }
 return {lastComplete,uncovered:required.filter(id=>!seen.has(id))};
}

/** Delayed check and administrative review are separate facts. Review does not clear a supervisor's debt. */
export type OversightRecord={late_due_at:string;reviewed_at:string;follow_up_due_at:string};
export function supervisionOversightState(input:{due:string|null;now:number;delegated:boolean;needsCheck:boolean;paused:boolean;ack?:OversightRecord|null}):'NONE'|'NEEDS_REVIEW'|'REVIEWED_WAITING'|'FOLLOW_UP_DUE'{
 if(input.paused||!input.needsCheck||!input.delegated||!input.due)return 'NONE';
 if(!input.ack||Math.abs(time(input.ack.late_due_at)-time(input.due))>=1000)return 'NEEDS_REVIEW';
 return time(input.ack.follow_up_due_at)<=input.now?'FOLLOW_UP_DUE':'REVIEWED_WAITING';
}
