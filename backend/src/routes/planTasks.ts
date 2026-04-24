/**
 * Phase 5.2 — Action Plan tasks
 *
 * Backed CRUD for:
 *   * Tasks      (plan_tasks)
 *   * Groups     (plan_task_groups)
 *   * Subtasks   (plan_subtasks)
 *   * Reminders  (plan_task_reminders)
 *
 * Plus AI-assist endpoints:
 *   POST /ai-next-question — one question at a time to refine a task idea
 *   POST /ai-draft         — given collected answers, produce title +
 *                            category + priority + subtasks + notes +
 *                            a suggested reminder date.
 *
 * Mounted at /api/v1/plan-tasks.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';
import { MODEL_FOR } from '../services/aiModels';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const uid = (req: Request): string => getAuth(req)?.userId ?? 'unknown';

// ── Groups ──────────────────────────────────────────────────────────────
const groupSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(16).optional().nullable(),
});

router.get('/groups', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(`SELECT * FROM plan_task_groups ORDER BY created_at ASC`);
    res.json({ groups: result.rows });
  } catch (err) {
    console.error('plan_task_groups list error:', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

router.post('/groups', requireAuth, async (req: Request, res: Response) => {
  const parse = groupSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  try {
    const result = await query(
      `INSERT INTO plan_task_groups (name, color, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [parse.data.name, parse.data.color ?? null, uid(req)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('plan_task_groups create error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

router.delete('/groups/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(`DELETE FROM plan_task_groups WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Group not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('plan_task_groups delete error:', err);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// ── Tasks ───────────────────────────────────────────────────────────────
const taskSchema = z.object({
  title: z.string().min(1).max(300),
  category: z.string().max(50).optional().nullable(),
  priority: z.enum(['High','Medium','Low']).optional().default('Medium'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(20000).optional().nullable(),
  group_id: z.string().uuid().optional().nullable(),
  assigned_to: z.string().max(255).optional().nullable(),
  done: z.boolean().optional(),
});
const taskUpdate = taskSchema.partial();

// Full task row shape + aggregated subtask counts. Used by list + get.
const TASK_SELECT = `
  SELECT t.*,
         g.name AS group_name,
         g.color AS group_color,
         COUNT(st.id)::int AS subtask_total,
         COUNT(st.id) FILTER (WHERE st.done)::int AS subtask_done,
         EXISTS (
           SELECT 1 FROM plan_task_reminders r
            WHERE r.task_id = t.id
              AND r.dismissed = FALSE
              AND r.remind_at <= NOW() + INTERVAL '7 days'
         ) AS reminder_soon
    FROM plan_tasks t
    LEFT JOIN plan_task_groups g ON t.group_id = g.id
    LEFT JOIN plan_subtasks st ON st.task_id = t.id
`;

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { done, group_id, priority } = req.query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (done !== undefined) { params.push(done === 'true'); conds.push(`t.done = $${params.length}`); }
  if (typeof group_id === 'string') { params.push(group_id); conds.push(`t.group_id = $${params.length}`); }
  if (typeof priority === 'string') { params.push(priority); conds.push(`t.priority = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  try {
    const result = await query(
      `${TASK_SELECT} ${where}
       GROUP BY t.id, g.name, g.color
       ORDER BY t.done ASC,
                CASE t.priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
                t.due_date NULLS LAST,
                t.created_at DESC`,
      params
    );
    res.json({ tasks: result.rows });
  } catch (err) {
    console.error('plan_tasks list error:', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Phase 5.2 QA fix — /upcoming-reminders MUST be registered BEFORE
// /:id because Express matches in declaration order. If :id comes
// first, a GET /upcoming-reminders matches as id="upcoming-reminders"
// and the handler tries SELECT WHERE id='upcoming-reminders' which
// either 500s (invalid UUID) or returns 404. Same reason we hoist
// any other static-path GETs above /:id.
router.get('/upcoming-reminders', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT r.*, t.title AS task_title, t.priority, t.due_date
        FROM plan_task_reminders r
        JOIN plan_tasks t ON r.task_id = t.id
       WHERE r.dismissed = FALSE
         AND r.remind_at <= NOW() + INTERVAL '30 days'
       ORDER BY r.remind_at ASC
       LIMIT 100
    `);
    res.json({ reminders: result.rows });
  } catch (err) {
    console.error('upcoming reminders error:', err);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const tRes = await query(
      `${TASK_SELECT} WHERE t.id = $1 GROUP BY t.id, g.name, g.color`,
      [req.params.id]
    );
    if (tRes.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    const sRes = await query(`SELECT * FROM plan_subtasks WHERE task_id = $1 ORDER BY order_index`, [req.params.id]);
    const rRes = await query(`SELECT * FROM plan_task_reminders WHERE task_id = $1 ORDER BY remind_at`, [req.params.id]);
    res.json({ task: tRes.rows[0], subtasks: sRes.rows, reminders: rRes.rows });
  } catch (err) {
    console.error('plan_tasks get error:', err);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = taskSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  try {
    const result = await query(
      `INSERT INTO plan_tasks (title, category, priority, due_date, notes, group_id, assigned_to, done, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, FALSE),$9) RETURNING *`,
      [d.title, d.category ?? null, d.priority, d.due_date ?? null, d.notes ?? null, d.group_id ?? null, d.assigned_to ?? null, d.done ?? null, uid(req)]
    );
    await logAudit(null, uid(req), 'plan_task.create', result.rows[0].id as string, { title: d.title }, (req.ip ?? 'unknown'));
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('plan_tasks create error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const parse = taskUpdate.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const keys = Object.keys(d);
  if (keys.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map(k => (d as Record<string, unknown>)[k] ?? null);
  // When flipping done → true, also stamp done_at
  const extraSet = d.done === true ? ', done_at = NOW()' : d.done === false ? ', done_at = NULL' : '';
  try {
    const result = await query(
      `UPDATE plan_tasks SET ${setClause}${extraSet}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...vals]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('plan_tasks update error:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(`DELETE FROM plan_tasks WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('plan_tasks delete error:', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ── Subtasks ────────────────────────────────────────────────────────────
const subtaskSchema = z.object({
  title: z.string().min(1).max(500),
  done: z.boolean().optional().default(false),
  order_index: z.number().int().min(0).max(9999).optional(),
});
const subtaskUpdate = subtaskSchema.partial();

router.post('/:id/subtasks', requireAuth, async (req: Request, res: Response) => {
  const parse = subtaskSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  try {
    const next = await query(`SELECT COALESCE(MAX(order_index), -1) + 1 AS idx FROM plan_subtasks WHERE task_id = $1`, [req.params.id]);
    const idx = parse.data.order_index ?? (next.rows[0].idx as number);
    const result = await query(
      `INSERT INTO plan_subtasks (task_id, title, done, order_index) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, parse.data.title, parse.data.done ?? false, idx]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('plan_subtasks create error:', err);
    res.status(500).json({ error: 'Failed to add subtask' });
  }
});

router.put('/:id/subtasks/:sid', requireAuth, async (req: Request, res: Response) => {
  const parse = subtaskUpdate.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const keys = Object.keys(d);
  if (keys.length === 0) { res.status(400).json({ error: 'No fields' }); return; }
  const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const vals = keys.map(k => (d as Record<string, unknown>)[k] ?? null);
  // Stamp done_at / done_by on toggle
  const userId = uid(req);
  let extra = '';
  const extraVals: unknown[] = [];
  if (d.done === true) { extra = `, done_at = NOW(), done_by = $${keys.length + 3 + extraVals.length}`; extraVals.push(userId); }
  else if (d.done === false) { extra = `, done_at = NULL, done_by = NULL`; }
  try {
    const result = await query(
      `UPDATE plan_subtasks SET ${setClause}${extra} WHERE task_id = $1 AND id = $2 RETURNING *`,
      [req.params.id, req.params.sid, ...vals, ...extraVals]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Subtask not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('plan_subtasks update error:', err);
    res.status(500).json({ error: 'Failed to update subtask' });
  }
});

router.delete('/:id/subtasks/:sid', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM plan_subtasks WHERE task_id = $1 AND id = $2 RETURNING id`,
      [req.params.id, req.params.sid]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Subtask not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('plan_subtasks delete error:', err);
    res.status(500).json({ error: 'Failed to delete subtask' });
  }
});

// ── Reminders ───────────────────────────────────────────────────────────
const reminderSchema = z.object({
  remind_at: z.string(),                        // ISO datetime
  message: z.string().max(1000).optional().nullable(),
});

router.post('/:id/reminders', requireAuth, async (req: Request, res: Response) => {
  const parse = reminderSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  try {
    const result = await query(
      `INSERT INTO plan_task_reminders (task_id, remind_at, message) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, parse.data.remind_at, parse.data.message ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('plan_task_reminders create error:', err);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

router.put('/:id/reminders/:rid/dismiss', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE plan_task_reminders SET dismissed = TRUE, dismissed_at = NOW()
        WHERE task_id = $1 AND id = $2 RETURNING *`,
      [req.params.id, req.params.rid]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Reminder not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('plan_task_reminders dismiss error:', err);
    res.status(500).json({ error: 'Failed to dismiss' });
  }
});

router.delete('/:id/reminders/:rid', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM plan_task_reminders WHERE task_id = $1 AND id = $2 RETURNING id`,
      [req.params.id, req.params.rid]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Reminder not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('plan_task_reminders delete error:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// /upcoming-reminders moved to the top of the file above /:id (Phase 5.2
// QA fix) — see comment there. This location is now a no-op; left only
// as a breadcrumb so future readers don't wonder where it went.

// ── AI Guided task creation ─────────────────────────────────────────────

const aiNextSchema = z.object({
  goal: z.string().max(1000),            // short user-typed goal
  answers: z.array(z.object({
    question: z.string().max(500),
    answer: z.string().max(5000),
  })).max(10),
});

router.post('/ai-next-question', requireAuth, async (req: Request, res: Response) => {
  const parse = aiNextSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const { goal, answers } = parse.data;
  if (answers.length >= 6) { res.json({ done: true }); return; }

  const systemPrompt = `You help a healthcare staffing operator break a goal into an actionable task. Ask ONE short question at a time to clarify scope, owner, deadline, success criteria, or potential blockers. Never write the task itself — just ask questions.

Respond with JSON ONLY, no markdown fences:
  { "question": "<your next question>" }   -- keep asking
  { "done": true }                         -- you have enough

Rules:
- Questions ≤20 words, plain English.
- Don't repeat a topic already answered.
- Stop after 4-6 questions (rarely 7-8).
- Push once for specifics when an answer is thin, then move on.`;

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
    console.error('plan_tasks ai-next-question error:', err);
    // Phase 5.2 QA — surface rate-limit (429) and overload (529)
    // separately so the frontend can auto-retry vs. show a persistent
    // banner. 529 = Anthropic is currently over capacity; usually
    // resolves in <30s.
    if (err?.status === 429) { res.status(429).json({ error: 'AI is busy. Please retry.', retry_after_seconds: 15 }); return; }
    if (err?.status === 529) { res.status(503).json({ error: 'Claude is temporarily over capacity. Retrying automatically usually works within a minute.', retry_after_seconds: 30 }); return; }
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

  // Phase 6.6 QA fix — include today's date in the prompt so Claude
  // doesn't draft due dates in the past. Without this the model
  // defaults to its training-cutoff date, which was producing 2025
  // dates in mid-2026.
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `You turn a goal + collected answers into a concrete task definition for a healthcare staffing ops team.

Today's date is ${today}. All due dates you generate MUST be on or after this date — never in the past.

Return JSON only, no markdown fences:

{
  "title": "<short action-verb task title, under 80 chars>",
  "category": "<one of: Step 1 Urgent|Step 2 Insurance|Step 3 Funding|Step 4 Planning|Step 5 Controls|Step 6 Contracts|General>",
  "priority": "High|Medium|Low",
  "due_date": "YYYY-MM-DD (must be >= ${today}) or null",
  "notes": "<2-4 sentence context capturing what the answers revealed>",
  "subtasks": ["<ordered actionable steps, 3-8 items, each ≤120 chars>"],
  "suggested_reminder_days": <integer 1-30, how many days before due_date to remind; null if no due date>
}

Rules:
- Subtasks must be verb-first and actionable ("Call Sarah at BankEasy to confirm account number", not "Account stuff").
- If the answers didn't pin down a date, set due_date to null. Do NOT guess a date from training data — use today (${today}) as the earliest possible date.
- If the user said "by Friday" or "next week", calculate the actual YYYY-MM-DD relative to ${today}.
- Do not invent facts the answers didn't provide.
- priority = High if the answers indicate a blocker / deadline in ≤7 days; Medium otherwise; Low if purely housekeeping.`;

  const ctx: string[] = [`Goal: ${goal}`, '', 'Collected answers:'];
  answers.forEach((a, i) => ctx.push(`${i + 1}. Q: ${a.question}\n   A: ${a.answer}`));

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.taskDraft,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: ctx.join('\n') }],
    });
    const raw = (response.content[0] as { type: string; text: string }).text;
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = cleaned.indexOf('{'); const last = cleaned.lastIndexOf('}');
    const jsonStr = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
    let parsed: {
      title?: string; category?: string; priority?: string; due_date?: string | null;
      notes?: string; subtasks?: string[]; suggested_reminder_days?: number | null;
    };
    try { parsed = JSON.parse(jsonStr); }
    catch { res.status(502).json({ error: 'AI returned malformed JSON.', raw_preview: raw.slice(0, 500) }); return; }
    if (!parsed.title) { res.status(502).json({ error: 'AI response missing title' }); return; }

    // Phase 6.6 QA fix — belt-and-suspenders guard against Claude
    // emitting a due_date in the past despite the prompt. If it does,
    // null it out so the frontend doesn't save an overdue task out of
    // the gate.
    let dueDate: string | null = parsed.due_date ?? null;
    if (dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      if (dueDate < today) {
        console.warn('[plan-tasks] AI returned past due_date', dueDate, 'today is', today, '— nulling it out');
        dueDate = null;
      }
    } else if (dueDate) {
      // malformed string → drop
      dueDate = null;
    }

    res.json({
      title: parsed.title,
      category: parsed.category ?? 'General',
      priority: (['High','Medium','Low'] as const).includes(parsed.priority as any) ? parsed.priority : 'Medium',
      due_date: dueDate,
      notes: parsed.notes ?? '',
      subtasks: Array.isArray(parsed.subtasks) ? parsed.subtasks.filter(s => typeof s === 'string').slice(0, 12) : [],
      suggested_reminder_days: typeof parsed.suggested_reminder_days === 'number' ? parsed.suggested_reminder_days : null,
    });
  } catch (err: any) {
    console.error('plan_tasks ai-draft error:', err);
    // Phase 5.2 QA — surface rate-limit (429) and overload (529)
    // separately so the frontend can auto-retry vs. show a persistent
    // banner. 529 = Anthropic is currently over capacity; usually
    // resolves in <30s.
    if (err?.status === 429) { res.status(429).json({ error: 'AI is busy. Please retry.', retry_after_seconds: 15 }); return; }
    if (err?.status === 529) { res.status(503).json({ error: 'Claude is temporarily over capacity. Retrying automatically usually works within a minute.', retry_after_seconds: 30 }); return; }
    res.status(500).json({ error: `AI failed: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

export default router;
