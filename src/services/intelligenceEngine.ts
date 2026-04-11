/**
 * Intelligence Engine
 *
 * Provides AI-powered operational insights for Frontline Healthcare Staffing:
 * - Daily suggestions derived from pipeline health metrics
 * - Daily narrative summaries
 * - Clarification questions when operational data is ambiguous
 * - AI-generated narrative prose for custom reports
 *
 * All Claude calls use model claude-3-5-sonnet-20241022.
 * DB access goes through the shared pool exported from ../db/client.
 */

import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/client';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-3-5-sonnet-20241022';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OperationalMetrics {
  candidates: {
    total: number;
    by_stage: Record<string, number>;
    created_this_week: number;
  };
  reminders: {
    overdue: number;
  };
  onboarding: {
    incomplete: number;
  };
  credentials: {
    expiring_soon: number;
  };
  suggestions: {
    pending: number;
  };
  clarification_questions: {
    pending: number;
  };
}

interface SuggestionPayload {
  type: string;
  title: string;
  description: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run a single query safely, returning a fallback value if the table does not
 * yet exist or any other DB error occurs. This lets gatherMetrics work even
 * against a partially-migrated database.
 */
async function safeQuery<T>(
  sql: string,
  params: unknown[],
  fallback: T
): Promise<T> {
  try {
    const result = await pool.query(sql, params);
    return result.rows[0] ?? fallback;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Only suppress "table does not exist" class of errors
    if (msg.includes('does not exist') || msg.includes('relation')) {
      return fallback;
    }
    console.error('[intelligenceEngine] DB query failed:', msg);
    return fallback;
  }
}

/**
 * Gather operational metrics from multiple tables.
 * Each sub-query is wrapped independently so a missing table never kills the
 * entire metrics run.
 */
async function gatherMetrics(): Promise<OperationalMetrics> {
  // --- candidates ---
  const candidateTotal = await safeQuery<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM candidates',
    [],
    { count: '0' }
  );

  const candidateByStage = await safeQuery<{ rows: Array<{ stage: string; count: string }> }>(
    `SELECT stage, COUNT(*)::text AS count FROM candidates GROUP BY stage`,
    [],
    { rows: [] }
  );
  // candidateByStage comes from pool.query directly — re-query with pool for grouping
  let byStage: Record<string, number> = {};
  try {
    const stageResult = await pool.query(
      'SELECT COALESCE(stage, \'unknown\') AS stage, COUNT(*)::int AS count FROM candidates GROUP BY stage'
    );
    for (const row of stageResult.rows) {
      byStage[row.stage] = row.count;
    }
  } catch {
    byStage = {};
  }

  const candidateWeek = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM candidates
     WHERE created_at >= NOW() - INTERVAL '7 days'`,
    [],
    { count: '0' }
  );

  // --- reminders ---
  const overdueReminders = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM reminders
     WHERE due_date < NOW() AND status != 'sent'`,
    [],
    { count: '0' }
  );

  // --- onboarding ---
  const incompleteOnboarding = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onboarding_forms
     WHERE status != 'completed'`,
    [],
    { count: '0' }
  );

  // --- credentials ---
  const expiringCredentials = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM credentials
     WHERE expiry_date < NOW() + INTERVAL '30 days'`,
    [],
    { count: '0' }
  );

  // --- suggestions ---
  const pendingSuggestions = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM suggestions WHERE status = 'pending'`,
    [],
    { count: '0' }
  );

  // --- clarification questions ---
  const pendingQuestions = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM clarification_questions WHERE status = 'pending'`,
    [],
    { count: '0' }
  );

  return {
    candidates: {
      total: parseInt(candidateTotal.count, 10),
      by_stage: byStage,
      created_this_week: parseInt(candidateWeek.count, 10),
    },
    reminders: {
      overdue: parseInt(overdueReminders.count, 10),
    },
    onboarding: {
      incomplete: parseInt(incompleteOnboarding.count, 10),
    },
    credentials: {
      expiring_soon: parseInt(expiringCredentials.count, 10),
    },
    suggestions: {
      pending: parseInt(pendingSuggestions.count, 10),
    },
    clarification_questions: {
      pending: parseInt(pendingQuestions.count, 10),
    },
  };
}

/**
 * Extract the first valid JSON array from an arbitrary Claude response string.
 * Handles responses that wrap JSON in markdown code blocks.
 */
function extractJsonArray(text: string): unknown[] {
  // Strip markdown fences if present
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  const match = stripped.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found in Claude response');
  return JSON.parse(match[0]);
}

/**
 * Extract the first valid JSON object from an arbitrary Claude response string.
 */
function extractJsonObject(text: string): Record<string, unknown> {
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in Claude response');
  return JSON.parse(match[0]);
}

// ---------------------------------------------------------------------------
// Exported service functions
// ---------------------------------------------------------------------------

/**
 * Generate 3–5 actionable workflow suggestions based on current operational
 * metrics and persist them to the suggestions table.
 */
export async function generateDailySuggestions(userId: string): Promise<void> {
  const metrics = await gatherMetrics();

  const prompt = `You are an operations intelligence assistant for Frontline Healthcare Staffing.

Based on the following operational metrics, generate 3 to 5 specific, actionable suggestions to improve workflow efficiency, compliance, and candidate pipeline health.

CURRENT METRICS:
${JSON.stringify(metrics, null, 2)}

INSTRUCTIONS:
- Each suggestion must be directly motivated by the data above.
- Prioritise compliance and patient-safety risks first.
- Return ONLY a valid JSON array — no prose, no markdown fences.

REQUIRED FORMAT:
[
  {
    "type": "workflow | compliance | pipeline | communication | credentialing",
    "title": "Short imperative title (max 15 words)",
    "description": "Clear explanation of what should be done and why (2–3 sentences)",
    "reason": "Which metric or data point triggered this suggestion",
    "priority": "high | medium | low"
  }
]`;

  let suggestions: SuggestionPayload[] = [];

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected Claude response type');

    const raw = extractJsonArray(block.text) as SuggestionPayload[];
    suggestions = raw.filter(
      (s) => s.type && s.title && s.description
    );
  } catch (err) {
    console.error('[intelligenceEngine] generateDailySuggestions - Claude error:', err);
    // Insert a fallback suggestion so the caller knows something ran
    suggestions = [
      {
        type: 'workflow',
        title: 'Review operational metrics manually',
        description:
          'AI suggestion generation encountered an error. Please review the current pipeline metrics manually and identify priority actions.',
        reason: 'AI service error',
        priority: 'medium',
      },
    ];
  }

  // Persist each suggestion to the DB
  for (const s of suggestions) {
    try {
      await pool.query(
        `INSERT INTO suggestions (type, title, description, reason, priority, status, generated_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
        [s.type, s.title, s.description, s.reason ?? null, s.priority ?? 'medium']
      );
    } catch (dbErr) {
      console.error('[intelligenceEngine] Failed to insert suggestion:', dbErr);
    }
  }

  console.log(
    `[intelligenceEngine] generateDailySuggestions: inserted ${suggestions.length} suggestions for user ${userId}`
  );
}

/**
 * Generate a narrative daily summary for the given ISO date string (YYYY-MM-DD)
 * and upsert it into the daily_summaries table.
 */
export async function generateDailySummary(date: string): Promise<void> {
  const metrics = await gatherMetrics();

  // Pull suggestion and question counts for the target date
  let suggestionsGenerated = 0;
  let questionsGenerated = 0;
  try {
    const sgRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM suggestions
       WHERE DATE(generated_at) = $1`,
      [date]
    );
    suggestionsGenerated = sgRes.rows[0]?.count ?? 0;
  } catch { /* table may not exist yet */ }

  try {
    const qRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM clarification_questions
       WHERE DATE(created_at) = $1`,
      [date]
    );
    questionsGenerated = qRes.rows[0]?.count ?? 0;
  } catch { /* table may not exist yet */ }

  const prompt = `You are an operations intelligence assistant for Frontline Healthcare Staffing.

Write a concise daily operations summary for ${date}.

METRICS SNAPSHOT:
${JSON.stringify(metrics, null, 2)}

TODAY'S ACTIVITY:
- AI suggestions generated: ${suggestionsGenerated}
- Clarification questions raised: ${questionsGenerated}

INSTRUCTIONS:
- Write a 2–4 sentence headline summary suitable for a dashboard banner.
- Then write a 3–5 sentence narrative expanding on risks, highlights, and recommended focus areas.
- Identify up to 3 risk alerts (brief bullet points).
- Return ONLY valid JSON — no prose outside the object, no markdown fences.

REQUIRED FORMAT:
{
  "headline": "One-sentence banner headline",
  "narrative": "Multi-sentence operational narrative...",
  "risk_alerts": ["Risk 1", "Risk 2", "Risk 3"]
}`;

  let headline = `Operations summary for ${date}`;
  let narrative = 'Summary generation encountered an error. Manual review recommended.';
  let riskAlerts: string[] = [];

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected Claude response type');

    const parsed = extractJsonObject(block.text);
    headline  = typeof parsed.headline  === 'string' ? parsed.headline  : headline;
    narrative = typeof parsed.narrative === 'string' ? parsed.narrative : narrative;
    riskAlerts = Array.isArray(parsed.risk_alerts)
      ? (parsed.risk_alerts as string[]).filter((r) => typeof r === 'string')
      : [];
  } catch (err) {
    console.error('[intelligenceEngine] generateDailySummary - Claude error:', err);
  }

  try {
    await pool.query(
      `INSERT INTO daily_summaries
         (summary_date, headline, narrative, metrics, risk_alerts,
          suggestions_generated, questions_generated, status, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'generated', NOW())
       ON CONFLICT (summary_date) DO UPDATE SET
         headline             = EXCLUDED.headline,
         narrative            = EXCLUDED.narrative,
         metrics              = EXCLUDED.metrics,
         risk_alerts          = EXCLUDED.risk_alerts,
         suggestions_generated = EXCLUDED.suggestions_generated,
         questions_generated  = EXCLUDED.questions_generated,
         status               = 'generated',
         generated_at         = NOW()`,
      [
        date,
        headline,
        narrative,
        JSON.stringify(metrics),
        JSON.stringify(riskAlerts),
        suggestionsGenerated,
        questionsGenerated,
      ]
    );
    console.log(`[intelligenceEngine] generateDailySummary: upserted summary for ${date}`);
  } catch (dbErr) {
    console.error('[intelligenceEngine] Failed to upsert daily summary:', dbErr);
    throw dbErr;
  }
}

/**
 * Analyse contextual data and generate clarification questions for missing or
 * ambiguous information, persisting them to the clarification_questions table.
 */
export async function generateClarificationQuestions(
  context: string,
  contextData: unknown
): Promise<void> {
  const prompt = `You are an operations intelligence assistant for Frontline Healthcare Staffing.

Review the following data for context "${context}" and identify information that is missing, ambiguous, or needs confirmation before safe operational decisions can be made.

CONTEXT DATA:
${JSON.stringify(contextData, null, 2)}

INSTRUCTIONS:
- Focus on compliance gaps, missing credentials, unclear placement details, or ambiguous status fields.
- Generate 2–5 targeted clarification questions.
- Return ONLY a valid JSON array — no prose, no markdown fences.

REQUIRED FORMAT:
[
  {
    "question": "The exact question that needs to be answered",
    "why_asked": "Why this information gap matters operationally",
    "priority": "high | medium | low",
    "options": null
  }
]

Use "options" only when a question has a small fixed set of valid answers, e.g. ["Yes","No"]. Otherwise set it to null.`;

  interface QuestionPayload {
    question: string;
    why_asked: string;
    priority: string;
    options: string[] | null;
  }

  let questions: QuestionPayload[] = [];

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected Claude response type');

    const raw = extractJsonArray(block.text) as QuestionPayload[];
    questions = raw.filter((q) => q.question && q.why_asked);
  } catch (err) {
    console.error('[intelligenceEngine] generateClarificationQuestions - Claude error:', err);
    return; // nothing to insert
  }

  for (const q of questions) {
    try {
      await pool.query(
        `INSERT INTO clarification_questions
           (context, question, why_asked, options, priority, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
        [
          context,
          q.question,
          q.why_asked ?? null,
          q.options ? JSON.stringify(q.options) : null,
          q.priority ?? 'medium',
        ]
      );
    } catch (dbErr) {
      console.error('[intelligenceEngine] Failed to insert clarification question:', dbErr);
    }
  }

  console.log(
    `[intelligenceEngine] generateClarificationQuestions: inserted ${questions.length} questions for context "${context}"`
  );
}

/**
 * Generate an AI narrative summary for a report and return it as a string.
 * The caller is responsible for persisting the narrative (e.g. to report_runs).
 */
export async function generateReportNarrative(
  reportType: string,
  data: unknown,
  filters: unknown
): Promise<string> {
  const prompt = `You are an operations intelligence assistant for Frontline Healthcare Staffing.

Write a professional narrative summary of the following ${reportType} report for an operations manager.

APPLIED FILTERS:
${JSON.stringify(filters, null, 2)}

REPORT DATA:
${JSON.stringify(data, null, 2)}

INSTRUCTIONS:
- Write 3–5 sentences covering key findings, trends, and any notable risks or highlights.
- Use clear, professional language appropriate for a healthcare staffing context.
- Do NOT repeat raw numbers mechanically — synthesise insights.
- Return plain prose only. No JSON, no markdown headers.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected Claude response type');

    return block.text.trim();
  } catch (err) {
    console.error('[intelligenceEngine] generateReportNarrative - Claude error:', err);
    return 'Narrative generation is currently unavailable. Please review the report data directly.';
  }
}
