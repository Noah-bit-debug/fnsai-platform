/**
 * Intelligence Engine
 *
 * Provides AI-powered operational insights for Frontline Healthcare Staffing:
 * - Daily suggestions derived from pipeline health metrics
 * - Daily narrative summaries
 * - Clarification questions when operational data is ambiguous
 * - AI-generated narrative prose for custom reports
 *
 * All Claude calls use the model selected by MODEL_FOR.intelligence
 * (centralized in services/aiModels.ts — currently Sonnet 4.5).
 * DB access goes through the shared pool exported from ../db/client.
 */

import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/client';
import { MODEL_FOR } from './aiModels';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = MODEL_FOR.intelligence;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summary periods. 'day' is the original daily rollup; 'week' and
 *  'month' aggregate over the trailing 7 and 30 days respectively. */
export type SummaryPeriod = 'day' | 'week' | 'month';

/** Role-scope lens on the same metrics. Changes what Claude emphasizes
 *  in the narrative — 'all' is organization-wide (original behavior),
 *  the others give each team a targeted view. */
export type SummaryScope = 'all' | 'recruiting' | 'hr' | 'credentialing' | 'bd' | 'ceo';

/** Window (days) used for the "new this period" counts. */
function windowDaysFor(period: SummaryPeriod): number {
  return period === 'day' ? 1 : period === 'week' ? 7 : 30;
}

/** Human label for prompts + headings. */
function periodLabel(period: SummaryPeriod): string {
  return period === 'day' ? 'today' : period === 'week' ? 'this week' : 'this month';
}

/** What Claude should focus on for each scope. The metrics snapshot is
 *  the same regardless of scope; only the prompt framing changes. */
function scopeFraming(scope: SummaryScope): { audience: string; focus: string } {
  switch (scope) {
    case 'recruiting':
      return {
        audience: 'recruiting team lead',
        focus: 'candidate pipeline velocity, stage-conversion rates, time-to-submit, new placements started, and where candidates are getting stuck. Downplay compliance/credentialing details unless they are blocking a placement.',
      };
    case 'hr':
      return {
        audience: 'HR / people-ops manager',
        focus: 'onboarding completion, expiring credentials that require outreach, policy + documentation gaps, and incidents requiring HR follow-up. Downplay BD / sales pipeline details.',
      };
    case 'credentialing':
      return {
        audience: 'credentialing coordinator',
        focus: 'document expirations in the next 30 days, missing required documents, credential-stage candidates, and anything that could delay clearance for placement. Downplay sales + BD activity.',
      };
    case 'bd':
      return {
        audience: 'business development / sales team',
        focus: 'bid pipeline, RFPs received, active client contracts expiring, placements started (revenue-generating), and client-facing activity. Downplay internal HR / credentialing unless blocking revenue.',
      };
    case 'ceo':
      return {
        audience: 'CEO / executive',
        focus: 'high-level health across all functions — revenue proxies (active placements, won bids), top 2-3 risks (overdue reminders, expiring credentials, incidents), and one sentence on trend vs. prior period. Keep it short and prioritized.',
      };
    case 'all':
    default:
      return {
        audience: 'operations manager',
        focus: 'a balanced cross-functional view: recruiting pipeline, compliance, BD, and operational risks.',
      };
  }
}

interface OperationalMetrics {
  period: SummaryPeriod;
  window_days: number;
  candidates: {
    total: number;
    by_stage: Record<string, number>;
    /** Count of candidates created within the trailing window_days. */
    created_in_period: number;
  };
  reminders: {
    overdue: number;
    /** Reminders whose due_date falls within the trailing window. */
    due_in_period: number;
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
  placements: {
    /** Placements created in the trailing window. */
    started_in_period: number;
    active: number;
  };
  incidents: {
    /** Incidents reported in the trailing window. */
    reported_in_period: number;
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
 * Gather operational metrics from multiple tables for the requested
 * period. Point-in-time state (totals, pending counts, expiring-soon
 * credentials) is the same regardless of period; activity counts
 * ("new this period") scale with the window.
 *
 * Each sub-query is wrapped independently so a missing table never
 * kills the entire metrics run.
 */
async function gatherMetrics(period: SummaryPeriod = 'day'): Promise<OperationalMetrics> {
  const windowDays = windowDaysFor(period);

  // --- candidates ---
  const candidateTotal = await safeQuery<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM candidates',
    [],
    { count: '0' }
  );

  // Re-query with pool for grouping by stage (safeQuery returns single row).
  let byStage: Record<string, number> = {};
  try {
    const stageResult = await pool.query(
      "SELECT COALESCE(stage, 'unknown') AS stage, COUNT(*)::int AS count FROM candidates GROUP BY stage"
    );
    for (const row of stageResult.rows) {
      byStage[row.stage] = row.count;
    }
  } catch {
    byStage = {};
  }

  const candidatesInPeriod = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM candidates
      WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [String(windowDays)],
    { count: '0' }
  );

  // --- reminders ---
  const overdueReminders = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM reminders
     WHERE due_date < NOW() AND status != 'sent'`,
    [],
    { count: '0' }
  );
  const remindersInPeriod = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM reminders
      WHERE due_date >= NOW() AND due_date < NOW() + ($1 || ' days')::interval`,
    [String(windowDays)],
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

  // --- placements ---
  const placementsInPeriod = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM placements
      WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [String(windowDays)],
    { count: '0' }
  );
  const activePlacements = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM placements WHERE status = 'active'`,
    [],
    { count: '0' }
  );

  // --- incidents ---
  const incidentsInPeriod = await safeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM incidents
      WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [String(windowDays)],
    { count: '0' }
  );

  return {
    period,
    window_days: windowDays,
    candidates: {
      total: parseInt(candidateTotal.count, 10),
      by_stage: byStage,
      created_in_period: parseInt(candidatesInPeriod.count, 10),
    },
    reminders: {
      overdue: parseInt(overdueReminders.count, 10),
      due_in_period: parseInt(remindersInPeriod.count, 10),
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
    placements: {
      started_in_period: parseInt(placementsInPeriod.count, 10),
      active: parseInt(activePlacements.count, 10),
    },
    incidents: {
      reported_in_period: parseInt(incidentsInPeriod.count, 10),
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
 * Generate a narrative operations summary for the given ISO date string
 * (YYYY-MM-DD) and period, and upsert it into the daily_summaries table.
 *
 * The table name is historical — it holds day/week/month summaries
 * discriminated by the `period` column (phase5_weekly_monthly_summaries
 * migration). Unique constraint is (summary_date, period).
 */
export async function generateDailySummary(
  date: string,
  period: SummaryPeriod = 'day',
  scope: SummaryScope = 'all',
): Promise<void> {
  const metrics = await gatherMetrics(period);
  const windowDays = windowDaysFor(period);
  const label = periodLabel(period);
  const { audience, focus } = scopeFraming(scope);

  // Count suggestions + clarifications generated within the window
  // ending on `date`. For weekly/monthly we want trailing counts.
  let suggestionsGenerated = 0;
  let questionsGenerated = 0;
  try {
    const sgRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM suggestions
        WHERE generated_at > ($1::date + INTERVAL '1 day' - ($2 || ' days')::interval)
          AND generated_at <= ($1::date + INTERVAL '1 day')`,
      [date, String(windowDays)]
    );
    suggestionsGenerated = sgRes.rows[0]?.count ?? 0;
  } catch { /* table may not exist yet */ }

  try {
    const qRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM clarification_questions
        WHERE created_at > ($1::date + INTERVAL '1 day' - ($2 || ' days')::interval)
          AND created_at <= ($1::date + INTERVAL '1 day')`,
      [date, String(windowDays)]
    );
    questionsGenerated = qRes.rows[0]?.count ?? 0;
  } catch { /* table may not exist yet */ }

  const periodLongLabel = period === 'day' ? 'daily' : period === 'week' ? 'weekly' : 'monthly';
  const periodWindowDesc = period === 'day'
    ? `for ${date}`
    : `for the ${windowDays}-day period ending ${date}`;

  const prompt = `You are an operations intelligence assistant for Frontline Healthcare Staffing.

Write a concise ${periodLongLabel} operations summary ${periodWindowDesc}, targeted at a ${audience}.

SCOPE: ${scope}
FOCUS FOR THIS SCOPE:
${focus}

METRICS SNAPSHOT (period = ${period}, window = ${windowDays} days):
${JSON.stringify(metrics, null, 2)}

ACTIVITY ${label.toUpperCase()}:
- AI suggestions generated: ${suggestionsGenerated}
- Clarification questions raised: ${questionsGenerated}

INSTRUCTIONS:
- Write a 2–4 sentence headline summary suitable for a dashboard banner. Reference the period explicitly (e.g. "${label}" or "the past ${windowDays} days").
- Then write a 3–5 sentence narrative targeted at the ${audience}, emphasizing the SCOPE FOCUS above. Skip or downplay data that doesn't fit this audience.
- For week/month summaries, identify trends and compare against the period-over-period shape when metrics imply it.
- Identify up to 3 risk alerts (brief bullet points), prioritized by what matters to this audience.
- Return ONLY valid JSON — no prose outside the object, no markdown fences.

REQUIRED FORMAT:
{
  "headline": "One-sentence banner headline",
  "narrative": "Multi-sentence operational narrative...",
  "risk_alerts": ["Risk 1", "Risk 2", "Risk 3"]
}`;

  let headline = `Operations summary for ${periodWindowDesc}`;
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
         (summary_date, period, scope, headline, narrative, metrics, risk_alerts,
          suggestions_generated, questions_generated, status, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'generated', NOW())
       ON CONFLICT (summary_date, period, scope) DO UPDATE SET
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
        period,
        scope,
        headline,
        narrative,
        JSON.stringify(metrics),
        JSON.stringify(riskAlerts),
        suggestionsGenerated,
        questionsGenerated,
      ]
    );
    console.log(`[intelligenceEngine] generateDailySummary: upserted ${period}/${scope} summary for ${date}`);
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
