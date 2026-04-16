import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';

const router = Router();

const facilitySchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().max(100).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  contact_name: z.string().max(255).optional().nullable(),
  contact_email: z.string().email().optional().nullable(),
  contact_phone: z.string().max(30).optional().nullable(),
  contract_status: z
    .enum(['active', 'renewing', 'expired', 'pending'])
    .optional()
    .default('pending'),
  special_requirements: z.record(z.unknown()).optional().default({}),
  notes: z.string().max(5000).optional().nullable(),
});

const facilityUpdateSchema = facilitySchema.partial();

// GET / - list facilities
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { contract_status, search } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (contract_status) {
    conditions.push(`f.contract_status = $${paramIndex++}`);
    params.push(contract_status);
  }
  if (search) {
    conditions.push(
      `(f.name ILIKE $${paramIndex} OR f.contact_name ILIKE $${paramIndex} OR f.address ILIKE $${paramIndex})`
    );
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT f.*,
              COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active') AS active_placements,
              COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'active') AS active_staff
       FROM facilities f
       LEFT JOIN placements p ON p.facility_id = f.id
       LEFT JOIN staff s ON s.facility_id = f.id
       ${whereClause}
       GROUP BY f.id
       ORDER BY f.name ASC`,
      params
    );

    res.json({ facilities: result.rows });
  } catch (err) {
    console.error('Facilities list error:', err);
    res.status(500).json({ error: 'Failed to fetch facilities' });
  }
});

// GET /:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const facilityResult = await query('SELECT * FROM facilities WHERE id = $1', [id]);

    if (facilityResult.rows.length === 0) {
      res.status(404).json({ error: 'Facility not found' });
      return;
    }

    const placementsResult = await query(
      `SELECT p.*, s.first_name, s.last_name, s.role AS staff_role
       FROM placements p
       LEFT JOIN staff s ON p.staff_id = s.id
       WHERE p.facility_id = $1
       ORDER BY p.created_at DESC LIMIT 20`,
      [id]
    );

    res.json({
      ...facilityResult.rows[0],
      placements: placementsResult.rows,
    });
  } catch (err) {
    console.error('Facility get error:', err);
    res.status(500).json({ error: 'Failed to fetch facility' });
  }
});

// POST / - create facility
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = facilitySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  try {
    const result = await query(
      `INSERT INTO facilities
         (name, type, address, contact_name, contact_email, contact_phone, contract_status, special_requirements, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.name,
        data.type,
        data.address,
        data.contact_name,
        data.contact_email,
        data.contact_phone,
        data.contract_status,
        JSON.stringify(data.special_requirements ?? {}),
        data.notes,
      ]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'facility.create',
      result.rows[0].id as string,
      { name: data.name },
      (req.ip ?? 'unknown')
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Facility create error:', err);
    res.status(500).json({ error: 'Failed to create facility' });
  }
});

// PUT /:id - update facility
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = facilityUpdateSchema.safeParse(req.body);
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
  const values = fields.map((key) => {
    const val = data[key as keyof typeof data];
    if (key === 'special_requirements' && val) return JSON.stringify(val);
    return val;
  });

  try {
    const result = await query(
      `UPDATE facilities SET ${setClause} WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Facility not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'facility.update', id, { fields }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Facility update error:', err);
    res.status(500).json({ error: 'Failed to update facility' });
  }
});

// DELETE /:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    // Soft delete by setting contract_status to 'expired'
    const result = await query(
      `UPDATE facilities SET contract_status = 'expired' WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Facility not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'facility.deactivate', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true });
  } catch (err) {
    console.error('Facility delete error:', err);
    res.status(500).json({ error: 'Failed to deactivate facility' });
  }
});

export default router;
