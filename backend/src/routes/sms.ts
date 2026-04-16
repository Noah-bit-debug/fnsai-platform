import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';
import { sendApprovalRequest } from '../services/clerkchat';

const router = Router();

const smsApprovalSchema = z.object({
  type: z.string().min(1).max(100),
  subject: z.string().min(1).max(255),
  message: z.string().min(1).max(2000),
  recipient_phone: z.string().min(10).max(20),
  reference_id: z.string().uuid().optional(),
  reference_type: z.string().max(50).optional(),
  details: z.string().max(1000).optional(),
});

// GET / - list SMS approvals
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { status } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT * FROM sms_approvals ${whereClause} ORDER BY created_at DESC LIMIT 100`,
      params
    );

    res.json({ approvals: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ approvals: [] }); return; }
    console.error('SMS list error:', err);
    res.status(500).json({ error: 'Failed to fetch SMS approvals' });
  }
});

// POST / - send new approval SMS
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = smsApprovalSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const data = parse.data;
  const auth = getAuth(req);

  try {
    // Insert record first to get an ID
    const insertResult = await query(
      `INSERT INTO sms_approvals (type, subject, message, recipient_phone, reference_id, reference_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.type,
        data.subject,
        data.message,
        data.recipient_phone,
        data.reference_id ?? null,
        data.reference_type ?? null,
      ]
    );

    const approval = insertResult.rows[0];

    await sendApprovalRequest(
      data.recipient_phone,
      data.subject,
      data.details ?? data.message,
      approval.id as string
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'sms.send',
      approval.id as string,
      { type: data.type, to: data.recipient_phone },
      (req.ip ?? 'unknown')
    );

    res.status(201).json(approval);
  } catch (err) {
    console.error('SMS send error:', err);
    res.status(500).json({ error: 'Failed to send SMS approval' });
  }
});

// POST /:id/approve - approve via web
router.post('/:id/approve', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE sms_approvals
       SET status = 'approved', approved_at = NOW(), approved_by = $2
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, auth?.userId ?? 'web']
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Approval not found or already processed' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'sms.approve', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true, approval: result.rows[0] });
  } catch (err) {
    console.error('SMS approve error:', err);
    res.status(500).json({ error: 'Failed to approve' });
  }
});

// POST /:id/deny - deny via web
router.post('/:id/deny', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE sms_approvals
       SET status = 'denied', approved_at = NOW(), approved_by = $2
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, auth?.userId ?? 'web']
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Approval not found or already processed' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'sms.deny', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true, approval: result.rows[0] });
  } catch (err) {
    console.error('SMS deny error:', err);
    res.status(500).json({ error: 'Failed to deny' });
  }
});

// POST /webhook - ClerkChat incoming reply webhook
router.post('/webhook', async (req: Request, res: Response) => {
  const { from, body: smsBody, referenceId } = req.body as {
    from?: string;
    body?: string;
    referenceId?: string;
  };

  if (!smsBody || !referenceId) {
    res.status(200).json({ received: true }); // Always 200 for webhooks
    return;
  }

  const reply = smsBody.trim().toUpperCase();

  try {
    if (reply === 'A' || reply === 'APPROVE') {
      await query(
        `UPDATE sms_approvals
         SET status = 'approved', approved_at = NOW(), approved_by = $2
         WHERE id = $1 AND status = 'pending'`,
        [referenceId, from ?? 'sms']
      );

      await logAudit(null, null, 'sms.approvedViaSMS', referenceId, { from }, undefined);
    } else if (reply === 'D' || reply === 'DENY') {
      await query(
        `UPDATE sms_approvals
         SET status = 'denied', approved_at = NOW(), approved_by = $2
         WHERE id = $1 AND status = 'pending'`,
        [referenceId, from ?? 'sms']
      );

      await logAudit(null, null, 'sms.deniedViaSMS', referenceId, { from }, undefined);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('SMS webhook error:', err);
    res.status(200).json({ received: true }); // Still 200 to prevent retries
  }
});

export default router;
