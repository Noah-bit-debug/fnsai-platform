/**
 * AI Team — tool implementations.
 *
 * Each tool is a read-only function the agents can call to ground their
 * output in real data. NEVER expose write operations through these
 * tools — the orchestrator's `finalize_output` is the only thing that
 * leaves a mark, and it just stores text on the task. Anything that
 * actually mutates state (creating reminders, sending messages, etc.)
 * is captured as an *artifact suggestion* and surfaced to the user for
 * one-click action AFTER they approve the final output.
 *
 * Why read-only: the loop runs without immediate human review until the
 * end. Letting Claude write directly would let one bad turn (or one bad
 * prompt) silently mutate production data.
 */

import { query } from '../../db/client';

// ─── Tool definitions (the JSON schema Claude sees) ────────────────────

export type ToolName =
  | 'search_candidates'
  | 'get_candidate_details'
  | 'list_open_jobs'
  | 'list_pending_submissions'
  | 'list_expiring_credentials'
  | 'list_missing_credentials_for_candidate'
  | 'list_overdue_onboarding'
  | 'list_recent_reminders_for_candidate'
  | 'consult_specialist'
  | 'recommend_action'
  | 'finalize_output';

export interface ToolDef {
  name: ToolName;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFS: Record<ToolName, ToolDef> = {
  search_candidates: {
    name: 'search_candidates',
    description:
      'Search candidates by name fragment, role, stage, or status. ' +
      'Returns at most 25 matches with id, name, role, stage, status, last update. ' +
      'Use this to find people to look at; follow up with get_candidate_details for one specifically.',
    input_schema: {
      type: 'object',
      properties: {
        name_fragment: { type: 'string', description: 'Substring of first or last name. Optional.' },
        role:          { type: 'string', description: "e.g. 'RN', 'LPN', 'CNA'. Optional." },
        stage:         { type: 'string', description: "e.g. 'application', 'credentialing', 'onboarding', 'placed'. Optional." },
        status:        { type: 'string', description: "e.g. 'active', 'inactive'. Defaults to 'active'." },
      },
    },
  },
  get_candidate_details: {
    name: 'get_candidate_details',
    description:
      "Get a single candidate's full profile: identifying fields, stage, " +
      'recruiter assignment, recent activity, and missing-document count. ' +
      'Does NOT return PHI (medical records); does return contact info.',
    input_schema: {
      type: 'object',
      properties: { candidate_id: { type: 'string', description: 'UUID' } },
      required: ['candidate_id'],
    },
  },
  list_open_jobs: {
    name: 'list_open_jobs',
    description: 'List currently open job requisitions: title, role, location, opened date.',
    input_schema: { type: 'object', properties: {} },
  },
  list_pending_submissions: {
    name: 'list_pending_submissions',
    description:
      'List candidate submissions still pending a decision (not closed/withdrawn). ' +
      'Useful for "who are we waiting on" questions.',
    input_schema: { type: 'object', properties: {} },
  },
  list_expiring_credentials: {
    name: 'list_expiring_credentials',
    description:
      'List candidate credentials expiring in the next N days (default 30). ' +
      'Returns candidate name, credential label, and expiration date.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Window in days. Default 30.' },
      },
    },
  },
  list_missing_credentials_for_candidate: {
    name: 'list_missing_credentials_for_candidate',
    description: "List a single candidate's missing/pending/expired credential documents.",
    input_schema: {
      type: 'object',
      properties: { candidate_id: { type: 'string' } },
      required: ['candidate_id'],
    },
  },
  list_overdue_onboarding: {
    name: 'list_overdue_onboarding',
    description:
      'List candidates with onboarding forms that have been sitting incomplete for >3 days.',
    input_schema: { type: 'object', properties: {} },
  },
  list_recent_reminders_for_candidate: {
    name: 'list_recent_reminders_for_candidate',
    description:
      'List the last N reminders sent or scheduled for a candidate (default 10). ' +
      'Useful before recommending a new reminder so we donâ€™t spam.',
    input_schema: {
      type: 'object',
      properties: {
        candidate_id: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['candidate_id'],
    },
  },
  consult_specialist: {
    name: 'consult_specialist',
    description:
      "Ask one of the specialist personas to handle a sub-question with their own toolset. " +
      "Use this when a sub-task is squarely in another specialty (e.g. for compliance details, " +
      "ask compliance_ai). The specialist will run its own short loop and return a written answer. " +
      "ONLY the orchestrator calls this; specialists should solve directly with their own tools.",
    input_schema: {
      type: 'object',
      properties: {
        persona: {
          type: 'string',
          enum: ['recruiting_ai', 'hr_ai', 'compliance_ai', 'credentialing_ai', 'operations_ai'],
        },
        prompt:  { type: 'string', description: 'What you want the specialist to investigate or produce.' },
      },
      required: ['persona', 'prompt'],
    },
  },
  recommend_action: {
    name: 'recommend_action',
    description:
      'Persist a recommended action for the user to one-click later (after approval). ' +
      'Use for concrete suggestions like "send a reminder", "assign HR follow-up", "create a task". ' +
      'This does NOT execute the action — the user decides post-approval.',
    input_schema: {
      type: 'object',
      properties: {
        kind:    { type: 'string', description: "e.g. 'recommended_reminder', 'recommended_assignment', 'recommended_message'" },
        label:   { type: 'string', description: 'Short human label, e.g. "Remind Jane Doe about TB test"' },
        payload: { type: 'object', description: 'Free-form structured data the UI knows how to render and act on.' },
      },
      required: ['kind', 'label', 'payload'],
    },
  },
  finalize_output: {
    name: 'finalize_output',
    description:
      "Submit the final synthesized output for the user. Call this exactly once when you're done. " +
      "After this, the runner stops and the task moves to awaiting_approval. " +
      "Body should be in markdown.",
    input_schema: {
      type: 'object',
      properties: { output: { type: 'string', description: 'Markdown body. Sections, bullet points, callouts welcome.' } },
      required: ['output'],
    },
  },
};

// ─── Tool execution ────────────────────────────────────────────────────

export type ToolInput = Record<string, unknown>;
export type ToolResult = unknown;

export interface ToolContext {
  taskId: string;
  userId: string | null;       // DB UUID of the user who owns the task
  // The runner sets these via callbacks because they trigger
  // side-effects on tables we don't want to import here.
  recommendAction:   (kind: string, label: string, payload: Record<string, unknown>) => Promise<{ id: string }>;
  consultSpecialist: (persona: string, prompt: string) => Promise<string>;
}

export async function executeTool(
  name: ToolName,
  input: ToolInput,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (name) {
    case 'search_candidates': {
      const nameFrag = (input.name_fragment as string | undefined) ?? null;
      const role     = (input.role as string | undefined) ?? null;
      const stage    = (input.stage as string | undefined) ?? null;
      const status   = (input.status as string | undefined) ?? 'active';
      const r = await query<{
        id: string; first_name: string; last_name: string; role: string | null;
        stage: string | null; status: string; updated_at: string;
      }>(
        `SELECT id, first_name, last_name, role, stage, status, updated_at
           FROM candidates
          WHERE ($1::text IS NULL OR first_name ILIKE '%' || $1 || '%' OR last_name ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR role = $2)
            AND ($3::text IS NULL OR stage = $3)
            AND status = $4
          ORDER BY updated_at DESC
          LIMIT 25`,
        [nameFrag, role, stage, status]
      );
      return r.rows.map((c) => ({
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        role: c.role,
        stage: c.stage,
        status: c.status,
        updated_at: c.updated_at,
      }));
    }

    case 'get_candidate_details': {
      const id = String(input.candidate_id ?? '');
      if (!id) return { error: 'candidate_id required' };
      const r = await query<{
        id: string; first_name: string; last_name: string; email: string | null;
        phone: string | null; role: string | null; stage: string | null; status: string;
        years_experience: number | null; specialties: string[] | null;
        recruiter_notes: string | null; hr_notes: string | null;
        updated_at: string; assigned_recruiter_id: string | null;
        missing_doc_count: number;
      }>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.role, c.stage, c.status,
                c.years_experience, c.specialties, c.recruiter_notes, c.hr_notes,
                c.updated_at, c.assigned_recruiter_id,
                (SELECT COUNT(*)::INT FROM candidate_documents cd
                  WHERE cd.candidate_id = c.id
                    AND cd.required = true
                    AND cd.status IN ('missing','pending','expired')
                ) AS missing_doc_count
           FROM candidates c
          WHERE c.id = $1`,
        [id]
      );
      if (r.rows.length === 0) return { error: 'Candidate not found' };
      const c = r.rows[0];
      return {
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        email: c.email,
        phone: c.phone,
        role: c.role,
        stage: c.stage,
        status: c.status,
        years_experience: c.years_experience,
        specialties: c.specialties,
        recruiter_notes: c.recruiter_notes,
        hr_notes: c.hr_notes,
        last_updated: c.updated_at,
        assigned_recruiter_id: c.assigned_recruiter_id,
        missing_required_doc_count: c.missing_doc_count,
      };
    }

    case 'list_open_jobs': {
      // Defensive: jobs table is only present after the ATS migration.
      try {
        const r = await query<{
          id: string; title: string; role: string | null;
          city: string | null; state: string | null; opened_at: string | null;
        }>(
          `SELECT id, title, role, city, state, opened_at
             FROM jobs
            WHERE COALESCE(closed_at, NOW() + INTERVAL '1 day') > NOW()
              AND COALESCE(status, 'open') = 'open'
            ORDER BY opened_at DESC NULLS LAST
            LIMIT 50`
        );
        return r.rows;
      } catch {
        return [];
      }
    }

    case 'list_pending_submissions': {
      try {
        const r = await query(
          `SELECT s.id, s.candidate_id,
                  c.first_name || ' ' || c.last_name AS candidate_name,
                  s.job_id, j.title AS job_title,
                  s.stage_key, s.created_at, s.updated_at, s.interview_scheduled_at
             FROM submissions s
             LEFT JOIN candidates c ON c.id = s.candidate_id
             LEFT JOIN jobs j       ON j.id = s.job_id
            WHERE s.stage_key NOT IN ('hired','rejected','withdrawn','closed')
            ORDER BY s.updated_at DESC
            LIMIT 50`
        );
        return r.rows;
      } catch {
        return [];
      }
    }

    case 'list_expiring_credentials': {
      const days = Number(input.days ?? 30);
      const r = await query(
        `SELECT cd.id, cd.candidate_id,
                c.first_name || ' ' || c.last_name AS candidate_name,
                cd.label, cd.document_type, cd.expiry_date
           FROM candidate_documents cd
           JOIN candidates c ON c.id = cd.candidate_id
          WHERE cd.expiry_date IS NOT NULL
            AND cd.expiry_date BETWEEN NOW() AND NOW() + ($1 || ' days')::INTERVAL
          ORDER BY cd.expiry_date ASC
          LIMIT 100`,
        [days]
      );
      return r.rows;
    }

    case 'list_missing_credentials_for_candidate': {
      const id = String(input.candidate_id ?? '');
      if (!id) return { error: 'candidate_id required' };
      const r = await query(
        `SELECT label, document_type, status, expiry_date, required
           FROM candidate_documents
          WHERE candidate_id = $1
            AND status IN ('missing','pending','expired')
          ORDER BY required DESC, label ASC
          LIMIT 50`,
        [id]
      );
      return r.rows;
    }

    case 'list_overdue_onboarding': {
      try {
        const r = await query(
          `SELECT of.candidate_id,
                  c.first_name || ' ' || c.last_name AS candidate_name,
                  of.form_type, of.status, of.sent_at,
                  EXTRACT(DAY FROM NOW() - of.sent_at)::INT AS days_pending
             FROM onboarding_forms of
             LEFT JOIN candidates c ON c.id = of.candidate_id
            WHERE of.status IN ('not_sent','sent','opened')
              AND (of.sent_at IS NULL OR of.sent_at < NOW() - INTERVAL '3 days')
            ORDER BY of.sent_at ASC NULLS FIRST
            LIMIT 100`
        );
        return r.rows;
      } catch {
        return [];
      }
    }

    case 'list_recent_reminders_for_candidate': {
      const id = String(input.candidate_id ?? '');
      const limit = Math.min(Number(input.limit ?? 10), 50);
      if (!id) return { error: 'candidate_id required' };
      const r = await query(
        `SELECT id, type, trigger_type, subject, status, scheduled_at, sent_at, created_at
           FROM reminders
          WHERE candidate_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [id, limit]
      );
      return r.rows;
    }

    case 'consult_specialist': {
      const persona = String(input.persona ?? '');
      const prompt  = String(input.prompt ?? '');
      if (!persona || !prompt) return { error: 'persona and prompt required' };
      const reply = await ctx.consultSpecialist(persona, prompt);
      return { persona, reply };
    }

    case 'recommend_action': {
      const kind    = String(input.kind ?? '');
      const label   = String(input.label ?? '');
      const payload = (input.payload ?? {}) as Record<string, unknown>;
      if (!kind || !label) return { error: 'kind and label required' };
      const r = await ctx.recommendAction(kind, label, payload);
      return { id: r.id, recorded: true };
    }

    case 'finalize_output': {
      // The runner intercepts this before we get here, but if a
      // specialist (incorrectly) calls it, we stub a no-op. Specialists
      // should return text instead.
      return { error: 'finalize_output may only be called by the orchestrator' };
    }
  }
}
