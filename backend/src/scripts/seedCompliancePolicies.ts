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
