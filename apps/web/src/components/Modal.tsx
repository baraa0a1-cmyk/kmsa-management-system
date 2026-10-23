export function Modal({open,title,onClose,children,footer}:{open:boolean;title:string;onClose:()=>void;children:React.ReactNode;footer?:React.ReactNode}){
 if(!open)return null; return <div className="modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)onClose()}}><div className="modal"><div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}>×</button></div><div className="modal-body">{children}</div>{footer&&<div className="modal-footer">{footer}</div>}</div></div>
}
