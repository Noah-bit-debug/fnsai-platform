import Anthropic from '@anthropic-ai/sdk';
import { MODEL_FOR } from './aiModels';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ATS_MODEL = MODEL_FOR.booleanSearch;

/**
 * Input shape for Boolean string generation.
 * Accepts the relevant subset of a `jobs` row.
 */
export interface BooleanStringInput {
  title: string;
  profession?: string | null;
  specialty?: string | null;
  sub_specialty?: string | null;
  city?: string | null;
  state?: string | null;
  description?: string | null;
  required_credentials?: string[];
  required_skills?: string[];
}

/**
 * Generates a recruiter-friendly Boolean search string for LinkedIn / Google / ATS searches.
 * Returns a single-line, well-formed Boolean expression.
 */
export async function generateBooleanSearch(job: BooleanStringInput): Promise<string> {
  const prompt = `You are a senior healthcare staffing recruiter. Build a Boolean search string to find candidates for the following job.

JOB TITLE: ${job.title}
PROFESSION: ${job.profession ?? 'n/a'}
SPECIALTY: ${job.specialty ?? 'n/a'}
SUB-SPECIALTY: ${job.sub_specialty ?? 'n/a'}
LOCATION: ${[job.city, job.state].filter(Boolean).join(', ') || 'n/a'}
REQUIRED CREDENTIALS: ${(job.required_credentials ?? []).join(', ') || 'none specified'}
REQUIRED SKILLS: ${(job.required_skills ?? []).join(', ') || 'none specified'}
DESCRIPTION: ${job.description?.slice(0, 1200) ?? 'n/a'}

Rules:
- Use AND, OR, NOT (uppercase). Use parentheses for grouping.
- Use quotation marks for multi-word phrases.
- Include common role aliases and credential abbreviations (e.g. RN / Registered Nurse, BLS / ACLS).
- Include 2-4 common title variants and 2-3 specialty variants where applicable.
- Exclude obvious non-fits with NOT (e.g. student, intern) only if clearly appropriate.
- Keep the string under 500 characters.

Return ONLY the Boolean string, nothing else. No markdown, no explanation, no surrounding quotes.`;

  const response = await anthropic.messages.create({
    model: ATS_MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected AI response shape');
  return block.text.trim().replace(/^["'`]+|["'`]+$/g, '');
}
