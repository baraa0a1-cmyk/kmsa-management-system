import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BriefcaseBusiness, ClipboardCheck, ClipboardList, FileText, Gauge, Gavel, HandHeart, Home, LogOut, Megaphone, Menu, Radar, RefreshCw, Target, UserRound, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { signOut } from '../lib/auth';
import { profileTitle } from '../lib/labels';
import { supabase } from '../lib/supabase';
import { NotificationBell } from './NotificationBell';

const memberItems=[
 {to:'/',label:'الرئيسية',icon:Home},
 {to:'/opportunities',label:'الفرص',icon:BriefcaseBusiness},
 {to:'/services',label:'الخدمات',icon:HandHeart},
 {to:'/voice',label:'صوتك',icon:Megaphone},
 {to:'/account',label:'حسابي',icon:UserRound},
];
const workspaceItems=[
 {to:'/workspace',label:'الرئيسية',icon:Gauge,roles:['APPLICANT','MEMBER','SECRETARY','GS','PRESIDENT']},
 {to:'/workspace/projects',label:'المشاريع',icon:Target,roles:['APPLICANT','MEMBER','SECRETARY','GS','PRESIDENT']},
 {to:'/workspace/tasks',label:'المهام',icon:ClipboardList,roles:['APPLICANT','MEMBER','SECRETARY','GS','PRESIDENT']},
 {to:'/workspace/routine',label:'العمل الدوري',icon:RefreshCw,roles:['APPLICANT','MEMBER','SECRETARY','GS','PRESIDENT']},
 {to:'/workspace/proposals',label:'المقترحات',icon:FileText,roles:['SECRETARY','GS','PRESIDENT']},
 {to:'/workspace/reports',label:'التقارير',icon:ClipboardCheck,roles:['SECRETARY','GS','PRESIDENT']},
 {to:'/workspace/oversight',label:'المتابعة العامة',icon:Radar,roles:['GS','PRESIDENT']},
 {to:'/workspace/governance',label:'السجل الرسمي',icon:Gavel,roles:['GS','PRESIDENT']},
 {to:'/workspace/admin',label:'إدارة النظام',icon:Users,roles:['ADMIN']},
];


function MemberShell(){
 const {profile}=useAuth(); const nav=useNavigate(); const {pathname}=useLocation(); const [assigned,setAssigned]=useState(false);
 useEffect(()=>{
  if(!profile)return;
  if(['SECRETARY','GS','PRESIDENT','ADMIN'].includes(profile.role)){setAssigned(true);return}
  let live=true;
  async function refresh(){
   const [a,b,c,d,e]=await Promise.all([
    supabase.from('initiatives').select('id',{count:'exact',head:true}).eq('owner_id',profile!.id).eq('approval_status','APPROVED'),
    supabase.from('routine_obligations').select('id',{count:'exact',head:true}).eq('owner_id',profile!.id).eq('active',true),
    supabase.from('quick_tasks').select('id',{count:'exact',head:true}).eq('assignee_id',profile!.id).not('status','in','("DONE","CANCELLED")'),
    supabase.from('position_assignments').select('id',{count:'exact',head:true}).eq('profile_id',profile!.id).eq('active',true),
    supabase.from('project_supervision_assignments').select('initiative_id',{count:'exact',head:true}).eq('supervisor_id',profile!.id)
   ]);
   if(live&&![a,b,c,d,e].some(q=>q.error))setAssigned([a,b,c,d,e].some(q=>(q.count||0)>0));
  }
  const onFocus=()=>{void refresh()};
  void refresh();window.addEventListener('focus',onFocus);
  const interval=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh()},45000);
  return()=>{live=false;window.removeEventListener('focus',onFocus);window.clearInterval(interval)};
 },[profile?.id,profile?.role]);
 if(!profile)return null;
 const active=(to:string)=>to==='/'?pathname==='/':to==='/voice'?(pathname.startsWith('/voice')||pathname.startsWith('/proposals')):pathname.startsWith(to);
 const hasWorkspace=assigned;
 return <div className="member-shell">
  <header className="member-header"><div className="member-header-inner">
   <NavLink to="/" className="member-brand"><img src={`${import.meta.env.BASE_URL}kmsa-logo.png`} alt="شعار رابطة طلاب كلية الطب"/><div><strong>رابطة طلاب كلية الطب</strong><span>جامعة الخرطوم</span></div></NavLink>
   <nav className="member-desktop-nav">{memberItems.map(({to,label,icon:Icon})=><NavLink key={to} to={to} className={active(to)?'active':''}><Icon size={17}/>{label}</NavLink>)}</nav>
   <div className="member-header-actions">{hasWorkspace&&<button className="member-workspace-button" onClick={()=>nav('/workspace')}><BriefcaseBusiness size={17}/><span>مساحة العمل</span></button>}<NotificationBell/><NavLink to="/account" className="member-account-chip"><span>{profile.full_name.trim().charAt(0)||'ع'}</span><div><strong>{profile.full_name.split(' ')[0]}</strong><small>{profile.university_id||'عضو'}</small></div></NavLink><button className="member-logout-icon" title="تسجيل الخروج" onClick={async()=>{await signOut();nav('/login')}}><LogOut size={18}/></button></div>
  </div></header>
  <main className="member-main"><Outlet/></main>
  <nav className="member-bottom-nav">{memberItems.map(({to,label,icon:Icon})=><NavLink key={to} to={to} className={active(to)?'active':''}><Icon size={21}/><span>{label}</span></NavLink>)}</nav>
  {hasWorkspace&&<button className="member-mobile-workspace" onClick={()=>nav('/workspace')}><BriefcaseBusiness size={18}/>مساحة العمل</button>}
 </div>
}


function AdminShell(){const nav=useNavigate();const {profile}=useAuth();return <div className="v59-admin-shell" dir="rtl"><header className="v59-admin-top"><div className="v59-admin-brand"><NavLink to="/workspace/admin" title="العودة لإدارة النظام"><img src={`${import.meta.env.BASE_URL}kmsa-logo.png`} alt="شعار رابطة طلاب كلية الطب"/></NavLink><div><strong>رابطة طلاب كلية الطب</strong><small>جامعة الخرطوم · إدارة النظام</small></div></div><div className="v59-admin-account"><span>{profile?.full_name||'مدير النظام'}</span><button onClick={()=>nav('/change-password')}><UserRound size={16}/> كلمة المرور</button><button onClick={async()=>{await signOut();nav('/login')}}><LogOut size={16}/> خروج</button></div></header><main className="v59-admin-main"><Outlet/></main></div>}

function WorkspaceShell(){
 const {profile}=useAuth(); const nav=useNavigate(); const [open,setOpen]=useState(false); const {pathname}=useLocation(); if(!profile)return null;
 const allowed=workspaceItems.filter(i=>i.roles.includes(profile.role));
 return <div className="workspace-shell">
  <aside className={`workspace-sidebar ${open?'workspace-sidebar-open':''}`}>
   <div className="workspace-brand"><NavLink to="/workspace" onClick={()=>setOpen(false)} title="الرئيسية"><img src={`${import.meta.env.BASE_URL}kmsa-logo.png`} alt="KMSA"/></NavLink><div><strong>مساحة العمل</strong><span>{profileTitle(profile)}</span></div><button className="mobile-close v55-close" aria-label="إغلاق القائمة" onClick={()=>setOpen(false)}><X/></button></div>
   <div className="workspace-user"><div>{profile.full_name.trim().charAt(0)}</div><span><strong>{profile.full_name}</strong><small>{profile.university_id||profileTitle(profile)}</small></span></div>
   <nav>{allowed.map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==='/workspace'} onClick={()=>setOpen(false)} className={({isActive})=>isActive||(to!=='/workspace'&&pathname.startsWith(to))?'workspace-nav active':'workspace-nav'}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
   <div className="workspace-sidebar-bottom"><button className="workspace-nav" onClick={async()=>{await signOut();nav('/login')}}><LogOut size={18}/>تسجيل الخروج</button></div>
  </aside>
  {open&&<button aria-label="إغلاق القائمة الجانبية" className="mobile-overlay v55-overlay" onClick={()=>setOpen(false)}/>} 
  <main className="workspace-main"><header className="workspace-topbar v55-topbar"><button className="menu-btn v55-nav-trigger" aria-label="فتح قائمة مساحة العمل" title="القائمة" onClick={()=>setOpen(true)}><Menu size={21}/></button><NavLink to="/workspace" aria-label="العودة لرئيسية مساحة العمل" title="العودة لرئيسية مساحة العمل"><img className="v55-top-logo" src={`${import.meta.env.BASE_URL}kmsa-logo.png`} alt="شعار الرابطة"/></NavLink><div className="v55-top-heading"><strong>{pathname.startsWith('/workspace/supervision')?'إشراف السكرتارية':pathname.startsWith('/workspace/projects')?'المشاريع':pathname.startsWith('/workspace/tasks')?'المهام':pathname.startsWith('/workspace/routine')?'العمل الدوري':pathname.startsWith('/workspace/proposals')?'المقترحات':pathname.startsWith('/workspace/reports')?'التقارير':'مساحة العمل'}</strong><span>{profile.secretariat?.name_ar||(['GS','PRESIDENT','ADMIN'].includes(profile.role)?'السكرتارية العامة':'رابطة طلاب كلية الطب — جامعة الخرطوم')}</span></div><div className="workspace-topbar-actions"><NotificationBell/><button className="workspace-home-chip v55-member-shortcut" onClick={()=>nav('/')}><Home size={16}/>بوابة العضو</button></div></header><div className="workspace-page"><Outlet/></div></main>
 </div>
}

export function AppShell(){const {pathname}=useLocation();const {profile}=useAuth();if(profile?.role==='ADMIN')return <AdminShell/>;return pathname.startsWith('/workspace')?<WorkspaceShell/>:<MemberShell/>}
