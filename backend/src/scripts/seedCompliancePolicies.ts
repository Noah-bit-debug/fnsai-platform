/**
 * Seed FNS compliance policies into comp_policies.
 *
 * Idempotent — matches on title; existing rows are skipped, not updated.
 * If you change the source text below, delete or archive the old policy
 * via the UI first, then re-run.
 *
 * Usage:
 *   npx tsx backend/src/scripts/seedCompliancePolicies.ts
 *
 * Roles use the SYSTEM_ROLES keys from services/permissions/catalog.ts:
 *   ceo, admin, manager, hr, recruiter, coordinator
 */
import 'dotenv/config';
import { pool } from '../db/client';

interface PolicySeed {
  title: string;
  content: string;
  applicable_roles: string[];
  require_signature?: boolean;
  version?: string;
}

const ALL_ROLES = ['ceo', 'admin', 'manager', 'hr', 'recruiter', 'coordinator'];
const LEADERSHIP = ['ceo', 'admin'];
const LEADERSHIP_HR = ['ceo', 'admin', 'hr'];
const LEADERSHIP_HR_MANAGER = ['ceo', 'admin', 'manager', 'hr'];
const RECRUITERS_AND_OVERSIGHT = ['ceo', 'admin', 'hr', 'recruiter'];

export const POLICIES: PolicySeed[] = [
  // ─── Module 1 ─────────────────────────────────────────────────────────
  {
    title: 'AI Governance Charter',
    applicable_roles: ALL_ROLES,
    content: `PURPOSE
Establish the governance framework for all AI systems used within the
organization, including GPT-based tools. Ensure AI is used in a
compliant, controlled, and auditable manner; prevent misuse in
high-risk operational areas; define accountability for all AI-assisted
decisions; establish escalation requirements for AI-driven outputs.

SCOPE
Applies to all employees, contractors, consultants, and AI systems
deployed within the organization. Covers use of AI in recruiting,
credentialing, payroll, compliance operations, incident management,
and data handling.

DEFINITIONS
- AI System: any automated or semi-automated tool that generates
  outputs, including GPT-based assistants.
- PHI: any identifiable health-related information tied to an
  individual.
- PII: any data that can identify an individual.
- RBAC: Role-Based Access Control.
- Escalation: formal transfer of a decision or issue to a higher
  authority due to risk or uncertainty.

GOVERNING PRINCIPLES
- Compliance overrides convenience at all times.
- AI does not replace human accountability.
- High-risk decisions must be escalated.
- AI outputs must be validated before execution.
- AI usage must align with assigned role permissions.
- Sensitive data must be protected at all times.

AI USAGE RULES
- Only approved GPT systems may be used.
- AI must be used strictly within assigned job role.
- AI outputs must be reviewed before action.
- AI cannot be used to bypass compliance procedures.
- PHI may only be entered into approved workflows.
- AI responses must not be treated as final authority.

PROHIBITED USES
- Entering PHI into unauthorized systems.
- Using AI to bypass credentialing or payroll controls.
- Using AI to make legal determinations.
- Using AI to make clinical decisions affecting patient care.
- Sharing AI outputs externally without authorization.
- Accessing AI tools outside assigned permissions.

ESCALATION PROTOCOL
Escalation is REQUIRED when AI output involves patient safety risk,
legal exposure, compliance uncertainty, incomplete or conflicting
information, or high-impact operational decisions.

Escalation path: Staff Member → HR / Compliance → Executive
Leadership → Legal Counsel (if applicable).

DATA HANDLING (AI CONTEXT)
- PHI must only be entered into approved systems.
- PII must be handled securely.
- Data must not be stored in unsecured environments.
- AI conversations containing sensitive data must be restricted.

MONITORING & OVERSIGHT
The organization will monitor AI usage patterns, review logs of AI
interactions where applicable, audit compliance with AI policies, and
identify misuse or policy violations.

ENFORCEMENT
Violations may result in removal of AI access, disciplinary action,
termination of employment, or legal escalation.

ACKNOWLEDGMENT
All users must review this policy, acknowledge understanding, and
agree to comply.`,
  },

  // ─── Module 2 ─────────────────────────────────────────────────────────
  {
    title: 'Regulatory Mapping Manual',
    applicable_roles: LEADERSHIP_HR_MANAGER,
    content: `PURPOSE
Define the regulatory frameworks governing operations and ensure
compliance across all jurisdictions of operation.

SCOPE
Applies to all business operations involving staffing, employment,
credentialing, payroll, compliance, and data handling.

JURISDICTION COVERAGE
- Primary: Texas
- Active: California, Florida, New York
- Expandable: any additional states of operation

GOVERNING AGENCIES
Federal: U.S. Department of Labor (DOL), Equal Employment Opportunity
Commission (EEOC).
State: Texas Health & Human Services, California Department of Public
Health, Florida AHCA, New York Department of Health.

REGULATORY CATEGORIES
Each state must be evaluated across:
- Licensing requirements
- Wage and hour laws
- Overtime regulations
- Worker classification laws
- Anti-discrimination laws
- Data protection requirements

STATE-OF-WORK RULE
All employment conditions are governed by the state where the employee
performs work — NOT corporate headquarters or recruiter location.

MULTI-STATE COMPLIANCE CONTROLS
Before placement, confirm:
- license valid in assignment state
- wage rules applicable to assignment state
- classification rules for assignment state
- local labor compliance requirements

HIGH-RISK JURISDICTIONS
California and New York require enhanced scrutiny due to stricter
labor laws, increased enforcement, and higher litigation risk.

ESCALATION TRIGGERS
Escalate immediately when laws conflict between states, jurisdiction
is unclear, a worker operates across multiple states, or compliance
requirements are ambiguous.

DOCUMENTATION REQUIREMENTS
Maintain regulatory reference documentation, state-specific compliance
notes, and audit-ready validation records.

ENFORCEMENT
Failure to follow regulatory mapping may result in compliance
violations, financial penalties, or legal exposure.`,
  },

  // ─── Module 3 ─────────────────────────────────────────────────────────
  {
    title: 'Joint Commission Compliance Manual',
    applicable_roles: ALL_ROLES,
    content: `PURPOSE
Ensure the organization operates in a continuous state of Joint
Commission readiness.

SCOPE
Applies to all credentialing, staffing, documentation, incident
reporting, and training activities.

CORE COMPLIANCE REQUIREMENTS
Maintain complete credentialing files, verified licenses, documented
competencies, incident reporting logs, and training acknowledgments.

CREDENTIALING STANDARDS
Each worker must have a verified license, current credentials,
documented expiration tracking, and primary source verification.

DOCUMENTATION RULES
All documentation must be complete, accurate, organized, and
retrievable. If it is not documented, it is not compliant.

AUDIT READINESS STANDARD
The organization must remain audit-ready at all times — not rely on
last-minute preparation. Maintain real-time documentation.

INCIDENT MANAGEMENT REQUIREMENTS
All incidents must be documented immediately, escalated appropriately,
include follow-up actions, and be tracked to resolution.

INTERNAL AUDIT REQUIREMENTS
- Weekly compliance checks
- Monthly executive review
- Quarterly mock audits

DEFICIENCY HANDLING
1. Document deficiency.
2. Assign responsible party.
3. Define corrective action.
4. Track to completion.

ESCALATION TRIGGERS
Immediate escalation required for missing credential documentation,
expired licenses, patient safety incidents, audit deficiencies, or
compliance gaps.

TRAINING REQUIREMENTS
All staff must complete compliance training, acknowledge policies, and
follow documented procedures.

ENFORCEMENT
Failure to comply may result in loss of audit readiness, client risk
exposure, or corrective disciplinary action.

CONTINUOUS IMPROVEMENT
Review audit results, update processes, and strengthen compliance
controls.`,
  },

  // ─── Module 4 ─────────────────────────────────────────────────────────
  {
    title: 'Credentialing Standard Operating Procedure (SOP)',
    applicable_roles: LEADERSHIP_HR,
    content: `PURPOSE
Establish a standardized process for collecting, verifying, reviewing,
and approving all healthcare worker credentials prior to placement.
Ensure regulatory compliance, audit readiness, and prevention of
unqualified or unverified placements.

SCOPE
Applies to HR / credentialing personnel, compliance staff, and
executive oversight. Covers all clinical and non-clinical staff in all
states of operation.

CREDENTIALING REQUIREMENTS
Each worker must have a complete credential file including:
- Government-issued identification
- Active professional license or certification
- License number and issuing state
- License expiration date
- Primary source verification documentation
- Required certifications (BLS, ACLS, etc.)
- Resume or work history
- Background check (if required)
- Competency checklist (if required)
- Immunization / health records (if required by client)

CREDENTIALING WORKFLOW
1. Candidate intake
2. Document collection
3. Verification of all credentials
4. File completeness review
5. Clearance decision

CLEARANCE RULES
A worker may only be marked CLEARED if all required documents are
present, all verifications are completed, all credentials are current,
and no compliance concerns exist.

STATUS DEFINITIONS
- Cleared: fully verified and approved.
- Pending: in progress, not approved.
- Hold: incomplete or risk present.
- Escalate: high-risk issue requiring review.

HARD STOP RULES
A worker may NOT be cleared if any of the following are true:
- License is expired
- License is not verified
- A required document is missing
- The credential file is incomplete
- Fraudulent documentation is suspected
- Required certifications are missing

Result: DO NOT PLACE.

RE-VERIFICATION TRIGGERS
Credentialing must be revalidated when a license is nearing
expiration, the worker is reassigned or changes state, an audit
identifies a deficiency, or payroll processing occurs with unresolved
issues.

DOCUMENTATION REQUIREMENTS
All credential files must be complete, accurate, organized, and
retrievable. Incomplete documentation = not compliant.

ESCALATION TRIGGERS
Immediate escalation required for an expired or unverifiable license,
restricted or suspended license, suspected fraudulent documents,
missing critical credentialing data, or a worker placed without
clearance.

ROLE RESTRICTIONS
- Recruiters may NOT access full credential files.
- Recruiters may NOT clear candidates.
- Only authorized credentialing personnel may approve.

AUDIT REQUIREMENTS
Credential files must be audit-ready at all times, accessible upon
request, and supported by verification records.

ENFORCEMENT
Failure to follow this SOP may result in compliance violations,
disciplinary action, or removal of system access.`,
  },

  // ─── Module 5 ─────────────────────────────────────────────────────────
  {
    title: 'License Verification Protocol',
    applicable_roles: LEADERSHIP_HR,
    content: `PURPOSE
Ensure all professional licenses are valid, active, verified, and
compliant before any worker is cleared or placed.

SCOPE
Applies to all licensed healthcare professionals, all states of
operation, and all credentialing personnel.

VERIFICATION REQUIREMENTS
All licenses must be verified through PRIMARY SOURCE VERIFICATION
ONLY. Verification must confirm active status, correct discipline,
issuing state, expiration date, standing (good / restricted /
suspended), and any disciplinary actions.

VERIFICATION RULES
- Candidate-submitted documents are NOT sufficient.
- Verbal confirmation is NOT sufficient.
- Screenshots alone are NOT sufficient without source validation.

MULTI-STATE LICENSE VALIDATION
Confirm the license is valid in the assignment state, compact license
eligibility (if applicable), and any state-specific restrictions.

EXPIRATION MONITORING RULES
- 60+ days remaining → monitor
- 30 to 59 days → warning
- 7 to 29 days → urgent
- expired → immediate hold

HARD STOP CONDITIONS
A worker must NOT be cleared if any of the following are true:
- License expired
- License unverifiable
- License suspended or restricted
- License does not match assignment state

Result: DO NOT PLACE.

RE-VERIFICATION TRIGGERS
Re-verify when a license is nearing expiration, the worker is
reassigned or changes state, payroll is processed, or an audit
identifies a discrepancy.

DOCUMENTATION REQUIREMENTS
Maintain verification records, date of verification, source used, and
expiration tracking.

ESCALATION TRIGGERS
Immediate escalation required for an unverifiable license, found
disciplinary action, restricted license, conflicting license data, or
suspected falsification.

AUDIT REQUIREMENTS
License records must be documented, retrievable, and current.

ENFORCEMENT
Violations may result in removal of clearance authority, compliance
escalation, or disciplinary action.`,
  },

  // ─── Module 6 ─────────────────────────────────────────────────────────
  {
    title: 'Clinical Incident Reporting Manual',
    applicable_roles: ALL_ROLES,
    content: `PURPOSE
Define standardized procedures for identifying, documenting,
escalating, and resolving clinical incidents.

SCOPE
Applies to all field staff, all internal staff, and all client-related
incidents.

DEFINITION OF INCIDENT
An incident includes patient harm or injury, medication errors, falls
or safety events, scope-of-practice violations, facility complaints,
behavioral or professional issues, and near-miss events.

INCIDENT CLASSIFICATION
- Low: minimal impact
- Moderate: limited impact
- High: serious concern
- Critical: patient safety risk / legal exposure

INCIDENT REPORTING WORKFLOW
1. Intake
2. Documentation
3. Classification
4. Escalation
5. Follow-up tracking

DOCUMENTATION REQUIREMENTS
Each incident must include date and time, individuals involved,
facility / location, factual summary (no assumptions), immediate
actions taken, and supporting documentation.

ESCALATION RULES
Immediate escalation required for patient safety concerns, serious
complaints, legal exposure, or repeated incidents.

PROHIBITED ACTIONS
- Delaying incident reporting.
- Handling incidents informally without documentation.
- Determining fault at the intake stage.
- Ignoring reportable events.

FOLLOW-UP REQUIREMENTS
Track resolution, document corrective actions, maintain the incident
log, and ensure closure.

AUDIT REQUIREMENTS
Incident records must be complete, documented, and retrievable.

ESCALATION PATH
Staff → Compliance / HR → Executive Leadership → Legal (if required).

ENFORCEMENT
Failure to comply may result in compliance violations, disciplinary
action, or increased legal risk.

CONTINUOUS MONITORING
Track incident trends, identify repeat issues, and implement
corrective actions.`,
  },

  // ─── Module 7 ─────────────────────────────────────────────────────────
  {
    title: 'Recruiting Compliance Manual',
    applicable_roles: RECRUITERS_AND_OVERSIGHT,
    content: `PURPOSE
Ensure all recruiting activities are conducted in a compliant,
ethical, and legally defensible manner. This policy prevents
discriminatory hiring practices, misrepresentation, premature
placement decisions, and compliance risk during candidate sourcing.

SCOPE
Applies to all recruiters, hiring managers, and any personnel involved
in sourcing, screening, or communicating with candidates.

RECRUITING PRINCIPLES
- Job-related decision-making only.
- Equal opportunity employment standards.
- Documented and consistent screening processes.
- Transparency in communication.
- No informal or undocumented hiring decisions.

APPROVED RECRUITING ACTIVITIES
Recruiters are authorized to post job listings using compliant
language, review resumes based on qualifications, conduct structured
candidate screenings, collect preliminary documentation, communicate
role expectations accurately, and submit candidates for credentialing
review.

PROHIBITED PRACTICES
Recruiters MUST NOT:
- Screen candidates based on protected characteristics.
- Ask discriminatory or inappropriate questions.
- Promise placement before credentialing clearance.
- Misrepresent job conditions, pay, or responsibilities.
- Bypass credentialing or compliance processes.
- Pressure candidates into acceptance.
- Provide legal, payroll, or credentialing determinations.

CANDIDATE COMMUNICATION RULES
All communication must be factual and documented, reflect accurate job
details, avoid guarantees or promises, and be consistent with company
policies.

DOCUMENTATION REQUIREMENTS
Recruiters must maintain candidate notes, interview summaries,
communication logs, and submission records. All recruiting decisions
must be documented.

ESCALATION TRIGGERS
Immediate escalation required for a candidate discrimination
complaint, request from a client to discriminate, unclear job
requirements, candidate legal concerns, suspected misrepresentation,
or conflict between recruiter and compliance.

ROLE RESTRICTIONS
Recruiters CANNOT clear candidates, override credentialing decisions,
or access full compliance / PHI data. Recruiters MUST transfer
candidates to the credentialing team.

CLIENT INTERACTION RULE
If a client requests discriminatory criteria or non-compliant hiring
practices, the recruiter MUST refuse the request and escalate to
compliance immediately.

AUDIT REQUIREMENTS
Recruiting processes must be documented, consistent, and defensible.

ENFORCEMENT
Violations may result in restricted recruiting authority, disciplinary
action, or termination.`,
  },

  // ─── Module 8 ─────────────────────────────────────────────────────────
  {
    title: 'Anti-Discrimination Hiring Policy',
    applicable_roles: ALL_ROLES,
    content: `PURPOSE
Ensure all hiring decisions are made fairly, lawfully, and without
discrimination.

SCOPE
Applies to all hiring decisions, all recruiting activities, and all
client interactions involving staffing.

PROTECTED CLASSES
The organization prohibits discrimination based on race, color,
religion, gender, gender identity, sexual orientation, age,
disability, national origin, and marital status (where applicable).

HIRING STANDARDS
All hiring decisions must be based ONLY on qualifications, experience,
certifications, and job-related criteria.

PROHIBITED ACTIONS
The following are strictly prohibited:
- Asking about protected characteristics.
- Making hiring decisions based on bias.
- Honoring discriminatory client requests.
- Excluding candidates for non-job-related reasons.
- Creating biased job postings.

CLIENT REQUEST RULE
If a client requests discriminatory hiring, you MUST refuse the
request, document the request, and escalate immediately.

INTERVIEW GUIDELINES
Interview questions must be job-related, consistent across candidates,
and avoid personal or protected information.

COMPLAINT HANDLING
1. Document the complaint.
2. Escalate immediately.
3. Maintain confidentiality.
4. Investigate per compliance procedures.

RETALIATION PROHIBITION
No individual may retaliate against a complaint or penalize the
reporting of discrimination.

ESCALATION TRIGGERS
Immediate escalation required for discrimination complaints, biased
hiring decisions, inappropriate interview questions, or client
discrimination requests.

DOCUMENTATION REQUIREMENTS
Maintain hiring decision records, candidate evaluation notes, and
complaint logs.

ENFORCEMENT
Violations may result in disciplinary action, termination, or legal
escalation.`,
  },

  // ─── Module 9 ─────────────────────────────────────────────────────────
  {
    title: 'Payroll & Classification Compliance Manual',
    applicable_roles: LEADERSHIP_HR,
    content: `PURPOSE
Ensure all payroll processing and worker classification decisions are
accurate, compliant, and legally defensible.

SCOPE
Applies to payroll processing, worker classification, wage compliance,
and multi-state compensation rules.

PAYROLL REQUIREMENTS
All payroll must ensure accurate time tracking, correct pay rates,
proper overtime calculation, and compliance with state wage laws.

WORKER CLASSIFICATION RULES
Workers must be classified as Employee (W-2) or Independent Contractor
(1099). Classification must be documented, justified, and consistent.

CLASSIFICATION CRITERIA
Evaluate level of control, independence, financial relationship, and
duration of engagement.

MULTI-STATE WAGE RULE
Payroll must follow the state where work is performed — NOT company
headquarters or employee residence.

PAYROLL EXCEPTION HANDLING
Track and resolve missing hours, incorrect pay, overtime
discrepancies, classification issues, and final pay concerns.

HARD STOP RULES
DO NOT process payroll if classification is unclear, required
documentation is missing, an unresolved compliance issue exists, or
payroll data is incomplete.

RE-VERIFICATION TRIGGERS
Review payroll compliance when classification changes, the state of
work changes, wage disputes arise, an audit identifies an issue, or a
termination occurs.

ESCALATION TRIGGERS
Immediate escalation required for wage disputes, overtime violations,
classification concerns, final paycheck issues, or payroll
discrepancies.

DOCUMENTATION REQUIREMENTS
Maintain payroll records, timekeeping data, classification
documentation, and exception logs.

AUDIT REQUIREMENTS
Payroll must be accurate, documented, and auditable.

ENFORCEMENT
Violations may result in financial penalties, compliance violations,
or disciplinary action.

LEGAL SENSITIVITY RULE
If a payroll issue presents legal risk, escalate immediately.`,
  },

  // ─── Module 10 ────────────────────────────────────────────────────────
  {
    title: 'PHI Data Protection Manual',
    applicable_roles: ALL_ROLES,
    content: `PURPOSE
Establish strict controls for the handling, storage, transmission, and
protection of Protected Health Information (PHI) in alignment with
HIPAA principles and industry standards.

SCOPE
Applies to all employees, contractors, systems (including AI tools),
and data handling activities involving PHI.

DEFINITION OF PHI
PHI includes any identifiable health-related information: medical
records, health history, treatment details, insurance information, and
any data tied to a specific individual.

DATA CLASSIFICATION LEVELS
- PHI (high sensitivity)
- PII (moderate sensitivity)
- Operational data (internal use)
- Public data (low risk)

ACCESS CONTROL RULES
Access to PHI must be role-based and restricted to authorized
personnel only. Users may only access data necessary to perform their
job (minimum-necessary).

DATA HANDLING RULES
All PHI must be stored in approved systems only, transmitted securely,
protected from unauthorized access, and accessed only when necessary.

PROHIBITED ACTIONS
The following are strictly prohibited:
- Accessing PHI without authorization.
- Sharing PHI via unsecured channels (email, text, etc.).
- Storing PHI on personal devices or unauthorized platforms.
- Entering PHI into unapproved AI systems.
- Discussing PHI in public or unsecured environments.

AI-SPECIFIC PHI RULES
PHI may ONLY be entered into approved, secured workflows. AI systems
must not retain PHI beyond required usage or expose PHI across roles.

BREACH IDENTIFICATION
A breach includes unauthorized access, unauthorized disclosure, data
loss, or system compromise.

BREACH RESPONSE PROTOCOL
1. Immediately escalate.
2. Document the incident.
3. Contain exposure.
4. Notify leadership.
5. Initiate formal review.

ESCALATION TRIGGERS
Immediate escalation required for a suspected data breach,
unauthorized PHI access, lost or exposed data, system vulnerability,
or improper data handling.

DOCUMENTATION REQUIREMENTS
Maintain access logs, incident reports, breach documentation, and
corrective action records.

AUDIT REQUIREMENTS
PHI controls must be reviewed regularly, documented, and auditable.

ENFORCEMENT
Violations may result in immediate access revocation, disciplinary
action, termination, or legal escalation.

LEGAL SENSITIVITY RULE
PHI violations carry regulatory and legal consequences — immediate
escalation is required.`,
  },

  // ─── Module 11 ────────────────────────────────────────────────────────
  {
    title: 'AI Data Access Control Policy',
    applicable_roles: ALL_ROLES,
    content: `PURPOSE
Define how data is accessed, restricted, and controlled within AI
systems to prevent misuse, overexposure, and compliance violations.

SCOPE
Applies to all AI systems (GPTs), all users interacting with AI tools,
and all data processed through AI.

ACCESS CONTROL MODEL (RBAC)
Access is strictly governed by Role-Based Access Control (RBAC).

ROLE PERMISSIONS
- Recruiter: limited candidate data only; no PHI access.
- HR / Credentialing: credentialing data access; controlled PHI access.
- Payroll: compensation data; limited personal data.
- Executive: full oversight access.

DATA CLASSIFICATION IN AI SYSTEMS
AI systems must handle PHI (restricted), PII (controlled), operational
data, and compliance records.

ACCESS RULES
Users may ONLY access data required for their role, use AI within
assigned permissions, and input approved data types.

PROHIBITED ACTIONS
Users MUST NOT access data outside their role, input PHI into
unauthorized GPTs, use AI to retrieve restricted data, bypass RBAC
controls, or share outputs across unauthorized roles.

GPT USAGE RESTRICTIONS
- Recruiters cannot access credentialing files or input PHI.
- Payroll cannot access clinical data beyond necessity.
- Compliance must enforce access restrictions.

MONITORING & LOGGING
The organization will track AI usage, monitor access patterns, and
review logs for violations.

ESCALATION TRIGGERS
Immediate escalation required for an unauthorized access attempt,
cross-role data exposure, misuse of AI systems, or PHI entered into
the incorrect system.

DATA SEGMENTATION RULE
Data must be separated by role, protected from cross-access, and
restricted to a need-to-know basis.

AUDIT REQUIREMENTS
AI access must be logged, monitored, and auditable.

ENFORCEMENT
Violations may result in access revocation, disciplinary action, or
escalation to compliance / legal.

SYSTEM INTEGRITY RULE
AI systems must enforce access controls, prevent unauthorized
exposure, and maintain compliance boundaries.`,
  },

  // ─── Module 12 ────────────────────────────────────────────────────────
  {
    title: 'Audit Logging & Monitoring Manual',
    applicable_roles: LEADERSHIP_HR,
    content: `PURPOSE
Ensure all compliance activities are documented, tracked, monitored,
and auditable across the organization.

SCOPE
Applies to credentialing, payroll, recruiting, incident management,
compliance operations, and AI system usage.

LOGGING REQUIREMENTS
The organization must log credentialing actions, license
verifications, payroll processing activities, incident reports,
corrective actions, and AI system usage (where applicable).

LOG TYPES
Maintain credentialing logs, incident logs, payroll logs, audit logs,
and corrective action logs.

MONITORING FREQUENCY
- Daily: critical events.
- Weekly: dashboard review.
- Monthly: executive report.
- Quarterly: audit review.

AUDIT READINESS RULE
All logs must be complete, accurate, timestamped, and retrievable.

EXCEPTION TRACKING
All deviations must be identified, documented, assigned ownership, and
tracked to resolution.

ESCALATION TRIGGERS
Immediate escalation required for missing logs, incomplete records,
repeated compliance failures, untracked incidents, or system
discrepancies.

DOCUMENTATION REQUIREMENTS
Maintain audit logs, issue logs, resolution tracking, and corrective
action records.

RETENTION POLICY
Logs must be stored securely, retained per regulatory requirements,
and accessible for audit.

SYSTEM MONITORING REQUIREMENTS
The organization must monitor trends, identify recurring issues,
detect anomalies, and track compliance performance.

REPORTING REQUIREMENTS
- Weekly dashboard updates.
- Monthly executive reports.
- Audit findings documentation.

ENFORCEMENT
Failure to maintain logs may result in audit failure, compliance
violations, or disciplinary action.

CONTINUOUS IMPROVEMENT RULE
Audit results must be used to improve processes, update controls, and
strengthen compliance systems.`,
  },

  // ─── Module 13 ────────────────────────────────────────────────────────
  {
    title: 'Multi-State Compliance Matrix',
    applicable_roles: LEADERSHIP_HR_MANAGER,
    content: `PURPOSE
Ensure all operations comply with the laws and regulations of each
state where services are performed.

SCOPE
Applies to all workers, all assignments, all payroll processing, and
all credentialing decisions.

CORE RULE
The state of work determines all applicable laws — overrides company
headquarters, recruiter location, and employee residence.

STATE COVERAGE
- Primary: Texas
- High-regulation: California, New York
- Additional: Florida and any expanded states

COMPLIANCE CATEGORIES BY STATE
Each assignment must be validated against:
- Licensing requirements
- Wage & hour laws
- Overtime rules
- Worker classification laws
- Onboarding requirements
- Background check rules

OPERATIONAL CONTROLS
Before placement, verify the license is valid in the assignment state,
the pay rate complies with state law, classification aligns with state
requirements, and onboarding meets state requirements.

HIGH-RISK STATE CONTROLS
For California and New York:
- Additional wage validation
- Stricter classification review
- Enhanced documentation requirements

CROSS-STATE ASSIGNMENT RULE
If a worker operates across states, evaluate EACH state independently,
apply the strictest applicable rule, and escalate if unclear.

ESCALATION TRIGGERS
Immediate escalation required for conflicting state laws, unclear
jurisdiction, cross-state payroll discrepancies, or a license that is
not valid in the assignment state.

DOCUMENTATION REQUIREMENTS
Maintain assignment-state verification, compliance validation records,
and state-specific notes.

AUDIT REQUIREMENTS
All multi-state decisions must be documented, justified, and
auditable.

ENFORCEMENT
Failure to comply may result in regulatory violations, financial
penalties, or legal exposure.`,
  },

  // ─── Module 14 ────────────────────────────────────────────────────────
  {
    title: 'Escalation & Legal Trigger Framework',
    applicable_roles: ALL_ROLES,
    content: `PURPOSE
Ensure all high-risk issues are escalated appropriately and not
handled informally.

SCOPE
Applies to all departments, all compliance events, and all
risk-related decisions.

ESCALATION LEVELS
1. Staff member
2. Department lead (HR / Compliance)
3. Executive leadership
4. Legal counsel

IMMEDIATE ESCALATION TRIGGERS
Escalate IMMEDIATELY for:
- Expired or unverifiable license
- Patient harm or safety incident
- Payroll dispute or wage violation
- PHI breach or data exposure
- Discrimination complaint
- Suspected fraud
- Regulatory inquiry

STANDARD ESCALATION TRIGGERS
Escalate when documentation is incomplete, compliance is unclear,
process deviation occurs, or recurring issues are identified.

ESCALATION RULES
- Do NOT delay escalation.
- Do NOT resolve high-risk issues informally.
- Document ALL escalations.
- Escalate even if uncertain.

DOCUMENTATION REQUIREMENTS
All escalations must include the issue description, timeline, actions
taken, and responsible parties.

LEGAL SENSITIVITY RULE
If an issue presents legal risk, escalate immediately to executive /
legal.

PROHIBITED ACTIONS
- Ignoring escalation triggers.
- Delaying reporting.
- Resolving critical issues without documentation.
- Suppressing incidents.

ENFORCEMENT
Failure to escalate may result in compliance violations, disciplinary
action, or legal exposure.`,
  },

  // ─── Module 15 ────────────────────────────────────────────────────────
  {
    title: 'Contractor vs Employee Risk Framework',
    applicable_roles: LEADERSHIP_HR,
    content: `PURPOSE
Ensure proper worker classification and prevent misclassification
risk.

SCOPE
Applies to all workers, all assignments, and all payroll
classifications.

CLASSIFICATION TYPES
- Employee (W-2)
- Independent Contractor (1099)

CLASSIFICATION CRITERIA
Evaluate level of control, independence, financial arrangement,
duration of work, and integration into operations.

DOCUMENTATION REQUIREMENT
Classification must be documented, justified, and retained for audit.

RISK INDICATORS
High risk if a contractor is treated like an employee, a fixed
schedule is imposed, supervision mirrors an employee structure, or
there is a lack of independence.

HARD STOP RULE
If classification is unclear, DO NOT PROCEED.

RE-VERIFICATION TRIGGERS
Review classification when the assignment changes, duties change,
duration extends, or an audit identifies risk.

ESCALATION TRIGGERS
Immediate escalation required for a classification dispute, regulatory
inquiry, or inconsistent classification practices.

AUDIT REQUIREMENTS
All classifications must be documented, consistent, and auditable.

ENFORCEMENT
Violations may result in fines, back wages, or legal penalties.`,
  },

  // ─── Module 16 ────────────────────────────────────────────────────────
  {
    title: 'Employee Onboarding Compliance Manual',
    applicable_roles: LEADERSHIP_HR,
    content: `PURPOSE
Ensure all workers are properly vetted, documented, and approved
before placement.

SCOPE
Applies to all new hires, all contractors, and all assignments.

ONBOARDING REQUIREMENTS
Must complete the credentialing file, license verification, signed
policies, employment eligibility verification, and payroll setup.

ONBOARDING WORKFLOW
1. Candidate selection
2. Document collection
3. Credential verification
4. Compliance review
5. Final clearance
6. Assignment start

CLEARANCE RULE
A worker MUST NOT start until ALL requirements are complete.

DOCUMENTATION REQUIREMENTS
Maintain the onboarding checklist, signed documents, and verification
records.

HARD STOP RULES
DO NOT onboard if the credential file is incomplete, the license is
not verified, or any required documentation is missing.

ESCALATION TRIGGERS
Immediate escalation for incomplete onboarding, an early placement
request, or missing documentation.

AUDIT REQUIREMENTS
Onboarding files must be complete, documented, and audit-ready.

ENFORCEMENT
Violations may result in compliance failure or disciplinary action.`,
  },

  // ─── Module 17 ────────────────────────────────────────────────────────
  {
    title: 'Termination & Offboarding Compliance Policy',
    applicable_roles: LEADERSHIP_HR,
    content: `PURPOSE
Ensure proper closure of employment and protection of company systems
and data.

SCOPE
Applies to all employees and all contractors.

OFFBOARDING REQUIREMENTS
Must complete system access removal, assignment closure, final
payroll review, and documentation completion.

OFFBOARDING WORKFLOW
1. Termination notice
2. Access removal
3. Payroll review
4. Documentation completion
5. File closure

DATA SECURITY RULE
Immediately revoke access to systems, PHI, and internal data.

PAYROLL COMPLIANCE
Ensure final pay accuracy and state-law compliance.

DOCUMENTATION REQUIREMENTS
Maintain the termination record, offboarding checklist, and final pay
documentation.

ESCALATION TRIGGERS
Immediate escalation for a disputed termination, payroll issue, or
compliance concern.

AUDIT REQUIREMENTS
Offboarding must be documented and auditable.

ENFORCEMENT
Violations may result in compliance risk or disciplinary action.`,
  },

  // ─── Module 18 ────────────────────────────────────────────────────────
  {
    title: 'Continuous Audit & Review Protocol',
    applicable_roles: LEADERSHIP_HR,
    content: `PURPOSE
Ensure ongoing compliance monitoring and continuous improvement.

SCOPE
Applies to all operational areas: credentialing, payroll, recruiting,
incident management, and compliance.

AUDIT FREQUENCY
- Weekly: operational review
- Monthly: executive compliance report
- Quarterly: full internal audit

AUDIT SCOPE
Review credential files, payroll records, incident logs, training
records, and compliance documentation.

AUDIT METHODOLOGY
- Sampling
- Validation
- Verification
- Deficiency identification

DEFICIENCY HANDLING
1. Identify the issue.
2. Log the deficiency.
3. Assign corrective action.
4. Track to closure.

MONITORING REQUIREMENTS
Track compliance KPIs, incident trends, audit findings, and escalation
frequency.

REPORTING REQUIREMENTS
- Weekly dashboard
- Monthly executive report
- Audit findings log

ESCALATION TRIGGERS
Immediate escalation for a major audit failure, repeated compliance
issues, or unresolved deficiencies.

CONTINUOUS IMPROVEMENT RULE
Update processes, strengthen controls, and improve compliance systems
based on audit results.

ENFORCEMENT
Failure to maintain audit protocol may result in compliance breakdown,
audit failure, or operational risk.`,
  },
];

async function main(): Promise<void> {
  console.log(`\nFNS compliance policy seed — ${POLICIES.length} policies queued\n`);
  let inserted = 0;
  let skipped = 0;

  try {
    for (const p of POLICIES) {
      const existing = await pool.query(
        `SELECT id FROM comp_policies WHERE title = $1 LIMIT 1`,
        [p.title]
      );
      if (existing.rows.length > 0) {
        console.log(`  SKIP   "${p.title}" (already exists)`);
        skipped++;
        continue;
      }
      await pool.query(
        `INSERT INTO comp_policies
           (title, content, version, require_signature, status, applicable_roles, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          p.title,
          p.content,
          p.version ?? '1.0',
          p.require_signature ?? true,
          'published',
          p.applicable_roles,
          'system-seed',
        ]
      );
      console.log(`  INSERT "${p.title}"`);
      inserted++;
    }
    console.log(`\nDone. Inserted ${inserted}, skipped ${skipped}.\n`);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
