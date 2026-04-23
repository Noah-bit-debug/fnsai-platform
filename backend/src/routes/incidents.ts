import { Router, Request, Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';
import { MODEL_FOR } from '../services/aiModels';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const incidentSchema = z.object({
  staff_id: z.string().uuid().optional().nullable(),
  facility_id: z.string().uuid().optional().nullable(),
  type: z.string().min(1).max(100),
  description: z.string().min(1).max(10000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['open', 'under_review', 'resolved', 'closed']).optional().default('open'),
  workers_comp_claim: z.boolean().optional().default(false),
  resolution_notes: z.string().max(5000).optional().nullable(),
});

const incidentUpdateSchema = incidentSchema.partial();

// GET / - list incidents
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { status, staff_id, facility_id } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`i.status = $${paramIndex++}`);
    params.push(status);
  }
  if (staff_id) {
    conditions.push(`i.staff_id = $${paramIndex++}`);
    params.push(staff_id);
  }
  if (facility_id) {
    conditions.push(`i.facility_id = $${paramIndex++}`);
    params.push(facility_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT i.*,
              s.first_name, s.last_name,
              f.name AS facility_name
       FROM incidents i
       LEFT JOIN staff s ON i.staff_id = s.id
       LEFT JOIN facilities f ON i.facility_id = f.id
       ${whereClause}
       ORDER BY i.date DESC, i.created_at DESC`,
      params
    );

    res.json({ incidents: result.rows });
  } catch (err) {
    console.error('Incidents list error:', err);
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

// GET /:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT i.*,
              s.first_name, s.last_name, s.phone AS staff_phone, s.email AS staff_email,
              f.name AS facility_name, f.contact_name, f.contact_phone
       FROM incidents i
       LEFT JOIN staff s ON i.staff_id = s.id
       LEFT JOIN facilities f ON i.facility_id = f.id
       WHERE i.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Incident get error:', err);
    res.status(500).json({ error: 'Failed to fetch incident' });
  }
});

// POST / - create incident
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = incidentSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  try {
    const result = await query(
      `INSERT INTO incidents (staff_id, facility_id, type, description, date, status, workers_comp_claim, resolution_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.staff_id,
        data.facility_id,
        data.type,
        data.description,
        data.date,
        data.status,
        data.workers_comp_claim,
        data.resolution_notes,
      ]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'incident.create',
      result.rows[0].id as string,
      { type: data.type, workersComp: data.workers_comp_claim },
      (req.ip ?? 'unknown')
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Incident create error:', err);
    res.status(500).json({ error: 'Failed to create incident' });
  }
});

// PUT /:id - update incident
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = incidentUpdateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;
  const fields = Object.keys(data);
  if (fields.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  const setClause = fields.map((key, i) => `${key} = $${i + 2}`).join(', ');
  const values = fields.map((key) => data[key as keyof typeof data]);

  try {
    const result = await query(
      `UPDATE incidents SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'incident.update', id, { fields }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Incident update error:', err);
    res.status(500).json({ error: 'Failed to update incident' });
  }
});

// DELETE /:id - close incident
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE incidents SET status = 'closed', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'incident.close', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true });
  } catch (err) {
    console.error('Incident close error:', err);
    res.status(500).json({ error: 'Failed to close incident' });
  }
});

// ─── Phase 4.1 — AI-assisted incident report creation ────────────────────────
//
// Two endpoints. The guided-interview flow in the frontend calls them
// alternately until the AI indicates it has enough answers, then asks
// for a final narrative:
//
//   1. POST /ai-next-question  — given current answers + context, return
//      the next question to ask (or { done: true }).
//   2. POST /ai-draft          — given the full set of answers, return a
//      well-formed incident narrative to paste into the Description field.
//
// Both endpoints are narrow helpers: they never create or update an
// incident on their own. The user still reviews + submits via the
// existing POST /. Manual mode (typing straight into the textarea) is
// always available — these endpoints are optional.

const aiNextSchema = z.object({
  type: z.string().min(1).max(100),
  staff_name: z.string().max(200).optional().nullable(),
  facility_name: z.string().max(200).optional().nullable(),
  // Ordered list of Q&A pairs captured so far. First call will have
  // answers = []; AI should pick a sensible opening question.
  answers: z.array(z.object({
    question: z.string().max(500),
    answer: z.string().max(5000),
  })).max(20),
});

router.post('/ai-next-question', requireAuth, async (req: Request, res: Response) => {
  const parse = aiNextSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }
  const { type, staff_name, facility_name, answers } = parse.data;

  // Cap the interview length so we don't loop forever.
  if (answers.length >= 8) {
    res.json({ done: true });
    return;
  }

  const systemPrompt = `You are helping a healthcare staffing coordinator write an incident report. Ask ONE short, specific question at a time to collect facts the report needs (what happened, when, where, who was involved/hurt, immediate actions taken, witnesses, follow-up). Do NOT summarize. Do NOT provide the report itself.

Respond with ONE of:
- A JSON object: { "question": "<your next question>" }
- { "done": true }  — ONLY when you have enough facts for a solid report (typically 4-6 questions, rarely more than 8).

Rules:
- Questions should be plain English, ≤25 words.
- Do not repeat a topic already answered.
- Prioritize facts that a compliance/HR reviewer would need.
- If the reporter gave a thin answer, push once for specifics, then move on.
- Never wrap your output in markdown code fences.`;

  const ctxLines: string[] = [`Incident type: ${type}`];
  if (staff_name) ctxLines.push(`Staff involved: ${staff_name}`);
  if (facility_name) ctxLines.push(`Facility: ${facility_name}`);
  ctxLines.push('');
  if (answers.length === 0) {
    ctxLines.push('No answers collected yet. Ask the first useful question.');
  } else {
    ctxLines.push('Answers collected so far:');
    answers.forEach((a, i) => ctxLines.push(`${i + 1}. Q: ${a.question}\n   A: ${a.answer}`));
  }

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.incidentDraft,
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: ctxLines.join('\n') }],
    });
    const raw = (response.content[0] as { type: string; text: string }).text;
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    const jsonStr = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;

    let parsed: { question?: string; done?: boolean };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // If the model returned raw text, wrap it as a question.
      parsed = { question: cleaned.slice(0, 300) };
    }
    if (parsed.done) { res.json({ done: true }); return; }
    if (!parsed.question) { res.json({ done: true }); return; }
    res.json({ done: false, question: parsed.question });
  } catch (err: any) {
    console.error('Incident AI next-question error:', err);
    if (err?.status === 429) { res.status(429).json({ error: 'AI is busy. Please retry in a minute.' }); return; }
    if (err?.status === 529) { res.status(503).json({ error: 'Claude is over capacity. Retry in ~30s.', retry_after_seconds: 30 }); return; }
    res.status(500).json({ error: `AI failed: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

const aiDraftSchema = z.object({
  type: z.string().min(1).max(100),
  staff_name: z.string().max(200).optional().nullable(),
  facility_name: z.string().max(200).optional().nullable(),
  date: z.string().max(50).optional().nullable(),
  answers: z.array(z.object({
    question: z.string().max(500),
    answer: z.string().max(5000),
  })).min(1).max(20),
});

router.post('/ai-draft', requireAuth, async (req: Request, res: Response) => {
  const parse = aiDraftSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }
  const { type, staff_name, facility_name, date, answers } = parse.data;

  const systemPrompt = `You write concise, factual incident narratives for healthcare staffing compliance records. Output plain prose — no bullet lists, no headings, no markdown. 3-6 sentences. Use the third person. Preserve all facts the user gave. Do NOT invent details the user didn't provide. Do NOT include personal opinions or recommendations. Do NOT add a closing signature line.`;

  const ctx: string[] = [`Incident type: ${type}`];
  if (staff_name) ctx.push(`Staff: ${staff_name}`);
  if (facility_name) ctx.push(`Facility: ${facility_name}`);
  if (date) ctx.push(`Date: ${date}`);
  ctx.push('', 'Collected answers:');
  answers.forEach((a, i) => ctx.push(`${i + 1}. Q: ${a.question}\n   A: ${a.answer}`));
  ctx.push('', 'Write the incident description now.');

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.incidentDraft,
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: ctx.join('\n') }],
    });
    const raw = (response.content[0] as { type: string; text: string }).text;
    const description = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
    res.json({ description });
  } catch (err: any) {
    console.error('Incident AI draft error:', err);
    if (err?.status === 429) { res.status(429).json({ error: 'AI is busy. Please retry in a minute.' }); return; }
    if (err?.status === 529) { res.status(503).json({ error: 'Claude is over capacity. Retry in ~30s.', retry_after_seconds: 30 }); return; }
    res.status(500).json({ error: `AI failed: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

export default router;
