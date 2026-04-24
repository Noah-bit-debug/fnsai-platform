/**
 * Phase 4.4 — PTO (Paid Time Off)
 *
 * Two endpoints families:
 *   /requests        — CRUD + approve/deny workflow
 *   /balances/:staffId — read / adjust balance for a staff member
 *
 * Approval workflow:
 *   PUT /requests/:id/approve  — flips status to approved + decrements
 *                                the balance of the matching type
 *   PUT /requests/:id/deny     — status to denied, optional reason
 *   PUT /requests/:id/cancel   — any state → cancelled, no balance change
 *
 * Balances can go negative (unpaid leave on top of exhausted balance).
 * That's a policy call managers can make; we surface but don't prevent.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';

const router = Router();
const uid = (req: Request): string => getAuth(req)?.userId ?? 'unknown';

// ── Balances ────────────────────────────────────────────────────────────

router.get('/balances', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT b.*, s.first_name, s.last_name, s.role
         FROM pto_balances b
         LEFT JOIN staff s ON b.staff_id = s.id
         ORDER BY s.last_name, s.first_name`
    );
    res.json({ balances: result.rows });
  } catch (err) {
    console.error('PTO balances list error:', err);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

router.get('/balances/:staffId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT b.*, s.first_name, s.last_name, s.role
         FROM pto_balances b
         RIGHT JOIN staff s ON b.staff_id = s.id
        WHERE s.id = $1`,
      [req.params.staffId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Staff not found' }); return; }
    // If no balance row exists yet, fabricate a zero balance in the response.
    const row = result.rows[0];
    if (!row.staff_id) {
      res.json({
        staff_id: req.params.staffId,
        vacation_hours: 0, sick_hours: 0, personal_hours: 0,
        first_name: row.first_name, last_name: row.last_name, role: row.role,
      });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error('PTO balance get error:', err);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

const balanceAdjustSchema = z.object({
  vacation_hours: z.number().optional(),
  sick_hours: z.number().optional(),
  personal_hours: z.number().optional(),
});

// PUT /balances/:staffId — upsert absolute balance (admin correction)
router.put('/balances/:staffId', requireAuth, async (req: Request, res: Response) => {
  const parse = balanceAdjustSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  try {
    const result = await query(
      `INSERT INTO pto_balances (staff_id, vacation_hours, sick_hours, personal_hours, updated_by)
       VALUES ($1, COALESCE($2, 0), COALESCE($3, 0), COALESCE($4, 0), $5)
       ON CONFLICT (staff_id) DO UPDATE SET
         vacation_hours = COALESCE($2, pto_balances.vacation_hours),
         sick_hours     = COALESCE($3, pto_balances.sick_hours),
         personal_hours = COALESCE($4, pto_balances.personal_hours),
         updated_by     = $5,
         updated_at     = NOW()
       RETURNING *`,
      [req.params.staffId, d.vacation_hours ?? null, d.sick_hours ?? null, d.personal_hours ?? null, uid(req)]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PTO balance update error:', err);
    res.status(500).json({ error: 'Failed to update balance' });
  }
});

// ── Requests ────────────────────────────────────────────────────────────

const requestSchema = z.object({
  staff_id: z.string().uuid(),
  type: z.enum(['vacation','sick','personal','unpaid']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().positive(),
  reason: z.string().max(5000).optional().nullable(),
});
const requestUpdate = requestSchema.partial().omit({ staff_id: true });

router.get('/requests', requireAuth, async (req: Request, res: Response) => {
  const { staff_id, status } = req.query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (typeof staff_id === 'string') { params.push(staff_id); conds.push(`r.staff_id = $${params.length}`); }
  if (typeof status === 'string')   { params.push(status);   conds.push(`r.status = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT r.*, s.first_name, s.last_name, s.role
         FROM pto_requests r
         LEFT JOIN staff s ON r.staff_id = s.id
         ${where}
         ORDER BY r.start_date DESC`,
      params
    );
    res.json({ requests: result.rows });
  } catch (err) {
    console.error('PTO requests list error:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

router.post('/requests', requireAuth, async (req: Request, res: Response) => {
  const parse = requestSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  if (d.end_date < d.start_date) { res.status(400).json({ error: 'end_date must be on or after start_date' }); return; }
  try {
    const result = await query(
      `INSERT INTO pto_requests (staff_id, type, start_date, end_date, hours, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [d.staff_id, d.type, d.start_date, d.end_date, d.hours, d.reason ?? null, uid(req)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('PTO request create error:', err);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

router.put('/requests/:id', requireAuth, async (req: Request, res: Response) => {
  const parse = requestUpdate.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const keys = Object.keys(d);
  if (keys.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map(k => (d as Record<string, unknown>)[k] ?? null);
  try {
    const result = await query(
      `UPDATE pto_requests SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...vals]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Request not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PTO request update error:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// PUT /requests/:id/approve — decrements balance of the appropriate type
router.put('/requests/:id/approve', requireAuth, async (req: Request, res: Response) => {
  const userId = uid(req);
  try {
    // Load request
    const reqRes = await query(`SELECT * FROM pto_requests WHERE id = $1`, [req.params.id]);
    if (reqRes.rows.length === 0) { res.status(404).json({ error: 'Request not found' }); return; }
    const pr = reqRes.rows[0] as { staff_id: string; type: string; hours: number; status: string };
    if (pr.status !== 'pending') { res.status(400).json({ error: `Request is already ${pr.status}` }); return; }

    // Mark approved
    const updRes = await query(
      `UPDATE pto_requests SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
        WHERE id = $2 RETURNING *`,
      [userId, req.params.id]
    );

    // Deduct from balance (skip for 'unpaid' leave — no paid bucket to touch)
    if (pr.type !== 'unpaid') {
      const col = `${pr.type}_hours`;
      // Upsert a balance row if missing; subtract hours.
      await query(
        `INSERT INTO pto_balances (staff_id, vacation_hours, sick_hours, personal_hours, updated_by)
         VALUES ($1, 0, 0, 0, $2)
         ON CONFLICT (staff_id) DO NOTHING`,
        [pr.staff_id, userId]
      );
      await query(
        `UPDATE pto_balances SET ${col} = ${col} - $1, updated_by = $2, updated_at = NOW()
          WHERE staff_id = $3`,
        [pr.hours, userId, pr.staff_id]
      );
    }

    await logAudit(null, userId, 'pto.approve', req.params.id, { hours: pr.hours, type: pr.type }, (req.ip ?? 'unknown'));
    res.json(updRes.rows[0]);
  } catch (err) {
    console.error('PTO approve error:', err);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

router.put('/requests/:id/deny', requireAuth, async (req: Request, res: Response) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
  try {
    const result = await query(
      `UPDATE pto_requests SET status = 'denied', approved_by = $1, approved_at = NOW(),
          denial_reason = $2, updated_at = NOW()
        WHERE id = $3 AND status = 'pending' RETURNING *`,
      [uid(req), reason, req.params.id]
    );
    if (result.rows.length === 0) { res.status(400).json({ error: 'Request not found or not pending' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PTO deny error:', err);
    res.status(500).json({ error: 'Failed to deny request' });
  }
});

router.put('/requests/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    // If request was already approved, we must give back the hours.
    const reqRes = await query(`SELECT * FROM pto_requests WHERE id = $1`, [req.params.id]);
    if (reqRes.rows.length === 0) { res.status(404).json({ error: 'Request not found' }); return; }
    const pr = reqRes.rows[0] as { staff_id: string; type: string; hours: number; status: string };
    if (pr.status === 'cancelled') { res.status(400).json({ error: 'Already cancelled' }); return; }
    const wasApproved = pr.status === 'approved';

    const updRes = await query(
      `UPDATE pto_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (wasApproved && pr.type !== 'unpaid') {
      const col = `${pr.type}_hours`;
      await query(
        `UPDATE pto_balances SET ${col} = ${col} + $1, updated_at = NOW() WHERE staff_id = $2`,
        [pr.hours, pr.staff_id]
      );
    }

    res.json(updRes.rows[0]);
  } catch (err) {
    console.error('PTO cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel request' });
  }
});

router.delete('/requests/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(`DELETE FROM pto_requests WHERE id = $1 AND status = 'pending' RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) { res.status(400).json({ error: 'Only pending requests can be deleted' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('PTO delete error:', err);
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

export default router;
