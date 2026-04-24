/**
 * Phase 4.4 — Workforce Scheduling
 *
 * Shift CRUD. Shifts live at the (staff × facility × time-window) level.
 * Mounted at /api/v1/scheduling.
 *
 * Query conventions:
 *   * GET /shifts?staff_id=…          — all shifts for one staffer
 *   * GET /shifts?facility_id=…       — all shifts at one facility
 *   * GET /shifts?from=…&to=…         — date-range filter (inclusive)
 *   * GET /shifts?status=scheduled    — single-status filter
 * Filters combine with AND.
 *
 * The calendar view on the frontend uses from/to. A week-view requests
 * e.g. ?from=2026-04-20T00:00&to=2026-04-27T00:00.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';

const router = Router();
const uid = (req: Request): string => getAuth(req)?.userId ?? 'unknown';

const shiftSchema = z.object({
  staff_id: z.string().uuid(),
  facility_id: z.string().uuid().optional().nullable(),
  role: z.string().max(50).optional().nullable(),
  start_time: z.string(),
  end_time: z.string(),
  hourly_rate: z.number().nonnegative().optional().nullable(),
  status: z.enum(['scheduled','confirmed','completed','cancelled','no_show']).optional().default('scheduled'),
  notes: z.string().max(5000).optional().nullable(),
});
const shiftUpdate = shiftSchema.partial();

// GET /shifts — list w/ filters
router.get('/shifts', requireAuth, async (req: Request, res: Response) => {
  const { staff_id, facility_id, status, from, to } = req.query;
  const conds: string[] = [];
  const params: unknown[] = [];
  const push = (clause: string, val: unknown) => { params.push(val); conds.push(clause.replace('?', `$${params.length}`)); };

  if (typeof staff_id === 'string')    push('s.staff_id = ?', staff_id);
  if (typeof facility_id === 'string') push('s.facility_id = ?', facility_id);
  if (typeof status === 'string')      push('s.status = ?', status);
  if (typeof from === 'string')        push('s.end_time >= ?', from);
  if (typeof to === 'string')          push('s.start_time < ?', to);

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT s.*,
              st.first_name, st.last_name, st.role AS staff_role,
              f.name AS facility_name
         FROM work_shifts s
         LEFT JOIN staff st ON s.staff_id = st.id
         LEFT JOIN facilities f ON s.facility_id = f.id
         ${where}
         ORDER BY s.start_time ASC`,
      params
    );
    res.json({ shifts: result.rows });
  } catch (err) {
    console.error('Scheduling list error:', err);
    res.status(500).json({ error: 'Failed to fetch shifts' });
  }
});

// GET /shifts/:id
router.get('/shifts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT s.*, st.first_name, st.last_name, f.name AS facility_name
         FROM work_shifts s
         LEFT JOIN staff st ON s.staff_id = st.id
         LEFT JOIN facilities f ON s.facility_id = f.id
         WHERE s.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Shift not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Scheduling get error:', err);
    res.status(500).json({ error: 'Failed to fetch shift' });
  }
});

// POST /shifts — create
router.post('/shifts', requireAuth, async (req: Request, res: Response) => {
  const parse = shiftSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  if (new Date(d.end_time) <= new Date(d.start_time)) {
    res.status(400).json({ error: 'end_time must be after start_time' }); return;
  }
  try {
    const result = await query(
      `INSERT INTO work_shifts (staff_id, facility_id, role, start_time, end_time, hourly_rate, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [d.staff_id, d.facility_id ?? null, d.role ?? null, d.start_time, d.end_time, d.hourly_rate ?? null, d.status, d.notes ?? null, uid(req)]
    );
    await logAudit(null, uid(req), 'shift.create', result.rows[0].id as string, { staff_id: d.staff_id }, (req.ip ?? 'unknown'));
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Scheduling create error:', err);
    res.status(500).json({ error: 'Failed to create shift' });
  }
});

// PUT /shifts/:id
router.put('/shifts/:id', requireAuth, async (req: Request, res: Response) => {
  const parse = shiftUpdate.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const keys = Object.keys(d);
  if (keys.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map(k => (d as Record<string, unknown>)[k] ?? null);
  try {
    const result = await query(
      `UPDATE work_shifts SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...vals]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Shift not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Scheduling update error:', err);
    res.status(500).json({ error: 'Failed to update shift' });
  }
});

// DELETE /shifts/:id
router.delete('/shifts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(`DELETE FROM work_shifts WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Shift not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Scheduling delete error:', err);
    res.status(500).json({ error: 'Failed to delete shift' });
  }
});

// GET /coverage — count of scheduled shifts per day across a range. Used
// by the week-view header to show at-a-glance coverage numbers.
router.get('/coverage', requireAuth, async (req: Request, res: Response) => {
  const { from, to, facility_id } = req.query;
  if (typeof from !== 'string' || typeof to !== 'string') {
    res.status(400).json({ error: 'from and to query params required (ISO strings)' });
    return;
  }
  const params: unknown[] = [from, to];
  let facilityClause = '';
  if (typeof facility_id === 'string') { params.push(facility_id); facilityClause = ` AND facility_id = $${params.length}`; }
  try {
    const result = await query(
      `SELECT DATE(start_time) AS day,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
              COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show
         FROM work_shifts
         WHERE start_time >= $1 AND start_time < $2 ${facilityClause}
         GROUP BY DATE(start_time)
         ORDER BY day ASC`,
      params
    );
    res.json({ coverage: result.rows });
  } catch (err) {
    console.error('Scheduling coverage error:', err);
    res.status(500).json({ error: 'Failed to compute coverage' });
  }
});

export default router;
