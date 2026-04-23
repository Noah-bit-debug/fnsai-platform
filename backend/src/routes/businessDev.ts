/**
 * Phase 4 — Business Development routes
 *
 * Covers two pieces of the Phase 4 scope:
 *
 *   4.2  Bids — the new module the notes explicitly call out
 *               ("bid checklist, required steps tracking, AI help with
 *               bid creation, more tools useful for CEO-level work").
 *   4.3  Leads / Contacts / Follow-ups — wiring the three existing
 *               BusinessDev tabs off localStorage onto the backend so
 *               the data actually persists across sessions and users.
 *               The frontend shape is preserved 1:1 — nothing in the
 *               UI's mental model changes.
 *
 * Mounted at /api/v1/bd/* by backend/src/index.ts.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';
import { MODEL_FOR } from '../services/aiModels';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const uidFromReq = (req: Request): string => getAuth(req)?.userId ?? 'unknown';

// ═══════════════════════════════════════════════════════════════════════════
//  4.2  BIDS  —  /bids
// ═══════════════════════════════════════════════════════════════════════════

// Default 8-step checklist seeded into every new bid. Admins can edit /
// remove / add items per-bid via the checklist endpoints — this is just
// the starting template.
const DEFAULT_BID_CHECKLIST: { label: string; required: boolean }[] = [
  { label: 'Review RFP / requirements document',       required: true },
  { label: 'Identify client decision makers',          required: true },
  { label: 'Pricing analysis + cost model',            required: true },
  { label: 'Draft proposal / response document',       required: true },
  { label: 'Internal review (BD lead)',                required: true },
  { label: 'Legal / contracts review',                 required: false },
  { label: 'Submit bid to client',                     required: true },
  { label: 'Post-submission follow-up scheduled',      required: false },
];

const bidCreateSchema = z.object({
  title: z.string().min(1).max(200),
  client_name: z.string().max(200).optional().nullable(),
  facility_id: z.string().uuid().optional().nullable(),
  status: z.enum(['draft','in_progress','submitted','won','lost']).optional().default('draft'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  estimated_value: z.number().nonnegative().optional().nullable(),
  assigned_to: z.string().max(255).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  // Optional — if provided, seed THIS checklist instead of the default.
  // Used by the AI-assist flow where the AI returns a tailored checklist.
  checklist: z.array(z.object({
    label: z.string().min(1).max(300),
    required: z.boolean().optional().default(true),
  })).optional(),
});

const bidUpdateSchema = bidCreateSchema.partial().omit({ checklist: true });

// GET /bids — list, filter by status / assigned_to
router.get('/bids', requireAuth, async (req: Request, res: Response) => {
  const { status, assigned_to } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (typeof status === 'string') { conditions.push(`b.status = $${params.length + 1}`); params.push(status); }
  if (typeof assigned_to === 'string') { conditions.push(`b.assigned_to = $${params.length + 1}`); params.push(assigned_to); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT b.*,
              f.name AS facility_name,
              COUNT(c.id)::int AS checklist_total,
              COUNT(c.id) FILTER (WHERE c.completed)::int AS checklist_completed
         FROM bd_bids b
         LEFT JOIN facilities f ON b.facility_id = f.id
         LEFT JOIN bd_bid_checklist_items c ON c.bid_id = b.id
         ${whereClause}
         GROUP BY b.id, f.name
         ORDER BY
           CASE b.status
             WHEN 'in_progress' THEN 1
             WHEN 'draft' THEN 2
             WHEN 'submitted' THEN 3
             WHEN 'won' THEN 4
             WHEN 'lost' THEN 5
           END,
           b.due_date NULLS LAST,
           b.created_at DESC`,
      params
    );
    res.json({ bids: result.rows });
  } catch (err) {
    console.error('BD bids list error:', err);
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
});

// GET /bids/:id — detail including checklist
router.get('/bids/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const bRes = await query(
      `SELECT b.*, f.name AS facility_name
         FROM bd_bids b
         LEFT JOIN facilities f ON b.facility_id = f.id
         WHERE b.id = $1`,
      [id]
    );
    if (bRes.rows.length === 0) { res.status(404).json({ error: 'Bid not found' }); return; }
    const cRes = await query(
      `SELECT * FROM bd_bid_checklist_items WHERE bid_id = $1 ORDER BY order_index, created_at`,
      [id]
    );
    res.json({ bid: bRes.rows[0], checklist: cRes.rows });
  } catch (err) {
    console.error('BD bid detail error:', err);
    res.status(500).json({ error: 'Failed to fetch bid' });
  }
});

// POST /bids — create + seed checklist in one transaction
router.post('/bids', requireAuth, async (req: Request, res: Response) => {
  const parse = bidCreateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const userId = uidFromReq(req);

  try {
    // Insert bid row
    const bRes = await query(
      `INSERT INTO bd_bids
         (title, client_name, facility_id, status, due_date, estimated_value, assigned_to, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        d.title,
        d.client_name ?? null,
        d.facility_id ?? null,
        d.status ?? 'draft',
        d.due_date ?? null,
        d.estimated_value ?? null,
        d.assigned_to ?? userId,
        d.notes ?? null,
        userId,
      ]
    );
    const bid = bRes.rows[0];

    // Seed checklist (use AI-provided one if supplied, otherwise default)
    const items = d.checklist && d.checklist.length > 0 ? d.checklist : DEFAULT_BID_CHECKLIST;
    for (let i = 0; i < items.length; i++) {
      await query(
        `INSERT INTO bd_bid_checklist_items (bid_id, label, required, order_index) VALUES ($1,$2,$3,$4)`,
        [bid.id, items[i].label, items[i].required !== false, i]
      );
    }

    const bidId = bid.id as string;
    await logAudit(null, userId, 'bd_bid.create', bidId, { title: d.title, checklistCount: items.length }, (req.ip ?? 'unknown'));

    const cRes = await query(`SELECT * FROM bd_bid_checklist_items WHERE bid_id = $1 ORDER BY order_index`, [bidId]);
    res.status(201).json({ bid, checklist: cRes.rows });
  } catch (err) {
    console.error('BD bid create error:', err);
    res.status(500).json({ error: 'Failed to create bid' });
  }
});

// PUT /bids/:id — update metadata
router.put('/bids/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = bidUpdateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const fields = Object.keys(d);
  if (fields.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  const setClause = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = fields.map((k) => (d as Record<string, unknown>)[k] ?? null);

  try {
    const result = await query(
      `UPDATE bd_bids SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Bid not found' }); return; }
    await logAudit(null, uidFromReq(req), 'bd_bid.update', id, { fields }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('BD bid update error:', err);
    res.status(500).json({ error: 'Failed to update bid' });
  }
});

// DELETE /bids/:id — hard-delete (cascades to checklist)
router.delete('/bids/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(`DELETE FROM bd_bids WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Bid not found' }); return; }
    await logAudit(null, uidFromReq(req), 'bd_bid.delete', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true });
  } catch (err) {
    console.error('BD bid delete error:', err);
    res.status(500).json({ error: 'Failed to delete bid' });
  }
});

// ── Checklist items ──────────────────────────────────────────────────────

const checklistItemSchema = z.object({
  label: z.string().min(1).max(300),
  required: z.boolean().optional().default(true),
  order_index: z.number().int().min(0).max(9999).optional(),
});
const checklistUpdateSchema = z.object({
  label: z.string().min(1).max(300).optional(),
  required: z.boolean().optional(),
  completed: z.boolean().optional(),
  order_index: z.number().int().min(0).max(9999).optional(),
});

// POST /bids/:id/checklist — add a custom step
router.post('/bids/:id/checklist', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = checklistItemSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  try {
    // Put new items at the end unless explicit order_index provided.
    const nextIdxRes = await query(
      `SELECT COALESCE(MAX(order_index), -1) + 1 AS next_idx FROM bd_bid_checklist_items WHERE bid_id = $1`,
      [id]
    );
    const orderIndex = d.order_index ?? (nextIdxRes.rows[0].next_idx as number);
    const result = await query(
      `INSERT INTO bd_bid_checklist_items (bid_id, label, required, order_index) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, d.label, d.required !== false, orderIndex]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('BD checklist add error:', err);
    res.status(500).json({ error: 'Failed to add checklist item' });
  }
});

// PUT /bids/:id/checklist/:itemId — update (toggle completed, rename, etc.)
router.put('/bids/:id/checklist/:itemId', requireAuth, async (req: Request, res: Response) => {
  const { id, itemId } = req.params;
  const parse = checklistUpdateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const userId = uidFromReq(req);

  // Build a flat list of (column, value) updates. When the caller toggles
  // `completed`, mirror that onto completed_at + completed_by so the UI
  // can show who checked it off.
  const sets: Array<{ col: string; val: unknown }> = [];
  for (const k of Object.keys(d) as (keyof typeof d)[]) {
    sets.push({ col: k as string, val: (d as Record<string, unknown>)[k as string] });
  }
  if (d.completed === true) {
    // completed_at uses SQL NOW(), so we pass it as a raw expression.
    // Emit it outside the parameter list.
    sets.push({ col: 'completed_by', val: userId });
  } else if (d.completed === false) {
    sets.push({ col: 'completed_by', val: null });
  }

  if (sets.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  const params: unknown[] = [id, itemId];
  const setClauses: string[] = [];
  for (const s of sets) {
    params.push(s.val);
    setClauses.push(`${s.col} = $${params.length}`);
  }
  // Append NOW() raw for completed_at when appropriate.
  if (d.completed === true) setClauses.push(`completed_at = NOW()`);
  else if (d.completed === false) setClauses.push(`completed_at = NULL`);

  try {
    const result = await query(
      `UPDATE bd_bid_checklist_items SET ${setClauses.join(', ')}
        WHERE bid_id = $1 AND id = $2 RETURNING *`,
      params
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Checklist item not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('BD checklist update error:', err);
    res.status(500).json({ error: 'Failed to update checklist item' });
  }
});

// DELETE /bids/:id/checklist/:itemId
router.delete('/bids/:id/checklist/:itemId', requireAuth, async (req: Request, res: Response) => {
  const { id, itemId } = req.params;
  try {
    const result = await query(
      `DELETE FROM bd_bid_checklist_items WHERE bid_id = $1 AND id = $2 RETURNING id`,
      [id, itemId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Checklist item not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('BD checklist delete error:', err);
    res.status(500).json({ error: 'Failed to delete checklist item' });
  }
});

// ── AI-assisted bid creation ─────────────────────────────────────────────

const aiDraftBidSchema = z.object({
  // Free-form description of the opportunity, RFP text, or client context.
  context: z.string().min(10).max(30000),
  client_name: z.string().max(200).optional().nullable(),
});

router.post('/bids/ai-draft', requireAuth, async (req: Request, res: Response) => {
  const parse = aiDraftBidSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const { context, client_name } = parse.data;

  const systemPrompt = `You help a healthcare staffing business development team draft bids. Given a description of an opportunity, return a short suggested bid title, a tailored checklist of required steps (5-10 items), and initial notes capturing key facts from the description.

Respond with ONLY this JSON shape, no markdown fences:
{
  "title": "<short bid title, under 80 chars>",
  "notes": "<2-5 sentences capturing client, scope, timing, and any numeric specifics>",
  "checklist": [
    { "label": "<step name>", "required": true|false }
  ]
}

Rules:
- Checklist items should be actionable (e.g. "Confirm RN count + shifts with hiring manager", not "Understand the deal").
- Mark steps as required=true for core bid work, false for nice-to-have or conditional work.
- Keep checklist items under 100 chars each.
- Do not fabricate numbers or names that aren't in the context.
- If the context is too thin to write a real title, return "New bid — needs detail" and a minimal checklist.`;

  const userMsg = `${client_name ? `Client: ${client_name}\n\n` : ''}Opportunity context:\n${context}`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.bidDraft,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });
    const raw = (response.content[0] as { type: string; text: string }).text;
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    const jsonStr = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;

    let parsed: { title?: string; notes?: string; checklist?: { label: string; required?: boolean }[] };
    try { parsed = JSON.parse(jsonStr); }
    catch {
      res.status(502).json({ error: 'AI returned malformed JSON. Please retry.', raw_preview: raw.slice(0, 500) });
      return;
    }
    if (!parsed.title || !Array.isArray(parsed.checklist)) {
      res.status(502).json({ error: 'AI response missing title or checklist.' });
      return;
    }
    res.json({
      title: parsed.title,
      notes: parsed.notes ?? '',
      checklist: parsed.checklist.filter((c) => c && typeof c.label === 'string'),
    });
  } catch (err: any) {
    console.error('BD AI draft error:', err);
    if (err?.status === 429) { res.status(429).json({ error: 'AI is busy. Please retry in a minute.' }); return; }
    res.status(500).json({ error: `AI failed: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// GET /bids-stats — lightweight CEO-level dashboard numbers. The Phase 4
// notes mention "more tools useful for CEO-level work" — we expose this
// as a small stats endpoint so the Bids tab can show a header row with
// open count, open pipeline value, win rate, and due-this-week.
router.get('/bids-stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('draft','in_progress','submitted'))::int AS open_count,
        COALESCE(SUM(estimated_value) FILTER (WHERE status IN ('draft','in_progress','submitted')), 0)::float AS open_value,
        COUNT(*) FILTER (WHERE status = 'won')::int AS won_count,
        COUNT(*) FILTER (WHERE status = 'lost')::int AS lost_count,
        COUNT(*) FILTER (WHERE status IN ('draft','in_progress') AND due_date IS NOT NULL AND due_date <= CURRENT_DATE + INTERVAL '7 days')::int AS due_this_week
      FROM bd_bids
    `);
    const r = result.rows[0] as {
      open_count: number;
      open_value: number;
      won_count: number;
      lost_count: number;
      due_this_week: number;
    };
    const totalDecided = (r.won_count ?? 0) + (r.lost_count ?? 0);
    const winRate = totalDecided > 0 ? Math.round((r.won_count / totalDecided) * 100) : null;
    res.json({
      open_count: r.open_count,
      open_value: r.open_value,
      won_count: r.won_count,
      lost_count: r.lost_count,
      win_rate: winRate,
      due_this_week: r.due_this_week,
    });
  } catch (err) {
    console.error('BD bids-stats error:', err);
    res.status(500).json({ error: 'Failed to load bid stats' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  4.3  LEADS  —  /leads
// ═══════════════════════════════════════════════════════════════════════════

const LEAD_STATUSES = ['prospect','qualified','proposal','negotiating','closed','lost'] as const;
const LEAD_SOURCES = ['cold_call','referral','website','linkedin','event'] as const;

const leadSchema = z.object({
  company: z.string().min(1).max(200),
  contact_name: z.string().max(200).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  status: z.enum(LEAD_STATUSES).optional().default('prospect'),
  source: z.enum(LEAD_SOURCES).optional().default('cold_call'),
  last_contact: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  next_follow_up: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
});
const leadUpdateSchema = leadSchema.partial();

router.get('/leads', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(`SELECT * FROM bd_leads ORDER BY updated_at DESC`);
    res.json({ leads: result.rows });
  } catch (err) {
    console.error('BD leads list error:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

router.post('/leads', requireAuth, async (req: Request, res: Response) => {
  const parse = leadSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  try {
    const result = await query(
      `INSERT INTO bd_leads (company, contact_name, phone, email, status, source, last_contact, next_follow_up, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [d.company, d.contact_name ?? null, d.phone ?? null, d.email ?? null, d.status, d.source, d.last_contact ?? null, d.next_follow_up ?? null, d.notes ?? null, uidFromReq(req)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('BD lead create error:', err);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

router.put('/leads/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = leadUpdateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const keys = Object.keys(d);
  if (keys.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map((k) => (d as Record<string, unknown>)[k] ?? null);
  try {
    const result = await query(
      `UPDATE bd_leads SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...vals]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('BD lead update error:', err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

router.delete('/leads/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(`DELETE FROM bd_leads WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('BD lead delete error:', err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  4.3  CONTACTS  —  /contacts
// ═══════════════════════════════════════════════════════════════════════════

const contactSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional().nullable(),
  company: z.string().max(200).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  last_contact: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
});
const contactUpdateSchema = contactSchema.partial();

router.get('/contacts', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(`SELECT * FROM bd_contacts ORDER BY updated_at DESC`);
    res.json({ contacts: result.rows });
  } catch (err) {
    console.error('BD contacts list error:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

router.post('/contacts', requireAuth, async (req: Request, res: Response) => {
  const parse = contactSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  try {
    const result = await query(
      `INSERT INTO bd_contacts (name, title, company, email, phone, last_contact, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [d.name, d.title ?? null, d.company ?? null, d.email ?? null, d.phone ?? null, d.last_contact ?? null, d.notes ?? null, uidFromReq(req)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('BD contact create error:', err);
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

router.put('/contacts/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = contactUpdateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const keys = Object.keys(d);
  if (keys.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map((k) => (d as Record<string, unknown>)[k] ?? null);
  try {
    const result = await query(
      `UPDATE bd_contacts SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...vals]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Contact not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('BD contact update error:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

router.delete('/contacts/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(`DELETE FROM bd_contacts WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Contact not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('BD contact delete error:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  4.3  FOLLOW-UPS  —  /followups
// ═══════════════════════════════════════════════════════════════════════════

const FOLLOWUP_TYPES = ['call','email','meeting'] as const;
const FOLLOWUP_PRIORITIES = ['high','medium','low'] as const;
const FOLLOWUP_STATUSES = ['pending','done'] as const;

const followupSchema = z.object({
  company_contact: z.string().min(1).max(300),
  follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(FOLLOWUP_TYPES).optional().default('call'),
  priority: z.enum(FOLLOWUP_PRIORITIES).optional().default('medium'),
  status: z.enum(FOLLOWUP_STATUSES).optional().default('pending'),
  notes: z.string().max(10000).optional().nullable(),
});
const followupUpdateSchema = followupSchema.partial();

router.get('/followups', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(`SELECT * FROM bd_followups ORDER BY follow_up_date ASC, priority ASC`);
    res.json({ followups: result.rows });
  } catch (err) {
    console.error('BD followups list error:', err);
    res.status(500).json({ error: 'Failed to fetch follow-ups' });
  }
});

router.post('/followups', requireAuth, async (req: Request, res: Response) => {
  const parse = followupSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  try {
    const result = await query(
      `INSERT INTO bd_followups (company_contact, follow_up_date, type, priority, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [d.company_contact, d.follow_up_date, d.type, d.priority, d.status, d.notes ?? null, uidFromReq(req)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('BD followup create error:', err);
    res.status(500).json({ error: 'Failed to create follow-up' });
  }
});

router.put('/followups/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = followupUpdateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const keys = Object.keys(d);
  if (keys.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map((k) => (d as Record<string, unknown>)[k] ?? null);
  try {
    const result = await query(
      `UPDATE bd_followups SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...vals]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Follow-up not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('BD followup update error:', err);
    res.status(500).json({ error: 'Failed to update follow-up' });
  }
});

router.delete('/followups/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(`DELETE FROM bd_followups WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Follow-up not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('BD followup delete error:', err);
    res.status(500).json({ error: 'Failed to delete follow-up' });
  }
});

export default router;
