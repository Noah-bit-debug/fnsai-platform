import Anthropic from '@anthropic-ai/sdk';
import { MODEL_FOR } from './aiModels';
import { pool } from '../db/client';

/**
 * AI-powered credentialing document reviewer.
 *
 * Given an uploaded document file + the document_type the user claims it to
 * be (e.g. "bls", "rn_license", "drug_screen"), Claude checks:
 *   - does this look like that document type at all?
 *   - is it expired (and when does it expire)?
 *   - does it contain the fields/marks that type should have?
 *   - any issues that block approval?
 *
 * Output is structured JSON the frontend can render as a checklist, and the
 * backend can use to auto-update the candidate_documents.status.
 *
 * When confidence is 'low' or a clarification is needed, a row is inserted
 * into ai_brain_clarifications so an admin can teach the AI the company's
 * standard for that doc type. Those answered rules get pulled back into
 * future review prompts (via buildCompanyContext's approved-policy block).
 */

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface DocumentReview {
  type_match: boolean;           // does it actually look like the claimed type?
  expired: boolean | null;       // true/false if a date could be extracted; null if not
  expiry_date: string | null;    // ISO YYYY-MM-DD when known
  complete: boolean;             // all required fields visible?
  issues: string[];              // missing/invalid things
  confidence: 'high' | 'medium' | 'low';
  summary: string;               // 1-2 sentence human-readable verdict
  clarification_needed: string | null;  // a question for the admin if AI is unsure
  recommended_status: 'approved' | 'pending' | 'rejected'; // what to set the doc row to
}

export class DocumentReviewError extends Error {
  constructor(message: string, public readonly userFacing: string) {
    super(message);
    this.name = 'DocumentReviewError';
  }
}

// Phase 2.2: look up admin-defined doc_types first. Falls back to this
// hardcoded map if the DB doesn't have the type (e.g. during migration or
// when an admin deletes the row). Keeps reviews working while letting
// admins customize prompts without a code deploy.
async function loadDocTypeFromDb(key: string): Promise<{
  prompt_hints: string;
  issuing_bodies: string[];
  expires_months: number | null;
  required_fields: string[];
} | null> {
  try {
    const { pool } = await import('../db/client');
    const result = await pool.query(
      `SELECT prompt_hints, issuing_bodies, expires_months, required_fields
       FROM doc_types WHERE key = $1 AND active = TRUE LIMIT 1`,
      [key]
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      prompt_hints: r.prompt_hints as string,
      issuing_bodies: (r.issuing_bodies as string[]) ?? [],
      expires_months: r.expires_months as number | null,
      required_fields: (r.required_fields as string[]) ?? [],
    };
  } catch {
    // Table missing / pool error — silently fall back to hardcoded map.
    return null;
  }
}

// Per-type hints the AI uses when reviewing. Admins can extend these via
// approved clarifications (ai_brain_clarifications rows with
// source_type = 'document_review_<type>') — those get injected below.
const DOC_TYPE_HINTS: Record<string, string> = {
  bls:              'BLS card from American Heart Association (AHA) or American Red Cross (ARC). Must show cardholder name, issue date, expiry date (typically 2 years from issue). Check the AHA/ARC logo is present.',
  acls:             'ACLS card from AHA or ARC. Cardholder name, issue date, expiry date (typically 2 years). ACLS-specific logo/branding.',
  pals:             'PALS card from AHA or ARC. Cardholder name, issue date, expiry date (typically 2 years).',
  rn_license:       'State RN nursing license. License number, state of issue, issue date, expiry date, license holder name, and current active/verified status.',
  lpn_license:      'State LPN/LVN license with number, state, dates, holder name, active status.',
  cna_certification:'State CNA certification. Certification number, state, dates, holder name.',
  tb_test:          'TB test (PPD or QuantiFERON). Test date within last 12 months. Must show result (positive/negative) and tester/clinic signature.',
  background_check: 'Criminal background check from a recognized vendor (e.g., Checkr, HireRight, Accurate). Must show candidate name, date of report, and clear/flagged status.',
  drug_screen:      'Drug screen / toxicology report. Candidate name, collection date, clinic, substances tested, negative/positive result.',
  resume:           'A resume / CV — professional summary, work history, education, skills, certifications, contact info.',
  i9:               'I-9 Employment Eligibility Verification (US). Both Section 1 (employee) and Section 2 (employer verification of documents) completed with dates and signatures.',
  w4:               'Federal W-4 Withholding Certificate. Employee name, SSN (may be redacted), filing status, signature, date.',
  diploma:          'Educational diploma or transcript. Institution name, graduation date, degree conferred, candidate name.',
};

async function buildPrompt(documentType: string, extraCompanyRules: string[]): Promise<string> {
  // Prefer admin-defined doc_types row; fall back to hardcoded hints; then
  // fall back to a generic prompt if the type is completely unknown. This
  // keeps reviews working even if the doc_types table is empty or the key
  // hasn't been defined yet.
  const dbType = await loadDocTypeFromDb(documentType);

  const hint = dbType?.prompt_hints
    ?? DOC_TYPE_HINTS[documentType]
    ?? `A document of type "${documentType}". Review for completeness and validity.`;

  // Admin-defined issuing bodies and required fields get baked into the
  // prompt so the AI checks for them explicitly.
  const adminRules: string[] = [];
  if (dbType?.issuing_bodies && dbType.issuing_bodies.length > 0) {
    adminRules.push(`Accepted issuing bodies: ${dbType.issuing_bodies.join(', ')}. Reject if issued by anyone else.`);
  }
  if (dbType?.required_fields && dbType.required_fields.length > 0) {
    adminRules.push(`Document must contain these fields: ${dbType.required_fields.join(', ')}.`);
  }
  if (dbType?.expires_months != null) {
    adminRules.push(`Typical validity is ${dbType.expires_months} months. Use this to double-check the expiry date is reasonable.`);
  }

  const allRules = [...adminRules, ...extraCompanyRules];
  const rules = allRules.length > 0
    ? `\n\nCOMPANY-SPECIFIC RULES FOR THIS DOCUMENT TYPE:\n${allRules.map(r => `- ${r}`).join('\n')}`
    : '';

  return `You are a credentialing document reviewer for a healthcare staffing agency.

The user has uploaded a document and claims it is a ${documentType.toUpperCase()}.

WHAT A ${documentType.toUpperCase()} SHOULD BE:
${hint}${rules}

TASK: Review the attached document and return ONLY valid JSON with this exact shape, no markdown, no prose:

{
  "type_match": true,
  "expired": false,
  "expiry_date": "2027-05-12",
  "complete": true,
  "issues": ["Signature is missing", "etc"],
  "confidence": "high",
  "summary": "Valid BLS card from AHA, expires May 12, 2027.",
  "clarification_needed": null,
  "recommended_status": "approved"
}

Field rules:
- type_match: true if the document looks like the claimed type, false otherwise
- expired: true/false if you can read an expiry date; null if no expiry visible
- expiry_date: ISO YYYY-MM-DD if readable, else null
- complete: true if all required fields/marks for this type are visible
- issues: array of specific problems (empty array if none). Be concrete.
- confidence: "high" if you're sure, "medium" if some ambiguity, "low" if unsure
- summary: 1-2 sentences describing the verdict
- clarification_needed: a question for the admin ONLY if confidence is "low" or the doc has unusual markings you can't evaluate. Null otherwise.
- recommended_status: "approved" (type matches, not expired, complete), "pending" (needs human review), or "rejected" (wrong type, expired, incomplete).

Be strict but fair. If the image quality is too low to read key fields, lower confidence and set clarification_needed.`;
}

async function getApprovedRules(documentType: string): Promise<string[]> {
  try {
    const result = await pool.query(
      `SELECT answer FROM ai_brain_clarifications
       WHERE source_type = $1 AND status = 'answered' AND approved_as_rule = TRUE
       ORDER BY answered_at DESC LIMIT 10`,
      [`document_review_${documentType}`]
    );
    return result.rows.map(r => r.answer as string).filter(Boolean);
  } catch {
    return [];
  }
}

async function logClarification(documentType: string, question: string, context: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai_brain_clarifications (question, context, source_type) VALUES ($1, $2, $3)`,
      [question, `Document review (${documentType}): ${context.slice(0, 400)}`, `document_review_${documentType}`]
    );
  } catch { /* clarifications table may not exist yet */ }
}

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return cleaned;
  return cleaned.slice(first, last + 1);
}

export async function reviewDocument(
  fileBuffer: Buffer,
  mimeType: string,
  documentType: string,
): Promise<DocumentReview> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new DocumentReviewError(
      'ANTHROPIC_API_KEY not set',
      'AI document review is not configured on this server.',
    );
  }

  const approvedRules = await getApprovedRules(documentType);
  const prompt = await buildPrompt(documentType, approvedRules);

  // PDF → use Claude's document vision. Image → image input block.
  // Text/unknown → reject with a helpful error (we don't OCR arbitrary bytes).
  let content: Anthropic.Messages.ContentBlockParam[];
  if (mimeType === 'application/pdf') {
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBuffer.toString('base64') } } as Anthropic.Messages.ContentBlockParam,
      { type: 'text', text: prompt },
    ];
  } else if (mimeType.startsWith('image/')) {
    const imageMedia = (mimeType === 'image/jpg' ? 'image/jpeg' : mimeType) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    content = [
      { type: 'image', source: { type: 'base64', media_type: imageMedia, data: fileBuffer.toString('base64') } },
      { type: 'text', text: prompt },
    ];
  } else {
    throw new DocumentReviewError(
      `Unsupported mimeType ${mimeType}`,
      'This file type isn\'t supported for AI review. Please upload a PDF or image (PNG/JPG).',
    );
  }

  try {
    const response = await client.messages.create({
      model: MODEL_FOR.resumeParse, // same tier as resume parsing — needs vision + structured output
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    });

    const responseText = (response.content[0] as { type: string; text: string }).text;
    if (!responseText?.trim()) {
      throw new DocumentReviewError('Empty response from Claude', 'AI returned no response. Please retry.');
    }

    const jsonStr = extractJson(responseText);
    const parsed = JSON.parse(jsonStr) as DocumentReview;

    // Validate + fill defaults so downstream code isn't punished for Claude's
    // occasional creative interpretations.
    const review: DocumentReview = {
      type_match: !!parsed.type_match,
      expired: typeof parsed.expired === 'boolean' ? parsed.expired : null,
      expiry_date: parsed.expiry_date ?? null,
      complete: !!parsed.complete,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence as string)
        ? (parsed.confidence as DocumentReview['confidence'])
        : 'low',
      summary: parsed.summary || 'AI review completed.',
      clarification_needed: parsed.clarification_needed || null,
      recommended_status: ['approved', 'pending', 'rejected'].includes(parsed.recommended_status as string)
        ? (parsed.recommended_status as DocumentReview['recommended_status'])
        : 'pending',
    };

    if (review.clarification_needed || review.confidence === 'low') {
      await logClarification(documentType, review.clarification_needed ?? `Low-confidence review: ${review.summary}`, review.summary);
    }

    return review;
  } catch (err) {
    if (err instanceof DocumentReviewError) throw err;
    const anyErr = err as { status?: number; message?: string };
    console.error('Document review error:', err);
    if (anyErr.status === 401 || anyErr.status === 403) {
      throw new DocumentReviewError(`Anthropic auth (${anyErr.status})`, 'AI auth failed. Check ANTHROPIC_API_KEY.');
    }
    if (anyErr.status === 429) {
      throw new DocumentReviewError('Rate limit', 'AI is busy. Please retry in a minute.');
    }
    throw new DocumentReviewError(
      `Review failed: ${anyErr.message ?? String(err)}`,
      'AI document review failed. Please retry or mark status manually.',
    );
  }
}
