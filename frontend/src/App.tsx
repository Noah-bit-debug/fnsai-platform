import { useUser, SignIn, RedirectToSignIn } from '@clerk/clerk-react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RBACProvider } from './contexts/RBACContext';
import CandidateList from './pages/candidates/CandidateList';
import CandidateNew from './pages/candidates/CandidateNew';
import CandidateDetail from './pages/candidates/CandidateDetail';
// ATS Phase 2
import JobList from './pages/jobs/JobList';
import JobNew from './pages/jobs/JobNew';
import JobDetail from './pages/jobs/JobDetail';
import SubmissionList from './pages/submissions/SubmissionList';
import SubmissionDetail from './pages/submissions/SubmissionDetail';
import ClientOrgList from './pages/clients/ClientOrgList';
import ClientOrgDetail from './pages/clients/ClientOrgDetail';
import KanbanBoard from './pages/KanbanBoard';
import Pipeline from './pages/Pipeline';
import Reminders from './pages/Reminders';
import RoleDashboard from './pages/RoleDashboard';
import Integrations from './pages/Integrations';
import Reports from './pages/Reports';
import CompanyKnowledge from './pages/CompanyKnowledge';
import ClarificationCenter from './pages/ClarificationCenter';
import Templates from './pages/Templates';
import Suggestions from './pages/Suggestions';
import DailySummary from './pages/DailySummary';
import TimeTracking from './pages/TimeTracking';
import Attendance from './pages/Attendance';
import TimeTrackingManager from './pages/TimeTrackingManager';
import TimeTrackingAdmin from './pages/TimeTrackingAdmin';

// DEV BYPASS — set localStorage.setItem('sentrix_dev_bypass','1') in console to skip auth
const DEV_BYPASS = import.meta.env.DEV && localStorage.getItem('fnsai_dev_bypass') === '1';
import AppShell from './components/Layout/AppShell';
import ESign from './pages/ESign';
import SignDocument from './pages/SignDocument';
import ESignDashboard from './pages/esign/ESignDashboard';
import ESignDocuments from './pages/esign/ESignDocuments';
import ESignDocumentNew from './pages/esign/ESignDocumentNew';
import ESignDocumentDetail from './pages/esign/ESignDocumentDetail';
import ESignAnalytics from './pages/esign/ESignAnalytics';
import ESignPrepare from './pages/esign/ESignPrepare';
import ESignTemplates from './pages/esign/ESignTemplates';
import ESignForms from './pages/esign/ESignForms';

import ComplianceReports from './pages/compliance/ComplianceReports';
import MyCertificates from './pages/compliance/MyCertificates';
import CertificateVerify from './pages/compliance/CertificateVerify';
import ComplianceAdminHub from './pages/compliance/ComplianceAdminHub';
import CategoryManager from './pages/compliance/CategoryManager';
import PolicyList from './pages/compliance/PolicyList';
import PolicyEditor from './pages/compliance/PolicyEditor';
import DocumentList from './pages/compliance/DocumentList';
import DocumentEditor from './pages/compliance/DocumentEditor';
import MyCompliance from './pages/compliance/MyCompliance';
import PolicySign from './pages/compliance/PolicySign';
import DocumentView from './pages/compliance/DocumentView';
import ComplianceRecords from './pages/compliance/ComplianceRecords';
import ExamList from './pages/compliance/ExamList';
import ExamEditor from './pages/compliance/ExamEditor';
import ChecklistList from './pages/compliance/ChecklistList';
import ChecklistEditor from './pages/compliance/ChecklistEditor';
import BundleList from './pages/compliance/BundleList';
import BundleEditor from './pages/compliance/BundleEditor';
import BundleAssign from './pages/compliance/BundleAssign';
import TakeExam from './pages/compliance/TakeExam';
import CompleteChecklist from './pages/compliance/CompleteChecklist';
import NotificationSettings from './pages/compliance/NotificationSettings';
import PlacementReadinessAdmin from './pages/compliance/PlacementReadinessAdmin';
import BulkAssign from './pages/compliance/BulkAssign';
import MessageCenter from './pages/compliance/MessageCenter';

// Role dashboards
import CEODashboard from './pages/dashboards/CEODashboard';
import ManagementDashboard from './pages/dashboards/ManagementDashboard';
import RecruitingDashboard from './pages/dashboards/RecruitingDashboard';
import HRDashboard from './pages/dashboards/HRDashboard';
import CredentialingDashboard from './pages/dashboards/CredentialingDashboard';
import ComplianceDashboard from './pages/dashboards/ComplianceDashboard';

// Always-built pages
import Dashboard from './pages/Dashboard';
import AIAssistant from './pages/AIAssistant';
import StaffManagement from './pages/StaffManagement';
import StaffProfile from './pages/StaffProfile';
import DocumentChecker from './pages/DocumentChecker';
import EmailMonitor from './pages/EmailMonitor';
import SMSApprovals from './pages/SMSApprovals';
import AILearning from './pages/AILearning';
import DocumentQA from './pages/DocumentQA';

// Business Dev
import BusinessDev from './pages/BusinessDev';

// Business Ops
import ActionPlan from './pages/ActionPlan';
import Insurance from './pages/Insurance';
import Funding from './pages/Funding';
import Timeline from './pages/Timeline';
import Contracts from './pages/Contracts';

// Workforce
import Onboarding from './pages/Onboarding';
import Credentialing from './pages/Credentialing';
import Placements from './pages/Placements';
import Checklists from './pages/Checklists';

// Operations & Controls
import Clients from './pages/Clients';
import Incidents from './pages/Incidents';
import Timekeeping from './pages/Timekeeping';
import DocumentLogs from './pages/DocumentLogs';

// Admin
import UserManagement from './pages/admin/UserManagement';
import NotificationPrefs from './pages/admin/NotificationPrefs';

// AI System & Account
import AIBrain from './pages/AIBrain';
import TrainingHub from './pages/TrainingHub';
import SetupWizard from './pages/SetupWizard';
import Security from './pages/Security';
import AIKnowledgeBase from './pages/AIKnowledgeBase';

function App() {
  const { isLoaded, isSignedIn } = useUser();

  // DEV bypass — skip auth entirely for pressure testing
  if (DEV_BYPASS) return <RBACProvider><AppRoutes /></RBACProvider>;

  if (!isLoaded) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--prd)',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            border: '3px solid rgba(255,255,255,0.15)',
            borderTopColor: 'var(--ac)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--prd)',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 600, color: '#fff', marginBottom: 4 }}>
          FNS <span style={{ color: 'var(--ac)' }}>AI</span>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 24 }}>
          FNS AI Compliance Infrastructure — Secure Login
        </div>
        <SignIn routing="hash" />
      </div>
    );
  }

  return (
    <RBACProvider>
      <AppRoutes />
    </RBACProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />

        {/* Business Dev */}
        <Route path="business-dev" element={<BusinessDev />} />

        {/* Business Ops */}
        <Route path="action-plan" element={<ActionPlan />} />
        <Route path="insurance" element={<Insurance />} />
        <Route path="funding" element={<Funding />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="contracts" element={<Contracts />} />

        {/* Workforce */}
        <Route path="staff" element={<StaffManagement />} />
        <Route path="staff/:id" element={<StaffProfile />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="credentialing" element={<Credentialing />} />
        <Route path="placements" element={<Placements />} />
        <Route path="checklists" element={<Checklists />} />

        {/* Operations */}
        <Route path="clients" element={<Clients />} />
        <Route path="email-monitor" element={<EmailMonitor />} />
        <Route path="sms" element={<SMSApprovals />} />
        <Route path="documents" element={<DocumentChecker />} />

        {/* Internal Controls */}
        <Route path="incidents" element={<Incidents />} />
        <Route path="timekeeping" element={<Timekeeping />} />
        <Route path="logs" element={<DocumentLogs />} />

        {/* Intelligence */}
        <Route path="integrations" element={<Integrations />} />
        <Route path="reports" element={<Reports />} />
        <Route path="knowledge" element={<CompanyKnowledge />} />
        <Route path="clarification" element={<ClarificationCenter />} />
        <Route path="templates" element={<Templates />} />
        <Route path="suggestions" element={<Suggestions />} />
        <Route path="daily-summary" element={<DailySummary />} />

        {/* AI System */}
        <Route path="ai-assistant" element={<AIAssistant />} />
        <Route path="ai-knowledge" element={<AIKnowledgeBase />} />
        {/* Redirect old AI URLs → consolidated AI Knowledge Base */}
        <Route path="knowledge"    element={<Navigate to="/ai-knowledge" replace />} />
        <Route path="ai-learning"  element={<Navigate to="/ai-knowledge" replace />} />
        <Route path="ai-brain" element={<AIBrain />} />
        <Route path="document-qa"  element={<Navigate to="/ai-knowledge" replace />} />
        <Route path="training"     element={<TrainingHub />} />
        <Route path="setup-wizard" element={<SetupWizard />} />

        {/* Recruiting */}
        <Route path="candidates" element={<CandidateList />} />
        <Route path="candidates/new" element={<CandidateNew />} />
        <Route path="candidates/:id" element={<CandidateDetail />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="reminders" element={<Reminders />} />
        <Route path="role-dashboard" element={<RoleDashboard />} />

        {/* ATS Phase 2 */}
        <Route path="jobs" element={<JobList />} />
        <Route path="jobs/new" element={<JobNew />} />
        <Route path="jobs/:id" element={<JobDetail />} />
        <Route path="submissions" element={<SubmissionList />} />
        <Route path="submissions/:id" element={<SubmissionDetail />} />
        <Route path="clients-orgs" element={<ClientOrgList />} />
        <Route path="clients-orgs/:id" element={<ClientOrgDetail />} />
        <Route path="kanban" element={<KanbanBoard />} />

        {/* Compliance */}
        <Route path="/compliance/my" element={<MyCompliance />} />
        <Route path="/compliance/policy/:id" element={<PolicySign />} />
        <Route path="/compliance/document/:id" element={<DocumentView />} />
        <Route path="/compliance/admin" element={<ComplianceAdminHub />} />
        <Route path="/compliance/admin/categories" element={<CategoryManager />} />
        <Route path="/compliance/admin/policies" element={<PolicyList />} />
        <Route path="/compliance/admin/policies/new" element={<PolicyEditor />} />
        <Route path="/compliance/admin/policies/:id/edit" element={<PolicyEditor />} />
        <Route path="/compliance/admin/documents" element={<DocumentList />} />
        <Route path="/compliance/admin/documents/new" element={<DocumentEditor />} />
        <Route path="/compliance/admin/documents/:id/edit" element={<DocumentEditor />} />
        <Route path="/compliance/admin/records" element={<ComplianceRecords />} />
        <Route path="/compliance/exam/:id" element={<TakeExam />} />
        <Route path="/compliance/checklist/:id" element={<CompleteChecklist />} />
        <Route path="/compliance/admin/exams" element={<ExamList />} />
        <Route path="/compliance/admin/exams/new" element={<ExamEditor />} />
        <Route path="/compliance/admin/exams/:id/edit" element={<ExamEditor />} />
        <Route path="/compliance/admin/checklists" element={<ChecklistList />} />
        <Route path="/compliance/admin/checklists/new" element={<ChecklistEditor />} />
        <Route path="/compliance/admin/checklists/:id/edit" element={<ChecklistEditor />} />
        <Route path="/compliance/admin/bundles" element={<BundleList />} />
        <Route path="/compliance/admin/bundles/new" element={<BundleEditor />} />
        <Route path="/compliance/admin/bundles/:id/edit" element={<BundleEditor />} />
        <Route path="/compliance/admin/bundles/:id/assign" element={<BundleAssign />} />
        <Route path="/compliance/admin/notifications" element={<NotificationSettings />} />
        <Route path="/compliance/admin/readiness" element={<PlacementReadinessAdmin />} />
        <Route path="/compliance/admin/bulk-assign" element={<BulkAssign />} />
        <Route path="/compliance/messages" element={<MessageCenter />} />
        <Route path="/compliance/certificates" element={<MyCertificates />} />
        <Route path="/compliance/admin/reports" element={<ComplianceReports />} />

        {/* eSign — full module */}
        <Route path="esign" element={<ESignDashboard />} />
        <Route path="esign/documents" element={<ESignDocuments />} />
        <Route path="esign/documents/new" element={<ESignDocumentNew />} />
        <Route path="esign/documents/:id" element={<ESignDocumentDetail />} />
        <Route path="esign/documents/:id/prepare" element={<ESignPrepare />} />
        <Route path="esign/templates" element={<ESignTemplates />} />
        <Route path="esign/forms" element={<ESignForms />} />
        <Route path="esign/analytics" element={<ESignAnalytics />} />

        {/* Time Tracking */}
        <Route path="time-tracking" element={<TimeTracking />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="time-tracking/team" element={<TimeTrackingManager />} />
        <Route path="time-tracking/admin" element={<TimeTrackingAdmin />} />

        {/* Role Dashboards */}
        <Route path="ceo-dashboard" element={<CEODashboard />} />
        <Route path="management-dashboard" element={<ManagementDashboard />} />
        <Route path="recruiting-dashboard" element={<RecruitingDashboard />} />
        <Route path="hr-dashboard" element={<HRDashboard />} />
        <Route path="credentialing-dashboard" element={<CredentialingDashboard />} />
        <Route path="compliance-dashboard" element={<ComplianceDashboard />} />

        {/* Account */}
        <Route path="security" element={<Security />} />
        <Route path="settings/users" element={<UserManagement />} />
        <Route path="settings/notifications" element={<NotificationPrefs />} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>

      {/* Public signing page — no auth wrapper */}
      <Route path="/sign/:token" element={<SignDocument />} />

      {/* Public certificate verification — no auth */}
      <Route path="/verify-cert/:number" element={<CertificateVerify />} />

      <Route path="/sign-in/*" element={<RedirectToSignIn />} />
    </Routes>
  );
}

export default App;
