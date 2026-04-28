import { randomBytes } from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';
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
    // Hard-stop: refuse placement if compliance has marked the staff
    // member as not placement-ready. Mirrors the Credentialing SOP /
    // License Verification / Onboarding modules — no placement without
    // a cleared credential file.
    //
    // Falls open if no readiness record exists yet so we don't
    // retroactively block flows where evaluations haven't been run.
    // Once /compliance/readiness/evaluate-all has run once, the gate
    // is live for any staff member with a recorded "not ready" verdict.
    if (data.staff_id) {
      const readiness = await query(
        `SELECT is_ready, blocking_issues
         FROM comp_placement_readiness
         WHERE staff_id = $1`,
        [data.staff_id]
      );
      if (readiness.rows.length > 0 && readiness.rows[0].is_ready === false) {
        res.status(409).json({
          error: 'Placement blocked: staff member is not compliance-ready. Resolve credential blockers before placement.',
          code: 'PLACEMENT_NOT_READY',
          blocking_issues: readiness.rows[0].blocking_issues ?? [],
        });
        return;
      }
    }

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
      String(result.rows[0].id),
      { facilityId: data.facility_id, role: data.role },
      (req.ip ?? 'unknown')
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

    await logAudit(null, auth?.userId ?? 'unknown', 'placement.update', id, { fields }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Placement update error:', err);
    res.status(500).json({ error: 'Failed to update placement' });
  }
});

// POST /:id/send-contract
// Creates an internal eSign document draft for this placement's contract and
// links it back to the placement. The caller (frontend) should then route the
// user to /esign/documents/:doc_id/prepare to place signature fields and send.
// (Previously this posted to Foxit; we now use our own eSign stack.)
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

    const fullName = [placement.first_name, placement.last_name].filter(Boolean).join(' ') || 'Staff member';
    const docTitle = `Placement Contract — ${fullName} · ${placement.facility_name ?? 'Facility'}`;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // 1) Create the eSign document in draft state
    const createdByUuid = await (async (): Promise<string | null> => {
      if (!auth?.userId) return null;
      try {
        const r = await query<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = $1 LIMIT 1`, [auth.userId]);
        return r.rows[0]?.id ?? null;
      } catch { return null; }
    })();

    const docRes = await query<{ id: string }>(
      `INSERT INTO esign_documents
         (title, field_values, status, staff_id, created_by, signing_order, message, expires_at)
       VALUES ($1, $2, 'draft', $3, $4, 'parallel', $5, $6)
       RETURNING id`,
      [
        docTitle,
        JSON.stringify({}),
        placement.staff_id ?? null,
        createdByUuid,
        `Please review and sign your placement contract for ${placement.role} at ${placement.facility_name ?? 'the facility'}. Start date: ${placement.start_date ?? 'TBD'}.`,
        expiresAt,
      ]
    );
    const documentId = docRes.rows[0].id;

    // 2) Create one signer row (the staff member) with a secure signing token
    const token = randomBytes(32).toString('hex');
    await query(
      `INSERT INTO esign_signers
         (document_id, name, email, role, order_index, token, auth_method)
       VALUES ($1, $2, $3, 'signer', 0, $4, 'email_link')`,
      [documentId, fullName, placement.staff_email, token]
    );

    // 3) Link the eSign doc to this placement + update contract status
    await query(
      `UPDATE placements SET foxit_envelope_id = $1, contract_status = 'pending_esign', updated_at = NOW()
       WHERE id = $2`,
      [documentId, id]
    );

    // 4) Fire-and-forget SMS heads-up when the staff has a phone
    if (placement.staff_phone) {
      try {
        const smsResult = await sendApprovalRequest(
          String(placement.staff_phone),
          `Placement Contract: ${placement.role} at ${placement.facility_name}`,
          `Start: ${placement.start_date || 'TBD'} | Rate: $${placement.hourly_rate || 'TBD'}/hr\nPlease check your email to sign your contract.`,
          id
        );
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
      } catch (smsErr) {
        console.warn('Contract SMS heads-up failed (non-fatal):', smsErr);
      }
    }

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'placement.sendContract',
      id,
      { esign_document_id: documentId },
      (req.ip ?? 'unknown')
    );

    res.json({
      success: true,
      esign_document_id: documentId,
      prepare_url: `/esign/documents/${documentId}/prepare`,
      smsSent: !!placement.staff_phone,
    });
  } catch (err) {
    console.error('Send contract error:', err);
    res.status(500).json({ error: 'Failed to create eSign contract' });
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

    await logAudit(null, auth?.userId ?? 'unknown', 'placement.approve', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true, placement: result.rows[0] });
  } catch (err) {
    console.error('Placement approve error:', err);
    res.status(500).json({ error: 'Failed to approve placement' });
  }
});

export default router;
