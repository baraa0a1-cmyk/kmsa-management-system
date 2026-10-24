import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BriefcaseBusiness, ClipboardCheck, FileText, Gauge, Gavel, HandHeart, Home, LogOut, Megaphone, Menu, Network, Radar, RefreshCw, Target, UserRound, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { signOut } from '../lib/auth';
import { profileTitle, roleLabel } from '../lib/labels';
import { supabase } from '../lib/supabase';

const memberItems=[
 {to:'/',label:'الرئيسية',icon:Home},
 {to:'/opportunities',label:'الفرص',icon:BriefcaseBusiness},
 {to:'/services',label:'الخدمات',icon:HandHeart},
 {to:'/voice',label:'صوتك',icon:Megaphone},
 {to:'/account',label:'حسابي',icon:UserRound},
];
const workspaceItems=[
 {to:'/workspace',label:'الرئيسية',icon:Gauge,roles:['APPLICANT','MEMBER','SECRETARY','GS','PRESIDENT','ADMIN']},
 {to:'/workspace/structure',label:'الهيكل والفريق',icon:Network,roles:['SECRETARY','GS','PRESIDENT','ADMIN']},
 {to:'/workspace/projects',label:'المشاريع',icon:Target,roles:['APPLICANT','MEMBER','SECRETARY','GS','PRESIDENT','ADMIN']},
 {to:'/workspace/routine',label:'العمل الدوري',icon:RefreshCw,roles:['APPLICANT','MEMBER','SECRETARY','GS','PRESIDENT','ADMIN']},
 {to:'/workspace/proposals',label:'المقترحات',icon:FileText,roles:['SECRETARY','GS','PRESIDENT','ADMIN']},
 {to:'/workspace/reports',label:'التقارير',icon:ClipboardCheck,roles:['SECRETARY','GS','PRESIDENT','ADMIN']},
 {to:'/workspace/oversight',label:'المتابعة العامة',icon:Radar,roles:['GS','PRESIDENT','ADMIN']},
 {to:'/workspace/governance',label:'السجل الرسمي',icon:Gavel,roles:['GS','PRESIDENT','ADMIN']},
 {to:'/workspace/users',label:'الحسابات',icon:Users,roles:['ADMIN']},
];

function MemberShell(){
 const {profile}=useAuth(); const nav=useNavigate(); const {pathname}=useLocation(); const [assigned,setAssigned]=useState(false);
 useEffect(()=>{if(!profile)return;if(['SECRETARY','GS','PRESIDENT','ADMIN'].includes(profile.role)){setAssigned(true);return}(async()=>{const [a,b]=await Promise.all([supabase.from('initiatives').select('id',{count:'exact',head:true}).eq('owner_id',profile.id).eq('approval_status','APPROVED'),supabase.from('routine_obligations').select('id',{count:'exact',head:true}).eq('owner_id',profile.id).eq('active',true)]);setAssigned((a.count||0)>0||(b.count||0)>0)})()},[profile?.id,profile?.role]);
 if(!profile)return null;
 const active=(to:string)=>to==='/'?pathname==='/':to==='/voice'?(pathname.startsWith('/voice')||pathname.startsWith('/proposals')):pathname.startsWith(to);
 const hasWorkspace=assigned;
 return <div className="member-shell">
  <header className="member-header"><div className="member-header-inner">
   <NavLink to="/" className="member-brand"><img src={`${import.meta.env.BASE_URL}kmsa-logo.png`} alt="شعار رابطة طلاب كلية الطب"/><div><strong>رابطة طلاب كلية الطب</strong><span>جامعة الخرطوم</span></div></NavLink>
   <nav className="member-desktop-nav">{memberItems.map(({to,label,icon:Icon})=><NavLink key={to} to={to} className={active(to)?'active':''}><Icon size={17}/>{label}</NavLink>)}</nav>
   <div className="member-header-actions">{hasWorkspace&&<button className="member-workspace-button" onClick={()=>nav('/workspace')}><BriefcaseBusiness size={17}/><span>مساحة العمل</span></button>}<button className="member-icon-button" aria-label="الإشعارات"><Bell size={19}/></button><NavLink to="/account" className="member-account-chip"><span>{profile.full_name.trim().charAt(0)||'ع'}</span><div><strong>{profile.full_name.split(' ')[0]}</strong><small>{profile.university_id||'عضو'}</small></div></NavLink><button className="member-logout-icon" title="تسجيل الخروج" onClick={async()=>{await signOut();nav('/login')}}><LogOut size={18}/></button></div>
  </div></header>
  <main className="member-main"><Outlet/></main>
  <nav className="member-bottom-nav">{memberItems.map(({to,label,icon:Icon})=><NavLink key={to} to={to} className={active(to)?'active':''}><Icon size={21}/><span>{label}</span></NavLink>)}</nav>
  {hasWorkspace&&<button className="member-mobile-workspace" onClick={()=>nav('/workspace')}><BriefcaseBusiness size={18}/>مساحة العمل</button>}
 </div>
}

function WorkspaceShell(){
 const {profile}=useAuth(); const nav=useNavigate(); const [open,setOpen]=useState(false); const {pathname}=useLocation(); if(!profile)return null;
 const allowed=workspaceItems.filter(i=>i.roles.includes(profile.role));
 return <div className="workspace-shell">
  <aside className={`workspace-sidebar ${open?'workspace-sidebar-open':''}`}>
   <div className="workspace-brand"><img src={`${import.meta.env.BASE_URL}kmsa-logo.png`} alt="KMSA"/><div><strong>مساحة العمل</strong><span>{profileTitle(profile)}</span></div><button className="mobile-close" onClick={()=>setOpen(false)}><X/></button></div>
   <button className="workspace-back-member" onClick={()=>nav('/')}><Home size={17}/>بوابة العضو</button>
   <div className="workspace-user"><div>{profile.full_name.trim().charAt(0)}</div><span><strong>{profile.full_name}</strong><small>{profile.university_id||profileTitle(profile)}</small></span></div>
   <nav>{allowed.map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==='/workspace'} onClick={()=>setOpen(false)} className={({isActive})=>isActive||(to!=='/workspace'&&pathname.startsWith(to))?'workspace-nav active':'workspace-nav'}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
   <div className="workspace-sidebar-bottom"><button className="workspace-nav" onClick={async()=>{await signOut();nav('/login')}}><LogOut size={18}/>تسجيل الخروج</button></div>
  </aside>
  {open&&<div className="mobile-overlay" onClick={()=>setOpen(false)}/>} 
  <main className="workspace-main"><header className="workspace-topbar"><button className="menu-btn" onClick={()=>setOpen(true)}><Menu/></button><div><strong>{pathname.startsWith('/workspace/structure')?'الهيكل والفريق':pathname.startsWith('/workspace/projects')?'المشاريع':pathname.startsWith('/workspace/routine')?'العمل الدوري':pathname.startsWith('/workspace/proposals')?'المقترحات':pathname.startsWith('/workspace/reports')?'التقارير':'مساحة العمل'}</strong><span>متابعة مبكرة · مسؤولية واضحة · تدخل قبل التأخير</span></div><button className="workspace-home-chip" onClick={()=>nav('/')}><Home size={16}/>بوابة العضو</button></header><div className="workspace-page"><Outlet/></div></main>
 </div>
}

export function AppShell(){const {pathname}=useLocation();return pathname.startsWith('/workspace')?<WorkspaceShell/>:<MemberShell/>}
