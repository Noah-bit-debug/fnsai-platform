import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';
import { createEnvelope } from '../services/foxit';
import { sendApprovalRequest } from '../services/clerkchat';

const router = Router();

const placementSchema = z.object({
  staff_id: z.string().uuid().optional().nullable(),
  facility_id: z.string().uuid(),
  role: z.string().min(1).max(100),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  status: z.enum(['active', 'pending', 'unfilled', 'completed', 'cancelled']).optional().default('pending'),
  hourly_rate: z.number().positive().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

const placementUpdateSchema = placementSchema.partial();

// GET / - list placements with joins
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { status, facility_id, staff_id } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`p.status = $${paramIndex++}`);
    params.push(status);
  }
  if (facility_id) {
    conditions.push(`p.facility_id = $${paramIndex++}`);
    params.push(facility_id);
  }
  if (staff_id) {
    conditions.push(`p.staff_id = $${paramIndex++}`);
    params.push(staff_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT p.*,
              s.first_name, s.last_name, s.role AS staff_role,
              f.name AS facility_name, f.contact_name AS facility_contact
       FROM placements p
       LEFT JOIN staff s ON p.staff_id = s.id
       LEFT JOIN facilities f ON p.facility_id = f.id
       ${whereClause}
       ORDER BY p.created_at DESC`,
      params
    );

    res.json({ placements: result.rows });
  } catch (err) {
    console.error('Placements list error:', err);
    res.status(500).json({ error: 'Failed to fetch placements' });
  }
});

// GET /:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT p.*,
              s.first_name, s.last_name, s.role AS staff_role, s.email AS staff_email, s.phone AS staff_phone,
              f.name AS facility_name, f.address AS facility_address, f.contact_name, f.contact_email, f.contact_phone
       FROM placements p
       LEFT JOIN staff s ON p.staff_id = s.id
       LEFT JOIN facilities f ON p.facility_id = f.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Placement not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Placement get error:', err);
    res.status(500).json({ error: 'Failed to fetch placement' });
  }
});

// POST / - create placement
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = placementSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  try {
    const result = await query(
      `INSERT INTO placements (staff_id, facility_id, role, start_date, end_date, status, hourly_rate, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.staff_id,
        data.facility_id,
        data.role,
        data.start_date,
        data.end_date,
        data.status,
        data.hourly_rate,
        data.notes,
      ]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'placement.create',
      result.rows[0].id,
      { facilityId: data.facility_id, role: data.role },
      req.ip
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Placement create error:', err);
    res.status(500).json({ error: 'Failed to create placement' });
  }
});

// PUT /:id - update placement
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = placementUpdateSchema.safeParse(req.body);
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
      `UPDATE placements SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Placement not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'placement.update', id, { fields }, req.ip);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Placement update error:', err);
    res.status(500).json({ error: 'Failed to update placement' });
  }
});

// POST /:id/send-contract - trigger Foxit eSign + SMS approval
router.post('/:id/send-contract', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const placementResult = await query(
      `SELECT p.*, s.first_name, s.last_name, s.email AS staff_email, s.phone AS staff_phone,
              f.name AS facility_name
       FROM placements p
       LEFT JOIN staff s ON p.staff_id = s.id
       LEFT JOIN facilities f ON p.facility_id = f.id
       WHERE p.id = $1`,
      [id]
    );

    if (placementResult.rows.length === 0) {
      res.status(404).json({ error: 'Placement not found' });
      return;
    }

    const placement = placementResult.rows[0];

    if (!placement.staff_email) {
      res.status(400).json({ error: 'Staff member has no email address for contract delivery' });
      return;
    }

    // Create a minimal PDF placeholder buffer (would be a real contract template)
    const contractBuffer = Buffer.from(
      `%PDF-1.4 PLACEMENT CONTRACT - ${placement.first_name} ${placement.last_name} at ${placement.facility_name}`
    );

    const envelope = await createEnvelope(
      placement.staff_email,
      `${placement.first_name} ${placement.last_name}`,
      contractBuffer,
      `Contract_${placement.last_name}_${placement.facility_name.replace(/\s/g, '_')}.pdf`
    );

    // Update placement with envelope ID
    await query(
      `UPDATE placements SET foxit_envelope_id = $1, contract_status = 'pending_esign', updated_at = NOW()
       WHERE id = $2`,
      [envelope.envelopeId, id]
    );

    // Send SMS approval if staff has phone
    if (placement.staff_phone) {
      const smsResult = await sendApprovalRequest(
        placement.staff_phone,
        `Placement Contract: ${placement.role} at ${placement.facility_name}`,
        `Start: ${placement.start_date || 'TBD'} | Rate: $${placement.hourly_rate || 'TBD'}/hr\nPlease check your email to sign your contract.`,
        id
      );

      // Store SMS approval record
      await query(
        `INSERT INTO sms_approvals (type, subject, message, recipient_phone, reference_id, reference_type)
         VALUES ('contract', $1, $2, $3, $4, 'placement')`,
        [
          `Contract: ${placement.role} at ${placement.facility_name}`,
          smsResult.messageId,
          placement.staff_phone,
          id,
        ]
      );
    }

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'placement.sendContract',
      id,
      { envelopeId: envelope.envelopeId },
      req.ip
    );

    res.json({
      success: true,
      envelopeId: envelope.envelopeId,
      smsSent: !!placement.staff_phone,
    });
  } catch (err) {
    console.error('Send contract error:', err);
    res.status(500).json({ error: 'Failed to send contract' });
  }
});

// POST /:id/approve - approve placement
router.post('/:id/approve', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE placements SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Placement not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'placement.approve', id, {}, req.ip);
    res.json({ success: true, placement: result.rows[0] });
  } catch (err) {
    console.error('Placement approve error:', err);
    res.status(500).json({ error: 'Failed to approve placement' });
  }
});

export default router;
