import { Router, Request, Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { getAuth } from '../middleware/auth';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { MODEL_FOR } from '../services/aiModels';
import { guardAIRequest } from '../services/permissions/aiGuard';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const taskSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional().nullable(),
  task_type: z.enum(['call', 'meeting', 'todo', 'follow_up', 'email', 'sms', 'other']).optional().nullable(),
  due_at: z.string().optional().nullable(),
  timezone: z.string().max(50).optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  escalate_to: z.string().uuid().optional().nullable(),
  reminder_minutes_before: z.number().int().min(0).optional().nullable(),
  recurrence: z.string().max(200).optional().nullable(),
  notify_email: z.boolean().optional(),
  notify_sms: z.boolean().optional(),
  candidate_id: z.string().uuid().optional().nullable(),
  job_id: z.string().uuid().optional().nullable(),
  submission_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
});

// GET / — list with overdue flag computed in SELECT
router.get('/', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  const { assigned_to, candidate_id, job_id, submission_id, client_id, status, overdue, due_today } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (assigned_to) { conditions.push(`t.assigned_to = $${idx++}`); params.push(assigned_to); }
  if (candidate_id) { conditions.push(`t.candidate_id = $${idx++}`); params.push(candidate_id); }
  if (job_id) { conditions.push(`t.job_id = $${idx++}`); params.push(job_id); }
  if (submission_id) { conditions.push(`t.submission_id = $${idx++}`); params.push(submission_id); }
  if (client_id) { conditions.push(`t.client_id = $${idx++}`); params.push(client_id); }
  if (status) { conditions.push(`t.status = $${idx++}`); params.push(status); }
  if (overdue === 'true') { conditions.push(`t.status = 'open' AND t.due_at < NOW()`); }
  if (due_today === 'true') { conditions.push(`t.status = 'open' AND t.due_at::date = CURRENT_DATE`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT t.*,
              (t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at < NOW()) AS is_overdue,
              u_assign.name AS assigned_to_name,
              u_create.name AS created_by_name,
              (c.first_name || ' ' || c.last_name) AS candidate_name,
              j.title AS job_title,
              cl.name AS client_name
       FROM recruiter_tasks t
       LEFT JOIN users u_assign ON t.assigned_to = u_assign.id
       LEFT JOIN users u_create ON t.created_by = u_create.id
       LEFT JOIN candidates c ON t.candidate_id = c.id
       LEFT JOIN jobs j ON t.job_id = j.id
       LEFT JOIN clients cl ON t.client_id = cl.id
       ${where}
       ORDER BY
         CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
         t.due_at ASC NULLS LAST,
         t.created_at DESC
       LIMIT 500`,
      params
    );
    res.json({ tasks: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ tasks: [] }); return; }
    console.error('Tasks list error:', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// POST / — create
router.post('/', requireAuth, requirePermission('reminders_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const d = parsed.data;

  try {
    const result = await query(
      `INSERT INTO recruiter_tasks (
         title, description, task_type, due_at, timezone,
         assigned_to, escalate_to, reminder_minutes_before, recurrence,
         notify_email, notify_sms,
         candidate_id, job_id, submission_id, client_id,
         created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       ) RETURNING *`,
      [
        d.title, d.description ?? null, d.task_type ?? 'todo', d.due_at ?? null, d.timezone ?? null,
        d.assigned_to ?? null, d.escalate_to ?? null, d.reminder_minutes_before ?? null, d.recurrence ?? null,
        d.notify_email ?? true, d.notify_sms ?? false,
        d.candidate_id ?? null, d.job_id ?? null, d.submission_id ?? null, d.client_id ?? null,
        req.userRecord?.id ?? null,
      ]
    );
    await logAudit(req.userRecord?.id ?? null, getAuth(req).userId ?? 'system', 'task.create', result.rows[0].id as string);
    res.status(201).json({ task: result.rows[0] });
  } catch (err) {
    console.error('Task create error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /:id
router.put('/:id', requireAuth, requirePermission('reminders_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = taskSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  const setParts = entries.map(([k], i) => `${k} = $${i + 1}`);
  const values: unknown[] = entries.map(([, v]) => v);
  values.push(req.params.id);

  try {
    const result = await query(
      `UPDATE recruiter_tasks SET ${setParts.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ task: result.rows[0] });
  } catch (err) {
    console.error('Task update error:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// POST /:id/complete
router.post('/:id/complete', requireAuth, requirePermission('reminders_manage'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `UPDATE recruiter_tasks
       SET status = 'done', completed_at = NOW(), completed_by = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [req.userRecord?.id ?? null, req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ task: result.rows[0] });
  } catch (err) {
    console.error('Task complete error:', err);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// DELETE /:id — cancel
router.delete('/:id', requireAuth, requirePermission('reminders_manage'), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE recruiter_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Task cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel task' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// AI-assisted task creation — mirrors the Action Plan wizard pattern
// (plan-tasks/ai-next-question + plan-tasks/ai-draft), but tuned for
// recruiting workflows (candidates, submissions, clients, interviews,
// follow-ups) and the recruiter_tasks data shape (task_type enum,
// due_at timestamp, reminder_minutes_before).
//
// Flow:
//   1. POST /ai-next-question  — AI asks one refining question; returns
//                                 { done: true } once it has enough
//   2. POST /ai-draft          — AI emits a concrete draft task:
//                                 { title, task_type, due_at, description,
//                                   reminder_minutes_before }
//
// The frontend wizard walks the user through 3–6 questions and then
// shows the draft in an editable form before calling tasksApi.create.
// ─────────────────────────────────────────────────────────────────────

const aiNextSchema = z.object({
  goal: z.string().max(1000),
  answers: z.array(z.object({
    question: z.string().max(500),
    answer: z.string().max(5000),
  })).max(10),
});

router.post('/ai-next-question', requireAuth, async (req: Request, res: Response) => {
  const parse = aiNextSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const { goal, answers } = parse.data;

  const guard = await guardAIRequest({
    req,
    tool: 'ai_recruiter_task_wizard',
    toolPermission: 'ai.chat.use',
    additionalRequired: ['ai.topic.candidates'],
    prompt: goal + ' ' + (answers[answers.length - 1]?.answer ?? ''),
  });
  if (!guard.allowed) { res.status(403).json({ error: guard.denialMessage }); return; }

  if (answers.length >= 6) { res.json({ done: true }); return; }

  const systemPrompt = `You help a healthcare-staffing recruiter turn a vague task idea into a concrete recruiter_tasks row. Ask ONE short clarifying question at a time. Focus on:
- WHO the task involves (candidate name, client/facility, job/submission)
- WHAT the task type really is (call, meeting, email, SMS, follow-up, todo)
- WHEN it needs to happen (specific day + time if possible — recruiters use tight schedules)
- WHY it matters / urgency (screening today vs. 30-day follow-up)

Respond with JSON ONLY, no markdown fences:
  { "question": "<your next question>" }   -- keep asking
  { "done": true }                         -- you have enough

Rules:
- Questions ≤20 words, plain English, recruiter-speak ok ("Who's the candidate?" not "What is the target individual?").
- Don't repeat a topic already answered.
- Stop after 3-5 questions (rarely 6).
- Be pragmatic: skip the "why" if context is already clear.`;

  const ctx: string[] = [`Goal: ${goal}`];
  if (answers.length === 0) ctx.push('No answers yet. Ask the first useful question.');
  else {
    ctx.push('Answers so far:');
    answers.forEach((a, i) => ctx.push(`${i + 1}. Q: ${a.question}\n   A: ${a.answer}`));
  }

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.taskDraft,
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: ctx.join('\n') }],
    });
    const raw = (response.content[0] as { type: string; text: string }).text;
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = cleaned.indexOf('{'); const last = cleaned.lastIndexOf('}');
    const jsonStr = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
    let parsed: { question?: string; done?: boolean };
    try { parsed = JSON.parse(jsonStr); } catch { parsed = { question: cleaned.slice(0, 300) }; }
    if (parsed.done) { res.json({ done: true }); return; }
    if (!parsed.question) { res.json({ done: true }); return; }
    res.json({ done: false, question: parsed.question });
  } catch (err: any) {
    console.error('recruiter-tasks ai-next-question error:', err);
    // Same 429/529 handling pattern as plan-tasks + AI chat.
    if (err?.status === 429) { res.status(429).json({ error: 'AI is busy. Please retry.', retry_after_seconds: 15 }); return; }
    if (err?.status === 529) { res.status(503).json({ error: 'Claude is temporarily over capacity. Retrying usually works within a minute.', retry_after_seconds: 30 }); return; }
    res.status(500).json({ error: `AI failed: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

const aiDraftSchema = z.object({
  goal: z.string().max(1000),
  answers: z.array(z.object({
    question: z.string().max(500),
    answer: z.string().max(5000),
  })).min(1).max(10),
});

router.post('/ai-draft', requireAuth, async (req: Request, res: Response) => {
  const parse = aiDraftSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const { goal, answers } = parse.data;

  const guard = await guardAIRequest({
    req,
    tool: 'ai_recruiter_task_wizard',
    toolPermission: 'ai.chat.use',
    additionalRequired: ['ai.topic.candidates'],
    prompt: goal + ' ' + answers.map(a => a.answer).join(' ').slice(0, 2000),
  });
  if (!guard.allowed) { res.status(403).json({ error: guard.denialMessage }); return; }

  // Include today's date so Claude doesn't draft tasks in the past.
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `You turn a recruiter's goal + collected answers into a concrete task definition.

Today's date is ${today}. All due_at timestamps MUST be on or after ${today}T00:00:00Z — never in the past.

Return JSON only, no markdown fences:

{
  "title": "<short action-verb title, under 120 chars>",
  "task_type": "call | meeting | email | sms | follow_up | todo | other",
  "due_at": "YYYY-MM-DDTHH:MM:00Z (ISO 8601 UTC) or null",
  "description": "<1-3 sentences of context from the answers>",
  "reminder_minutes_before": <integer 5..1440 or null>
}

Rules:
- task_type must be ONE of: call, meeting, email, sms, follow_up, todo, other.
- If the user said "tomorrow at 2pm", calculate the actual ISO timestamp relative to ${today} in UTC. Assume America/New_York (UTC-4 currently) unless the answers say otherwise.
- If no specific time was mentioned, pick a sensible default (9am local for morning tasks, 2pm for afternoon, null if open-ended).
- reminder_minutes_before: 60 for same-day tasks, 1440 (24h) for next-day meetings, null for low-urgency tasks.
- Never invent a candidate/client name that wasn't mentioned — just describe the context.`;

  const ctx: string[] = [`Goal: ${goal}`, '', 'Collected answers:'];
  answers.forEach((a, i) => ctx.push(`${i + 1}. Q: ${a.question}\n   A: ${a.answer}`));

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.taskDraft,
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: ctx.join('\n') }],
    });
    const raw = (response.content[0] as { type: string; text: string }).text;
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = cleaned.indexOf('{'); const last = cleaned.lastIndexOf('}');
    const jsonStr = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
    let parsed: {
      title?: string;
      task_type?: string;
      due_at?: string | null;
      description?: string;
      reminder_minutes_before?: number | null;
    };
    try { parsed = JSON.parse(jsonStr); }
    catch { res.status(502).json({ error: 'AI returned malformed JSON.', raw_preview: raw.slice(0, 500) }); return; }
    if (!parsed.title) { res.status(502).json({ error: 'AI response missing title' }); return; }

    // Guard: clamp task_type to the enum, default to 'todo'.
    const validTypes = ['call', 'meeting', 'email', 'sms', 'follow_up', 'todo', 'other'];
    const taskType = validTypes.includes(parsed.task_type ?? '') ? parsed.task_type! : 'todo';

    // Guard: drop past or malformed due_at.
    let dueAt: string | null = parsed.due_at ?? null;
    if (dueAt) {
      const parsedDate = new Date(dueAt);
      if (isNaN(parsedDate.getTime()) || parsedDate.getTime() < Date.now() - 60_000) {
        console.warn('[recruiter-tasks] AI returned past/bad due_at', dueAt, '— nulling out');
        dueAt = null;
      } else {
        dueAt = parsedDate.toISOString();
      }
    }

    // Guard: clamp reminder to 5..1440 minutes.
    let reminder: number | null = parsed.reminder_minutes_before ?? null;
    if (reminder != null) {
      reminder = Math.max(5, Math.min(1440, Math.round(reminder)));
    }

    res.json({
      title: parsed.title.slice(0, 120),
      task_type: taskType,
      due_at: dueAt,
      description: (parsed.description ?? '').slice(0, 2000),
      reminder_minutes_before: reminder,
    });
  } catch (err: any) {
    console.error('recruiter-tasks ai-draft error:', err);
    if (err?.status === 429) { res.status(429).json({ error: 'AI is busy. Please retry.', retry_after_seconds: 15 }); return; }
    if (err?.status === 529) { res.status(503).json({ error: 'Claude is temporarily over capacity. Retrying usually works within a minute.', retry_after_seconds: 30 }); return; }
    res.status(500).json({ error: `AI failed: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

export default router;
