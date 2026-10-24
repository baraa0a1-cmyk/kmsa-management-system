import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { workspaceProjects } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { Initiative, Milestone, ProjectIntervention, ProjectUpdate } from '../lib/types';
import { formatDate } from '../lib/labels';

export default function WorkspaceWeeklyPage(){
 const [projects,setProjects]=useState<Initiative[]>([]);const [milestones,setMilestones]=useState<Milestone[]>([]);const [updates,setUpdates]=useState<ProjectUpdate[]>([]);const [interventions,setInterventions]=useState<ProjectIntervention[]>([]);
 useEffect(()=>{(async()=>{setProjects(await workspaceProjects());const [m,u,i]=await Promise.all([supabase.from('milestones').select('*,result:results(*)').order('due_at'),supabase.from('project_updates').select('*').order('created_at',{ascending:false}),supabase.from('project_interventions').select('*').order('created_at',{ascending:false})]);setMilestones((m.data||[]) as any);setUpdates((u.data||[]) as any);setInterventions((i.data||[]) as any)})()},[]);
 const rows=useMemo(()=>projects.filter(p=>p.status!=='COMPLETED'&&p.setup_status==='ACTIVE').map(p=>{const projectUpdates=updates.filter(u=>u.initiative_id===p.id);const latest=projectUpdates[0];const projectMs=milestones.filter((m:any)=>{const r=m.result as any;return r&&r.initiative_id===p.id&&!['VERIFIED','CANCELLED'].includes(m.status)}).sort((a,b)=>new Date(a.due_at).getTime()-new Date(b.due_at).getTime());const next=projectMs[0];const ints=interventions.filter(i=>i.initiative_id===p.id&&i.status==='OPEN');return {p,latest,next,ints}}),[projects,milestones,updates,interventions]);
 return <div className="workspace-stack"><div className="workspace-page-head"><div><span className="workspace-kicker">المتابعة الدورية</span><h1>صورة التنفيذ الحالية</h1><p>تُجمع تلقائيًا من واقع المشاريع: آخر تحديث، المحطة القادمة، والتدخل المفتوح. لا تطلب من السكرتير إعادة كتابة العمل في نموذج موازٍ.</p></div></div>
 <section className="workspace-card"><div className="workspace-week-list">{rows.map(({p,latest,next,ints})=><Link to={`/workspace/projects/${p.id}`} className="workspace-week-row" key={p.id}><div className="workspace-week-title"><div className={`workspace-project-health ${p.health==='ON_TRACK'?'good':p.health==='WATCH'?'warn':'danger'}`}>{p.health==='ON_TRACK'?<CheckCircle2/>:<AlertTriangle/>}</div><div><strong>{p.title}</strong><span>{p.secretariat?.name_ar||''} · {p.owner?.full_name||'—'}</span></div></div><div className="workspace-week-cell"><small>آخر تحديث</small><strong>{latest?latest.progress_note:'لا يوجد تحديث بعد'}</strong></div><div className="workspace-week-cell"><small>القادم</small><strong>{next?next.title:'لا توجد محطة مفتوحة'}</strong><span>{next?formatDate(next.due_at):''}</span></div><div className="workspace-week-cell"><small>تدخل مفتوح</small><strong>{ints.length?ints[0].action_text:'لا يوجد'}</strong></div></Link>)}{!rows.length&&<div className="workspace-empty"><CalendarDays/>لا توجد مشاريع نشطة لتكوين صورة الأسبوع.</div>}</div></section>
 </div>
}
