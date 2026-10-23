import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AppShell } from './components/AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import WorkPage from './pages/WorkPage';
import PlanningPage from './pages/PlanningPage';
import GovernancePage from './pages/GovernancePage';
import MilestonePage from './pages/MilestonePage';
import ProposalsPage from './pages/ProposalsPage';
import ProposalPage from './pages/ProposalPage';
import ProposalEditorPage from './pages/ProposalEditorPage';
import ReportsPage from './pages/ReportsPage';
import PerformancePage from './pages/PerformancePage';
import ArchivePage from './pages/ArchivePage';
import AdminPage from './pages/AdminPage';
import UsersPage from './pages/UsersPage';
import PasswordChangePage from './pages/PasswordChangePage';

function Guard({children}:{children:React.ReactNode}){const {session,profile,loading}=useAuth(); if(loading)return <div className="splash"><div className="loader"/><div>جارٍ تجهيز مساحة العمل…</div></div>; if(!session)return <Navigate to="/login" replace/>; if(profile?.must_change_password)return <Navigate to="/change-password" replace/>; return <>{children}</>}
function LoginGuard(){const {session,loading}=useAuth();if(loading)return <div className="splash"><div className="loader"/></div>;return session?<Navigate to="/" replace/>:<LoginPage/>}
export default function App(){return <AuthProvider><Routes><Route path="/login" element={<LoginGuard/>}/><Route path="/change-password" element={<PasswordChangePage/>}/><Route element={<Guard><AppShell/></Guard>}><Route path="/" element={<DashboardPage/>}/><Route path="/planning" element={<PlanningPage/>}/><Route path="/work" element={<WorkPage/>}/><Route path="/work/milestone/:id" element={<MilestonePage/>}/><Route path="/proposals" element={<ProposalsPage/>}/><Route path="/proposals/new" element={<ProposalEditorPage/>}/><Route path="/proposals/:id" element={<ProposalPage/>}/><Route path="/proposals/:id/edit" element={<ProposalEditorPage/>}/><Route path="/governance" element={<GovernancePage/>}/><Route path="/reports" element={<ReportsPage/>}/><Route path="/performance" element={<PerformancePage/>}/><Route path="/archive" element={<ArchivePage/>}/><Route path="/admin" element={<AdminPage/>}/><Route path="/users" element={<UsersPage/>}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes></AuthProvider>}
