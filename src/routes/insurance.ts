import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';

const router = Router();

const insuranceSchema = z.object({
  type: z.enum(['workers_comp', 'professional_liability', 'epli', 'general_liability', 'other']),
  provider: z.string().max(255).optional().nullable(),
  policy_number: z.string().max(100).optional().nullable(),
  annual_premium: z.number().positive().optional().nullable(),
  coverage_limit: z.string().max(100).optional().nullable(),
  status: z
    .enum(['quote_needed', 'quote_received', 'applied', 'active', 'expired'])
    .optional()
    .default('quote_needed'),
  renewal_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

const insuranceUpdateSchema = insuranceSchema.partial();

// GET / - list insurance policies
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM insurance_policies ORDER BY type ASC, created_at DESC`
    );

    res.json({ policies: result.rows });
  } catch (err) {
    console.error('Insurance list error:', err);
    res.status(500).json({ error: 'Failed to fetch insurance policies' });
  }
});

// GET /:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await query('SELECT * FROM insurance_policies WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Insurance policy not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Insurance get error:', err);
    res.status(500).json({ error: 'Failed to fetch insurance policy' });
  }
});

// POST / - create policy
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = insuranceSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  try {
    const result = await query(
      `INSERT INTO insurance_policies
         (type, provider, policy_number, annual_premium, coverage_limit, status, renewal_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.type,
        data.provider,
        data.policy_number,
        data.annual_premium,
        data.coverage_limit,
        data.status,
        data.renewal_date,
        data.notes,
      ]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'insurance.create',
      result.rows[0].id as string,
      { type: data.type },
      req.ip
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Insurance create error:', err);
    res.status(500).json({ error: 'Failed to create insurance policy' });
  }
});

// PUT /:id - update policy
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = insuranceUpdateSchema.safeParse(req.body);
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
      `UPDATE insurance_policies SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Insurance policy not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'insurance.update', id, { fields }, req.ip);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Insurance update error:', err);
    res.status(500).json({ error: 'Failed to update insurance policy' });
  }
});

// DELETE /:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      'DELETE FROM insurance_policies WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Insurance policy not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'insurance.delete', id, {}, req.ip);
    res.json({ success: true });
  } catch (err) {
    console.error('Insurance delete error:', err);
    res.status(500).json({ error: 'Failed to delete insurance policy' });
  }
});

export default router;
