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
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';
import { MODEL_FOR } from '../services/aiModels';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Shared file upload (contracts + RFPs) ──────────────────────────────
// Uses the same persistent-dir override pattern as esign. Set
// BD_UPLOAD_DIR to a volume mount on Railway to survive deploys.
const bdUploadRoot = process.env.BD_UPLOAD_DIR
  ? path.join(process.env.BD_UPLOAD_DIR)
  : path.join(process.cwd(), 'uploads', 'bd');
const contractsDir = path.join(bdUploadRoot, 'contracts');
const rfpsDir      = path.join(bdUploadRoot, 'rfps');
[contractsDir, rfpsDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
console.log(`[bd] Upload dir: ${bdUploadRoot}${process.env.BD_UPLOAD_DIR ? ' (persistent)' : ' (ephemeral)'}`);

const makeStorage = (dir: string) => multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dir),
  filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});
const BD_ALLOWED_MIMETYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
];
const contractUpload = multer({
  storage: makeStorage(contractsDir),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, BD_ALLOWED_MIMETYPES.includes(file.mimetype)),
});
const rfpUpload = multer({
  storage: makeStorage(rfpsDir),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, BD_ALLOWED_MIMETYPES.includes(file.mimetype)),
});

/** Extract text from an uploaded file. PDFs use pdf-parse via dynamic
 *  import so the heavy dep only loads when needed. DOCX uses mammoth.
 *  Returns first 30k chars — Claude's context is plenty but we trim to
 *  keep the DB row sane and the AI prompt fast. */
async function extractText(filePath: string, mimetype: string): Promise<string> {
  try {
    if (mimetype === 'text/plain') {
      return fs.readFileSync(filePath, 'utf8').slice(0, 30000);
    }
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const r = await mammoth.extractRawText({ path: filePath });
      return r.value.slice(0, 30000);
    }
    if (mimetype === 'application/pdf') {
      // pdf-parse: dynamic import keeps module-load cost off the hot path.
      const mod = await import('pdf-parse' as string).catch(() => null);
      if (!mod) return '';
      const data = await (mod as any).default(fs.readFileSync(filePath));
      return String(data.text ?? '').slice(0, 30000);
    }
    return '';
  } catch (err) {
    console.warn('[bd] text extraction failed:', err);
    return '';
  }
}

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

  const { guardAIRequest } = await import('../services/permissions/aiGuard');
  const guard = await guardAIRequest({
    req,
    tool: 'ai_bid_draft',
    toolPermission: 'ai.chat.use',
    additionalRequired: ['bd.bids.edit', 'ai.topic.bids'],
    prompt: context,
  });
  if (!guard.allowed) { res.status(403).json({ error: guard.denialMessage }); return; }

  const systemPrompt = `${guard.systemPromptGuard}You help a healthcare staffing business development team draft bids. Given a description of an opportunity, return a short suggested bid title, a tailored checklist of required steps (5-10 items), and initial notes capturing key facts from the description.

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
    if (err?.status === 529) { res.status(503).json({ error: 'Claude is over capacity. Retry in ~30s.', retry_after_seconds: 30 }); return; }
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

// ═══════════════════════════════════════════════════════════════════════════
//  4.4  CONTRACTS  —  /contracts
// ═══════════════════════════════════════════════════════════════════════════
//
// A contract record owns N version rows. The top-level row holds the
// "current state" (status, expiration, summary). Each version is the
// snapshot of the document file + the admin's note about what changed.
// Uploading a new version auto-increments current_version and, if text
// could be extracted, kicks off an AI terms-summary refresh.

const contractSchema = z.object({
  title: z.string().min(1).max(200),
  client_name: z.string().max(200).optional().nullable(),
  facility_id: z.string().uuid().optional().nullable(),
  bid_id: z.string().uuid().optional().nullable(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  expiration_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  total_value: z.number().nonnegative().optional().nullable(),
  status: z.enum(['draft','active','expired','terminated']).optional().default('draft'),
  notes: z.string().max(10000).optional().nullable(),
});
const contractUpdate = contractSchema.partial();

router.get('/contracts', requireAuth, async (req: Request, res: Response) => {
  const { status, facility_id } = req.query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (typeof status === 'string')      { params.push(status);      conds.push(`c.status = $${params.length}`); }
  if (typeof facility_id === 'string') { params.push(facility_id); conds.push(`c.facility_id = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT c.*,
              f.name AS facility_name,
              COUNT(v.id)::int AS version_count,
              (c.expiration_date IS NOT NULL AND c.expiration_date <= CURRENT_DATE + INTERVAL '30 days' AND c.status = 'active') AS expiring_soon
         FROM bd_contracts c
         LEFT JOIN facilities f ON c.facility_id = f.id
         LEFT JOIN bd_contract_versions v ON v.contract_id = c.id
         ${where}
         GROUP BY c.id, f.name
         ORDER BY
           CASE c.status WHEN 'active' THEN 1 WHEN 'draft' THEN 2 WHEN 'expired' THEN 3 WHEN 'terminated' THEN 4 END,
           c.expiration_date NULLS LAST,
           c.created_at DESC`,
      params
    );
    res.json({ contracts: result.rows });
  } catch (err) {
    console.error('BD contracts list error:', err);
    res.status(500).json({ error: 'Failed to fetch contracts' });
  }
});

router.get('/contracts/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const cRes = await query(
      `SELECT c.*, f.name AS facility_name
         FROM bd_contracts c
         LEFT JOIN facilities f ON c.facility_id = f.id
         WHERE c.id = $1`,
      [id]
    );
    if (cRes.rows.length === 0) { res.status(404).json({ error: 'Contract not found' }); return; }
    const vRes = await query(
      `SELECT * FROM bd_contract_versions WHERE contract_id = $1 ORDER BY version DESC`,
      [id]
    );
    res.json({ contract: cRes.rows[0], versions: vRes.rows });
  } catch (err) {
    console.error('BD contract detail error:', err);
    res.status(500).json({ error: 'Failed to fetch contract' });
  }
});

router.post('/contracts', requireAuth, async (req: Request, res: Response) => {
  const parse = contractSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  try {
    const result = await query(
      `INSERT INTO bd_contracts (title, client_name, facility_id, bid_id, effective_date, expiration_date, total_value, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [d.title, d.client_name ?? null, d.facility_id ?? null, d.bid_id ?? null, d.effective_date ?? null, d.expiration_date ?? null, d.total_value ?? null, d.status, d.notes ?? null, uidFromReq(req)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('BD contract create error:', err);
    res.status(500).json({ error: 'Failed to create contract' });
  }
});

router.put('/contracts/:id', requireAuth, async (req: Request, res: Response) => {
  const parse = contractUpdate.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const keys = Object.keys(d);
  if (keys.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map(k => (d as Record<string, unknown>)[k] ?? null);
  try {
    const result = await query(
      `UPDATE bd_contracts SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...vals]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Contract not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('BD contract update error:', err);
    res.status(500).json({ error: 'Failed to update contract' });
  }
});

router.delete('/contracts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(`DELETE FROM bd_contracts WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Contract not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('BD contract delete error:', err);
    res.status(500).json({ error: 'Failed to delete contract' });
  }
});

// POST /contracts/:id/versions — upload a new version file. Auto-bumps
// current_version, stores the file, optionally extracts+summarizes.
router.post('/contracts/:id/versions', requireAuth, contractUpload.single('file'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = uidFromReq(req);
  const changesSummary = typeof req.body?.changes_summary === 'string' ? req.body.changes_summary : null;

  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  try {
    // Find the current max version for this contract.
    const vMax = await query(`SELECT COALESCE(MAX(version), 0) AS m FROM bd_contract_versions WHERE contract_id = $1`, [id]);
    const nextVersion = ((vMax.rows[0].m as number) ?? 0) + 1;

    const filePath = path.relative(process.cwd(), req.file.path);
    const ins = await query(
      `INSERT INTO bd_contract_versions (contract_id, version, file_path, file_name, changes_summary, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, nextVersion, filePath, req.file.originalname, changesSummary, userId]
    );
    await query(`UPDATE bd_contracts SET current_version = $1, updated_at = NOW() WHERE id = $2`, [nextVersion, id]);

    // Best-effort AI terms summary. Non-fatal if anything fails.
    (async () => {
      const text = await extractText(req.file!.path, req.file!.mimetype);
      if (!text || text.length < 200) return;
      try {
        const aiResp = await anthropic.messages.create({
          model: MODEL_FOR.bidDraft,
          max_tokens: 600,
          system: 'You write 3-5 sentence plain-English summaries of healthcare staffing contracts. Capture: parties, scope, rate/value, term length, termination clause, notable risks (indemnification, liability caps, non-solicit). No markdown.',
          messages: [{ role: 'user', content: text }],
        });
        const summary = ((aiResp.content[0] as { type: string; text: string }).text ?? '').trim();
        if (summary) await query(`UPDATE bd_contracts SET terms_summary = $1, updated_at = NOW() WHERE id = $2`, [summary, id]);
      } catch (err) { console.warn('[bd] contract summary AI failed:', err); }
    })();

    await logAudit(null, userId, 'bd_contract.version_upload', id, { version: nextVersion, filename: req.file.originalname }, (req.ip ?? 'unknown'));
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error('BD contract version upload error:', err);
    res.status(500).json({ error: 'Failed to upload version' });
  }
});

// GET /contracts/:id/versions/:vid/file — stream the version file back
router.get('/contracts/:id/versions/:vid/file', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT file_path, file_name FROM bd_contract_versions WHERE id = $1 AND contract_id = $2`,
      [req.params.vid, req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Version not found' }); return; }
    const row = result.rows[0] as { file_path: string; file_name: string };
    const absPath = path.isAbsolute(row.file_path) ? row.file_path : path.join(process.cwd(), row.file_path);
    if (!fs.existsSync(absPath)) { res.status(404).json({ error: 'File is missing from disk (ephemeral storage?)' }); return; }
    res.download(absPath, row.file_name);
  } catch (err) {
    console.error('BD contract file serve error:', err);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// GET /contracts-alerts — expiring + expired quick list for a dashboard.
router.get('/contracts-alerts', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT id, title, client_name, expiration_date, status,
        CASE
          WHEN status = 'expired' THEN 'expired'
          WHEN expiration_date IS NOT NULL AND expiration_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'ok'
        END AS alert_level
      FROM bd_contracts
      WHERE status IN ('active','expired')
        AND (status = 'expired'
             OR (expiration_date IS NOT NULL AND expiration_date <= CURRENT_DATE + INTERVAL '60 days'))
      ORDER BY expiration_date ASC NULLS LAST
      LIMIT 50
    `);
    res.json({ alerts: result.rows });
  } catch (err) {
    console.error('BD contracts alerts error:', err);
    res.status(500).json({ error: 'Failed to compute alerts' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  4.4  RFPs  —  /rfps
// ═══════════════════════════════════════════════════════════════════════════
//
// Inbox-style. Upload an RFP document → extract text → AI summary →
// optionally draft a bid from it (reuses POST /bids/ai-draft under the
// hood but also backlinks the new bid to the RFP).

const rfpUpdateSchema = z.object({
  title: z.string().max(300).optional(),
  client_name: z.string().max(200).optional().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['new','reviewed','drafted','declined','expired']).optional(),
  notes: z.string().max(10000).optional().nullable(),
});

router.get('/rfps', requireAuth, async (req: Request, res: Response) => {
  const { status } = req.query;
  const params: unknown[] = [];
  let where = '';
  if (typeof status === 'string') { params.push(status); where = `WHERE status = $${params.length}`; }
  try {
    const result = await query(
      `SELECT id, title, client_name, file_name, parsed_summary, due_date, bid_id, status, received_at, notes, created_at
         FROM bd_rfps ${where}
         ORDER BY received_at DESC`,
      params
    );
    res.json({ rfps: result.rows });
  } catch (err) {
    console.error('BD rfps list error:', err);
    res.status(500).json({ error: 'Failed to fetch RFPs' });
  }
});

router.get('/rfps/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(`SELECT * FROM bd_rfps WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'RFP not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('BD rfp get error:', err);
    res.status(500).json({ error: 'Failed to fetch RFP' });
  }
});

// POST /rfps — upload RFP file, extract text, AI summarize (all in one flow)
router.post('/rfps', requireAuth, rfpUpload.single('file'), async (req: Request, res: Response) => {
  const userId = uidFromReq(req);
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : req.file.originalname;
  const clientName = typeof req.body?.client_name === 'string' ? req.body.client_name : null;

  try {
    // Extract text synchronously so the response includes parsed_summary.
    const parsedText = await extractText(req.file.path, req.file.mimetype);

    // AI summary — best-effort, non-fatal.
    let parsedSummary = '';
    if (parsedText && parsedText.length > 100) {
      try {
        const aiResp = await anthropic.messages.create({
          model: MODEL_FOR.bidDraft,
          max_tokens: 500,
          system: 'You summarize RFPs (request for proposal documents) for a healthcare staffing team. 3-5 sentences. Capture: client/issuer, scope of work, location, start/end dates, headcount or shift volume, deadlines, must-have requirements. No markdown.',
          messages: [{ role: 'user', content: parsedText }],
        });
        parsedSummary = ((aiResp.content[0] as { type: string; text: string }).text ?? '').trim();
      } catch (err) { console.warn('[bd] rfp summary AI failed:', err); }
    }

    const filePath = path.relative(process.cwd(), req.file.path);
    const result = await query(
      `INSERT INTO bd_rfps (title, client_name, file_path, file_name, parsed_text, parsed_summary, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, clientName, filePath, req.file.originalname, parsedText, parsedSummary, userId]
    );
    await logAudit(null, userId, 'bd_rfp.upload', result.rows[0].id as string, { filename: req.file.originalname }, (req.ip ?? 'unknown'));
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('BD rfp upload error:', err);
    res.status(500).json({ error: 'Failed to upload RFP' });
  }
});

router.put('/rfps/:id', requireAuth, async (req: Request, res: Response) => {
  const parse = rfpUpdateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const keys = Object.keys(d);
  if (keys.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map(k => (d as Record<string, unknown>)[k] ?? null);
  try {
    const result = await query(
      `UPDATE bd_rfps SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...vals]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'RFP not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('BD rfp update error:', err);
    res.status(500).json({ error: 'Failed to update RFP' });
  }
});

router.delete('/rfps/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(`DELETE FROM bd_rfps WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'RFP not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('BD rfp delete error:', err);
    res.status(500).json({ error: 'Failed to delete RFP' });
  }
});

// POST /rfps/:id/draft-bid — drafts a bid from an RFP using its parsed
// text as AI context, creates the bid, and backlinks the RFP.
router.post('/rfps/:id/draft-bid', requireAuth, async (req: Request, res: Response) => {
  const userId = uidFromReq(req);
  try {
    const rfpRes = await query(`SELECT * FROM bd_rfps WHERE id = $1`, [req.params.id]);
    if (rfpRes.rows.length === 0) { res.status(404).json({ error: 'RFP not found' }); return; }
    const rfp = rfpRes.rows[0] as { id: string; title: string; client_name: string | null; parsed_text: string; parsed_summary: string; due_date: string | null };
    const context = rfp.parsed_text || rfp.parsed_summary || rfp.title || '';
    if (!context || context.length < 10) { res.status(400).json({ error: 'RFP has no extractable context to draft from.' }); return; }

    // AI draft (reuses the same prompt as /bids/ai-draft but inlined)
    const aiResp = await anthropic.messages.create({
      model: MODEL_FOR.bidDraft,
      max_tokens: 2048,
      system: `You help a healthcare staffing BD team draft bids. Given an RFP's context, return a short bid title, a tailored checklist (5-10 items), and concise notes. Return ONLY this JSON — no markdown fences: { "title":"…","notes":"…","checklist":[{"label":"…","required":true|false}] }. Checklist items should be actionable. Do not fabricate numbers or names.`,
      messages: [{ role: 'user', content: (rfp.client_name ? `Client: ${rfp.client_name}\n\n` : '') + context.slice(0, 20000) }],
    });
    const raw = (aiResp.content[0] as { type: string; text: string }).text;
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = cleaned.indexOf('{'); const last = cleaned.lastIndexOf('}');
    const jsonStr = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
    let parsed: { title?: string; notes?: string; checklist?: { label: string; required?: boolean }[] };
    try { parsed = JSON.parse(jsonStr); } catch { res.status(502).json({ error: 'AI returned malformed JSON.' }); return; }
    if (!parsed.title || !Array.isArray(parsed.checklist)) { res.status(502).json({ error: 'AI response missing title or checklist.' }); return; }

    // Create the bid
    const bidRes = await query(
      `INSERT INTO bd_bids (title, client_name, due_date, status, notes, assigned_to, created_by)
       VALUES ($1,$2,$3,'draft',$4,$5,$6) RETURNING *`,
      [parsed.title, rfp.client_name, rfp.due_date, parsed.notes ?? '', userId, userId]
    );
    const bid = bidRes.rows[0] as { id: string };
    // Seed checklist
    const items = parsed.checklist;
    for (let i = 0; i < items.length; i++) {
      await query(
        `INSERT INTO bd_bid_checklist_items (bid_id, label, required, order_index) VALUES ($1,$2,$3,$4)`,
        [bid.id, items[i].label, items[i].required !== false, i]
      );
    }
    // Backlink
    await query(`UPDATE bd_rfps SET bid_id = $1, status = 'drafted', updated_at = NOW() WHERE id = $2`, [bid.id, rfp.id]);
    res.status(201).json({ bid, rfp_id: rfp.id });
  } catch (err: any) {
    console.error('BD rfp draft-bid error:', err);
    if (err?.status === 429) { res.status(429).json({ error: 'AI is busy. Please retry.' }); return; }
    if (err?.status === 529) { res.status(503).json({ error: 'Claude is over capacity. Retry in ~30s.', retry_after_seconds: 30 }); return; }
    res.status(500).json({ error: `Failed to draft bid: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  4.4  REVENUE FORECAST  —  /forecast
// ═══════════════════════════════════════════════════════════════════════════
//
// Simple weighted pipeline math. Each open bid contributes
//   expected = estimated_value × win_probability
// where win_probability depends on status:
//   draft       → 10%
//   in_progress → 30%
//   submitted   → 55%
// Historical win rate adjusts the baseline if we have data.
// Projections are grouped by due_date month.

router.get('/forecast', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Baseline probabilities, nudged by historical win rate.
    const histRes = await query(`
      SELECT COUNT(*) FILTER (WHERE status = 'won')::int AS won,
             COUNT(*) FILTER (WHERE status = 'lost')::int AS lost
        FROM bd_bids
    `);
    const won = (histRes.rows[0].won as number) ?? 0;
    const lost = (histRes.rows[0].lost as number) ?? 0;
    const decided = won + lost;
    const baseWinRate = decided >= 5 ? won / decided : 0.30;  // default 30% if no history

    // Scale the three status probabilities proportionally so submitted
    // is still the highest but all three track real history.
    const probs = {
      draft:       Math.min(0.5, baseWinRate * 0.35),
      in_progress: Math.min(0.7, baseWinRate * 1.0),
      submitted:   Math.min(0.9, baseWinRate * 1.8 + 0.1),
    };

    // NOTE: TO_CHAR forces due_date to a string ('YYYY-MM') in SQL so we
    // don't have to worry about the pg driver returning DATE as a Date
    // object (which would make `.slice(0, 7)` a runtime error — the
    // forecast endpoint used to 500 on any non-null due_date because of
    // this).
    const bidsRes = await query(`
      SELECT id, title, status,
             TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date,
             TO_CHAR(due_date, 'YYYY-MM')     AS due_month,
             estimated_value
        FROM bd_bids
       WHERE status IN ('draft','in_progress','submitted')
         AND estimated_value IS NOT NULL
       ORDER BY due_date NULLS LAST
    `);

    interface BidRow { id: string; title: string; status: 'draft'|'in_progress'|'submitted'; due_date: string | null; due_month: string | null; estimated_value: number }
    const rows = bidsRes.rows as unknown as BidRow[];

    // Per-month rollup
    const byMonth: Record<string, { month: string; weighted_value: number; gross_value: number; bid_count: number }> = {};
    const perBid = rows.map(b => {
      const p = probs[b.status] ?? 0.25;
      const weighted = Number(b.estimated_value) * p;
      const monthKey = b.due_month ?? 'Unscheduled';
      if (!byMonth[monthKey]) byMonth[monthKey] = { month: monthKey, weighted_value: 0, gross_value: 0, bid_count: 0 };
      byMonth[monthKey].weighted_value += weighted;
      byMonth[monthKey].gross_value    += Number(b.estimated_value);
      byMonth[monthKey].bid_count      += 1;
      return { id: b.id, title: b.title, status: b.status, due_date: b.due_date, gross: Number(b.estimated_value), weighted, probability: p };
    });

    const months = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
    const totalWeighted = perBid.reduce((s, b) => s + b.weighted, 0);
    const totalGross    = perBid.reduce((s, b) => s + b.gross, 0);

    res.json({
      baseline_win_rate: Number((baseWinRate * 100).toFixed(1)),
      history: { won, lost, decided_total: decided },
      probabilities: {
        draft: Number((probs.draft * 100).toFixed(1)),
        in_progress: Number((probs.in_progress * 100).toFixed(1)),
        submitted: Number((probs.submitted * 100).toFixed(1)),
      },
      total_gross_open: Number(totalGross.toFixed(2)),
      total_weighted_projection: Number(totalWeighted.toFixed(2)),
      by_month: months,
      by_bid: perBid,
    });
  } catch (err) {
    console.error('BD forecast error:', err);
    res.status(500).json({ error: 'Failed to compute forecast' });
  }
});

export default router;
