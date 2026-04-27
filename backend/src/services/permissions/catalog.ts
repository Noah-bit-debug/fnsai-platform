/**
 * Permission catalog — the source of truth for all permissions in FNS AI.
 *
 * Default-deny model: a user has NO permission unless:
 *   1. A role they hold grants it, AND
 *   2. They don't have a 'deny' override for it.
 *
 * OR:
 *   3. They have a 'grant' override for it (and it hasn't expired).
 *
 * The catalog is seeded into the `permissions` DB table on backend startup
 * by seedCatalog() in permissionService.ts — the DB is a cached projection,
 * this TS file is the authoritative definition.
 *
 * Adding a new permission:
 *   1. Add it to PERMISSIONS below with category, label, description, risk.
 *   2. Add it to DEFAULT_ROLE_GRANTS for any role that should get it by default.
 *   3. Restart the backend — catalog + role grants re-seed.
 *   4. Use it in code: requirePermission('candidates.view.contact_info')
 *
 * Risk levels:
 *   low      — information only, minimal blast radius if wrongly granted.
 *   medium   — actions, but reversible or scoped.
 *   high     — sensitive data access (medical, finance, compliance).
 *   critical — 2-person approval required to grant. Things like financial
 *              write, security config, role/permission management.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PermissionDef {
  key: string;
  category: string;
  label: string;
  description: string;
  risk: RiskLevel;
  aiOnly?: boolean;           // pure AI capability, not used by UI/API directly
}

// ─── PERMISSION CATALOG ─────────────────────────────────────────────────
// Keys follow a dotted convention: category.resource.action
// Keep them stable — code references these strings.
export const PERMISSIONS: PermissionDef[] = [
  // ═══ Candidate data ══════════════════════════════════════════════════
  { key: 'candidates.view',                 category: 'candidates', label: 'View candidates',               description: 'See candidate list + basic profile fields',                       risk: 'low' },
  { key: 'candidates.edit',                 category: 'candidates', label: 'Edit candidates',               description: 'Update candidate fields, move through pipeline stages',           risk: 'medium' },
  { key: 'candidates.create',               category: 'candidates', label: 'Create candidates',             description: 'Add new candidates (manual or resume upload)',                    risk: 'low' },
  { key: 'candidates.delete',               category: 'candidates', label: 'Delete candidates',             description: 'Remove a candidate record entirely',                              risk: 'high' },
  { key: 'candidates.view.contact_info',    category: 'candidates', label: 'View candidate contact info',   description: 'Phone, email, address, emergency contacts',                       risk: 'medium' },
  { key: 'candidates.view.documents',       category: 'candidates', label: 'View candidate documents',      description: 'Resume, cover letter, references, uploaded files',                risk: 'medium' },
  { key: 'candidates.view.credentials',     category: 'candidates', label: 'View candidate credentials',    description: 'Licenses, certifications, credentialing documents',               risk: 'high' },
  { key: 'candidates.view.medical',         category: 'candidates', label: 'View medical/health documents', description: 'PPD, vaccine records, physical exam, drug screen results',        risk: 'high' },
  { key: 'candidates.send_message',         category: 'candidates', label: 'Send candidate messages',       description: 'Email, SMS, or in-app message to a candidate',                    risk: 'medium' },

  // ═══ Recruiting ══════════════════════════════════════════════════════
  { key: 'jobs.view',                       category: 'recruiting', label: 'View jobs',                     description: 'See open + closed job requisitions',                              risk: 'low' },
  { key: 'jobs.edit',                       category: 'recruiting', label: 'Edit jobs',                     description: 'Create, modify, close jobs',                                      risk: 'medium' },
  { key: 'submissions.view',                category: 'recruiting', label: 'View submissions',              description: 'See submissions and their status',                                risk: 'low' },
  { key: 'submissions.create',              category: 'recruiting', label: 'Create submissions',            description: 'Submit a candidate to a job',                                     risk: 'medium' },
  { key: 'pipeline.view',                   category: 'recruiting', label: 'View recruiter pipeline',       description: 'See all stages of the candidate pipeline',                        risk: 'low' },
  { key: 'tasks.recruiter.view',            category: 'recruiting', label: 'View recruiter tasks',          description: 'Their own + assigned tasks',                                      risk: 'low' },
  { key: 'tasks.recruiter.assign',          category: 'recruiting', label: 'Assign recruiter tasks',        description: 'Assign tasks to other users',                                     risk: 'medium' },

  // ═══ Assignments (generic owner pattern) ═════════════════════════════
  { key: 'assignments.view',                category: 'recruiting', label: 'View assignments',              description: 'See who owns candidates, tasks, and reminders',                   risk: 'low' },
  { key: 'assignments.manage',              category: 'recruiting', label: 'Assign and reassign work',      description: 'Assign or reassign candidates, tasks, reminders to users',        risk: 'medium' },

  // ═══ HR ══════════════════════════════════════════════════════════════
  { key: 'hr.view',                         category: 'hr',         label: 'View HR records',               description: 'General HR dashboards + employee lists',                          risk: 'medium' },
  { key: 'hr.edit',                         category: 'hr',         label: 'Edit HR records',               description: 'Modify employee records, employment status',                      risk: 'high' },
  { key: 'onboarding.view',                 category: 'hr',         label: 'View onboarding',               description: 'Onboarding queue + per-candidate progress',                       risk: 'medium' },
  { key: 'onboarding.manage',               category: 'hr',         label: 'Manage onboarding',             description: 'Send paperwork, mark items complete, promote to Placed',          risk: 'high' },
  { key: 'hr.employee_files',               category: 'hr',         label: 'View employee files',           description: 'I-9, W-4, tax forms, signed HR docs',                             risk: 'high' },
  { key: 'hr.incidents.view',               category: 'hr',         label: 'View incidents',                description: 'Workplace incidents + investigation notes',                       risk: 'high' },
  { key: 'hr.incidents.manage',             category: 'hr',         label: 'Manage incidents',              description: 'File, investigate, close incident reports',                       risk: 'high' },
  { key: 'pto.view_own',                    category: 'hr',         label: 'View own PTO balance',          description: 'See their own accrual + used',                                    risk: 'low' },
  { key: 'pto.view_team',                   category: 'hr',         label: 'View team PTO',                 description: 'See direct reports\' PTO + requests',                             risk: 'medium' },
  { key: 'pto.approve',                     category: 'hr',         label: 'Approve PTO',                   description: 'Approve or deny PTO requests',                                    risk: 'medium' },

  // ═══ Credentialing ═══════════════════════════════════════════════════
  { key: 'credentialing.view',              category: 'credentialing', label: 'View credentials',           description: 'Per-staff credential list + expirations',                         risk: 'medium' },
  { key: 'credentialing.edit',              category: 'credentialing', label: 'Edit credentials',           description: 'Add, update, archive credential records',                         risk: 'high' },
  { key: 'credentialing.approve_docs',      category: 'credentialing', label: 'Approve/reject documents',   description: 'Mark documents as verified or rejected',                          risk: 'high' },
  { key: 'credentialing.view_expiring',     category: 'credentialing', label: 'View expiring credentials',  description: 'Expiration tracking dashboard',                                   risk: 'medium' },
  { key: 'credentialing.reminders',         category: 'credentialing', label: 'Manage credential reminders', description: 'Configure who gets notified when',                               risk: 'medium' },

  // ═══ Compliance ══════════════════════════════════════════════════════
  { key: 'compliance.view',                 category: 'compliance', label: 'View compliance records',       description: 'Per-user completion + bundle assignments',                        risk: 'medium' },
  { key: 'compliance.edit',                 category: 'compliance', label: 'Edit compliance records',       description: 'Override completion, reset attempts, reassign',                   risk: 'high' },
  { key: 'compliance.manuals.view',         category: 'compliance', label: 'View compliance manuals',       description: 'Read full policy + manual text',                                  risk: 'low' },
  { key: 'compliance.policies.manage',      category: 'compliance', label: 'Manage compliance policies',    description: 'Create, edit, publish, retire policies',                          risk: 'high' },
  { key: 'compliance.audit_logs.view',      category: 'compliance', label: 'View audit logs',               description: 'Compliance-specific audit log entries',                           risk: 'high' },
  { key: 'compliance.reports.export',       category: 'compliance', label: 'Export compliance reports',     description: 'Download CSV/PDF reports for audits',                             risk: 'medium' },

  // ═══ Business Development / Bids ═════════════════════════════════════
  { key: 'bd.bids.view',                    category: 'business_dev', label: 'View bids',                   description: 'Active + closed bids list',                                       risk: 'medium' },
  { key: 'bd.bids.edit',                    category: 'business_dev', label: 'Edit bids',                   description: 'Create, modify, submit bid responses',                            risk: 'high' },
  { key: 'bd.proposals.view',               category: 'business_dev', label: 'View client proposals',       description: 'Proposal documents and history',                                  risk: 'medium' },
  { key: 'bd.checklists.view',              category: 'business_dev', label: 'View bid checklists',         description: 'Pre-bid requirement checklists',                                  risk: 'low' },
  { key: 'bd.strategic_notes.view',         category: 'business_dev', label: 'View strategic notes',        description: 'Internal strategy notes on leads/bids',                           risk: 'high' },
  { key: 'bd.ceo_sensitive_notes',          category: 'business_dev', label: 'View CEO-sensitive bid notes', description: 'Highly confidential strategy commentary',                        risk: 'critical' },
  { key: 'bd.leads.view',                   category: 'business_dev', label: 'View leads',                  description: 'Prospect/lead pipeline',                                          risk: 'medium' },
  { key: 'bd.contacts.view',                category: 'business_dev', label: 'View BD contacts',            description: 'Individual contacts at prospective clients',                      risk: 'medium' },
  { key: 'bd.contracts.view',               category: 'business_dev', label: 'View contracts',              description: 'Contract documents and status',                                   risk: 'high' },

  // ═══ Finance / Payroll ═══════════════════════════════════════════════
  { key: 'finance.pay_rates.view',          category: 'finance',    label: 'View pay rates',                description: 'What candidates/staff are paid per hour/week',                    risk: 'high' },
  { key: 'finance.bill_rates.view',         category: 'finance',    label: 'View bill rates',               description: 'What clients are billed per hour/week',                           risk: 'high' },
  { key: 'finance.margins.view',            category: 'finance',    label: 'View margins',                  description: 'Profitability per placement/client',                              risk: 'critical' },
  { key: 'finance.payroll.view',            category: 'finance',    label: 'View payroll',                  description: 'Payroll runs, employee earnings',                                 risk: 'critical' },
  { key: 'finance.invoices.view',           category: 'finance',    label: 'View invoices',                 description: 'Client invoices + payment status',                                risk: 'high' },
  { key: 'finance.revenue_reports.view',    category: 'finance',    label: 'View revenue reports',          description: 'Top-line revenue, YTD, forecast',                                 risk: 'critical' },

  // ═══ AI core capabilities ════════════════════════════════════════════
  { key: 'ai.chat.use',                     category: 'ai',         label: 'Use AI Chat',                   description: 'Open and query the AI chat interface',                            risk: 'low' },
  { key: 'ai.esther.use',                   category: 'ai',         label: 'Use Ask Esther',                description: 'Use the Ask Esther AI assistant',                                 risk: 'low' },
  { key: 'ai.team.use',                     category: 'ai',         label: 'Use AI Team',                   description: 'Use the AI Team multi-agent tools',                               risk: 'medium' },

  // ═══ AI topic gates ══════════════════════════════════════════════════
  // These enforce what the user can ASK AI about. AI guard checks these
  // before running a query.
  { key: 'ai.topic.candidates',             category: 'ai_topics',  label: 'Ask AI about candidates',       description: 'Let AI see candidate data in responses',                          risk: 'low',  aiOnly: true },
  { key: 'ai.topic.hr',                     category: 'ai_topics',  label: 'Ask AI about HR',               description: 'Let AI see HR records in responses',                              risk: 'medium', aiOnly: true },
  { key: 'ai.topic.credentialing',          category: 'ai_topics',  label: 'Ask AI about credentialing',    description: 'Let AI see credential records',                                   risk: 'medium', aiOnly: true },
  { key: 'ai.topic.compliance',             category: 'ai_topics',  label: 'Ask AI about compliance',       description: 'Let AI see compliance records',                                   risk: 'medium', aiOnly: true },
  { key: 'ai.topic.bids',                   category: 'ai_topics',  label: 'Ask AI about bids',             description: 'Let AI see bid/BD data',                                          risk: 'high', aiOnly: true },
  { key: 'ai.topic.finance',                category: 'ai_topics',  label: 'Ask AI about finance',          description: 'Let AI see pay/bill rates, margins, revenue',                     risk: 'critical', aiOnly: true },
  { key: 'ai.topic.ceo',                    category: 'ai_topics',  label: 'Ask AI about CEO/admin work',   description: 'Let AI see CEO-only tasks + strategic notes',                     risk: 'critical', aiOnly: true },

  // ═══ AI actions (what AI can DO on behalf of user) ═══════════════════
  { key: 'ai.search.files',                 category: 'ai_actions', label: 'Allow AI file search',          description: 'AI can search uploaded files',                                    risk: 'medium', aiOnly: true },
  { key: 'ai.search.email',                 category: 'ai_actions', label: 'Allow AI email search',         description: 'AI can search user\'s Outlook via Graph',                         risk: 'high', aiOnly: true },
  { key: 'ai.search.sharepoint',            category: 'ai_actions', label: 'Allow AI SharePoint search',    description: 'AI can search SharePoint/OneDrive',                               risk: 'high', aiOnly: true },
  { key: 'ai.action.draft_message',         category: 'ai_actions', label: 'Allow AI to draft messages',    description: 'AI can prepare but not send messages',                            risk: 'low', aiOnly: true },
  { key: 'ai.action.send_message',          category: 'ai_actions', label: 'Allow AI to send messages',     description: 'AI can send outbound messages autonomously',                      risk: 'high', aiOnly: true },
  { key: 'ai.action.create_task',           category: 'ai_actions', label: 'Allow AI to create tasks',      description: 'AI can create tasks directly from conversation',                  risk: 'low', aiOnly: true },
  { key: 'ai.action.edit_records',          category: 'ai_actions', label: 'Allow AI to edit records',      description: 'AI can make direct edits to DB records',                          risk: 'high', aiOnly: true },

  // ═══ Files / SharePoint / OneDrive ═══════════════════════════════════
  { key: 'files.company.search',            category: 'files',      label: 'Search company files',          description: 'General company file search',                                     risk: 'medium' },
  { key: 'files.candidates.search',         category: 'files',      label: 'Search candidate folders',      description: 'Files in candidate-specific folders',                             risk: 'medium' },
  { key: 'files.credentialing.search',      category: 'files',      label: 'Search credentialing folders',  description: 'Credential document storage',                                     risk: 'high' },
  { key: 'files.hr.search',                 category: 'files',      label: 'Search HR folders',             description: 'HR file share',                                                   risk: 'high' },
  { key: 'files.compliance.search',         category: 'files',      label: 'Search compliance folders',     description: 'Compliance file share',                                           risk: 'medium' },
  { key: 'files.bids.search',               category: 'files',      label: 'Search bid/proposal folders',   description: 'BD proposals and bid docs',                                       risk: 'high' },
  { key: 'files.ceo_private.search',        category: 'files',      label: 'Search CEO/private folders',    description: 'CEO-only folders',                                                risk: 'critical' },
  { key: 'files.upload',                    category: 'files',      label: 'Upload files',                  description: 'Upload to allowed folders',                                       risk: 'medium' },
  { key: 'files.move',                      category: 'files',      label: 'Move files',                    description: 'Reorganize file locations',                                       risk: 'medium' },
  { key: 'files.create_folders',            category: 'files',      label: 'Create folders',                description: 'Create new folder structures',                                    risk: 'medium' },

  // ═══ Admin ═══════════════════════════════════════════════════════════
  { key: 'admin.users.manage',              category: 'admin',      label: 'Manage users',                  description: 'Add, update, deactivate user accounts',                           risk: 'high' },
  { key: 'admin.roles.manage',              category: 'admin',      label: 'Manage roles',                  description: 'Create, edit, delete roles',                                      risk: 'critical' },
  { key: 'admin.roles.create_custom',       category: 'admin',      label: 'Create custom roles',           description: 'Author new role definitions',                                     risk: 'critical' },
  { key: 'admin.permissions.edit',          category: 'admin',      label: 'Edit permissions',              description: 'Change which permissions a role grants',                          risk: 'critical' },
  { key: 'admin.overrides.grant',           category: 'admin',      label: 'Grant user overrides',          description: 'Give a specific user a specific permission',                      risk: 'critical' },
  { key: 'admin.security_logs.view',        category: 'admin',      label: 'View security logs',            description: 'Read the security_audit_log',                                     risk: 'high' },
  { key: 'admin.ai_logs.view',              category: 'admin',      label: 'View AI access logs',           description: 'Read the ai_security_log',                                        risk: 'high' },
  { key: 'admin.integrations.manage',       category: 'admin',      label: 'Manage integrations',           description: 'Configure Anthropic / Microsoft / SMS connections',               risk: 'high' },
  { key: 'admin.simulate.view_as_role',     category: 'admin',      label: 'Preview as another role',       description: 'Temporarily view the app as another role for testing',            risk: 'medium' },
  // The meta-permission that protects the CEO role itself. ONLY the CEO
  // role grants this. Without it, even Admin cannot:
  //   - assign a user to the CEO role
  //   - remove a user from the CEO role
  //   - grant a CEO-tier permission override to anyone (including themselves)
  //   - edit the CEO role's permission definition (also blocked by
  //     is_system, but defensive belt-and-suspenders)
  // The runtime guards live in routes/rbac.ts and routes/users.ts.
  { key: 'admin.ceo_role.manage',           category: 'admin',      label: 'Manage CEO role + access',      description: 'Promote/demote users to CEO and edit CEO-tier permissions. Held only by CEO.', risk: 'critical' },

  // ═══ CEO-only ════════════════════════════════════════════════════════
  { key: 'ceo.private_tasks',               category: 'ceo',        label: 'CEO private tasks',             description: 'CEO\'s own personal task list',                                   risk: 'critical' },
  { key: 'ceo.executive_strategy',          category: 'ceo',        label: 'Executive strategy docs',       description: 'Strategic planning documents',                                    risk: 'critical' },
  { key: 'ceo.legal_notes',                 category: 'ceo',        label: 'Legal/confidential notes',      description: 'Privileged legal correspondence notes',                           risk: 'critical' },
];

// ─── DEFAULT ROLES ──────────────────────────────────────────────────────
//
// The six default system roles. They follow a deliberate hierarchy:
//
//   CEO       — full access, including the meta-permission to manage the
//               CEO role itself (admin.ceo_role.manage). Cannot be
//               restricted by anyone else.
//   Admin    — full operational access, including all CEO-tier data
//               (CEO private tasks, executive strategy, finance margins,
//               etc.). The ONE thing Admin lacks is admin.ceo_role.manage,
//               which means Admin cannot promote anyone to CEO, demote
//               the CEO, or grant CEO-tier permission overrides.
//   Manager  — broad operational access. No system-level admin
//               (security logs, error logs, integrations, role/permission
//               editing). Can manage assignments + reports.
//   HR       — superset of Recruiter + Coordinator + HR-specific work
//               (employee files, incidents, onboarding manage, full
//               credentialing + compliance).
//   Recruiter — recruiting workflow only (pipeline, jobs, submissions,
//               candidate contact + documents).
//   Coordinator — limited operational support. Schedules, basic contact,
//               assignments view, communication logs. No HR / compliance
//               / credentialing / payroll / admin.
//
// CEO-protection guarantees enforced at runtime in the routes layer:
//   - Only callers with admin.ceo_role.manage may assign or unassign
//     the CEO role to/from any user.
//   - Only callers with admin.ceo_role.manage may grant a permission
//     override on any CEO-tier permission (ceo.*, admin.ceo_role.manage,
//     bd.ceo_sensitive_notes, files.ceo_private.search, ai.topic.ceo,
//     finance.margins.view, finance.payroll.view, finance.revenue_reports.view,
//     ai.topic.finance).
//   - System-role permission sets are not editable through the UI at
//     all — to change them, edit this file and redeploy.
//
// Editing this file is the right way to update default permissions.
// Anything more dynamic (per-tenant overrides, custom roles) goes
// through the UI, where the guards above keep CEO-tier access locked.

export interface SystemRoleDef {
  key: string;
  label: string;
  description: string;
  permissions: string[];      // permission keys granted to this role
}

// ─── Permission bundles ────────────────────────────────────────────────
// Defining the bundles up front makes the role definitions readable and
// keeps the Recruiter ⊆ HR and Coordinator ⊆ HR relationships explicit
// (HR composes both). Don't reference these constants outside this file.

const COORDINATOR_PERMS: string[] = [
  // Lightweight operational support — scheduling, contact info, follow-ups.
  // Coordinator does NOT see HR records, compliance docs, credentialing
  // details, payroll, or admin tools.
  'candidates.view',
  'candidates.view.contact_info',
  'candidates.send_message',
  'jobs.view',
  'pipeline.view',
  'submissions.view',
  'tasks.recruiter.view',
  'assignments.view',
  'pto.view_own',
  'ai.chat.use',
  'ai.action.draft_message',
  'ai.action.create_task',
  'files.candidates.search',
];

const RECRUITER_PERMS: string[] = [
  // Recruiting workflow only: candidate pipeline, jobs, applications,
  // interviews, recruiting communications, candidate profiles, recruiting
  // notes/tasks. NO credentialing, compliance, onboarding, payroll, or
  // admin tools.
  'candidates.view',
  'candidates.create',
  'candidates.edit',
  'candidates.view.contact_info',
  'candidates.view.documents',
  'candidates.send_message',
  'jobs.view',
  'submissions.view',
  'submissions.create',
  'pipeline.view',
  'tasks.recruiter.view',
  'assignments.view',
  'pto.view_own',
  'ai.chat.use',
  'ai.esther.use',
  'ai.topic.candidates',
  'ai.action.draft_message',
  'ai.action.create_task',
  'files.candidates.search',
];

// HR is explicitly the superset: recruiter ∪ coordinator ∪ HR-specific.
const HR_PERMS: string[] = Array.from(new Set([
  ...COORDINATOR_PERMS,
  ...RECRUITER_PERMS,
  // HR-specific
  'candidates.view.credentials',
  'candidates.view.medical',
  'hr.view', 'hr.edit',
  'hr.employee_files',
  'hr.incidents.view', 'hr.incidents.manage',
  'onboarding.view', 'onboarding.manage',
  'pto.view_team', 'pto.approve',
  'assignments.manage',
  // Credentialing — HR oversees the full lifecycle
  'credentialing.view', 'credentialing.edit', 'credentialing.approve_docs',
  'credentialing.view_expiring', 'credentialing.reminders',
  // Compliance — HR sees + can edit
  'compliance.view', 'compliance.edit', 'compliance.manuals.view',
  'compliance.policies.manage', 'compliance.reports.export',
  // Workforce + onboarding-related AI topics
  'ai.topic.hr', 'ai.topic.credentialing', 'ai.topic.compliance',
  'ai.search.files',
  'files.candidates.search', 'files.hr.search', 'files.credentialing.search',
  'files.compliance.search', 'files.upload',
]));

const MANAGER_PERMS: string[] = Array.from(new Set([
  ...HR_PERMS,
  // Manager additionally has cross-team reporting + BD visibility, plus
  // the right to assign work and edit jobs. Manager does NOT have
  // admin.* perms (no security logs, no role editing, no integrations).
  'jobs.edit',
  'tasks.recruiter.assign',
  'bd.bids.view', 'bd.proposals.view', 'bd.checklists.view',
  'bd.leads.view', 'bd.contacts.view',
  'finance.bill_rates.view', 'finance.pay_rates.view',
  'ai.team.use',
  'ai.topic.bids',
  'files.company.search', 'files.bids.search',
  // Assigning users to existing roles is allowed for Manager, but only
  // for non-Admin/CEO targets — the route layer guards CEO; Admin
  // assignments are blocked by admin.users.manage being held only by
  // Admin/CEO.
]));

// Admin gets EVERY permission EXCEPT admin.ceo_role.manage. That single
// exclusion is what makes Admin unable to touch CEO assignments or
// CEO-tier overrides while still having "access to everything else".
const ADMIN_PERMS: string[] = PERMISSIONS
  .map(p => p.key)
  .filter(k => k !== 'admin.ceo_role.manage');

export const SYSTEM_ROLES: SystemRoleDef[] = [
  // ═══ CEO — full access, the only role that can manage CEO ════════════
  {
    key: 'ceo',
    label: 'CEO',
    description: 'Full system access. The only role allowed to promote users to CEO or grant CEO-tier permission overrides. Permanent — cannot be restricted by Admin or anyone else.',
    permissions: PERMISSIONS.map(p => p.key),
  },

  // ═══ Admin — full access EXCEPT CEO-meta ═════════════════════════════
  {
    key: 'admin',
    label: 'Admin',
    description: 'Full operational + system access, including CEO-tier data. Cannot manage CEO accounts, change CEO-tier permission overrides, or edit the CEO role definition.',
    permissions: ADMIN_PERMS,
  },

  // ═══ Manager — broad operational, no admin/system ════════════════════
  {
    key: 'manager',
    label: 'Manager',
    description: 'Broad operational oversight: candidates, jobs, HR-light, assignments, reports, bid visibility. No admin/system controls.',
    permissions: MANAGER_PERMS,
  },

  // ═══ HR — superset of Recruiter + Coordinator + HR-specific ══════════
  {
    key: 'hr',
    label: 'HR',
    description: 'HR records, onboarding, credentialing, compliance, workforce management, plus everything Recruiter and Coordinator can do. No admin or CEO-tier access.',
    permissions: HR_PERMS,
  },

  // ═══ Recruiter — recruiting workflow only ════════════════════════════
  {
    key: 'recruiter',
    label: 'Recruiter',
    description: 'Recruiting workflow only — candidate pipeline, jobs, applications, interviews, candidate communications. No HR records, credentialing, compliance, or admin tools.',
    permissions: RECRUITER_PERMS,
  },

  // ═══ Coordinator — limited operational support ═══════════════════════
  {
    key: 'coordinator',
    label: 'Coordinator',
    description: 'Limited operational support: scheduling, basic candidate/staff contact, assignment follow-up, communication logs. No HR records, compliance, credentialing, payroll, or admin tools.',
    permissions: COORDINATOR_PERMS,
  },
];

// ─── CEO-tier permissions (used by runtime guards) ─────────────────────
//
// Granting any of these as an override requires admin.ceo_role.manage.
// This complements the role-assignment guard (you can't be promoted to
// CEO without admin.ceo_role.manage) and prevents an Admin from
// achieving the same effect by side-loading individual CEO-tier perms
// onto a non-CEO user.
export const CEO_TIER_PERMISSIONS: ReadonlyArray<string> = [
  'admin.ceo_role.manage',
  'ceo.private_tasks',
  'ceo.executive_strategy',
  'ceo.legal_notes',
  'bd.ceo_sensitive_notes',
  'files.ceo_private.search',
  'finance.margins.view',
  'finance.payroll.view',
  'finance.revenue_reports.view',
  'ai.topic.ceo',
  'ai.topic.finance',
];

export function isCeoTierPermission(key: string): boolean {
  return CEO_TIER_PERMISSIONS.includes(key);
}

// ─── Helper lookups ─────────────────────────────────────────────────────

export function getPermissionDef(key: string): PermissionDef | undefined {
  return PERMISSIONS.find(p => p.key === key);
}

export function isCriticalPermission(key: string): boolean {
  return getPermissionDef(key)?.risk === 'critical';
}

export function getPermissionsByCategory(category: string): PermissionDef[] {
  return PERMISSIONS.filter(p => p.category === category);
}

// Category ordering for UI display
export const CATEGORY_ORDER = [
  'candidates',
  'recruiting',
  'hr',
  'credentialing',
  'compliance',
  'business_dev',
  'finance',
  'files',
  'ai',
  'ai_topics',
  'ai_actions',
  'admin',
  'ceo',
];

export const CATEGORY_LABELS: Record<string, string> = {
  candidates: 'Candidate data',
  recruiting: 'Recruiting',
  hr: 'HR',
  credentialing: 'Credentialing',
  compliance: 'Compliance',
  business_dev: 'Business Development / Bids',
  finance: 'Finance / Payroll',
  files: 'Files / SharePoint / OneDrive',
  ai: 'AI core',
  ai_topics: 'AI topic gates',
  ai_actions: 'AI actions',
  admin: 'Admin',
  ceo: 'CEO only',
};
