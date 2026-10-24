import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AppShell } from './components/AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import MemberHomePage from './pages/MemberHomePage';
import MemberOpportunitiesPage from './pages/MemberOpportunitiesPage';
import MemberServicesPage from './pages/MemberServicesPage';
import MemberVoicePage from './pages/MemberVoicePage';
import MemberAccountPage from './pages/MemberAccountPage';
import MemberProposalsPage from './pages/MemberProposalsPage';
import MemberProposalDetailPage from './pages/MemberProposalDetailPage';
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

function Guard({children}:{children:React.ReactNode}){const {session,profile,loading}=useAuth(); if(loading)return <div className="splash"><div className="loader"/><div>جارٍ تجهيز حسابك…</div></div>; if(!session)return <Navigate to="/login" replace/>; if(profile?.must_change_password)return <Navigate to="/change-password" replace/>; return <>{children}</>}
function LoginGuard(){const {session,loading}=useAuth();if(loading)return <div className="splash"><div className="loader"/></div>;return session?<Navigate to="/" replace/>:<LoginPage/>}
function HomeRoute(){const {profile}=useAuth();return profile?.role==='APPLICANT'?<MemberHomePage/>:<DashboardPage/>}
function ProposalListRoute(){const {profile}=useAuth();return profile?.role==='APPLICANT'?<MemberProposalsPage/>:<ProposalsPage/>}
function ProposalDetailRoute(){const {profile}=useAuth();return profile?.role==='APPLICANT'?<MemberProposalDetailPage/>:<ProposalPage/>}
function StaffOnly({children}:{children:React.ReactNode}){const {profile}=useAuth();return profile?.role==='APPLICANT'?<Navigate to="/" replace/>:<>{children}</>}
function MemberOnly({children}:{children:React.ReactNode}){const {profile}=useAuth();return profile?.role==='APPLICANT'?<>{children}</>:<Navigate to="/" replace/>}

export default function App(){return <AuthProvider><Routes><Route path="/login" element={<LoginGuard/>}/><Route path="/change-password" element={<PasswordChangePage/>}/><Route element={<Guard><AppShell/></Guard>}>
 <Route path="/" element={<HomeRoute/>}/>
 <Route path="/opportunities" element={<MemberOnly><MemberOpportunitiesPage/></MemberOnly>}/>
 <Route path="/services" element={<MemberOnly><MemberServicesPage/></MemberOnly>}/>
 <Route path="/voice" element={<MemberOnly><MemberVoicePage/></MemberOnly>}/>
 <Route path="/account" element={<MemberOnly><MemberAccountPage/></MemberOnly>}/>
 <Route path="/planning" element={<StaffOnly><PlanningPage/></StaffOnly>}/>
 <Route path="/work" element={<StaffOnly><WorkPage/></StaffOnly>}/>
 <Route path="/work/milestone/:id" element={<StaffOnly><MilestonePage/></StaffOnly>}/>
 <Route path="/proposals" element={<ProposalListRoute/>}/>
 <Route path="/proposals/new" element={<ProposalEditorPage/>}/>
 <Route path="/proposals/:id" element={<ProposalDetailRoute/>}/>
 <Route path="/proposals/:id/edit" element={<ProposalEditorPage/>}/>
 <Route path="/governance" element={<StaffOnly><GovernancePage/></StaffOnly>}/>
 <Route path="/reports" element={<StaffOnly><ReportsPage/></StaffOnly>}/>
 <Route path="/performance" element={<StaffOnly><PerformancePage/></StaffOnly>}/>
 <Route path="/archive" element={<StaffOnly><ArchivePage/></StaffOnly>}/>
 <Route path="/admin" element={<StaffOnly><AdminPage/></StaffOnly>}/>
 <Route path="/users" element={<StaffOnly><UsersPage/></StaffOnly>}/>
 </Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes></AuthProvider>}
