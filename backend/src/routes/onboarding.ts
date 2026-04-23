import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';

const router = Router();

const onboardingItemSchema = z.object({
  staff_id: z.string().uuid(),
  item_name: z.string().min(1).max(255),
  category: z.string().max(100).optional().nullable(),
  status: z.enum(['pending', 'in_progress', 'completed', 'missing']).optional().default('pending'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const onboardingUpdateSchema = onboardingItemSchema.partial().omit({ staff_id: true });

// GET /?staffId= - list onboarding items for staff
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { staffId, status } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (staffId) {
    conditions.push(`o.staff_id = $${paramIndex++}`);
    params.push(staffId);
  }
  if (status) {
    conditions.push(`o.status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT o.*,
              s.first_name, s.last_name
       FROM onboarding_items o
       JOIN staff s ON o.staff_id = s.id
       ${whereClause}
       ORDER BY o.due_date ASC NULLS LAST, o.category ASC`,
      params
    );

    res.json({ items: result.rows });
  } catch (err) {
    console.error('Onboarding list error:', err);
    res.status(500).json({ error: 'Failed to fetch onboarding items' });
  }
});

// GET /summary - onboarding progress by staff member
router.get('/summary', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
         s.id AS staff_id,
         s.first_name,
         s.last_name,
         s.status AS staff_status,
         COUNT(o.id) AS total_items,
         COUNT(o.id) FILTER (WHERE o.status = 'completed') AS completed_items,
         COUNT(o.id) FILTER (WHERE o.status = 'missing') AS missing_items,
         COUNT(o.id) FILTER (WHERE o.status = 'pending') AS pending_items,
         ROUND(
           COUNT(o.id) FILTER (WHERE o.status = 'completed')::DECIMAL /
           NULLIF(COUNT(o.id), 0) * 100
         , 0) AS completion_pct
       FROM staff s
       LEFT JOIN onboarding_items o ON o.staff_id = s.id
       WHERE s.status = 'onboarding'
       GROUP BY s.id, s.first_name, s.last_name, s.status
       ORDER BY completion_pct DESC NULLS LAST`
    );

    res.json({ summary: result.rows });
  } catch (err) {
    console.error('Onboarding summary error:', err);
    res.status(500).json({ error: 'Failed to fetch onboarding summary' });
  }
});

// POST / - create onboarding item
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = onboardingItemSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  try {
    const result = await query(
      `INSERT INTO onboarding_items (staff_id, item_name, category, status, due_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.staff_id, data.item_name, data.category, data.status, data.due_date, data.notes]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'onboarding.create',
      result.rows[0].id as string,
      { staffId: data.staff_id, item: data.item_name },
      (req.ip ?? 'unknown')
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Onboarding create error:', err);
    res.status(500).json({ error: 'Failed to create onboarding item' });
  }
});

// PUT /:id - update item status
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = onboardingUpdateSchema.safeParse(req.body);
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

  const extraSets: string[] = [];
  if (data.status === 'completed') {
    extraSets.push('completed_at = NOW()');
  }

  const setClause = [
    ...fields.map((key, i) => `${key} = $${i + 2}`),
    ...extraSets,
  ].join(', ');
  const values = fields.map((key) => data[key as keyof typeof data]);

  try {
    const result = await query(
      `UPDATE onboarding_items SET ${setClause} WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Onboarding item not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'onboarding.update', id, { fields }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Onboarding update error:', err);
    res.status(500).json({ error: 'Failed to update onboarding item' });
  }
});

export default router;
