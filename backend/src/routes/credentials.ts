import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';

const router = Router();

const credentialSchema = z.object({
  staff_id: z.string().uuid(),
  type: z.string().min(1).max(100),
  issuer: z.string().max(255).optional().nullable(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z
    .enum(['valid', 'expiring', 'expiring_soon', 'expired', 'pending', 'missing'])
    .optional()
    .default('valid'),
  document_url: z.string().url().optional().nullable(),
});

const credentialUpdateSchema = credentialSchema.partial().omit({ staff_id: true });

// GET /?staffId= - list credentials for staff member
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { staffId, status } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (staffId) {
    conditions.push(`c.staff_id = $${paramIndex++}`);
    params.push(staffId);
  }
  if (status) {
    conditions.push(`c.status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT c.*,
              s.first_name, s.last_name
       FROM credentials c
       JOIN staff s ON c.staff_id = s.id
       ${whereClause}
       ORDER BY c.expiry_date ASC NULLS LAST`,
      params
    );

    res.json({ credentials: result.rows });
  } catch (err) {
    console.error('Credentials list error:', err);
    res.status(500).json({ error: 'Failed to fetch credentials' });
  }
});

// GET /expiring - credentials expiring within 30 days
router.get('/expiring', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT c.*,
              s.first_name, s.last_name, s.email, s.phone,
              f.name AS facility_name
       FROM credentials c
       JOIN staff s ON c.staff_id = s.id
       LEFT JOIN facilities f ON s.facility_id = f.id
       WHERE c.expiry_date IS NOT NULL
         AND c.expiry_date <= NOW() + INTERVAL '30 days'
         AND c.expiry_date >= NOW()
         AND s.status NOT IN ('inactive', 'terminated')
       ORDER BY c.expiry_date ASC`
    );

    // Also get expired
    const expiredResult = await query(
      `SELECT c.*,
              s.first_name, s.last_name
       FROM credentials c
       JOIN staff s ON c.staff_id = s.id
       WHERE c.expiry_date < NOW()
         AND c.status != 'expired'
         AND s.status NOT IN ('inactive', 'terminated')
       ORDER BY c.expiry_date ASC`
    );

    res.json({
      expiringSoon: result.rows,
      alreadyExpired: expiredResult.rows,
    });
  } catch (err) {
    console.error('Expiring credentials error:', err);
    res.status(500).json({ error: 'Failed to fetch expiring credentials' });
  }
});

// GET /:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT c.*, s.first_name, s.last_name FROM credentials c
       JOIN staff s ON c.staff_id = s.id WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Credential get error:', err);
    res.status(500).json({ error: 'Failed to fetch credential' });
  }
});

// POST / - add credential
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = credentialSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  // Auto-calculate status based on dates
  let computedStatus = data.status;
  if (data.expiry_date) {
    const expiry = new Date(data.expiry_date);
    const now = new Date();
    const daysUntilExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry < 0) computedStatus = 'expired';
    else if (daysUntilExpiry <= 30) computedStatus = 'expiring';
  }

  try {
    const result = await query(
      `INSERT INTO credentials (staff_id, type, issuer, issue_date, expiry_date, status, document_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.staff_id,
        data.type,
        data.issuer,
        data.issue_date,
        data.expiry_date,
        computedStatus,
        data.document_url,
      ]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'credential.add',
      result.rows[0].id as string,
      { staffId: data.staff_id, type: data.type },
      (req.ip ?? 'unknown')
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Credential create error:', err);
    res.status(500).json({ error: 'Failed to create credential' });
  }
});

// PUT /:id - update credential
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = credentialUpdateSchema.safeParse(req.body);
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
      `UPDATE credentials SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'credential.update', id, { fields }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Credential update error:', err);
    res.status(500).json({ error: 'Failed to update credential' });
  }
});

export default router;
