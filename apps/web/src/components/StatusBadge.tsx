export function StatusBadge({children,tone='neutral'}:{children:React.ReactNode;tone?:'neutral'|'good'|'warn'|'danger'|'info'}){
 return <span className={`badge badge-${tone}`}>{children}</span>
}
