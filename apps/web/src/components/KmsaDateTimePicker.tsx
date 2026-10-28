import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CalendarDays,ChevronLeft,ChevronRight,Clock3} from 'lucide-react';
/** Calendar rendered by KMSA, not the browser's native date/time picker.
 * Values follow datetime-local YYYY-MM-DDTHH:mm (no offset). */
export function KmsaDateTimePicker({value,onChange,dateOnly=false,min,label}:{value:string;onChange:(value:string)=>void;dateOnly?:boolean;min?:string;label?:string}){
 const ref=useRef<HTMLDivElement>(null);const floating=useRef<HTMLDivElement>(null);const [open,setOpen]=useState(false);const [panelPos,setPanelPos]=useState({top:100,right:14});
 const parsed=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value||'');
 const today=new Date();const selected=parsed?new Date(+parsed[1],+parsed[2]-1,+parsed[3],+(parsed[4]||0),+(parsed[5]||0)):today;
 const [view,setView]=useState(()=>new Date(selected.getFullYear(),selected.getMonth(),1));
 useEffect(()=>{if(!open)return;const onDown=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node)&&!floating.current?.contains(e.target as Node))setOpen(false)};const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};document.addEventListener('pointerdown',onDown);document.addEventListener('keydown',onKey);return()=>{document.removeEventListener('pointerdown',onDown);document.removeEventListener('keydown',onKey)}},[open]);
 const days=useMemo(()=>{const start=(new Date(view.getFullYear(),view.getMonth(),1).getDay()+1)%7;const n=new Date(view.getFullYear(),view.getMonth()+1,0).getDate();return [...Array(start).fill(0),...Array.from({length:n},(_,i)=>i+1)]},[view]);
 const pad=(n:number)=>String(n).padStart(2,'0');
 const emit=(y:number,m:number,d:number,h=selected.getHours(),mm=selected.getMinutes())=>onChange(`${y}-${pad(m+1)}-${pad(d)}${dateOnly?'':`T${pad(h)}:${pad(mm)}`}`);
 const formatted=parsed?new Intl.DateTimeFormat('ar-SD',{day:'numeric',month:'long',year:'numeric',...(dateOnly?{}:{hour:'numeric',minute:'2-digit'})}).format(selected):'اختر التاريخ والوقت';
 const validDay=(day:number)=>{const candidate=`${view.getFullYear()}-${pad(view.getMonth()+1)}-${pad(day)}`;return !min||candidate>=min.slice(0,10)};
 return <div className="kmsa-datetime" ref={ref} dir="rtl">
  {label&&<label className="kmsa-datetime-label">{label}</label>}
  <button type="button" className="kmsa-datetime-trigger" aria-expanded={open} onClick={()=>{setView(new Date(selected.getFullYear(),selected.getMonth(),1));const rect=ref.current?.getBoundingClientRect();if(rect){const placeBelow=window.innerHeight-rect.bottom>390;setPanelPos({top:placeBelow?rect.bottom+6:Math.max(12,rect.top-400),right:Math.max(12,Math.min(window.innerWidth-354,window.innerWidth-rect.right))})}setOpen(o=>!o)}}><CalendarDays size={18}/><span>{formatted}</span><Clock3 size={16}/></button>
  {open&&createPortal(<div ref={floating} className="kmsa-datetime-panel" style={{position:"fixed",top:panelPos.top,right:panelPos.right,zIndex:9001}} role="dialog" aria-label="اختيار التاريخ والوقت">
   <div className="kmsa-calendar-head"><button type="button" aria-label="الشهر السابق" onClick={()=>setView(v=>new Date(v.getFullYear(),v.getMonth()-1,1))}><ChevronRight size={17}/></button><strong>{new Intl.DateTimeFormat('ar-SD',{month:'long',year:'numeric'}).format(view)}</strong><button type="button" aria-label="الشهر التالي" onClick={()=>setView(v=>new Date(v.getFullYear(),v.getMonth()+1,1))}><ChevronLeft size={17}/></button></div>
   <div className="kmsa-calendar-grid">{['س','أ','إ','ث','أر','خ','ج'].map((d,i)=><span className="kmsa-day-name" key={i}>{d}</span>)}{days.map((day,i)=>day?<button type="button" key={i} disabled={!validDay(day)} className={day===selected.getDate()&&selected.getMonth()===view.getMonth()&&selected.getFullYear()===view.getFullYear()?'selected':''} onClick={()=>{emit(view.getFullYear(),view.getMonth(),day);if(dateOnly)setOpen(false)}}>{day}</button>:<span key={i}/>)}</div>
   {!dateOnly&&<div className="kmsa-calendar-time"><label>الساعة <select value={pad(selected.getHours())} onChange={e=>emit(selected.getFullYear(),selected.getMonth(),selected.getDate(),Number(e.target.value),selected.getMinutes())}>{Array.from({length:24},(_,n)=><option key={n} value={pad(n)}>{pad(n)}</option>)}</select></label><label>الدقيقة <select value={pad(selected.getMinutes())} onChange={e=>emit(selected.getFullYear(),selected.getMonth(),selected.getDate(),selected.getHours(),Number(e.target.value))}>{Array.from({length:60},(_,n)=><option key={n} value={pad(n)}>{pad(n)}</option>)}</select></label></div>}
   <div className="kmsa-calendar-footer"><button type="button" className="workspace-secondary small" onClick={()=>emit(today.getFullYear(),today.getMonth(),today.getDate(),today.getHours(),today.getMinutes())}>اليوم</button><button type="button" className="workspace-primary small" onClick={()=>setOpen(false)}>اعتماد الموعد</button></div>
  </div>,document.body)}
 </div>
}
