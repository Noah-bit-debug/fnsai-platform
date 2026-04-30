import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from 'pdf-lib';
import { DEFAULT_TEMPLATE_ROLES, type TemplateRole } from './templateRoles';

export interface TemplateField {
  id: string;
  label: string;
  type: 'text' | 'date' | 'email' | 'phone' | 'textarea' | 'checkbox' | 'select';
  required: boolean;
  default_value?: string;
  options?: string[]; // for select type
  placeholder?: string;
  // Optional role this field is bound to. When set, document-from-
  // template uses this to wire the field to the right signer. Mirrors
  // the PR scope: HR signs HR-bound fields, Candidate signs the rest.
  role_key?: string;
}

export interface SystemTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  content: string;
  fields: TemplateField[];
  // Roles + signing_order ship as part of every system template.
  // Healthcare staffing flows are HR + Candidate by default; some
  // templates (e.g. handbook ack) are candidate-only. Sequential
  // ordering uses role.order.
  roles?: TemplateRole[];
  signing_order?: 'parallel' | 'sequential';
}

// Convenience: a candidate-only role list. Used by templates the
// candidate signs without HR (e.g. handbook acknowledgment).
const CANDIDATE_ONLY: TemplateRole[] = [
  { key: 'candidate', label: 'Candidate', order: 1 },
];

// ─── 12 Pre-built Healthcare Compliance Templates ────────────────────────────
export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  {
    id: 'hipaa-acknowledgment',
    name: 'HIPAA Privacy Notice Acknowledgment',
    category: 'Compliance',
    description: 'Staff acknowledges receipt and understanding of HIPAA Privacy Notice',
    fields: [
      { id: 'employee_name', label: 'Employee Full Name', type: 'text', required: true },
      { id: 'employee_title', label: 'Job Title / Role', type: 'text', required: true },
      { id: 'facility_name', label: 'Facility / Location', type: 'text', required: false },
      { id: 'sign_date', label: 'Date', type: 'date', required: true },
    ],
    content: `HIPAA PRIVACY NOTICE ACKNOWLEDGMENT

Frontline Healthcare Staffing

This document acknowledges that the undersigned employee has received and reviewed the Notice of Privacy Practices as required under the Health Insurance Portability and Accountability Act of 1996 (HIPAA) and its implementing regulations.

ACKNOWLEDGMENT OF RECEIPT

I, {employee_name}, employed as {employee_title}{facility_name_line}, hereby acknowledge and agree to the following:

1. RECEIPT OF NOTICE
I have received a copy of Frontline Healthcare Staffing's Notice of Privacy Practices, which describes how protected health information (PHI) about patients and staff may be used and disclosed, and how individuals can access this information.

2. UNDERSTANDING OF OBLIGATIONS
I understand my obligations under HIPAA, including but not limited to:
   • Protecting the privacy and security of all patient health information
   • Disclosing PHI only as permitted or required by law
   • Reporting any suspected or actual unauthorized disclosures of PHI immediately
   • Using the minimum necessary information when accessing patient records

3. CONSEQUENCES OF VIOLATIONS
I understand that violations of HIPAA privacy rules may result in:
   • Disciplinary action up to and including termination
   • Civil penalties of $100 to $50,000 per violation
   • Criminal penalties including fines and imprisonment for willful violations

4. ONGOING COMPLIANCE
I agree to comply with all HIPAA policies and procedures established by Frontline Healthcare Staffing and the facilities to which I am assigned.

5. TRAINING
I acknowledge that I have received or will complete required HIPAA privacy and security training as part of my onboarding and on an annual basis.

By signing below, I confirm that I have read, understood, and agree to comply with the HIPAA Privacy Notice and all related policies and procedures.`,
  },
  {
    id: 'background-check-auth',
    name: 'Background Check Authorization',
    category: 'Compliance',
    description: 'Authorization for pre-employment and ongoing background screening',
    fields: [
      { id: 'employee_name', label: 'Full Legal Name', type: 'text', required: true },
      { id: 'date_of_birth', label: 'Date of Birth', type: 'date', required: true },
      { id: 'ssn_last4', label: 'Last 4 digits of SSN', type: 'text', required: true, placeholder: 'XXXX' },
      { id: 'current_address', label: 'Current Address', type: 'textarea', required: true },
      { id: 'sign_date', label: 'Date', type: 'date', required: true },
    ],
    content: `BACKGROUND CHECK AUTHORIZATION AND DISCLOSURE

Frontline Healthcare Staffing

DISCLOSURE REGARDING BACKGROUND INVESTIGATION

Frontline Healthcare Staffing ("Company") may obtain one or more consumer reports or investigative consumer reports about you for employment purposes. These reports may include information about your character, general reputation, personal characteristics, mode of living, and/or credit standing, and may include information about your criminal history, employment history, educational records, professional licenses, references, and other background information.

AUTHORIZATION

I, {employee_name}, born {date_of_birth}, residing at {current_address}, hereby authorize Frontline Healthcare Staffing and its designated agents to obtain consumer reports and investigative consumer reports about me, now and throughout my employment.

I understand that:
   • This authorization remains on file and may be used for future employment decisions
   • I have the right to request information about the nature and scope of any investigation
   • I may request a copy of any consumer report obtained about me
   • A summary of my rights under the Fair Credit Reporting Act (FCRA) has been provided to me

SCOPE OF INVESTIGATION
The background investigation may include:
   • Criminal history (federal, state, and county records)
   • Sex offender registry checks
   • Professional license verification
   • Employment verification (last 7 years)
   • Education verification
   • OIG/GSA exclusion list checks (required for healthcare workers)
   • Drug screening results
   • Driving record (if applicable)

For identification purposes: Last 4 SSN digits: {ssn_last4}

I certify that all information I have provided in connection with my application for employment is true and complete. I understand that any false information or omissions may disqualify me from employment or result in termination.`,
  },
  {
    id: 'drug-screen-consent',
    name: 'Drug & Substance Abuse Testing Consent',
    category: 'Compliance',
    description: 'Consent for pre-employment and random drug/alcohol screening',
    fields: [
      { id: 'employee_name', label: 'Employee Full Name', type: 'text', required: true },
      { id: 'employee_role', label: 'Position / Role', type: 'text', required: true },
      { id: 'test_type', label: 'Test Type', type: 'select', required: true, options: ['Pre-Employment', 'Random', 'Post-Incident', 'Reasonable Suspicion', 'Return-to-Duty'] },
      { id: 'sign_date', label: 'Date', type: 'date', required: true },
    ],
    content: `DRUG AND SUBSTANCE ABUSE TESTING CONSENT FORM

Frontline Healthcare Staffing

POLICY STATEMENT

Frontline Healthcare Staffing is committed to providing a safe, healthy, and productive work environment for all employees and the patients in our care. The use of illegal drugs and the misuse of alcohol or prescription medications are incompatible with these goals.

CONSENT TO TESTING

I, {employee_name}, applying for/currently employed in the role of {employee_role}, hereby voluntarily consent to submit to a {test_type} drug and/or alcohol test administered by or on behalf of Frontline Healthcare Staffing.

TEST TYPE: {test_type}

SUBSTANCES TESTED
This test screens for the following substances, which may include but are not limited to:
   • Marijuana/THC (including medical marijuana)
   • Cocaine and cocaine metabolites
   • Amphetamines and methamphetamines
   • Opiates (including heroin, morphine, codeine)
   • Phencyclidine (PCP)
   • Benzodiazepines
   • Barbiturates
   • Alcohol (blood or breath analysis)
   • Synthetic opioids (fentanyl, oxycodone, etc.)

MY UNDERSTANDING

I understand and acknowledge the following:
   • Testing is a condition of employment/continued employment with Frontline Healthcare Staffing
   • A positive test result, refusal to test, or adulteration of a specimen will result in immediate disqualification or termination
   • Test results are confidential and will only be shared with authorized personnel
   • I may be required to submit to random testing throughout my employment
   • I have been provided an opportunity to disclose current prescription medications that may affect test results

MEDICAL MARIJUANA NOTICE
I acknowledge that even in states where medical or recreational marijuana is legal, Frontline Healthcare Staffing maintains a zero-tolerance policy for marijuana use due to federal regulations governing healthcare workers and patient safety requirements.

By signing this form, I certify that I am providing informed consent to submit to this testing and have not consumed any prohibited substances that would cause a positive test result.`,
  },
  {
    id: 'handbook-receipt',
    name: 'Employee Handbook Acknowledgment',
    category: 'HR',
    description: 'Receipt and acknowledgment of the employee handbook',
    fields: [
      { id: 'employee_name', label: 'Employee Full Name', type: 'text', required: true },
      { id: 'employee_id', label: 'Employee ID (if assigned)', type: 'text', required: false },
      { id: 'start_date', label: 'Start Date', type: 'date', required: true },
      { id: 'sign_date', label: 'Date Signed', type: 'date', required: true },
    ],
    content: `EMPLOYEE HANDBOOK ACKNOWLEDGMENT AND RECEIPT

Frontline Healthcare Staffing

RECEIPT OF EMPLOYEE HANDBOOK

I, {employee_name} (Employee ID: {employee_id}), acknowledge that I have received a copy of the Frontline Healthcare Staffing Employee Handbook effective as of my start date of {start_date}.

I understand and agree to the following:

1. I have received and/or have access to the Employee Handbook and related policies.

2. It is my responsibility to read and familiarize myself with the information contained in the Handbook and to comply with all policies and procedures outlined therein.

3. The Employee Handbook is not a contract of employment and does not alter my at-will employment status.

4. Frontline Healthcare Staffing reserves the right to modify, rescind, or revise any policy or benefit described in the Handbook, with or without prior notice.

5. I understand that this Handbook supersedes and replaces all previously issued Handbooks and any inconsistent verbal or written policy statements.

KEY POLICIES ACKNOWLEDGED

By signing this form, I specifically acknowledge having received information about:
   • Equal Employment Opportunity and Non-Discrimination Policy
   • Anti-Harassment and Anti-Bullying Policy
   • HIPAA Privacy and Security Policy
   • Code of Professional Conduct
   • Social Media Policy
   • Drug and Alcohol Free Workplace Policy
   • Attendance and Punctuality Requirements
   • Time and Attendance Reporting Procedures
   • Workplace Safety and Incident Reporting
   • Patient Rights and Confidentiality
   • Dress Code and Professional Appearance Standards
   • Disciplinary Procedures
   • Termination and Resignation Procedures
   • Benefits Information

If I have any questions regarding the contents of this Handbook or any policy, I understand that I should direct them to my supervisor or to HR.`,
  },
  {
    id: 'direct-deposit',
    name: 'Direct Deposit Authorization',
    category: 'Payroll',
    description: 'Authorization to deposit payroll directly to employee bank account',
    fields: [
      { id: 'employee_name', label: 'Employee Full Name', type: 'text', required: true },
      { id: 'bank_name', label: 'Bank / Financial Institution Name', type: 'text', required: true },
      { id: 'account_type', label: 'Account Type', type: 'select', required: true, options: ['Checking', 'Savings'] },
      { id: 'routing_number', label: 'Routing Number (9 digits)', type: 'text', required: true },
      { id: 'account_number', label: 'Account Number', type: 'text', required: true },
      { id: 'sign_date', label: 'Date', type: 'date', required: true },
    ],
    content: `DIRECT DEPOSIT AUTHORIZATION FORM

Frontline Healthcare Staffing

EMPLOYEE INFORMATION AND AUTHORIZATION

I, {employee_name}, hereby authorize Frontline Healthcare Staffing ("Company") and its payroll service provider to initiate credit entries to my {account_type} account at {bank_name}.

BANKING INFORMATION
   Bank / Financial Institution: {bank_name}
   Account Type: {account_type}
   Routing Number: {routing_number}
   Account Number: {account_number}

AUTHORIZATION TERMS

1. I authorize the Company to deposit my net pay into the account specified above on each regularly scheduled payday.

2. I authorize the Company to initiate corrective debit entries if an erroneous credit entry is made to my account.

3. This authorization will remain in effect until I provide written notice to cancel it with sufficient notice to allow the Company to process the change (typically one full pay cycle).

4. I agree to provide at least 14 days advance written notice of any changes to my banking information.

5. I understand that it may take up to two pay periods for direct deposit to take effect after this authorization is processed.

IMPORTANT NOTICES

   • Attach a voided check or official bank documentation for verification
   • Frontline Healthcare Staffing uses industry-standard encryption to protect your banking information
   • You will continue to receive a pay stub each pay period showing all earnings and deductions
   • Direct deposit is available for all employees after completion of the new hire waiting period

PAYCARD ALTERNATIVE
If you do not have a bank account, please contact HR about our paycard program.

By signing below, I certify that the banking information provided is accurate and I authorize the direct deposit arrangement described above.

NOTE: For your security, this document is handled with strict confidentiality. Routing and account numbers are used only for payroll deposit purposes.`,
  },
  {
    id: 'offer-letter',
    name: 'Employment Offer Letter',
    category: 'HR',
    description: 'Formal employment offer with compensation and terms',
    fields: [
      { id: 'employee_name', label: 'Candidate Full Name', type: 'text', required: true },
      { id: 'employee_address', label: 'Candidate Address', type: 'textarea', required: false },
      { id: 'position_title', label: 'Position Title', type: 'text', required: true },
      { id: 'employment_type', label: 'Employment Type', type: 'select', required: true, options: ['Full-Time', 'Part-Time', 'Per Diem', 'Contract', 'Temporary'] },
      { id: 'start_date', label: 'Proposed Start Date', type: 'date', required: true },
      { id: 'hourly_rate', label: 'Hourly Rate ($)', type: 'text', required: true },
      { id: 'supervisor_name', label: 'Reporting Supervisor', type: 'text', required: false },
      { id: 'sign_date', label: 'Date of Offer', type: 'date', required: true },
    ],
    content: `EMPLOYMENT OFFER LETTER

Frontline Healthcare Staffing
[Company Address]
[City, State ZIP]

{sign_date}

{employee_name}
{employee_address}

Dear {employee_name},

We are pleased to offer you the position of {position_title} with Frontline Healthcare Staffing on a {employment_type} basis. We believe your skills and experience will be a valuable addition to our team.

OFFER DETAILS

Position Title: {position_title}
Employment Type: {employment_type}
Start Date: {start_date}
Compensation: \${hourly_rate} per hour
Reporting To: {supervisor_name}

COMPENSATION AND BENEFITS
   • Hourly Rate: \${hourly_rate}/hour
   • Pay Schedule: Bi-weekly direct deposit
   • Overtime: Paid at 1.5x for hours worked over 40/week
   • Benefits eligibility determined by employment type and hours worked

CONDITIONS OF EMPLOYMENT
This offer is contingent upon successful completion of the following:
   • Background check (criminal, professional, OIG exclusion)
   • Drug screening
   • Verification of applicable professional licenses/certifications
   • Completion of new hire paperwork and onboarding requirements
   • Reference verification

AT-WILL EMPLOYMENT
Employment with Frontline Healthcare Staffing is at-will, meaning either party may terminate the employment relationship at any time, with or without cause or notice. Nothing in this letter or any company policy creates an employment contract or guarantees employment for any specific period.

ACCEPTANCE
To accept this offer, please sign and return this letter by the date indicated. If you have questions, please contact our HR team.

We look forward to welcoming you to the Frontline Healthcare Staffing team!

Sincerely,

_______________________________
Authorized Representative
Frontline Healthcare Staffing

CANDIDATE ACCEPTANCE

I, {employee_name}, accept the employment offer as described above.`,
  },
  {
    id: 'nda-confidentiality',
    name: 'Confidentiality & Non-Disclosure Agreement',
    category: 'Legal',
    description: 'Protects patient information, trade secrets, and proprietary company data',
    fields: [
      { id: 'employee_name', label: 'Employee Full Name', type: 'text', required: true },
      { id: 'employee_role', label: 'Position / Role', type: 'text', required: true },
      { id: 'sign_date', label: 'Effective Date', type: 'date', required: true },
    ],
    content: `CONFIDENTIALITY AND NON-DISCLOSURE AGREEMENT

Frontline Healthcare Staffing

This Confidentiality and Non-Disclosure Agreement ("Agreement") is entered into as of {sign_date} between Frontline Healthcare Staffing ("Company") and {employee_name} ("Employee"), employed as {employee_role}.

1. DEFINITION OF CONFIDENTIAL INFORMATION
"Confidential Information" includes, but is not limited to:
   a) Protected Health Information (PHI) of all patients, as defined by HIPAA
   b) Personal information of staff, clients, and business partners
   c) Proprietary staffing processes, procedures, and methodologies
   d) Client and facility contracts, rates, and business arrangements
   e) Financial information, pricing, and business strategies
   f) Software, databases, and technology systems
   g) Employee information including compensation and personnel files
   h) Any information marked as confidential or that a reasonable person would understand to be confidential

2. OBLIGATIONS OF CONFIDENTIALITY
Employee agrees to:
   a) Hold all Confidential Information in strict confidence
   b) Use Confidential Information only in the performance of assigned duties
   c) Not disclose Confidential Information to any third party without written authorization
   d) Promptly report any unauthorized disclosure or suspected breach
   e) Return or destroy all Confidential Information upon termination of employment

3. PATIENT INFORMATION (HIPAA)
Employee specifically acknowledges that:
   a) All patient information is protected under HIPAA and applicable state laws
   b) Access to PHI is limited to the minimum necessary to perform job duties
   c) Unauthorized access to or disclosure of PHI may result in criminal prosecution

4. SOCIAL MEDIA AND PUBLIC COMMUNICATIONS
Employee agrees to never post, share, or discuss:
   a) Any patient information, including de-identified information that could identify a patient
   b) Photographs or recordings taken at client facilities without explicit authorization
   c) Internal company matters, client information, or proprietary business information

5. DURATION
This Agreement survives the termination of employment for a period of five (5) years with respect to trade secrets and business confidential information, and indefinitely with respect to patient PHI.

6. REMEDIES
Employee acknowledges that unauthorized disclosure of Confidential Information would cause irreparable harm and that monetary damages would be inadequate. The Company shall be entitled to seek injunctive relief in addition to all other available legal remedies.

7. GOVERNING LAW
This Agreement shall be governed by the laws of the state in which Employee performs services.

By signing below, Employee acknowledges reading, understanding, and agreeing to all terms of this Agreement.`,
  },
  {
    id: 'facility-assignment',
    name: 'Facility Assignment Agreement',
    category: 'Operations',
    description: 'Terms and conditions for assignment to a specific client facility',
    fields: [
      { id: 'employee_name', label: 'Staff Member Name', type: 'text', required: true },
      { id: 'employee_role', label: 'Role / Credential', type: 'text', required: true },
      { id: 'facility_name', label: 'Facility Name', type: 'text', required: true },
      { id: 'facility_address', label: 'Facility Address', type: 'textarea', required: false },
      { id: 'start_date', label: 'Assignment Start Date', type: 'date', required: true },
      { id: 'end_date', label: 'Anticipated End Date', type: 'date', required: false },
      { id: 'shift_type', label: 'Shift', type: 'select', required: true, options: ['Days (7a-3p)', 'Evenings (3p-11p)', 'Nights (11p-7a)', '12-Hour Days', '12-Hour Nights', 'Rotating', 'Per Diem/Variable'] },
      { id: 'hourly_rate', label: 'Hourly Rate ($)', type: 'text', required: true },
      { id: 'sign_date', label: 'Date', type: 'date', required: true },
    ],
    content: `FACILITY ASSIGNMENT AGREEMENT

Frontline Healthcare Staffing

ASSIGNMENT DETAILS

This Facility Assignment Agreement confirms the terms of the following staffing assignment:

Staff Member: {employee_name}
Role / Credential: {employee_role}
Assigned Facility: {facility_name}
Facility Address: {facility_address}
Assignment Start: {start_date}
Anticipated End: {end_date}
Shift: {shift_type}
Hourly Rate: \${hourly_rate}/hour

TERMS AND CONDITIONS

1. NATURE OF ASSIGNMENT
This assignment is temporary and does not constitute permanent employment at the assigned facility. Frontline Healthcare Staffing remains the Employer of Record.

2. FACILITY POLICIES
I agree to comply with all policies, procedures, and protocols of {facility_name}, including but not limited to dress code, badge requirements, parking, and unit-specific procedures.

3. PROFESSIONAL STANDARDS
I agree to:
   a) Maintain professional conduct and attitude at all times
   b) Report to assigned shifts on time or provide adequate notice of absence
   c) Perform all duties within my licensed scope of practice
   d) Immediately report any patient safety concerns to the charge nurse/supervisor AND Frontline Healthcare Staffing

4. CANCELLATIONS AND NO-CALLS
   a) I will provide at least 2 hours notice before any shift cancellation
   b) No-call/no-show to an assigned shift may result in immediate removal from the facility and/or termination
   c) I understand that excessive cancellations may affect future assignment opportunities

5. FLOATING AND REASSIGNMENT
I understand that the facility may reassign me to other units based on patient census and staffing needs. I will accept reassignments within my competency level.

6. CREDENTIALS AND COMPLIANCE
I certify that all required licenses, certifications, and credentials are current and valid. I agree to immediately notify Frontline Healthcare Staffing of any changes in my licensure status.

7. NON-SOLICITATION
I agree not to seek or accept direct employment with {facility_name} during this assignment or for 12 months following completion of this assignment without written approval from Frontline Healthcare Staffing.

8. TIMESHEETS
I agree to submit accurate timesheets and obtain required supervisor signatures by the deadline each pay period. Falsification of timesheets is grounds for immediate termination.

By signing, I acknowledge I have read and agree to all terms of this assignment.`,
  },
  {
    id: 'emergency-contact',
    name: 'Emergency Contact & Medical Release',
    category: 'HR',
    description: 'Emergency contacts and emergency medical treatment authorization',
    fields: [
      { id: 'employee_name', label: 'Employee Full Name', type: 'text', required: true },
      { id: 'employee_dob', label: 'Date of Birth', type: 'date', required: true },
      { id: 'contact1_name', label: 'Primary Emergency Contact Name', type: 'text', required: true },
      { id: 'contact1_relation', label: 'Relationship', type: 'text', required: true },
      { id: 'contact1_phone', label: 'Primary Contact Phone', type: 'phone', required: true },
      { id: 'contact2_name', label: 'Secondary Emergency Contact Name', type: 'text', required: false },
      { id: 'contact2_phone', label: 'Secondary Contact Phone', type: 'phone', required: false },
      { id: 'blood_type', label: 'Blood Type (if known)', type: 'select', required: false, options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'] },
      { id: 'allergies', label: 'Known Allergies / Medical Conditions', type: 'textarea', required: false, placeholder: 'List any allergies, medical conditions, or medications important in an emergency' },
      { id: 'sign_date', label: 'Date', type: 'date', required: true },
    ],
    content: `EMERGENCY CONTACT INFORMATION AND MEDICAL RELEASE

Frontline Healthcare Staffing
(Confidential — For Emergency Use Only)

EMPLOYEE INFORMATION

Employee Name: {employee_name}
Date of Birth: {employee_dob}
Blood Type: {blood_type}

EMERGENCY CONTACTS

PRIMARY CONTACT
Name: {contact1_name}
Relationship: {contact1_relation}
Phone: {contact1_phone}

SECONDARY CONTACT
Name: {contact2_name}
Phone: {contact2_phone}

MEDICAL INFORMATION
Known Allergies / Conditions: {allergies}

EMERGENCY MEDICAL TREATMENT AUTHORIZATION

In the event of a medical emergency in which I am unable to provide consent for medical treatment, I hereby authorize Frontline Healthcare Staffing and emergency medical personnel to:

   1. Contact the emergency contacts listed above
   2. Authorize necessary emergency medical treatment on my behalf if my emergency contacts cannot be reached
   3. Share the medical information provided on this form with emergency medical responders as needed for my care
   4. Transport me to the nearest appropriate medical facility

INSURANCE INFORMATION
I understand I am responsible for providing current insurance information at the time of any medical treatment. Workers' compensation coverage applies for work-related injuries sustained while on assignment.

WORKERS' COMPENSATION
I understand that injuries sustained during the course and scope of my employment should be immediately reported to my supervisor and Frontline Healthcare Staffing. Workers' compensation coverage is provided through the Company's insurance carrier.

HIPAA AUTHORIZATION
I authorize the release of my medical information listed on this form to emergency responders, treating physicians, and Frontline Healthcare Staffing's designated HR personnel only for emergency purposes.

I certify that the information provided is accurate and I will update this form within 30 days of any changes.`,
  },
  {
    id: 'at-will-acknowledgment',
    name: 'At-Will Employment Acknowledgment',
    category: 'Legal',
    description: 'Acknowledgment of at-will employment status and related policies',
    fields: [
      { id: 'employee_name', label: 'Employee Full Name', type: 'text', required: true },
      { id: 'position_title', label: 'Position Title', type: 'text', required: true },
      { id: 'start_date', label: 'Employment Start Date', type: 'date', required: true },
      { id: 'sign_date', label: 'Date Signed', type: 'date', required: true },
    ],
    content: `AT-WILL EMPLOYMENT ACKNOWLEDGMENT

Frontline Healthcare Staffing

ACKNOWLEDGMENT OF AT-WILL EMPLOYMENT STATUS

I, {employee_name}, employed as {position_title} with a start date of {start_date}, hereby acknowledge and understand the following:

1. AT-WILL EMPLOYMENT
My employment with Frontline Healthcare Staffing is at-will. This means:
   a) Either the Company or I may terminate the employment relationship at any time
   b) Termination may occur with or without cause
   c) Termination may occur with or without advance notice
   d) This at-will status applies regardless of length of service

2. NO CONTRACT OR GUARANTEE
   a) Nothing in any company document, policy, handbook, or verbal communication creates an employment contract
   b) No supervisor, manager, or representative of the Company has the authority to alter my at-will status except through a written agreement signed by the CEO or President
   c) Completion of a probationary period does not change my at-will status
   d) Performance reviews, raises, or positive feedback do not create an implied contract

3. RESIGNATION
   a) I understand I may resign at any time with or without notice
   b) While not required, I am encouraged to provide at least two weeks written notice
   c) My employment record will reflect any notice period provided

4. COMPANY POLICY CHANGES
   a) The Company reserves the right to change compensation, benefits, job duties, work schedules, and other terms and conditions of employment at any time
   b) I will be notified of material changes to policies and procedures

5. EQUAL OPPORTUNITY
I acknowledge that the Company's at-will employment policy does not permit termination for illegal reasons including discrimination based on protected characteristics (race, color, religion, sex, national origin, age, disability, etc.).

6. GOVERNING LAW
This acknowledgment is governed by applicable state and federal law.

By signing below, I confirm that I have read, understood, and agree to the at-will employment terms described above. I have not been promised or guaranteed employment for any specific duration.`,
  },
  {
    id: 'workers-comp-notice',
    name: "Workers' Compensation Rights Notice",
    category: 'Compliance',
    description: "Required notice of workers' compensation rights and reporting procedures",
    fields: [
      { id: 'employee_name', label: 'Employee Full Name', type: 'text', required: true },
      { id: 'employee_role', label: 'Position / Role', type: 'text', required: true },
      { id: 'sign_date', label: 'Date', type: 'date', required: true },
    ],
    content: `WORKERS' COMPENSATION RIGHTS NOTICE AND ACKNOWLEDGMENT

Frontline Healthcare Staffing

NOTICE TO EMPLOYEES — PLEASE READ CAREFULLY

This notice describes your rights and responsibilities under the Workers' Compensation system.

YOUR RIGHTS UNDER WORKERS' COMPENSATION

As an employee of Frontline Healthcare Staffing, you are covered by Workers' Compensation insurance if you are injured on the job. Workers' Compensation provides:

   ✓ Medical Treatment: Coverage for medical care necessary to treat your work injury
   ✓ Temporary Disability: Wage replacement if you are unable to work due to a work injury
   ✓ Permanent Disability: Benefits if your injury results in permanent impairment
   ✓ Supplemental Job Displacement: Vouchers for retraining if you cannot return to your previous job
   ✓ Death Benefits: Benefits to dependents if a work-related injury results in death

REPORTING REQUIREMENTS

I, {employee_name}, understand and agree to the following reporting obligations:

1. IMMEDIATE REPORTING
   • Report ALL work-related injuries or illnesses to my supervisor AND Frontline Healthcare Staffing immediately — no matter how minor
   • Failure to report promptly may jeopardize my right to Workers' Compensation benefits

2. HOW TO REPORT
   • Notify the charge nurse/supervisor at the facility immediately
   • Contact Frontline Healthcare Staffing HR at the number on my ID badge within 24 hours
   • Complete an incident report within 24 hours of the injury

3. MEDICAL TREATMENT
   • For emergencies: Call 911 or go to the nearest emergency room immediately
   • For non-emergencies: Use the designated occupational health provider as directed by Frontline Healthcare Staffing
   • Seeking unauthorized treatment may affect benefit eligibility

4. LIGHT DUTY
   • The Company may offer modified/light duty assignments during recovery
   • I am required to accept light duty within my medical restrictions if offered

ANTI-RETALIATION NOTICE
It is ILLEGAL for Frontline Healthcare Staffing to discriminate against or retaliate against any employee for filing a Workers' Compensation claim or participating in a Workers' Compensation proceeding.

Workers' Compensation Insurance Carrier: [Carrier Name on File with HR]
Policy Number: [On File with HR]
Claims Phone: [Available from HR]

I, {employee_name}, employed as {employee_role}, acknowledge receipt of this Workers' Compensation Rights Notice and understand my rights and responsibilities.`,
  },
  {
    id: 'tb-test-consent',
    name: 'TB Test Consent & Documentation',
    category: 'Health Screening',
    description: 'Tuberculosis testing consent and results documentation',
    fields: [
      { id: 'employee_name', label: 'Employee Full Name', type: 'text', required: true },
      { id: 'employee_role', label: 'Role / Credential', type: 'text', required: true },
      { id: 'test_method', label: 'Test Method', type: 'select', required: true, options: ['Mantoux TST (Skin Test)', 'QuantiFERON-TB Gold (Blood Test)', 'T-SPOT.TB (Blood Test)', 'Chest X-Ray', 'Symptom Questionnaire Only'] },
      { id: 'test_date', label: 'Test Date', type: 'date', required: true },
      { id: 'test_result', label: 'Result', type: 'select', required: false, options: ['Negative', 'Positive', 'Indeterminate', 'Pending'] },
      { id: 'sign_date', label: 'Date', type: 'date', required: true },
    ],
    content: `TUBERCULOSIS (TB) TEST CONSENT AND DOCUMENTATION FORM

Frontline Healthcare Staffing

TB TESTING REQUIREMENT

All healthcare workers placed by Frontline Healthcare Staffing are required to have documented TB screening in compliance with CDC guidelines, The Joint Commission standards, and applicable state healthcare worker regulations.

CONSENT TO TUBERCULOSIS TESTING

I, {employee_name}, employed/applying as {employee_role}, hereby consent to TB screening as follows:

Test Method: {test_method}
Test Date: {test_date}
Test Result: {test_result}

INFORMATION PROVIDED TO ME

I have been informed of the following:
   • The purpose of TB testing and how it detects tuberculosis infection
   • The risks associated with the test method selected (including possible reactions to skin test)
   • What a positive result means and the follow-up steps required
   • That a positive TB test does NOT mean I have active tuberculosis disease

MY HISTORY AND ACKNOWLEDGMENTS

   □ I have previously had a positive TB test result / TB disease / TB treatment (disclose to HR)
   □ I have received the BCG vaccine (may cause false positive skin test)
   □ I have no known history of TB exposure or positive test

POSITIVE RESULT PROTOCOL
If my test result is positive or indeterminate:
   1. I will notify Frontline Healthcare Staffing HR immediately
   2. I will follow up with a licensed physician for evaluation
   3. A chest X-ray may be required to rule out active TB disease
   4. I understand I may not be placed at facilities until TB status is cleared by a physician

ANNUAL TESTING
I understand that TB screening may be required annually or as required by facility contracts or state regulations.

DECLINATION (if applicable)
If declining TB testing, I understand this may affect my ability to accept placements at certain facilities and I accept full responsibility for any resulting limitations on my assignments.

By signing below, I consent to TB testing as described above and certify that the information provided is accurate.`,
  },
];

// ─── Role overlays for system templates ───────────────────────────────────────
//
// Each healthcare-staffing form has a different signing pattern. Rather
// than threading a `roles` field through 12 inline definitions (which
// invites copy-paste errors), the assignments live in this single map
// and are overlaid onto SYSTEM_TEMPLATES at load time.
//
// Sequencing rationale:
//   - `parallel` is the default — both parties sign whenever they get to it.
//   - `sequential` is used where the upstream party's signature is a
//     precondition (offer letter: HR signs first to lock the offer, THEN
//     the candidate sees and accepts).

type RoleOverlay = { roles: TemplateRole[]; signing_order: 'parallel' | 'sequential' };

const HR_AND_CANDIDATE: TemplateRole[] = [
  { key: 'hr',        label: 'HR',        order: 1 },
  { key: 'candidate', label: 'Candidate', order: 2 },
];

const SYSTEM_TEMPLATE_ROLES: Record<string, RoleOverlay> = {
  'hipaa-acknowledgment':    { roles: HR_AND_CANDIDATE, signing_order: 'parallel' },
  'background-check-auth':   { roles: HR_AND_CANDIDATE, signing_order: 'parallel' },
  'drug-screen-consent':     { roles: HR_AND_CANDIDATE, signing_order: 'parallel' },
  'handbook-receipt':        { roles: CANDIDATE_ONLY,    signing_order: 'parallel' },
  'direct-deposit':          { roles: CANDIDATE_ONLY,    signing_order: 'parallel' },
  // Offer letter is the canonical sequential case: HR drafts + signs to
  // lock the offer terms, then the candidate sees the locked offer and
  // accepts.
  'offer-letter':            { roles: HR_AND_CANDIDATE, signing_order: 'sequential' },
  'nda-confidentiality':     { roles: HR_AND_CANDIDATE, signing_order: 'parallel' },
  'facility-assignment':     { roles: HR_AND_CANDIDATE, signing_order: 'parallel' },
  'emergency-contact':       { roles: CANDIDATE_ONLY,    signing_order: 'parallel' },
  'at-will-acknowledgment':  { roles: CANDIDATE_ONLY,    signing_order: 'parallel' },
  'workers-comp-notice':     { roles: CANDIDATE_ONLY,    signing_order: 'parallel' },
  'tb-test-consent':         { roles: CANDIDATE_ONLY,    signing_order: 'parallel' },
};

// Apply the overlays once at module-load. Templates without an overlay
// fall back to the org-wide DEFAULT_TEMPLATE_ROLES — preserves the
// "sensible default" promise and means new system templates added
// later still work even if someone forgets to update the overlay map.
for (const t of SYSTEM_TEMPLATES) {
  const overlay = SYSTEM_TEMPLATE_ROLES[t.id];
  if (overlay) {
    t.roles = overlay.roles;
    t.signing_order = overlay.signing_order;
  } else {
    t.roles = DEFAULT_TEMPLATE_ROLES;
    t.signing_order = 'parallel';
  }
}

// ─── PDF Generation ───────────────────────────────────────────────────────────

function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

interface DrawTextOptions {
  font: PDFFont;
  boldFont: PDFFont;
  fontSize?: number;
  x: number;
  maxWidth: number;
  color?: ReturnType<typeof rgb>;
}

function drawWrappedText(
  page: PDFPage,
  text: string,
  y: number,
  opts: DrawTextOptions
): number {
  const fontSize = opts.fontSize ?? 10;
  const lineHeight = fontSize * 1.4;
  const lines = wrapText(text, opts.maxWidth, opts.font, fontSize);
  for (const line of lines) {
    if (y < 60) return y; // don't run off page
    page.drawText(line, {
      x: opts.x,
      y,
      size: fontSize,
      font: opts.font,
      color: opts.color ?? rgb(0.1, 0.1, 0.1),
    });
    y -= lineHeight;
  }
  return y;
}

export async function generateSignedPDF(opts: {
  title: string;
  content: string;
  fieldValues: Record<string, string>;
  signerName: string;
  signedAt: string;
  ipAddress: string;
  signatureData: string; // base64 PNG
  signatureType: string;
  auditEntries: Array<{ action: string; actor: string; timestamp: string }>;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const marginLeft = 56;
  const marginRight = 56;
  const contentWidth = pageWidth - marginLeft - marginRight;

  // Fill field values into content
  let filledContent = opts.content;
  for (const [key, value] of Object.entries(opts.fieldValues)) {
    filledContent = filledContent.replace(new RegExp(`\\{${key}\\}`, 'g'), value || `[${key}]`);
    // Handle facility_name_line pattern
    if (key === 'facility_name' && value) {
      filledContent = filledContent.replace(/\{facility_name_line\}/g, ` at ${value}`);
    }
  }
  filledContent = filledContent.replace(/\{facility_name_line\}/g, '');

  const drawText = (
    page: PDFPage,
    text: string,
    y: number,
    drawOpts: DrawTextOptions
  ) => drawWrappedText(page, text, y, drawOpts);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 48;

  const textOpts: DrawTextOptions = { font, boldFont, x: marginLeft, maxWidth: contentWidth };

  // ── Header ─────────────────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0,
    y: pageHeight - 72,
    width: pageWidth,
    height: 72,
    color: rgb(0.07, 0.38, 0.64),
  });
  page.drawText('FRONTLINE HEALTHCARE STAFFING', {
    x: marginLeft,
    y: pageHeight - 30,
    size: 13,
    font: boldFont,
    color: rgb(1, 1, 1),
  });
  page.drawText(opts.title, {
    x: marginLeft,
    y: pageHeight - 50,
    size: 10,
    font,
    color: rgb(0.85, 0.92, 1),
  });

  // Doc ID + date
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  page.drawText(`Electronically Signed Document  |  ${now}`, {
    x: marginLeft,
    y: pageHeight - 65,
    size: 8,
    font,
    color: rgb(0.75, 0.88, 1),
  });

  y = pageHeight - 96;

  // ── Body Content ───────────────────────────────────────────────────────────
  const lines = filledContent.split('\n');
  for (const rawLine of lines) {
    if (y < 100) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - 48;
    }
    const line = rawLine.trim();
    if (!line) {
      y -= 8;
      continue;
    }

    // Section headers (all caps, short lines)
    if (line === line.toUpperCase() && line.length > 3 && !line.startsWith('•') && !line.startsWith('□')) {
      page.drawText(line, {
        x: marginLeft,
        y,
        size: 10,
        font: boldFont,
        color: rgb(0.07, 0.38, 0.64),
      });
      y -= 6;
      page.drawLine({
        start: { x: marginLeft, y },
        end: { x: pageWidth - marginRight, y },
        thickness: 0.5,
        color: rgb(0.07, 0.38, 0.64),
        opacity: 0.3,
      });
      y -= 10;
      continue;
    }

    // Numbered items / bullets
    const isListItem = /^[\d]+\./.test(line) || line.startsWith('•') || line.startsWith('✓') || line.startsWith('□');
    const indentX = isListItem ? marginLeft + 8 : marginLeft;
    const maxW = isListItem ? contentWidth - 8 : contentWidth;

    y = drawWrappedText(page, line, y, { ...textOpts, x: indentX, maxWidth: maxW, fontSize: 9.5 });
    y -= 2;
  }

  // ── Signature Block ────────────────────────────────────────────────────────
  if (y < 200) {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - 48;
  }
  y -= 20;

  page.drawLine({
    start: { x: marginLeft, y: y + 5 },
    end: { x: pageWidth - marginRight, y: y + 5 },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 5;

  page.drawText('ELECTRONIC SIGNATURE', {
    x: marginLeft,
    y,
    size: 11,
    font: boldFont,
    color: rgb(0.07, 0.38, 0.64),
  });
  y -= 18;

  // Embed signature image
  try {
    const base64Data = opts.signatureData.replace(/^data:image\/\w+;base64,/, '');
    const sigBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    const sigImage = await pdfDoc.embedPng(sigBytes);
    const sigDims = sigImage.scale(0.4);
    const sigW = Math.min(sigDims.width, 220);
    const sigH = (sigDims.height / sigDims.width) * sigW;
    page.drawImage(sigImage, { x: marginLeft, y: y - sigH, width: sigW, height: sigH });
    y -= sigH + 8;
  } catch {
    // fallback: text representation
    page.drawText(`[Signature on file — ${opts.signatureType}]`, {
      x: marginLeft, y, size: 10, font, color: rgb(0.4, 0.4, 0.4),
    });
    y -= 18;
  }

  page.drawLine({
    start: { x: marginLeft, y },
    end: { x: marginLeft + 220, y },
    thickness: 1,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 14;
  page.drawText(opts.signerName, { x: marginLeft, y, size: 10, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
  y -= 14;
  page.drawText(`Signed: ${opts.signedAt}`, { x: marginLeft, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 12;
  page.drawText(`IP Address: ${opts.ipAddress}`, { x: marginLeft, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
  y -= 12;
  page.drawText(`Method: ${opts.signatureType}`, { x: marginLeft, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

  // ── Audit Trail Page ───────────────────────────────────────────────────────
  const auditPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let ay = pageHeight - 48;

  auditPage.drawRectangle({
    x: 0, y: pageHeight - 48, width: pageWidth, height: 48,
    color: rgb(0.95, 0.96, 0.98),
  });
  auditPage.drawText('AUDIT TRAIL & COMPLIANCE LOG', {
    x: marginLeft, y: pageHeight - 28, size: 12, font: boldFont, color: rgb(0.07, 0.38, 0.64),
  });
  auditPage.drawText('Legally binding electronic signature audit record', {
    x: marginLeft, y: pageHeight - 42, size: 9, font, color: rgb(0.5, 0.5, 0.5),
  });

  ay = pageHeight - 70;
  auditPage.drawText(`Document: ${opts.title}`, { x: marginLeft, y: ay, size: 10, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
  ay -= 14;
  auditPage.drawText(`Signer: ${opts.signerName}`, { x: marginLeft, y: ay, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
  ay -= 14;
  auditPage.drawText(`Completed: ${opts.signedAt}`, { x: marginLeft, y: ay, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
  ay -= 24;

  auditPage.drawText('EVENT LOG', { x: marginLeft, y: ay, size: 10, font: boldFont, color: rgb(0.07, 0.38, 0.64) });
  ay -= 16;

  for (const entry of opts.auditEntries) {
    auditPage.drawRectangle({ x: marginLeft, y: ay - 4, width: contentWidth, height: 18, color: rgb(0.97, 0.98, 1), opacity: 0.5 });
    auditPage.drawText(`${entry.timestamp}`, { x: marginLeft + 4, y: ay + 2, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
    auditPage.drawText(entry.action, { x: marginLeft + 160, y: ay + 2, size: 8, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
    auditPage.drawText(entry.actor, { x: marginLeft + 340, y: ay + 2, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
    ay -= 20;
  }

  ay -= 20;
  auditPage.drawText('LEGAL NOTICE', { x: marginLeft, y: ay, size: 9, font: boldFont, color: rgb(0.07, 0.38, 0.64) });
  ay -= 14;
  const legalText = 'This document was signed electronically in accordance with the Electronic Signatures in Global and National Commerce Act (ESIGN Act, 15 U.S.C. § 7001 et seq.) and the Uniform Electronic Transactions Act (UETA). The electronic signature on this document is legally binding and has the same legal effect as a handwritten signature.';
  ay = drawWrappedText(auditPage, legalText, ay, { ...textOpts, fontSize: 8.5, color: rgb(0.4, 0.4, 0.4) });

  return pdfDoc.save();
}
