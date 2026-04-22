import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';
import { sendApprovalRequest, sendSMS } from '../services/clerkchat';

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

// Phase 1.1B + 1.1C — direct send (no approval flow). For recruiter-to-candidate
// texting from the candidate profile or the global texting panel. Logs a
// reference row in sms_approvals with status='sent' so messages still show up
// in the audit / history view.
const directSmsSchema = z.object({
  recipient_phone: z.string().min(10).max(20),
  message: z.string().min(1).max(1600),
  reference_id: z.string().uuid().optional().nullable(),
  reference_type: z.string().max(50).optional().nullable(),  // e.g. 'candidate', 'staff'
});

router.post('/send-direct', requireAuth, async (req: Request, res: Response) => {
  const parse = directSmsSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }
  const d = parse.data;
  const auth = getAuth(req);

  // Normalize the phone number to E.164 for ClerkChat / most SMS providers.
  // Common inputs we handle:
  //   "832 209 9165"     -> "+18322099165"
  //   "(832) 209-9165"   -> "+18322099165"
  //   "18322099165"      -> "+18322099165"
  //   "+18322099165"     -> "+18322099165"
  //   "+447911123456"    -> "+447911123456" (kept as-is)
  const digitsOnly = d.recipient_phone.replace(/\D/g, '');
  let cleanedPhone: string;
  if (d.recipient_phone.trim().startsWith('+')) {
    cleanedPhone = '+' + digitsOnly;  // preserve explicit country code
  } else if (digitsOnly.length === 10) {
    cleanedPhone = '+1' + digitsOnly;  // default to US country code for 10-digit numbers
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    cleanedPhone = '+' + digitsOnly;   // 1-prefixed US number
  } else if (digitsOnly.length >= 10) {
    cleanedPhone = '+' + digitsOnly;   // international number without +
  } else {
    res.status(400).json({ error: 'Invalid phone number — need at least 10 digits.' });
    return;
  }

  // Prefix to the recipient knows who this is from. Not required for SMS
  // spec, but recruiters identify themselves when texting candidates.
  const finalMessage = d.message;

  try {
    const result = await sendSMS(cleanedPhone, finalMessage);

    // Log as a 'sent' sms_approvals row so history/audit captures it.
    try {
      await query(
        `INSERT INTO sms_approvals (type, subject, message, recipient_phone, reference_id, reference_type, status, sent_at)
         VALUES ('direct', 'Direct message', $1, $2, $3, $4, 'sent', NOW())`,
        [finalMessage.slice(0, 2000), cleanedPhone, d.reference_id ?? null, d.reference_type ?? null]
      );
    } catch { /* table may not have all columns — best effort */ }

    await logAudit(null, auth?.userId ?? 'unknown', 'sms.send_direct', d.reference_id ?? cleanedPhone,
      { to: cleanedPhone, len: finalMessage.length }, (req.ip ?? 'unknown'));

    res.json({ success: true, messageId: result.messageId, status: result.status });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('Direct SMS send error:', err);
    if (e.message?.includes('CLERKCHAT_')) {
      res.status(503).json({
        error: 'SMS is not configured on the server. Set CLERKCHAT_API_KEY and CLERKCHAT_FROM_NUMBER env vars.',
      });
      return;
    }
    res.status(500).json({ error: `Failed to send SMS: ${e.message?.slice(0, 200) ?? 'unknown'}` });
  }
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
