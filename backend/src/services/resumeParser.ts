import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Sonnet handles resume parsing just as well as Opus at ~5× the speed and
// ~5× the cost savings. Upgraded if we ever hit accuracy issues.
const MODEL = process.env.ANTHROPIC_RESUME_MODEL || 'claude-sonnet-4-6';

export interface ParsedResume {
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  role: string | null;
  specialties: string[];
  skills: string[];
  certifications: string[];
  licenses: string[];
  education: Array<{ degree: string; institution: string; year: string | null }>;
  work_history: Array<{
    title: string;
    employer: string;
    start_date: string | null;
    end_date: string | null;
    description: string | null;
  }>;
  years_experience: number | null;
  summary: string | null;
}

// Explicit error types so the route can return helpful messages to the UI
// instead of a generic "parsing failed" that tells the recruiter nothing.
export class ResumeParseError extends Error {
  constructor(message: string, public readonly userFacing: string) {
    super(message);
    this.name = 'ResumeParseError';
  }
}

const PARSE_PROMPT = `You are a resume parser for a healthcare staffing agency. Extract ALL of the following from the resume content provided and return ONLY valid JSON with no markdown code blocks, no explanation, just raw JSON.

Return exactly this structure:
{
  "name": "full name or null",
  "email": "email address or null",
  "phone": "phone number or null",
  "address": "full address or null",
  "role": "primary nursing/healthcare role such as RN, LPN, LVN, CNA, RT, NP, PA, or null",
  "specialties": ["list of medical specialties like ICU, ER, Med-Surg, etc."],
  "skills": ["list of clinical skills"],
  "certifications": ["BLS", "ACLS", "PALS", etc.],
  "licenses": ["State RN License #12345", etc.],
  "education": [{"degree": "BSN", "institution": "University Name", "year": "2018"}],
  "work_history": [{"title": "Staff RN", "employer": "Hospital Name", "start_date": "2020-01", "end_date": "2023-06", "description": "Brief role description"}],
  "years_experience": 5,
  "summary": "brief professional summary"
}

If any field cannot be determined, use null for scalars or [] for arrays. Do not fabricate information.`;

// Recognized MIME types + the fallback for whatever the browser actually sent
// (some browsers send application/octet-stream for .docx from macOS, etc.).
function classify(mimeType: string, fileName?: string): 'pdf' | 'docx' | 'text' | 'unknown' {
  const lower = (mimeType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();
  if (lower === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (lower === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || name.endsWith('.docx')) return 'docx';
  if (lower.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) return 'text';
  // .doc (old Word format) is not supported by mammoth — flag it explicitly
  if (lower === 'application/msword' || name.endsWith('.doc')) return 'unknown';
  return 'unknown';
}

// Claude sometimes wraps JSON in prose ("Here's the parsed data: { ... }").
// Grab the first '{' through the matching last '}' instead of trusting
// whitespace/markdown stripping.
function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return cleaned;
  return cleaned.slice(first, last + 1);
}

export async function parseResume(
  fileBuffer: Buffer,
  mimeType: string,
  fileName?: string,
): Promise<ParsedResume> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ResumeParseError(
      'ANTHROPIC_API_KEY is not configured on the server',
      'AI parsing is not configured on this server. Please fill in candidate details manually.',
    );
  }

  const kind = classify(mimeType, fileName);
  if (kind === 'unknown') {
    throw new ResumeParseError(
      `Unsupported mime type: ${mimeType} (${fileName ?? 'no name'})`,
      'This file type isn\'t supported. Please upload a PDF, DOCX, or plain-text resume. (Old .doc files are not supported — save as .docx or PDF first.)',
    );
  }

  let responseText: string;

  try {
    // Resolve the resume to plain text regardless of input format. Earlier
    // versions sent PDFs to Claude as `type: "document"` blocks, but the
    // installed Anthropic SDK doesn't reliably accept that shape — calls
    // failed with cryptic "input.0.content.0.type" errors. Extracting text
    // up front (PDF via pdf-parse, DOCX via mammoth) is what the BD bid
    // pipeline already does and works on every SDK version.
    let textContent: string;
    if (kind === 'pdf') {
      const mod = await import('pdf-parse' as string).catch(() => null);
      if (!mod) {
        throw new ResumeParseError(
          'pdf-parse module unavailable on the server',
          'PDF parsing is not configured on this server. Please upload a DOCX or paste the resume text.',
        );
      }
      const data = await (mod as any).default(fileBuffer);
      textContent = String(data?.text ?? '').trim();
      if (!textContent) {
        throw new ResumeParseError(
          'pdf-parse extracted no text from PDF',
          'Could not read any text from this PDF. It may be a scanned image — try a text-based PDF or upload a DOCX.',
        );
      }
    } else if (kind === 'docx') {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      textContent = (result.value || '').trim();
      if (!textContent) {
        throw new ResumeParseError(
          'mammoth extracted no text from DOCX',
          'Could not read any text from this DOCX. It may be image-only or corrupted. Try exporting to PDF.',
        );
      }
    } else {
      textContent = fileBuffer.toString('utf-8').trim();
      if (!textContent) {
        throw new ResumeParseError(
          'Empty text file',
          'This resume file appears to be empty.',
        );
      }
    }

    // Trim very long resumes to keep the prompt fast and predictable.
    if (textContent.length > 40000) textContent = textContent.slice(0, 40000);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `${PARSE_PROMPT}\n\nResume content:\n${textContent}`,
        },
      ],
    });
    responseText = (response.content[0] as any).text;

    if (!responseText || !responseText.trim()) {
      throw new ResumeParseError(
        'Claude returned empty response',
        'AI returned an empty response. Please retry or fill in manually.',
      );
    }

    const cleaned = extractJson(responseText);
    let parsed: ParsedResume;
    try {
      parsed = JSON.parse(cleaned) as ParsedResume;
    } catch (jsonErr) {
      throw new ResumeParseError(
        `JSON parse failed: ${(jsonErr as Error).message} | raw: ${responseText.slice(0, 300)}`,
        'AI returned a malformed response. Please retry or fill in manually.',
      );
    }

    const safe = (val: any) => (Array.isArray(val) ? val : []);
    return {
      name: parsed.name || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      address: parsed.address || null,
      role: parsed.role || null,
      specialties: safe(parsed.specialties),
      skills: safe(parsed.skills),
      certifications: safe(parsed.certifications),
      licenses: safe(parsed.licenses),
      education: safe(parsed.education),
      work_history: safe(parsed.work_history),
      years_experience: parsed.years_experience ?? null,
      summary: parsed.summary || null,
    };
  } catch (err) {
    if (err instanceof ResumeParseError) throw err;
    // Anthropic SDK errors have a status code + message we can surface usefully
    const anyErr = err as { status?: number; message?: string; error?: { message?: string } };
    console.error('Resume parsing error:', err);
    if (anyErr.status === 401 || anyErr.status === 403) {
      throw new ResumeParseError(
        `Anthropic auth error (${anyErr.status}): ${anyErr.message}`,
        'AI parsing auth failed. Check ANTHROPIC_API_KEY on the server.',
      );
    }
    if (anyErr.status === 429) {
      throw new ResumeParseError(
        'Anthropic rate limit hit',
        'AI is busy right now. Please try again in a minute.',
      );
    }
    throw new ResumeParseError(
      `Unexpected parsing error: ${anyErr.message ?? String(err)}`,
      'Resume parsing failed. Please retry or fill in manually.',
    );
  }
}
