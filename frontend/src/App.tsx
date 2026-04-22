import { lazy, Suspense } from 'react';
import { useUser, SignIn, RedirectToSignIn } from '@clerk/clerk-react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RBACProvider } from './contexts/RBACContext';
import AppShell from './components/Layout/AppShell';
import RootErrorBoundary from './components/RootErrorBoundary';

// ─── Eager (hot-path pages) ─────────────────────────────────────────────────
import Dashboard from './pages/Dashboard';
import CandidateList from './pages/candidates/CandidateList';
import JobList from './pages/jobs/JobList';
import SubmissionList from './pages/submissions/SubmissionList';
import Pipeline from './pages/Pipeline';
import KanbanBoard from './pages/KanbanBoard';
import Tasks from './pages/Tasks';

// ─── Lazy (loaded on demand) ────────────────────────────────────────────────
// Recruiting
const CandidateNew = lazy(() => import('./pages/candidates/CandidateNew'));
const CandidateDetail = lazy(() => import('./pages/candidates/CandidateDetail'));
const JobNew = lazy(() => import('./pages/jobs/JobNew'));
const JobDetail = lazy(() => import('./pages/jobs/JobDetail'));
const JobEdit = lazy(() => import('./pages/jobs/JobEdit'));
const SubmissionDetail = lazy(() => import('./pages/submissions/SubmissionDetail'));
const ClientOrgList = lazy(() => import('./pages/clients/ClientOrgList'));
const ClientOrgDetail = lazy(() => import('./pages/clients/ClientOrgDetail'));
const AtsReports = lazy(() => import('./pages/AtsReports'));
const Reminders = lazy(() => import('./pages/Reminders'));
const RoleDashboard = lazy(() => import('./pages/RoleDashboard'));

// Intelligence / AI
const Integrations = lazy(() => import('./pages/Integrations'));
const Reports = lazy(() => import('./pages/Reports'));
const CompanyKnowledge = lazy(() => import('./pages/CompanyKnowledge'));
const ClarificationCenter = lazy(() => import('./pages/ClarificationCenter'));
const Templates = lazy(() => import('./pages/Templates'));
const Suggestions = lazy(() => import('./pages/Suggestions'));
const DailySummary = lazy(() => import('./pages/DailySummary'));
const AIAssistant = lazy(() => import('./pages/AIAssistant'));
const AIKnowledgeBase = lazy(() => import('./pages/AIKnowledgeBase'));
const AIBrain = lazy(() => import('./pages/AIBrain'));
const TrainingHub = lazy(() => import('./pages/TrainingHub'));
const SetupWizard = lazy(() => import('./pages/SetupWizard'));
const AILearning = lazy(() => import('./pages/AILearning'));
const DocumentQA = lazy(() => import('./pages/DocumentQA'));

// Time Tracking
const TimeTracking = lazy(() => import('./pages/TimeTracking'));
const Attendance = lazy(() => import('./pages/Attendance'));
const TimeTrackingManager = lazy(() => import('./pages/TimeTrackingManager'));
const TimeTrackingAdmin = lazy(() => import('./pages/TimeTrackingAdmin'));

// eSign — heavy (pdf + signature)
const SignDocument = lazy(() => import('./pages/SignDocument'));
const ESignDashboard = lazy(() => import('./pages/esign/ESignDashboard'));
const ESignDocuments = lazy(() => import('./pages/esign/ESignDocuments'));
const ESignDocumentNew = lazy(() => import('./pages/esign/ESignDocumentNew'));
const ESignDocumentDetail = lazy(() => import('./pages/esign/ESignDocumentDetail'));
const ESignAnalytics = lazy(() => import('./pages/esign/ESignAnalytics'));
const ESignPrepare = lazy(() => import('./pages/esign/ESignPrepare'));
const ESignTemplates = lazy(() => import('./pages/esign/ESignTemplates'));
const ESignForms = lazy(() => import('./pages/esign/ESignForms'));

// Compliance — 25+ pages, all lazy
const ComplianceReports = lazy(() => import('./pages/compliance/ComplianceReports'));
const MyCertificates = lazy(() => import('./pages/compliance/MyCertificates'));
const CertificateVerify = lazy(() => import('./pages/compliance/CertificateVerify'));
const ComplianceAdminHub = lazy(() => import('./pages/compliance/ComplianceAdminHub'));
const CategoryManager = lazy(() => import('./pages/compliance/CategoryManager'));
const PolicyList = lazy(() => import('./pages/compliance/PolicyList'));
const PolicyEditor = lazy(() => import('./pages/compliance/PolicyEditor'));
const DocumentList = lazy(() => import('./pages/compliance/DocumentList'));
const DocumentEditor = lazy(() => import('./pages/compliance/DocumentEditor'));
const MyCompliance = lazy(() => import('./pages/compliance/MyCompliance'));
const PolicySign = lazy(() => import('./pages/compliance/PolicySign'));
const DocumentView = lazy(() => import('./pages/compliance/DocumentView'));
const ComplianceRecords = lazy(() => import('./pages/compliance/ComplianceRecords'));
const ExamList = lazy(() => import('./pages/compliance/ExamList'));
const ExamEditor = lazy(() => import('./pages/compliance/ExamEditor'));
const ChecklistList = lazy(() => import('./pages/compliance/ChecklistList'));
const ChecklistEditor = lazy(() => import('./pages/compliance/ChecklistEditor'));
const BundleList = lazy(() => import('./pages/compliance/BundleList'));
const BundleEditor = lazy(() => import('./pages/compliance/BundleEditor'));
const BundleAssign = lazy(() => import('./pages/compliance/BundleAssign'));
const TakeExam = lazy(() => import('./pages/compliance/TakeExam'));
const CompleteChecklist = lazy(() => import('./pages/compliance/CompleteChecklist'));
const NotificationSettings = lazy(() => import('./pages/compliance/NotificationSettings'));
// Phase 2 additions
const DocTypesAdmin = lazy(() => import('./pages/compliance/DocTypesAdmin'));
const PolicyAIWizard = lazy(() => import('./pages/compliance/PolicyAIWizard'));
const ExamAIWizard = lazy(() => import('./pages/compliance/ExamAIWizard'));
const ChecklistAIWizard = lazy(() => import('./pages/compliance/ChecklistAIWizard'));
const CourseList = lazy(() => import('./pages/compliance/CourseList'));
const CourseEditor = lazy(() => import('./pages/compliance/CourseEditor'));
const CourseViewer = lazy(() => import('./pages/compliance/CourseViewer'));
const PlacementReadinessAdmin = lazy(() => import('./pages/compliance/PlacementReadinessAdmin'));
const BulkAssign = lazy(() => import('./pages/compliance/BulkAssign'));
const MessageCenter = lazy(() => import('./pages/compliance/MessageCenter'));

// Role dashboards
const CEODashboard = lazy(() => import('./pages/dashboards/CEODashboard'));
const ManagementDashboard = lazy(() => import('./pages/dashboards/ManagementDashboard'));
const RecruitingDashboard = lazy(() => import('./pages/dashboards/RecruitingDashboard'));
const HRDashboard = lazy(() => import('./pages/dashboards/HRDashboard'));
const CredentialingDashboard = lazy(() => import('./pages/dashboards/CredentialingDashboard'));
const ComplianceDashboard = lazy(() => import('./pages/dashboards/ComplianceDashboard'));

// Workforce
const StaffManagement = lazy(() => import('./pages/StaffManagement'));
const StaffProfile = lazy(() => import('./pages/StaffProfile'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Credentialing = lazy(() => import('./pages/Credentialing'));
const Placements = lazy(() => import('./pages/Placements'));
const Checklists = lazy(() => import('./pages/Checklists'));

// Operations & Controls
const Clients = lazy(() => import('./pages/Clients'));
const DocumentChecker = lazy(() => import('./pages/DocumentChecker'));
const EmailMonitor = lazy(() => import('./pages/EmailMonitor'));
const SMSApprovals = lazy(() => import('./pages/SMSApprovals'));
const Incidents = lazy(() => import('./pages/Incidents'));
const Timekeeping = lazy(() => import('./pages/Timekeeping'));
const DocumentLogs = lazy(() => import('./pages/DocumentLogs'));

// Business
const BusinessDev = lazy(() => import('./pages/BusinessDev'));
const ActionPlan = lazy(() => import('./pages/ActionPlan'));
const Insurance = lazy(() => import('./pages/Insurance'));
const Funding = lazy(() => import('./pages/Funding'));
const Timeline = lazy(() => import('./pages/Timeline'));
const Contracts = lazy(() => import('./pages/Contracts'));

// Admin / Account
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const NotificationPrefs = lazy(() => import('./pages/admin/NotificationPrefs'));
const Security = lazy(() => import('./pages/Security'));
const IntegrationSettings = lazy(() => import('./pages/IntegrationSettings'));
const ErrorLog = lazy(() => import('./pages/admin/ErrorLog'));

// DEV BYPASS — set localStorage.setItem('fnsai_dev_bypass','1') in console to skip auth
const DEV_BYPASS = import.meta.env.DEV && localStorage.getItem('fnsai_dev_bypass') === '1';

// ─── Fallbacks ──────────────────────────────────────────────────────────────
function PageSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
      <div
        style={{
          width: 32,
          height: 32,
          border: '3px solid rgba(0,0,0,0.08)',
          borderTopColor: 'var(--pr)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// Unused AILearning + DocumentQA references (old redirects use Navigate, but TS flags them)
// are silenced by re-exporting — kept in case any route is re-added later.
void AILearning;
void DocumentQA;

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
    // Error boundary above Suspense catches crashes in lazy()-loaded page
    // modules too. Previous boundary was inside AppShell, so module-load
    // errors for a single lazy page (e.g. Reminders) crashed through the
    // whole shell. With the boundary here, a bad page shows an error card
    // but the user still has nothing, this at least prevents complete
    // blank page. An INNER boundary in AppShell keeps the shell alive for
    // per-page render errors.
    <RootErrorBoundary>
    <Suspense fallback={<PageSpinner />}>
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

          {/* ATS Phase 2+ */}
          <Route path="jobs" element={<JobList />} />
          <Route path="jobs/new" element={<JobNew />} />
          <Route path="jobs/:id/edit" element={<JobEdit />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="submissions" element={<SubmissionList />} />
          <Route path="submissions/:id" element={<SubmissionDetail />} />
          <Route path="clients-orgs" element={<ClientOrgList />} />
          <Route path="clients-orgs/:id" element={<ClientOrgDetail />} />
          <Route path="kanban" element={<KanbanBoard />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="ats-reports" element={<AtsReports />} />

          {/* Compliance */}
          <Route path="/compliance/my" element={<MyCompliance />} />
          <Route path="/compliance/policy/:id" element={<PolicySign />} />
          <Route path="/compliance/document/:id" element={<DocumentView />} />
          <Route path="/compliance/admin" element={<ComplianceAdminHub />} />
          <Route path="/compliance/admin/categories" element={<CategoryManager />} />
          <Route path="/compliance/admin/doc-types" element={<DocTypesAdmin />} />
          <Route path="/compliance/admin/policies" element={<PolicyList />} />
          <Route path="/compliance/admin/policies/new" element={<PolicyEditor />} />
          <Route path="/compliance/admin/policies/:id/edit" element={<PolicyEditor />} />
          <Route path="/compliance/admin/policies/ai-wizard" element={<PolicyAIWizard />} />
          <Route path="/compliance/admin/documents" element={<DocumentList />} />
          <Route path="/compliance/admin/documents/new" element={<DocumentEditor />} />
          <Route path="/compliance/admin/documents/:id/edit" element={<DocumentEditor />} />
          <Route path="/compliance/admin/records" element={<ComplianceRecords />} />
          <Route path="/compliance/exam/:id" element={<TakeExam />} />
          <Route path="/compliance/checklist/:id" element={<CompleteChecklist />} />
          <Route path="/compliance/admin/exams" element={<ExamList />} />
          <Route path="/compliance/admin/exams/new" element={<ExamEditor />} />
          <Route path="/compliance/admin/exams/:id/edit" element={<ExamEditor />} />
          <Route path="/compliance/admin/exams/:id/ai-wizard" element={<ExamAIWizard />} />
          <Route path="/compliance/admin/checklists" element={<ChecklistList />} />
          <Route path="/compliance/admin/checklists/new" element={<ChecklistEditor />} />
          <Route path="/compliance/admin/checklists/:id/edit" element={<ChecklistEditor />} />
          <Route path="/compliance/admin/checklists/:id/ai-wizard" element={<ChecklistAIWizard />} />
          <Route path="/compliance/admin/bundles" element={<BundleList />} />
          <Route path="/compliance/admin/bundles/new" element={<BundleEditor />} />
          <Route path="/compliance/admin/bundles/:id/edit" element={<BundleEditor />} />
          <Route path="/compliance/admin/bundles/:id/assign" element={<BundleAssign />} />
          {/* Phase 2.6 — Courses */}
          <Route path="/compliance/admin/courses" element={<CourseList />} />
          <Route path="/compliance/admin/courses/:id/edit" element={<CourseEditor />} />
          <Route path="/compliance/courses/:id" element={<CourseViewer />} />
          <Route path="/compliance/course/:id" element={<CourseViewer />} />
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
          <Route path="settings/integrations" element={<IntegrationSettings />} />
          <Route path="settings/error-log" element={<ErrorLog />} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>

        {/* Public signing page — no auth wrapper */}
        <Route path="/sign/:token" element={<SignDocument />} />

        {/* Public certificate verification — no auth */}
        <Route path="/verify-cert/:number" element={<CertificateVerify />} />

        <Route path="/sign-in/*" element={<RedirectToSignIn />} />
      </Routes>
    </Suspense>
    </RootErrorBoundary>
  );
}

export default App;
