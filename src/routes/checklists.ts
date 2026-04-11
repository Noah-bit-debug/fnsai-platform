import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';

const router = Router();

const checklistItemSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().max(100).optional(),
  required: z.boolean().optional().default(true),
  description: z.string().max(1000).optional(),
});

const templateSchema = z.object({
  name: z.string().min(1).max(255),
  facility_id: z.string().uuid().optional().nullable(),
  items: z.array(checklistItemSchema).default([]),
});

const templateUpdateSchema = templateSchema.partial();

// GET /templates - list templates
router.get('/templates', requireAuth, async (req: Request, res: Response) => {
  const { facility_id } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (facility_id) {
    conditions.push(`(ct.facility_id = $${paramIndex++} OR ct.facility_id IS NULL)`);
    params.push(facility_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT ct.*,
              f.name AS facility_name,
              json_array_length(ct.items::json) AS item_count
       FROM checklist_templates ct
       LEFT JOIN facilities f ON ct.facility_id = f.id
       ${whereClause}
       ORDER BY ct.name ASC`,
      params
    );

    res.json({ templates: result.rows });
  } catch (err) {
    console.error('Checklists list error:', err);
    res.status(500).json({ error: 'Failed to fetch checklist templates' });
  }
});

// POST /templates - create template
router.post('/templates', requireAuth, async (req: Request, res: Response) => {
  const parse = templateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  try {
    const result = await query(
      `INSERT INTO checklist_templates (name, facility_id, items)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.name, data.facility_id ?? null, JSON.stringify(data.items)]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'checklist.create',
      result.rows[0].id as string,
      { name: data.name },
      req.ip
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Checklist create error:', err);
    res.status(500).json({ error: 'Failed to create checklist template' });
  }
});

// GET /templates/:id
router.get('/templates/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT ct.*, f.name AS facility_name
       FROM checklist_templates ct
       LEFT JOIN facilities f ON ct.facility_id = f.id
       WHERE ct.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Checklist template not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Checklist get error:', err);
    res.status(500).json({ error: 'Failed to fetch checklist template' });
  }
});

// PUT /templates/:id
router.put('/templates/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = templateUpdateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  const updates: string[] = [];
  const values: unknown[] = [id];
  let paramIndex = 2;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(data.name);
  }
  if (data.facility_id !== undefined) {
    updates.push(`facility_id = $${paramIndex++}`);
    values.push(data.facility_id);
  }
  if (data.items !== undefined) {
    updates.push(`items = $${paramIndex++}`);
    values.push(JSON.stringify(data.items));
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  try {
    const result = await query(
      `UPDATE checklist_templates SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Checklist template not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'checklist.update', id, {}, req.ip);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Checklist update error:', err);
    res.status(500).json({ error: 'Failed to update checklist template' });
  }
});

export default router;
