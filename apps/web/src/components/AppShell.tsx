import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Archive, BarChart3, ClipboardCheck, FileText, Gauge, Gavel, Layers3, LogOut, Menu, Settings, Target, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { signOut } from '../lib/auth';
import { roleLabel } from '../lib/labels';

const items=[
 {to:'/',label:'الرئيسية',icon:Gauge,roles:['APPLICANT','MEMBER','SECRETARY','GS','ADMIN']},
 {to:'/planning',label:'الخطط والنتائج',icon:Layers3,roles:['MEMBER','SECRETARY','GS','ADMIN']},
 {to:'/work',label:'العمل والمتابعة',icon:Target,roles:['MEMBER','SECRETARY','GS','ADMIN']},
 {to:'/proposals',label:'المقترحات',icon:FileText,roles:['APPLICANT','MEMBER','SECRETARY','GS','ADMIN']},
 {to:'/governance',label:'الاجتماعات والقرارات',icon:Gavel,roles:['SECRETARY','GS','ADMIN']},
 {to:'/reports',label:'التقرير الأسبوعي',icon:ClipboardCheck,roles:['SECRETARY','GS','ADMIN']},
 {to:'/performance',label:'الأداء',icon:BarChart3,roles:['SECRETARY','GS','ADMIN']},
 {to:'/archive',label:'الأرشيف',icon:Archive,roles:['MEMBER','SECRETARY','GS','ADMIN']},
 {to:'/admin',label:'الإدارة',icon:Settings,roles:['ADMIN']},
 {to:'/users',label:'الأعضاء',icon:Users,roles:['GS','ADMIN']},
];
export function AppShell(){
 const {profile}=useAuth(); const nav=useNavigate(); const [open,setOpen]=useState(false); if(!profile)return null;
 const allowed=items.filter(i=>i.roles.includes(profile.role));
 return <div className="shell">
  <aside className={`sidebar ${open?'sidebar-open':''}`}>
   <div className="brand"><div className="brand-mark">K</div><div><strong>KMSA</strong><span>Management System</span></div><button className="mobile-close" onClick={()=>setOpen(false)}><X/></button></div>
   <div className="user-card"><div className="avatar">{profile.full_name.trim().charAt(0)||'K'}</div><div><strong>{profile.full_name}</strong><span>{roleLabel[profile.role]}{profile.university_id?` · ${profile.university_id}`:''}</span></div></div>
   <nav>{allowed.map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==='/'} onClick={()=>setOpen(false)} className={({isActive})=>isActive?'nav-link active':'nav-link'}><Icon size={19}/><span>{label}</span></NavLink>)}</nav>
   <div className="sidebar-bottom"><button className="nav-link logout" onClick={async()=>{await signOut();nav('/login')}}><LogOut size={19}/>تسجيل الخروج</button></div>
  </aside>
  {open&&<div className="mobile-overlay" onClick={()=>setOpen(false)}/>} 
  <main className="main"><header className="topbar"><button className="menu-btn" onClick={()=>setOpen(true)}><Menu/></button><div><div className="topbar-title">نظام إدارة الرابطة</div><div className="topbar-sub">قرارات أوضح · متابعة قابلة للتحقق · ذاكرة مؤسسية</div></div></header><div className="page-wrap"><Outlet/></div></main>
 </div>
}
