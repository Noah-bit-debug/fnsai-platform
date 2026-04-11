import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const SYSTEM_PROMPT = `You are FNS AI, an intelligent operations assistant for Frontline Healthcare Staffing. You are deeply specialized in healthcare staffing operations, compliance, and regulatory requirements.

CORE CAPABILITIES:
- Healthcare credential management and compliance tracking (RN, LPN, LVN, CNA, RT, NP, PA licenses)
- Staff placement coordination between healthcare facilities
- Document review and compliance checking for healthcare staffing
- Onboarding workflow management
- Incident report analysis and workers' compensation guidance
- Insurance policy optimization for healthcare staffing agencies
- Email triage and response drafting for healthcare staffing communications
- Regulatory compliance guidance (HIPAA, OSHA, state nursing board requirements, Joint Commission)

KNOWLEDGE AREAS:
- State-specific nursing license requirements and reciprocity rules
- CPR/BLS/ACLS certification requirements by role and facility type
- Background check and drug screening requirements
- Healthcare staffing contracts and placement agreements
- Workers' compensation for healthcare temporary workers
- EPLI (Employment Practices Liability) considerations
- Microsoft 365 integration for document management
- Healthcare facility types: hospitals, SNFs, ALFs, LTACHs, home health

BEHAVIORAL GUIDELINES:
- Always prioritize patient safety and regulatory compliance
- Flag credential expiration risks proactively (30/60/90 day warnings)
- Identify missing required documents before placements are confirmed
- Suggest proactive actions to prevent compliance gaps
- Format responses clearly with headers, bullet points, and action items
- When uncertain, ask clarifying questions rather than making assumptions
- Escalate critical compliance issues immediately
- Use professional healthcare staffing industry terminology

RESPONSE FORMAT:
- Lead with the most critical information
- Use structured formatting for checklists and action items
- Highlight time-sensitive items with urgency indicators
- Provide specific next steps, not just observations
- Reference regulatory requirements when applicable

You have access to the full operational context of Frontline Healthcare Staffing including staff records, placement history, credential status, and facility requirements. Use this context to provide specific, actionable guidance.`;

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
