import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';

const router = Router();

const staffSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  role: z.enum(['RN', 'LPN', 'LVN', 'CNA', 'RT', 'NP', 'PA', 'Other']).optional().nullable(),
  specialty: z.string().max(100).optional().nullable(),
  status: z
    .enum(['active', 'available', 'onboarding', 'inactive', 'terminated'])
    .optional()
    .default('onboarding'),
  facility_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

const staffUpdateSchema = staffSchema.partial();

// GET / - list all staff
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { status, role, search, limit = '100', offset = '0' } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`s.status = $${paramIndex++}`);
    params.push(status);
  }
  if (role) {
    conditions.push(`s.role = $${paramIndex++}`);
    params.push(role);
  }
  if (search) {
    conditions.push(
      `(s.first_name ILIKE $${paramIndex} OR s.last_name ILIKE $${paramIndex} OR s.email ILIKE $${paramIndex})`
    );
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT s.*,
              f.name AS facility_name,
              COUNT(c.id) FILTER (WHERE c.status = 'expiring' OR c.status = 'expired') AS expiring_credentials
       FROM staff s
       LEFT JOIN facilities f ON s.facility_id = f.id
       LEFT JOIN credentials c ON c.staff_id = s.id
       ${whereClause}
       GROUP BY s.id, f.name
       ORDER BY s.last_name ASC, s.first_name ASC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, Number(limit), Number(offset)]
    );

    const countResult = await query(`SELECT COUNT(*) FROM staff s ${whereClause}`, params);

    res.json({
      staff: result.rows,
      total: Number(countResult.rows[0].count),
    });
  } catch (err) {
    console.error('Staff list error:', err);
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
});

// GET /:id - get staff by id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const staffResult = await query(
      `SELECT s.*, f.name AS facility_name
       FROM staff s
       LEFT JOIN facilities f ON s.facility_id = f.id
       WHERE s.id = $1`,
      [id]
    );

    if (staffResult.rows.length === 0) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    const credentialsResult = await query(
      'SELECT * FROM credentials WHERE staff_id = $1 ORDER BY expiry_date ASC',
      [id]
    );

    const placementsResult = await query(
      `SELECT p.*, f.name AS facility_name
       FROM placements p
       JOIN facilities f ON p.facility_id = f.id
       WHERE p.staff_id = $1
       ORDER BY p.created_at DESC LIMIT 10`,
      [id]
    );

    const onboardingResult = await query(
      'SELECT * FROM onboarding_items WHERE staff_id = $1 ORDER BY created_at ASC',
      [id]
    );

    res.json({
      ...staffResult.rows[0],
      credentials: credentialsResult.rows,
      placements: placementsResult.rows,
      onboarding: onboardingResult.rows,
    });
  } catch (err) {
    console.error('Staff get error:', err);
    res.status(500).json({ error: 'Failed to fetch staff member' });
  }
});

// POST / - create staff
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = staffSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  try {
    const result = await query(
      `INSERT INTO staff (first_name, last_name, email, phone, role, specialty, status, facility_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.first_name,
        data.last_name,
        data.email,
        data.phone,
        data.role,
        data.specialty,
        data.status,
        data.facility_id,
        data.notes,
      ]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'staff.create',
      `${data.first_name} ${data.last_name}`,
      { staffId: result.rows[0].id },
      (req.ip ?? 'unknown')
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Staff create error:', err);
    res.status(500).json({ error: 'Failed to create staff member' });
  }
});

// PUT /:id - update staff
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = staffUpdateSchema.safeParse(req.body);
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
      `UPDATE staff SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'staff.update',
      id,
      { fields },
      (req.ip ?? 'unknown')
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Staff update error:', err);
    res.status(500).json({ error: 'Failed to update staff member' });
  }
});

// DELETE /:id - soft delete
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE staff SET status = 'inactive', updated_at = NOW() WHERE id = $1 RETURNING id, first_name, last_name`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'staff.deactivate',
      id,
      {},
      (req.ip ?? 'unknown')
    );

    res.json({ success: true, message: 'Staff member deactivated' });
  } catch (err) {
    console.error('Staff delete error:', err);
    res.status(500).json({ error: 'Failed to deactivate staff member' });
  }
});

export default router;
