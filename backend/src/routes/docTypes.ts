import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';

/**
 * Phase 2.2 â€” Admin-defined document types.
 *
 * CRUD over doc_types so admins can add/edit/remove document types that the
 * AI document reviewer recognizes. When a recruiter uploads a new type on a
 * candidate's credentialing tab, the AI picks up the custom hints here and
 * reviews the doc against the admin-defined rules.
 *
 * Read: any authenticated user (they need the list to populate the doc type
 *       picker when adding a credential to a candidate).
 * Write: admin/ceo only â€” these rules drive company-wide compliance review.
 */

const router = Router();

const docTypeSchema = z.object({
  key: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'lowercase letters, digits, underscores only'),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  prompt_hints: z.string().min(1).max(4000),
  issuing_bodies: z.array(z.string().max(200)).optional().default([]),
  expires_months: z.number().int().min(0).max(600).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  required_fields: z.array(z.string().max(100)).optional().default([]),
  applicable_roles: z.array(z.string().max(50)).optional().default([]),
  active: z.boolean().optional(),
});

// GET / â€” list all doc types. Any auth'd user â€” frontend picker needs this.
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { active, category } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  // Default to active=true unless explicitly asked for all
  if (active === 'all') { /* no filter */ }
  else if (active === 'false') { conditions.push(`active = FALSE`); }
  else { conditions.push(`active = TRUE`); }
  if (category) { conditions.push(`category = $${idx++}`); params.push(category); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const result = await query(
      `SELECT * FROM doc_types ${where} ORDER BY category NULLS LAST, label ASC`,
      params
    );
    res.json({ doc_types: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ doc_types: [] }); return; }
    console.error('doc_types list error:', err);
    res.status(500).json({ error: `Failed to fetch doc types: ${err.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// GET /:key â€” single type by key (used by the reviewer service)
router.get('/:key', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(`SELECT * FROM doc_types WHERE key = $1`, [req.params.key]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Doc type not found' }); return; }
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('doc_types get error:', err);
    res.status(500).json({ error: `Failed to fetch doc type: ${err.message?.slice(0, 200)}` });
  }
});

// POST / â€” admin creates new doc type
router.post('/', requireAuth, requirePermission('admin_manage'), async (req: Request, res: Response) => {
  const parsed = docTypeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const auth = getAuth(req);
  try {
    const result = await query(
      `INSERT INTO doc_types
         (key, label, description, prompt_hints, issuing_bodies, expires_months,
          category, required_fields, applicable_roles, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        d.key, d.label, d.description ?? null, d.prompt_hints,
        d.issuing_bodies ?? [], d.expires_months ?? null,
        d.category ?? null, d.required_fields ?? [], d.applicable_roles ?? [],
        d.active ?? true, auth?.userId ?? null,
      ]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'doc_type.create', result.rows[0].id as string,
      { key: d.key, label: d.label }, req.ip ?? 'unknown');
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: `Doc type key "${d.key}" already exists.` });
      return;
    }
    console.error('doc_types create error:', err);
    res.status(500).json({ error: `Failed to create doc type: ${err.message?.slice(0, 200)}` });
  }
});

// PUT /:id â€” update
router.put('/:id', requireAuth, requirePermission('admin_manage'), async (req: Request, res: Response) => {
  const parsed = docTypeSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() }); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values: unknown[] = [req.params.id, ...entries.map(([, v]) => v)];
  const auth = getAuth(req);
  try {
    const result = await query(
      `UPDATE doc_types SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Doc type not found' }); return; }
    await logAudit(null, auth?.userId ?? 'unknown', 'doc_type.update', req.params.id,
      { fields: entries.map(([k]) => k) }, req.ip ?? 'unknown');
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('doc_types update error:', err);
    res.status(500).json({ error: `Failed to update doc type: ${err.message?.slice(0, 200)}` });
  }
});

// DELETE /:id â€” soft-delete by flipping active=false. Avoids orphaning
// existing candidate_documents that reference this type's key.
router.delete('/:id', requireAuth, requirePermission('admin_manage'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  try {
    const result = await query(
      `UPDATE doc_types SET active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id, key`,
      [req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Doc type not found' }); return; }
    await logAudit(null, auth?.userId ?? 'unknown', 'doc_type.deactivate', req.params.id,
      { key: result.rows[0].key }, req.ip ?? 'unknown');
    res.json({ success: true });
  } catch (err: any) {
    console.error('doc_types delete error:', err);
    res.status(500).json({ error: `Failed to deactivate doc type: ${err.message?.slice(0, 200)}` });
  }
});

export default router;
