import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';

const router = Router();

// Phase 4.4 QA fix — facility_id became optional to match the Incidents
// pattern (some timesheet submissions are general, not facility-bound —
// e.g. travel nurse orientation hours). DB still NOT NULL on facility_id
// historically, so we need the migration below to loosen it.
const timesheetSchema = z.object({
  staff_id: z.string().uuid(),
  facility_id: z.string().uuid().optional().nullable(),
  placement_id: z.string().uuid().optional().nullable(),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours_worked: z.number().min(0).max(168),
  notes: z.string().max(2000).optional().nullable(),
});

// GET / - list timesheets
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { status, staff_id, facility_id, week_start } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`t.status = $${paramIndex++}`);
    params.push(status);
  }
  if (staff_id) {
    conditions.push(`t.staff_id = $${paramIndex++}`);
    params.push(staff_id);
  }
  if (facility_id) {
    conditions.push(`t.facility_id = $${paramIndex++}`);
    params.push(facility_id);
  }
  if (week_start) {
    conditions.push(`t.week_start = $${paramIndex++}`);
    params.push(week_start);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT t.*,
              s.first_name, s.last_name, s.role AS staff_role,
              f.name AS facility_name
       FROM timesheets t
       JOIN staff s ON t.staff_id = s.id
       LEFT JOIN facilities f ON t.facility_id = f.id
       ${whereClause}
       ORDER BY t.week_start DESC, s.last_name ASC`,
      params
    );

    res.json({ timesheets: result.rows });
  } catch (err) {
    console.error('Timesheets list error:', err);
    res.status(500).json({ error: 'Failed to fetch timesheets' });
  }
});

// GET /:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT t.*,
              s.first_name, s.last_name, s.role AS staff_role,
              f.name AS facility_name
       FROM timesheets t
       JOIN staff s ON t.staff_id = s.id
       LEFT JOIN facilities f ON t.facility_id = f.id
       WHERE t.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Timesheet not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Timesheet get error:', err);
    res.status(500).json({ error: 'Failed to fetch timesheet' });
  }
});

// POST / - submit timesheet
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = timesheetSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  try {
    const result = await query(
      `INSERT INTO timesheets (staff_id, facility_id, placement_id, week_start, hours_worked, submitted_at, notes)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       RETURNING *`,
      [
        data.staff_id,
        data.facility_id ?? null,
        data.placement_id ?? null,
        data.week_start,
        data.hours_worked,
        data.notes ?? null,
      ]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'timesheet.submit',
      result.rows[0].id as string,
      { staffId: data.staff_id, hours: data.hours_worked, week: data.week_start },
      (req.ip ?? 'unknown')
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Timesheet create error:', err);
    res.status(500).json({ error: 'Failed to submit timesheet' });
  }
});

// POST /:id/verify - mark verified
router.post('/:id/verify', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  const { status = 'verified', notes } = req.body as { status?: string; notes?: string };

  try {
    const result = await query(
      `UPDATE timesheets
       SET status = $2, verified_at = NOW(), notes = COALESCE($3, notes)
       WHERE id = $1
       RETURNING *`,
      [id, status, notes ?? null]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Timesheet not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'timesheet.verify', id, { status }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Timesheet verify error:', err);
    res.status(500).json({ error: 'Failed to verify timesheet' });
  }
});

export default router;
