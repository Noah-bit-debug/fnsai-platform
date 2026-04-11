import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';

const router = Router();

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
      req.ip
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

    await logAudit(null, auth?.userId ?? 'unknown', 'incident.update', id, { fields }, req.ip);
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

    await logAudit(null, auth?.userId ?? 'unknown', 'incident.close', id, {}, req.ip);
    res.json({ success: true });
  } catch (err) {
    console.error('Incident close error:', err);
    res.status(500).json({ error: 'Failed to close incident' });
  }
});

export default router;
