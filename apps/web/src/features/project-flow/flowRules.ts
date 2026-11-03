/** Deterministic follow-up math: use one source for badges and oversight. */
export type CheckClock={created_at:string;assessment:string;next_review_at:string|null};
export type SecretaryClock={created_at:string;review_at:string|null};
const time=(s:string|null|undefined)=>s?new Date(s).getTime():NaN;
export function supervisorDueAt(baseline:string|null,assignedAt:string|null,lastCheck:CheckClock|null):string|null{
 const isLater=assignedAt&&baseline?new Date(Math.max(time(assignedAt),time(baseline))).toISOString():assignedAt||baseline;
 const anchor=lastCheck?.created_at||isLater;
 if(lastCheck?.assessment==='WAITING_EXTERNAL'&&lastCheck.next_review_at)return lastCheck.next_review_at;
 return anchor?new Date(time(anchor)+12*3600000).toISOString():null;
}
export function secretaryHasMissedAction(input:{due:string|null;now:number;delegated:boolean;latestCheck:CheckClock|null;secretaryAction:SecretaryClock|null;graceHours?:number}):boolean{
 const {due,now,delegated,latestCheck,secretaryAction}=input;
 if(!delegated||!due||!Number.isFinite(time(due))||time(due)>=now-(input.graceHours??24)*3600000)return false;
 if(!secretaryAction)return true;
 if(secretaryAction.review_at){return time(secretaryAction.review_at)<now&&(!latestCheck||time(latestCheck.created_at)<time(secretaryAction.created_at));}
 return time(secretaryAction.created_at)<time(due);
}
export function documentationLate(lastReport:string|null|undefined,now:number,hours=24):boolean{
 return !!lastReport&&Number.isFinite(time(lastReport))&&time(lastReport)<now-hours*3600000;
}
