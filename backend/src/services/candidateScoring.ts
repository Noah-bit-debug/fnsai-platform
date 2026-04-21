import Anthropic from '@anthropic-ai/sdk';
import { MODEL_FOR } from './aiModels';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ATS_MODEL = MODEL_FOR.candidateScoring;

export type FitLabel = 'excellent' | 'strong' | 'moderate' | 'weak' | 'poor';

export interface ScoringCandidate {
  first_name?: string;
  last_name?: string;
  role?: string | null;
  specialties?: string[];
  skills?: string[];
  certifications?: string[];
  licenses?: string[];
  years_experience?: number | null;
  education?: string | null;
  city?: string | null;
  state?: string | null;
  parsed_resume?: unknown;
}

export interface ScoringJob {
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

export interface ScoringResult {
  total: number;                             // 0-100
  breakdown: {
    title: number;                           // 0-100 per category
    skills: number;
    certifications: number;
    experience: number;
    education: number;
    location: number;
  };
  fit_label: FitLabel;
  summary: string;                           // 1-3 sentences
  gaps: Array<{ category: string; gap: string; severity: 'low' | 'medium' | 'high' }>;
}

function clamp100(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Scores a candidate against a job across six categories and returns a
 * normalized fit profile with gap analysis. Used by the Submissions flow.
 */
export async function scoreCandidateForJob(
  candidate: ScoringCandidate,
  job: ScoringJob
): Promise<ScoringResult> {
  const candidateBlurb = JSON.stringify({
    name: [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || undefined,
    role: candidate.role ?? undefined,
    specialties: candidate.specialties ?? [],
    skills: candidate.skills ?? [],
    certifications: candidate.certifications ?? [],
    licenses: candidate.licenses ?? [],
    years_experience: candidate.years_experience ?? undefined,
    education: candidate.education ?? undefined,
    location: [candidate.city, candidate.state].filter(Boolean).join(', ') || undefined,
  });

  const jobBlurb = JSON.stringify({
    title: job.title,
    profession: job.profession ?? undefined,
    specialty: job.specialty ?? undefined,
    sub_specialty: job.sub_specialty ?? undefined,
    location: [job.city, job.state].filter(Boolean).join(', ') || undefined,
    description: job.description?.slice(0, 1500) ?? undefined,
    required_credentials: job.required_credentials ?? [],
    required_skills: job.required_skills ?? [],
  });

  const prompt = `You are a senior healthcare staffing recruiter evaluating a candidate for a specific job. Score the candidate across six categories on a 0-100 scale.

CANDIDATE: ${candidateBlurb}

JOB: ${jobBlurb}

Scoring categories (all 0-100):
- title: alignment of candidate's current/past role with the job title/profession
- skills: overlap between the candidate's listed skills and the job's required skills
- certifications: coverage of required credentials (BLS, ACLS, state licenses, etc.)
- experience: years of relevant experience vs. what the job needs
- education: relevance of education/degree to the role
- location: proximity / willingness-to-relocate fit for the job's location (100 if same city, ~70 if same state, lower if far, 50 if remote job, 0 if unknown)

Then compute a weighted total (weights: title 20, skills 25, certifications 20, experience 20, education 5, location 10) and assign a fit_label:
- excellent: total >= 85
- strong: 70-84
- moderate: 55-69
- weak: 40-54
- poor: < 40

Identify gaps (missing credentials, skills shortfall, experience gap, location mismatch) with a severity (low/medium/high). Write a concise 1-3 sentence summary.

Return ONLY a JSON object matching this exact schema — no prose, no markdown:
{
  "total": <int 0-100>,
  "breakdown": {
    "title": <int 0-100>,
    "skills": <int 0-100>,
    "certifications": <int 0-100>,
    "experience": <int 0-100>,
    "education": <int 0-100>,
    "location": <int 0-100>
  },
  "fit_label": "excellent" | "strong" | "moderate" | "weak" | "poor",
  "summary": "<1-3 sentences>",
  "gaps": [ { "category": "<one of: title|skills|certifications|experience|education|location>", "gap": "<short description>", "severity": "low" | "medium" | "high" } ]
}`;

  const response = await anthropic.messages.create({
    model: ATS_MODEL,
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected AI response shape');
  const match = block.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in AI response');

  const parsed = JSON.parse(match[0]) as Partial<ScoringResult> & { breakdown?: Partial<ScoringResult['breakdown']> };

  const breakdown = {
    title: clamp100(parsed.breakdown?.title),
    skills: clamp100(parsed.breakdown?.skills),
    certifications: clamp100(parsed.breakdown?.certifications),
    experience: clamp100(parsed.breakdown?.experience),
    education: clamp100(parsed.breakdown?.education),
    location: clamp100(parsed.breakdown?.location),
  };

  const total = clamp100(parsed.total);

  const fit_label: FitLabel =
    total >= 85 ? 'excellent' :
    total >= 70 ? 'strong' :
    total >= 55 ? 'moderate' :
    total >= 40 ? 'weak' : 'poor';

  return {
    total,
    breakdown,
    fit_label: (parsed.fit_label as FitLabel) ?? fit_label,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
  };
}
