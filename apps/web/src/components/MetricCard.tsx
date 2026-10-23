export function MetricCard({label,value,hint,icon}:{label:string;value:React.ReactNode;hint?:string;icon?:React.ReactNode}){
 return <div className="metric-card"><div className="metric-icon">{icon}</div><div><div className="metric-value">{value}</div><div className="metric-label">{label}</div>{hint&&<div className="metric-hint">{hint}</div>}</div></div>
}
