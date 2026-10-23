import { Inbox } from 'lucide-react';
export function EmptyState({title='لا توجد بيانات',text='ستظهر العناصر هنا عند توفرها.',action}:{title?:string;text?:string;action?:React.ReactNode}){
 return <div className="empty-state"><Inbox size={34}/><h3>{title}</h3><p>{text}</p>{action}</div>
}
