import Anthropic from '@anthropic-ai/sdk';

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
- Reference regulatory requirements when applicable`;

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
      model: 'claude-3-5-sonnet-20241022',
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
      model: 'claude-3-5-sonnet-20241022',
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
      model: 'claude-3-5-sonnet-20241022',
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
