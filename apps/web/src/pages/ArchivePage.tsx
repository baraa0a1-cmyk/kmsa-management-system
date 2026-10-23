import { useEffect, useState } from 'react';
import { Archive, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { downloadDriveFile } from '../lib/api';
import { EmptyState } from '../components/EmptyState';
import { formatDateTime } from '../lib/labels';

export default function ArchivePage(){const [files,setFiles]=useState<any[]>([]);useEffect(()=>{supabase.from('file_assets').select('*').order('created_at',{ascending:false}).limit(100).then(({data})=>setFiles(data||[]))},[]);return <><div className="page-head"><div><h1>الأرشيف</h1><p>Google Drive هو مخزن الملفات، بينما قاعدة البيانات تحفظ الفهرسة والنسخ والعلاقة بالسجل المؤسسي.</p></div></div><div className="card card-pad"><div className="section-title"><div><h2>آخر الملفات</h2></div></div>{files.length?<div className="list">{files.map(f=><div className="list-item" key={f.id}><div className="item-main"><div className="item-title">{f.file_name}</div><div className="item-meta"><span>{f.entity_type}</span><span>{formatDateTime(f.created_at)}</span></div></div><button className="btn btn-secondary" onClick={()=>downloadDriveFile(f.drive_file_id)}><ExternalLink size={15}/>تنزيل</button></div>)}</div>:<EmptyState title="الأرشيف فارغ"/>}</div></>}
