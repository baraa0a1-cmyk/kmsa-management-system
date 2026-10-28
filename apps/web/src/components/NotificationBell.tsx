import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useLocation,useNavigate} from 'react-router-dom';
import {Bell,CheckCircle2,X} from 'lucide-react';
import {notificationFeed,workflow} from '../lib/api';
import type {UserNotification} from '../lib/types';
const actionRequired=(type:string)=>['PROJECT_PROGRESS_UPDATED','PROJECT_RESULT_READY','MILESTONE_UPDATE_REQUEST','DEADLINE_CHANGE_REQUEST','REQUEST_SUPERVISION_CHECK','PROJECT_PAUSE_PENDING','SUPERVISION_REVIEW_REQUEST_1','SUPERVISION_REVIEW_REQUEST_2','PROJECT_PENDING_GS'].includes(type)||/^MILESTONE_REVIEW_(PROGRESS_FOLLOW_UP|PROGRESS_UNCLEAR|RESULT_REVISION)$/.test(type);
export function NotificationBell(){
 const trigger=useRef<HTMLDivElement|null>(null);const panel=useRef<HTMLDivElement|null>(null);const nav=useNavigate();const {pathname}=useLocation();
 const [open,setOpen]=useState(false);const [items,setItems]=useState<UserNotification[]>([]);const [error,setError]=useState('');const [message,setMessage]=useState('');
 async function load(){try{const response=await notificationFeed(60);setItems(response as UserNotification[]);setError('')}catch(e:any){setError(e?.message||'تعذر جلب الإشعارات')}}
 useEffect(()=>{void load();const onFocus=()=>void load();const onChange=()=>void load();const interval=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},45000);window.addEventListener('focus',onFocus);window.addEventListener('kmsa:notification-changed',onChange);return()=>{window.clearInterval(interval);window.removeEventListener('focus',onFocus);window.removeEventListener('kmsa:notification-changed',onChange)}},[]);
 useEffect(()=>{setOpen(false);void load()},[pathname]);
 useEffect(()=>{if(!open)return;const onDown=(e:PointerEvent)=>{if(!trigger.current?.contains(e.target as Node)&&!panel.current?.contains(e.target as Node))setOpen(false)};const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};document.addEventListener('pointerdown',onDown);document.addEventListener('keydown',onKey);return()=>{document.removeEventListener('pointerdown',onDown);document.removeEventListener('keydown',onKey)}},[open]);
 const count=items.filter(n=>actionRequired(n.event_type)?!n.resolved_at:!n.read_at).length;
 async function click(n:UserNotification){
  if(actionRequired(n.event_type)&&n.resolved_at){setMessage(n.resolution_kind==='SUPERSEDED'?'عولج تحديث أحدث، فلم يعد هذا الإشعار القديم يتطلب إجراءً.':'تمت الاستجابة لهذا الإشعار سابقًا. لن يُطلب منك تنفيذ الإجراء مرة أخرى.');return;}
  try{if(!n.read_at)await workflow('NOTIFICATION_MARK_READ',{notificationId:n.id});await load();setOpen(false);if(n.action_path)nav(n.action_path);else setMessage('تمت قراءة الإشعار.')}catch(e:any){setError(e?.message||'تعذر فتح الإشعار')}
 }
 return <div className="notification-wrap" ref={trigger}>
  <button className="member-icon-button notification-button" aria-label={`الإشعارات ${count}`} aria-expanded={open} onClick={()=>{setOpen(v=>!v);if(!open)void load()}}><Bell size={19}/>{count>0&&<b>{count>9?'9+':count}</b>}</button>
  {open&&createPortal(<div ref={panel} className="kmsa-notification-panel" dir="rtl" role="dialog" aria-label="الإشعارات"><div className="notification-head"><strong>الإشعارات</strong><button type="button" title="إغلاق" aria-label="إغلاق الإشعارات" onClick={()=>setOpen(false)}><X size={17}/></button></div><div className="notification-list">{error&&<p role="alert" className="member-form-error">{error}</p>}{items.length?items.map(n=><button type="button" key={n.id} className={`${!n.read_at?'unread':''} ${n.resolved_at?'v66-notification-complete':''}`} onClick={()=>void click(n)}><span/><div><strong>{n.title}</strong>{n.body&&<p>{n.body}</p>}<small>{new Intl.DateTimeFormat('ar-SD',{dateStyle:'short',timeStyle:'short'}).format(new Date(n.created_at))}</small>{actionRequired(n.event_type)?n.resolved_at?<span className="v66-notification-done"><CheckCircle2 size={12} style={{verticalAlign:'middle'}}/> {n.resolution_kind==='SUPERSEDED'?'استُبدل بتحديث أحدث':'تمت الاستجابة'}</span>:<span className="v66-notification-action">ينتظر إتمام الإجراء المطلوب</span>:null}</div></button>):<div className="notification-empty">لا توجد إشعارات.</div>}</div></div>,document.body)}
  {message&&createPortal(<div className="v66-notification-toast" role="status" onClick={()=>setMessage('')}>{message} <button type="button" style={{marginRight:10,border:'none',background:'transparent',color:'inherit'}} aria-label="إغلاق" onClick={()=>setMessage('')}>×</button></div>,document.body)}
 </div>;
}
