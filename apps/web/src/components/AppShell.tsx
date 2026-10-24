import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Archive, BarChart3, Bell, BriefcaseBusiness, ClipboardCheck, FileText, Gauge, Gavel, HandHeart, Home, Layers3, LogOut, Megaphone, Menu, Settings, Target, UserRound, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { signOut } from '../lib/auth';
import { roleLabel } from '../lib/labels';

const staffItems=[
 {to:'/',label:'الرئيسية',icon:Gauge,roles:['MEMBER','SECRETARY','GS','ADMIN']},
 {to:'/planning',label:'الخطط والنتائج',icon:Layers3,roles:['MEMBER','SECRETARY','GS','ADMIN']},
 {to:'/work',label:'العمل والمتابعة',icon:Target,roles:['MEMBER','SECRETARY','GS','ADMIN']},
 {to:'/proposals',label:'المقترحات',icon:FileText,roles:['MEMBER','SECRETARY','GS','ADMIN']},
 {to:'/governance',label:'الاجتماعات والقرارات',icon:Gavel,roles:['SECRETARY','GS','ADMIN']},
 {to:'/reports',label:'التقرير الأسبوعي',icon:ClipboardCheck,roles:['SECRETARY','GS','ADMIN']},
 {to:'/performance',label:'الأداء',icon:BarChart3,roles:['SECRETARY','GS','ADMIN']},
 {to:'/archive',label:'الأرشيف',icon:Archive,roles:['MEMBER','SECRETARY','GS','ADMIN']},
 {to:'/admin',label:'الإدارة',icon:Settings,roles:['ADMIN']},
 {to:'/users',label:'الأعضاء',icon:Users,roles:['GS','ADMIN']},
];
const memberItems=[
 {to:'/',label:'الرئيسية',icon:Home},
 {to:'/opportunities',label:'الفرص',icon:BriefcaseBusiness},
 {to:'/services',label:'الخدمات',icon:HandHeart},
 {to:'/voice',label:'صوتك',icon:Megaphone},
 {to:'/account',label:'حسابي',icon:UserRound},
];

function MemberShell(){
 const {profile}=useAuth(); const nav=useNavigate(); const {pathname}=useLocation();
 if(!profile)return null;
 const active=(to:string)=>to==='/'?pathname==='/':to==='/voice'?(pathname.startsWith('/voice')||pathname.startsWith('/proposals')):pathname.startsWith(to);
 return <div className="member-shell">
  <header className="member-header">
   <div className="member-header-inner">
    <NavLink to="/" className="member-brand"><img src={`${import.meta.env.BASE_URL}kmsa-logo.png`} alt="شعار رابطة طلاب كلية الطب"/><div><strong>رابطة طلاب كلية الطب</strong><span>جامعة الخرطوم</span></div></NavLink>
    <nav className="member-desktop-nav">{memberItems.map(({to,label,icon:Icon})=><NavLink key={to} to={to} className={active(to)?'active':''}><Icon size={17}/>{label}</NavLink>)}</nav>
    <div className="member-header-actions"><button className="member-icon-button" aria-label="الإشعارات"><Bell size={19}/></button><NavLink to="/account" className="member-account-chip"><span>{profile.full_name.trim().charAt(0)||'ع'}</span><div><strong>{profile.full_name.split(' ')[0]}</strong><small>{profile.university_id||'عضو'}</small></div></NavLink><button className="member-logout-icon" title="تسجيل الخروج" onClick={async()=>{await signOut();nav('/login')}}><LogOut size={18}/></button></div>
   </div>
  </header>
  <main className="member-main"><Outlet/></main>
  <nav className="member-bottom-nav">{memberItems.map(({to,label,icon:Icon})=><NavLink key={to} to={to} className={active(to)?'active':''}><Icon size={21}/><span>{label}</span></NavLink>)}</nav>
 </div>
}

function StaffShell(){
 const {profile}=useAuth(); const nav=useNavigate(); const [open,setOpen]=useState(false); if(!profile)return null;
 const allowed=staffItems.filter(i=>i.roles.includes(profile.role));
 return <div className="shell">
  <aside className={`sidebar ${open?'sidebar-open':''}`}>
   <div className="brand"><img className="staff-logo" src={`${import.meta.env.BASE_URL}kmsa-logo.png`} alt="KMSA"/><div><strong>KMSA</strong><span>Management System</span></div><button className="mobile-close" onClick={()=>setOpen(false)}><X/></button></div>
   <div className="user-card"><div className="avatar">{profile.full_name.trim().charAt(0)||'K'}</div><div><strong>{profile.full_name}</strong><span>{roleLabel[profile.role]}{profile.university_id?` · ${profile.university_id}`:''}</span></div></div>
   <nav>{allowed.map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==='/'} onClick={()=>setOpen(false)} className={({isActive})=>isActive?'nav-link active':'nav-link'}><Icon size={19}/><span>{label}</span></NavLink>)}</nav>
   <div className="sidebar-bottom"><button className="nav-link logout" onClick={async()=>{await signOut();nav('/login')}}><LogOut size={19}/>تسجيل الخروج</button></div>
  </aside>
  {open&&<div className="mobile-overlay" onClick={()=>setOpen(false)}/>} 
  <main className="main"><header className="topbar"><button className="menu-btn" onClick={()=>setOpen(true)}><Menu/></button><div><div className="topbar-title">نظام إدارة الرابطة</div><div className="topbar-sub">قرارات أوضح · متابعة قابلة للتحقق · ذاكرة مؤسسية</div></div></header><div className="page-wrap"><Outlet/></div></main>
 </div>
}

export function AppShell(){const {profile}=useAuth(); if(!profile)return null; return profile.role==='APPLICANT'?<MemberShell/>:<StaffShell/>}
