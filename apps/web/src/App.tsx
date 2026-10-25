import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AppShell } from './components/AppShell';
import LoginPage from './pages/LoginPage';
import MemberHomePage from './pages/MemberHomePage';
import MemberOpportunitiesPage from './pages/MemberOpportunitiesPage';
import MemberServicesPage from './pages/MemberServicesPage';
import MemberVoicePage from './pages/MemberVoicePage';
import MemberAccountPage from './pages/MemberAccountPage';
import MemberProposalsPage from './pages/MemberProposalsPage';
import MemberProposalDetailPage from './pages/MemberProposalDetailPage';
import ProposalEditorPage from './pages/ProposalEditorPage';
import WorkspaceProposalsPage from './pages/WorkspaceProposalsPage';
import ProposalPage from './pages/ProposalPage';
import GovernancePage from './pages/GovernancePage';
import PerformancePage from './pages/PerformancePage';
import AdminPage from './pages/AdminPage';
import UsersPage from './pages/UsersPage';
import PasswordChangePage from './pages/PasswordChangePage';
import WorkspaceHomePage from './pages/WorkspaceHomePage';
import WorkspaceProjectsPage from './pages/WorkspaceProjectsPage';
import WorkspaceSupervisionPage from './pages/WorkspaceSupervisionPage';
import WorkspaceProjectCreatePage from './pages/WorkspaceProjectCreatePage';
import WorkspaceProjectPage from './pages/WorkspaceProjectPage';
import WorkspaceApprovalsPage from './pages/WorkspaceApprovalsPage';
import WorkspaceOversightPage from './pages/WorkspaceOversightPage';
import WorkspaceReportsPage from './pages/WorkspaceReportsPage';
import WorkspaceRoutinePage from './pages/WorkspaceRoutinePage';
import WorkspaceTasksPage from './pages/WorkspaceTasksPage';
import MilestonePage from './pages/MilestonePage';

function Guard({children}:{children:React.ReactNode}){const {session,profile,loading}=useAuth(); if(loading)return <div className="splash"><div className="loader"/><div>جارٍ تجهيز حسابك…</div></div>; if(!session)return <Navigate to="/login" replace/>; if(profile?.must_change_password)return <Navigate to="/change-password" replace/>; return <>{children}</>}
function LoginGuard(){const {session,loading}=useAuth();if(loading)return <div className="splash"><div className="loader"/></div>;return session?<Navigate to="/" replace/>:<LoginPage/>}
function WorkspaceOnly({children}:{children:React.ReactNode}){const {profile}=useAuth();return profile?<>{children}</>:<Navigate to="/" replace/>}
function SecretaryOrAbove({children}:{children:React.ReactNode}){const {profile}=useAuth();return profile&&['SECRETARY','GS','PRESIDENT','ADMIN'].includes(profile.role)?<>{children}</>:<Navigate to="/workspace" replace/>}
function SecretaryOrAdmin({children}:{children:React.ReactNode}){const {profile}=useAuth();return profile&&['SECRETARY','ADMIN'].includes(profile.role)?<>{children}</>:<Navigate to="/workspace" replace/>}
function OversightOnly({children}:{children:React.ReactNode}){const {profile}=useAuth();return profile&&['GS','PRESIDENT','ADMIN'].includes(profile.role)?<>{children}</>:<Navigate to="/workspace" replace/>}
function AdminOnly({children}:{children:React.ReactNode}){const {profile}=useAuth();return profile?.role==='ADMIN'?<>{children}</>:<Navigate to="/workspace" replace/>}

export default function App(){return <AuthProvider><Routes>
 <Route path="/login" element={<LoginGuard/>}/><Route path="/change-password" element={<PasswordChangePage/>}/>
 <Route element={<Guard><AppShell/></Guard>}>
  <Route path="/" element={<MemberHomePage/>}/>
  <Route path="/opportunities" element={<MemberOpportunitiesPage/>}/>
  <Route path="/services" element={<MemberServicesPage/>}/>
  <Route path="/voice" element={<MemberVoicePage/>}/>
  <Route path="/account" element={<MemberAccountPage/>}/>
  <Route path="/proposals" element={<MemberProposalsPage/>}/>
  <Route path="/proposals/new" element={<ProposalEditorPage/>}/>
  <Route path="/proposals/:id" element={<MemberProposalDetailPage/>}/>
  <Route path="/proposals/:id/edit" element={<ProposalEditorPage/>}/>

  <Route path="/workspace" element={<WorkspaceOnly><WorkspaceHomePage/></WorkspaceOnly>}/>
  <Route path="/workspace/supervision" element={<SecretaryOrAbove><WorkspaceSupervisionPage/></SecretaryOrAbove>}/>
  <Route path="/workspace/projects" element={<WorkspaceOnly><WorkspaceProjectsPage/></WorkspaceOnly>}/>
  <Route path="/workspace/projects/new" element={<SecretaryOrAdmin><WorkspaceProjectCreatePage/></SecretaryOrAdmin>}/><Route path="/workspace/projects/:id/edit" element={<SecretaryOrAdmin><WorkspaceProjectCreatePage/></SecretaryOrAdmin>}/>
  <Route path="/workspace/projects/:id" element={<WorkspaceOnly><WorkspaceProjectPage/></WorkspaceOnly>}/>
  <Route path="/workspace/milestones/:id" element={<WorkspaceOnly><MilestonePage/></WorkspaceOnly>}/>
  <Route path="/workspace/approvals" element={<SecretaryOrAbove><WorkspaceApprovalsPage/></SecretaryOrAbove>}/>
  <Route path="/workspace/tasks" element={<WorkspaceOnly><WorkspaceTasksPage/></WorkspaceOnly>}/>
  <Route path="/workspace/routine" element={<WorkspaceOnly><WorkspaceRoutinePage/></WorkspaceOnly>}/>
  <Route path="/workspace/reports" element={<SecretaryOrAbove><WorkspaceReportsPage/></SecretaryOrAbove>}/>
  <Route path="/workspace/weekly" element={<Navigate to="/workspace/reports" replace/>}/>
  <Route path="/workspace/oversight" element={<OversightOnly><WorkspaceOversightPage/></OversightOnly>}/>
  <Route path="/workspace/proposals" element={<SecretaryOrAbove><WorkspaceProposalsPage/></SecretaryOrAbove>}/>
  <Route path="/workspace/proposals/new" element={<WorkspaceOnly><ProposalEditorPage/></WorkspaceOnly>}/>
  <Route path="/workspace/proposals/:id/edit" element={<WorkspaceOnly><ProposalEditorPage/></WorkspaceOnly>}/>
  <Route path="/workspace/proposals/:id" element={<SecretaryOrAbove><ProposalPage/></SecretaryOrAbove>}/>
  <Route path="/workspace/governance" element={<OversightOnly><GovernancePage/></OversightOnly>}/>
  <Route path="/workspace/performance" element={<OversightOnly><PerformancePage/></OversightOnly>}/>
  <Route path="/workspace/admin" element={<AdminOnly><AdminPage/></AdminOnly>}/>
  <Route path="/workspace/users" element={<AdminOnly><UsersPage/></AdminOnly>}/>
 </Route>
 <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes></AuthProvider>}
