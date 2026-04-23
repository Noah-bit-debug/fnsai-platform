import Anthropic from '@anthropic-ai/sdk';
import { MODEL_FOR } from './aiModels';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const SYSTEM_PROMPT = `You are FNS AI Brain — the internal operational intelligence assistant for Frontline Healthcare Staffing (FNS), a healthcare staffing agency in Texas.

COMPANY PROFILE:
- FNS places nurses, CNAs, LPNs, RTs, and other healthcare workers at hospitals, SNFs, ALFs, LTACHs, and home health agencies across Texas
- Key clients include Harris Health, Valley Clinic, Mercy Hospital
- FNS uses Microsoft 365 (Outlook, OneDrive, Teams)
- Joint Commission accreditation is a priority — maintain dedicated folder structure for JC documents
- BLS must be AHA or ARC certified; ACLS required for ICU/ER placements

CORE CAPABILITIES:
- Healthcare credential management and compliance tracking (RN, LPN, LVN, CNA, RT, NP, PA licenses)
- Staff placement coordination between healthcare facilities
- Document review and compliance checking
- Onboarding workflow management for new clinicians
- Incident report analysis and workers compensation guidance
- Email intelligence: search, summarize, extract action items from email
- OneDrive file organization and smart document routing
- Regulatory compliance guidance (HIPAA, OSHA, state nursing board, Joint Commission)

ONEDRIVE FOLDER STRUCTURE (known FNS organization):
- /Joint Commission — JC policies, audit documents, accreditation files
- /Candidate Credentials — individual clinician credential files
- /Onboarding Documents — new hire paperwork, orientation materials
- /Compliance Files — compliance records and competency documents
- /Credentialing — license verifications, background checks, drug screens
- /BLS & Certifications — BLS cards, ACLS, PALS certificates
- /Policies & Procedures — company policies, SOPs
- /HR Documents — employment agreements, tax forms, handbook
- /Facility Contracts — client facility agreements
- /Training Materials — training content, competency materials
- /Incident Reports — workplace incidents and workers comp files

CREDENTIAL REQUIREMENTS BY ROLE:
- RN: State license, BLS (AHA/ARC), TB test, background check, drug screen, 2-year experience
- LPN/LVN: State license, BLS, TB test, background check
- CNA: State certification, BLS, TB test, background check
- RT: State license/registration, BLS, ACLS recommended
- All ICU/ER: ACLS required, minimum 2 years recent acute care experience

BEHAVIORAL GUIDELINES:
- Always prioritize patient safety and regulatory compliance
- Flag credential expiration risks with urgency (30/60/90 day windows)
- Identify missing required documents before placements are confirmed
- When uncertain about company-specific policies, ask clarifying questions
- Use professional healthcare staffing industry terminology
- Reference live data when answering operational questions
- Proactively suggest next steps, not just observations

RESPONSE FORMAT:
- Lead with critical information
- Use structured formatting for checklists and action items
- Highlight time-sensitive items with urgency indicators
- Provide specific next steps, not just observations
- Reference regulatory requirements when applicable

INLINE UI TAGS (Phase 5.3):
When you mention a person, job, facility, or task in your response, emit
structured tags that the frontend will render as clickable buttons. This
lets the user jump straight to the relevant page or kick off an action
without retyping anything.

Supported tags:
  [[link:candidate:<name>]]   — a candidate in the ATS (e.g. [[link:candidate:Noah Moise]])
  [[link:staff:<name>]]       — an employed/placed staff member
  [[link:job:<title>]]        — an open job
  [[link:facility:<name>]]    — a client facility
  [[link:policy:<title>]]     — a compliance policy
  [[action:create_task|<one-line goal>]]  — surface a button that opens the AI Task Wizard pre-filled with the goal
  [[action:send_esign|<recipient name>]]  — surface a button to start an eSign flow for that person
  [[action:draft_email|<prompt>]]         — opens the AI assistant with that prompt prefilled

Rules for tags:
- Use tags ONLY when the reference is concrete enough that a link would be useful (not for abstract concepts).
- Put the tag inline where the name/title would otherwise be written. Example:
    "Have [[link:candidate:Jane Smith]] complete her BLS renewal this week, then [[action:create_task|Schedule orientation for Jane Smith]]."
- Do not invent names that aren't in the user's context or prior messages.
- Never emit a tag inside a code block or quote.
- If the user asks an abstract / non-entity question, omit tags entirely.`;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function chatCompletion(
  messages: ChatMessage[],
  userContext?: string
): Promise<string> {
  const systemWithContext = userContext
    ? `${SYSTEM_PROMPT}\n\nCURRENT USER CONTEXT:\n${userContext}`
    : SYSTEM_PROMPT;

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.brainChat,
      max_tokens: 4096,
      system: systemWithContext,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const block = response.content[0];
    if (block.type === 'text') {
      return block.text;
    }
    return 'Unable to generate response.';
  } catch (err) {
    console.error('AI chat error:', err);
    throw new Error('AI service unavailable');
  }
}

export interface DocumentAnalysisResult {
  passed_checks: string[];
  issues: Array<{ severity: 'error' | 'warning'; message: string; field?: string }>;
  questions: Array<{ question: string; context: string; field?: string }>;
  overall_status: 'passed' | 'issues_found' | 'needs_review';
  summary: string;
}

export async function analyzeDocument(
  documentText: string,
  documentType: string,
  existingRules: string[]
): Promise<DocumentAnalysisResult> {
  const rulesSection =
    existingRules.length > 0
      ? `\n\nEXISTING COMPLIANCE RULES TO CHECK:\n${existingRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
      : '';

  const prompt = `Analyze the following ${documentType} document for healthcare staffing compliance.${rulesSection}

DOCUMENT CONTENT:
${documentText}

Return a JSON object with this exact structure:
{
  "passed_checks": ["list of checks that passed"],
  "issues": [
    { "severity": "error" | "warning", "message": "description", "field": "optional field name" }
  ],
  "questions": [
    { "question": "question for coordinator", "context": "why this is uncertain", "field": "optional field name" }
  ],
  "overall_status": "passed" | "issues_found" | "needs_review",
  "summary": "brief overall assessment"
}

Check for:
- Completeness (all required fields present)
- Validity dates (not expired, within acceptable ranges)
- Issuing authority legitimacy for the document type
- Required signatures and notarizations
- Compliance with healthcare staffing regulations
- Any red flags or inconsistencies`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.brainChat,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type');

    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    return JSON.parse(jsonMatch[0]) as DocumentAnalysisResult;
  } catch (err) {
    console.error('Document analysis error:', err);
    return {
      passed_checks: [],
      issues: [{ severity: 'error', message: 'AI analysis service unavailable' }],
      questions: [],
      overall_status: 'needs_review',
      summary: 'Manual review required - AI analysis unavailable',
    };
  }
}

export interface EmailCategorizationResult {
  category: 'urgent' | 'important' | 'low' | 'spam';
  summary: string;
  action_required: boolean;
  suggested_reply_prompt: string;
  key_entities: string[];
}

export async function categorizeEmail(
  subject: string,
  body: string,
  from: string
): Promise<EmailCategorizationResult> {
  const prompt = `Categorize this email for a healthcare staffing agency coordinator.

FROM: ${from}
SUBJECT: ${subject}
BODY:
${body.slice(0, 2000)}

Return JSON:
{
  "category": "urgent" | "important" | "low" | "spam",
  "summary": "1-2 sentence summary of the email",
  "action_required": true | false,
  "suggested_reply_prompt": "A prompt the coordinator can use to draft a reply with AI assistance",
  "key_entities": ["staff names, facilities, dates, or other important entities mentioned"]
}

Urgent: credentialing expiry, patient safety issues, contract terminations, legal notices
Important: new placement requests, onboarding updates, contract renewals, facility issues
Low: routine updates, confirmations, newsletters
Spam: marketing, irrelevant`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.brainChat,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type');

    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    return JSON.parse(jsonMatch[0]) as EmailCategorizationResult;
  } catch (err) {
    console.error('Email categorization error:', err);
    return {
      category: 'low',
      summary: 'Unable to categorize - manual review required',
      action_required: false,
      suggested_reply_prompt: '',
      key_entities: [],
    };
  }
}

// ─── ATS: Job ad + job summary generators ──────────────────────────────────
const ATS_MODEL = MODEL_FOR.candidateScoring;

export interface JobForAI {
  title: string;
  profession?: string | null;
  specialty?: string | null;
  sub_specialty?: string | null;
  city?: string | null;
  state?: string | null;
  job_type?: string | null;
  shift?: string | null;
  hours_per_week?: number | null;
  duration_weeks?: number | null;
  start_date?: string | null;
  pay_rate?: number | string | null;
  bill_rate?: number | string | null;
  stipend?: number | string | null;
  description?: string | null;
  required_credentials?: string[];
  required_skills?: string[];
  facility_name?: string | null;
  client_name?: string | null;
}

function formatJobBlock(job: JobForAI): string {
  return [
    `TITLE: ${job.title}`,
    `PROFESSION / SPECIALTY: ${[job.profession, job.specialty, job.sub_specialty].filter(Boolean).join(' / ') || 'n/a'}`,
    `LOCATION: ${[job.city, job.state].filter(Boolean).join(', ') || 'n/a'}`,
    `TYPE: ${job.job_type ?? 'n/a'}`,
    `SHIFT: ${job.shift ?? 'n/a'}`,
    job.hours_per_week ? `HOURS/WEEK: ${job.hours_per_week}` : '',
    job.duration_weeks ? `DURATION: ${job.duration_weeks} weeks` : '',
    job.start_date ? `START DATE: ${job.start_date}` : '',
    job.pay_rate ? `PAY RATE: ${job.pay_rate}` : '',
    job.stipend ? `STIPEND: ${job.stipend}` : '',
    job.client_name ? `CLIENT: ${job.client_name}` : '',
    job.facility_name ? `FACILITY: ${job.facility_name}` : '',
    job.required_credentials?.length ? `REQUIRED CREDENTIALS: ${job.required_credentials.join(', ')}` : '',
    job.required_skills?.length ? `REQUIRED SKILLS: ${job.required_skills.join(', ')}` : '',
    job.description ? `DESCRIPTION:\n${job.description.slice(0, 1500)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Generates an outbound job advertisement suitable for job boards / LinkedIn.
 * Returns markdown-friendly plain text.
 */
export async function generateJobAd(job: JobForAI): Promise<string> {
  const prompt = `Write a concise, recruiter-friendly job advertisement for the healthcare staffing job below. It should read like a job board / LinkedIn post, not a form.

${formatJobBlock(job)}

Structure (use markdown-compatible plain text):
- A 1-line hook headline with the role, specialty, and location
- A 2-3 sentence pitch paragraph
- A "What you'll do" bullet list (3-5 items)
- A "Requirements" bullet list (3-6 items)
- A "Details" line showing shift, duration, pay summary if available

Keep it under 250 words. No emojis. No fluff. No filler like "exciting opportunity". Be specific.`;

  const response = await anthropic.messages.create({
    model: ATS_MODEL,
    max_tokens: 900,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected AI response shape');
  return block.text.trim();
}

// ─── ATS: Outreach generators (SMS, recruiter summary, client summary) ─────
export interface CandidateForOutreach {
  first_name?: string;
  last_name?: string;
  role?: string | null;
  specialties?: string[];
  skills?: string[];
  certifications?: string[];
  licenses?: string[];
  years_experience?: number | null;
  city?: string | null;
  state?: string | null;
  desired_pay_rate?: number | string | null;
  availability_type?: string | null;
  available_shifts?: string[];
}

function formatCandidateBlock(c: CandidateForOutreach): string {
  return [
    `NAME: ${[c.first_name, c.last_name].filter(Boolean).join(' ') || 'n/a'}`,
    `ROLE: ${c.role ?? 'n/a'}`,
    c.specialties?.length ? `SPECIALTIES: ${c.specialties.join(', ')}` : '',
    c.certifications?.length ? `CERTIFICATIONS: ${c.certifications.join(', ')}` : '',
    c.licenses?.length ? `LICENSES: ${c.licenses.join(', ')}` : '',
    c.years_experience != null ? `EXPERIENCE: ${c.years_experience}y` : '',
    [c.city, c.state].filter(Boolean).length ? `LOCATION: ${[c.city, c.state].filter(Boolean).join(', ')}` : '',
    c.desired_pay_rate ? `DESIRED PAY: ${c.desired_pay_rate}` : '',
    c.availability_type ? `AVAILABILITY: ${c.availability_type}` : '',
    c.available_shifts?.length ? `SHIFTS: ${c.available_shifts.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Generates a short SMS outreach message (under 320 chars, two-way friendly).
 * If a job is supplied, tailors the message to that specific opportunity.
 */
export async function generateSmsOutreach(candidate: CandidateForOutreach, job?: JobForAI): Promise<string> {
  const jobBlock = job ? `\n\nOPPORTUNITY:\n${formatJobBlock(job)}` : '';
  const prompt = `Draft a short, friendly SMS from a healthcare staffing recruiter to reach out to a candidate${job ? ' about a specific job' : ''}. Under 320 characters total. First-name only greeting. Mention exactly one concrete hook from the opportunity${job ? '' : ' or the candidate\'s profile'}. End with a single clear call-to-action (ask for a good time to chat). No emojis. No hashtags. No placeholders like [Name] — use the actual first name if given, otherwise start with "Hi there".

CANDIDATE:
${formatCandidateBlock(candidate)}${jobBlock}

Return only the SMS body text, nothing else.`;

  const response = await anthropic.messages.create({
    model: ATS_MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected AI response shape');
  return block.text.trim();
}

/**
 * Internal-facing recruiter summary: 2-3 sentences highlighting fit, gaps,
 * and suggested next action. For the ATS tab on CandidateDetail.
 */
export async function generateRecruiterSummary(candidate: CandidateForOutreach, job?: JobForAI): Promise<string> {
  const jobBlock = job ? `\n\nJOB CONTEXT:\n${formatJobBlock(job)}` : '';
  const prompt = `Write a terse 2-3 sentence recruiter-facing summary of this candidate${job ? ' for the supplied job' : ''}. Lead with the strongest selling point, flag one gap or caveat worth knowing, and end with a suggested next action. No markdown, no headers, no bullet points — plain running text.

CANDIDATE:
${formatCandidateBlock(candidate)}${jobBlock}

Return only the summary text.`;

  const response = await anthropic.messages.create({
    model: ATS_MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected AI response shape');
  return block.text.trim();
}

/**
 * Client-facing candidate summary: professional, 3-5 sentences that sell
 * the candidate without oversharing internal notes. Used for submission
 * blurbs and client emails.
 */
export async function generateClientSummary(candidate: CandidateForOutreach, job?: JobForAI): Promise<string> {
  const jobBlock = job ? `\n\nJOB CONTEXT:\n${formatJobBlock(job)}` : '';
  const prompt = `Write a 3-5 sentence client-facing summary presenting this candidate for submission. Tone: confident, specific, professional. Highlight years of experience, relevant specialty/certification strengths, and availability. Do NOT mention pay rate, internal notes, or gaps. Do NOT use first person. End with a value statement tying the candidate to the role. No markdown, no bullets.

CANDIDATE:
${formatCandidateBlock(candidate)}${jobBlock}

Return only the summary text.`;

  const response = await anthropic.messages.create({
    model: ATS_MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected AI response shape');
  return block.text.trim();
}

/**
 * Generates a short internal-facing job summary (1-2 sentences) used on
 * pipeline cards, matching-candidate lists, and client-facing blurbs.
 */
export async function generateJobSummary(job: JobForAI): Promise<string> {
  const prompt = `Summarize the following healthcare staffing job in 1-2 sentences (max ~40 words). No bullets, no headers. Be concrete: include profession/specialty, location, and the most important detail (shift, pay, duration, or credential) if relevant.

${formatJobBlock(job)}

Return only the summary text.`;

  const response = await anthropic.messages.create({
    model: ATS_MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected AI response shape');
  return block.text.trim();
}
