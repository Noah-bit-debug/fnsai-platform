import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';

const router = Router();

const facilitySchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().max(100).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  contact_name: z.string().max(255).optional().nullable(),
  contact_email: z.string().email().optional().nullable(),
  contact_phone: z.string().max(30).optional().nullable(),
  contract_status: z
    .enum(['active', 'renewing', 'expired', 'pending'])
    .optional()
    .default('pending'),
  special_requirements: z.record(z.unknown()).optional().default({}),
  notes: z.string().max(5000).optional().nullable(),
});

const facilityUpdateSchema = facilitySchema.partial();

// GET / - list facilities
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { contract_status, search } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (contract_status) {
    conditions.push(`f.contract_status = $${paramIndex++}`);
    params.push(contract_status);
  }
  if (search) {
    conditions.push(
      `(f.name ILIKE $${paramIndex} OR f.contact_name ILIKE $${paramIndex} OR f.address ILIKE $${paramIndex})`
    );
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT f.*,
              COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active') AS active_placements,
              COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'active') AS active_staff
       FROM facilities f
       LEFT JOIN placements p ON p.facility_id = f.id
       LEFT JOIN staff s ON s.facility_id = f.id
       ${whereClause}
       GROUP BY f.id
       ORDER BY f.name ASC`,
      params
    );

    res.json({ facilities: result.rows });
  } catch (err) {
    console.error('Facilities list error:', err);
    res.status(500).json({ error: 'Failed to fetch facilities' });
  }
});

// Constrain :id to a UUID-shaped path segment so non-UUID paths like
// "/orgs" don't accidentally get matched by /:id and routed to the
// facility-by-id handler. Without this, GET /api/v1/clients/orgs hits
// `GET /:id` with id="orgs", tries SELECT * FROM facilities WHERE id='orgs'
// â†’ pg invalid-UUID error â†’ 500. The pattern below requires 36 chars of
// hex + dashes, so "orgs" (4 chars) falls through to the /orgs route.
const UUID_ID = ':id([0-9a-fA-F-]{36})';

// GET /:id
router.get(`/${UUID_ID}`, requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const facilityResult = await query('SELECT * FROM facilities WHERE id = $1', [id]);

    if (facilityResult.rows.length === 0) {
      res.status(404).json({ error: 'Facility not found' });
      return;
    }

    const placementsResult = await query(
      `SELECT p.*, s.first_name, s.last_name, s.role AS staff_role
       FROM placements p
       LEFT JOIN staff s ON p.staff_id = s.id
       WHERE p.facility_id = $1
       ORDER BY p.created_at DESC LIMIT 20`,
      [id]
    );

    res.json({
      ...facilityResult.rows[0],
      placements: placementsResult.rows,
    });
  } catch (err) {
    console.error('Facility get error:', err);
    res.status(500).json({ error: 'Failed to fetch facility' });
  }
});

// POST / - create facility
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = facilitySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  try {
    const result = await query(
      `INSERT INTO facilities
         (name, type, address, contact_name, contact_email, contact_phone, contract_status, special_requirements, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.name,
        data.type,
        data.address,
        data.contact_name,
        data.contact_email,
        data.contact_phone,
        data.contract_status,
        JSON.stringify(data.special_requirements ?? {}),
        data.notes,
      ]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'facility.create',
      result.rows[0].id as string,
      { name: data.name },
      (req.ip ?? 'unknown')
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Facility create error:', err);
    res.status(500).json({ error: 'Failed to create facility' });
  }
});

// PUT /:id - update facility
router.put(`/${UUID_ID}`, requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = facilityUpdateSchema.safeParse(req.body);
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
  const values = fields.map((key) => {
    const val = data[key as keyof typeof data];
    if (key === 'special_requirements' && val) return JSON.stringify(val);
    return val;
  });

  try {
    const result = await query(
      `UPDATE facilities SET ${setClause} WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Facility not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'facility.update', id, { fields }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Facility update error:', err);
    res.status(500).json({ error: 'Failed to update facility' });
  }
});

// DELETE /:id
router.delete(`/${UUID_ID}`, requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    // Soft delete by setting contract_status to 'expired'
    const result = await query(
      `UPDATE facilities SET contract_status = 'expired' WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Facility not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'facility.deactivate', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true });
  } catch (err) {
    console.error('Facility delete error:', err);
    res.status(500).json({ error: 'Failed to deactivate facility' });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ATS Phase 1: "Client Organizations" endpoints backed by the new `clients`
// table. Existing `/` endpoints above still target the legacy `facilities`
// table to avoid breaking current UI. Frontend will migrate to /orgs in Phase 2.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const clientSchema = z.object({
  name: z.string().min(1).max(300),
  website: z.string().max(500).optional().nullable(),
  business_unit: z.string().max(200).optional().nullable(),
  offerings: z.array(z.string()).optional().default([]),
  submission_format: z.string().max(100).optional().nullable(),
  submission_format_notes: z.string().max(5000).optional().nullable(),
  primary_contact_name: z.string().max(200).optional().nullable(),
  primary_contact_email: z.string().email().optional().nullable(),
  primary_contact_phone: z.string().max(30).optional().nullable(),
  status: z.enum(['active', 'inactive', 'prospect', 'churned']).optional(),
  notes: z.string().max(10000).optional().nullable(),
});

const contactSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  facility_id: z.string().uuid().optional().nullable(),
  is_primary: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

const reqTemplateSchema = z.object({
  kind: z.enum(['submission', 'onboarding']),
  bundle_id: z.string().uuid().optional().nullable(),
  ad_hoc: z.array(z.object({
    type: z.enum(['doc', 'cert', 'license', 'skill']).optional(),
    kind: z.string().optional(),
    label: z.string().min(1),
    required: z.boolean().optional(),
    notes: z.string().optional(),
  })).optional().default([]),
  notes: z.string().max(5000).optional().nullable(),
});

// GET /orgs â€” list client organizations
router.get('/orgs', requireAuth, async (req: Request, res: Response) => {
  const { status, search } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (status) { conditions.push(`c.status = $${idx++}`); params.push(status); }
  if (search) { conditions.push(`c.name ILIKE $${idx++}`); params.push(`%${search}%`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT c.*,
              (SELECT COUNT(*)::INT FROM facilities f WHERE f.client_id = c.id) AS facility_count,
              (SELECT COUNT(*)::INT FROM jobs j WHERE j.client_id = c.id AND j.status = 'open') AS open_jobs
       FROM clients c
       ${where}
       ORDER BY c.name ASC`,
      params
    );
    res.json({ clients: result.rows });
  } catch (err: any) {
    // Surface the real pg error details so the frontend alert actually
    // tells us what's broken instead of just "Request failed with status 500".
    const e = err as { code?: string; message?: string; detail?: string; hint?: string; table?: string; column?: string };
    if (e?.code === '42P01') { res.json({ clients: [] }); return; }
    console.error('Clients list error:', { code: e.code, message: e.message, detail: e.detail, hint: e.hint, table: e.table, column: e.column });
    res.status(500).json({
      error: `Failed to fetch clients: ${e.message?.slice(0, 200) ?? 'unknown error'}`,
      code: e.code,
      detail: e.detail,
      hint: e.hint,
    });
  }
});

// GET /orgs/:id â€” full client record
router.get('/orgs/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const [client, facs, contacts, templates] = await Promise.all([
      query(`SELECT * FROM clients WHERE id = $1`, [req.params.id]),
      query(`SELECT * FROM facilities WHERE client_id = $1 ORDER BY name`, [req.params.id]),
      query(`SELECT * FROM client_contacts WHERE client_id = $1 ORDER BY is_primary DESC, name ASC`, [req.params.id]),
      query(
        `SELECT t.*, b.title AS bundle_title
         FROM client_requirement_templates t
         LEFT JOIN comp_bundles b ON t.bundle_id = b.id
         WHERE t.client_id = $1
         ORDER BY t.kind, t.created_at`,
        [req.params.id]
      ),
    ]);
    if (client.rows.length === 0) { res.status(404).json({ error: 'Client not found' }); return; }
    res.json({
      client: client.rows[0],
      facilities: facs.rows,
      contacts: contacts.rows,
      requirement_templates: templates.rows,
    });
  } catch (err) {
    const e = err as { code?: string; message?: string; detail?: string; hint?: string; table?: string; column?: string };
    console.error('Client fetch error:', { code: e.code, message: e.message, detail: e.detail, table: e.table, column: e.column });
    res.status(500).json({
      error: `Failed to fetch client: ${e.message?.slice(0, 200) ?? 'unknown error'}`,
      code: e.code,
      detail: e.detail,
      hint: e.hint,
    });
  }
});

// POST /orgs
router.post('/orgs', requireAuth, async (req: Request, res: Response) => {
  const parsed = clientSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const auth = getAuth(req);
  try {
    const result = await query(
      `INSERT INTO clients (name, website, business_unit, offerings, submission_format, submission_format_notes,
         primary_contact_name, primary_contact_email, primary_contact_phone, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        d.name, d.website ?? null, d.business_unit ?? null, d.offerings ?? [],
        d.submission_format ?? null, d.submission_format_notes ?? null,
        d.primary_contact_name ?? null, d.primary_contact_email ?? null, d.primary_contact_phone ?? null,
        d.status ?? 'active', d.notes ?? null, auth?.userId ?? null,
      ]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'client.create', result.rows[0].id as string, { name: d.name }, req.ip ?? 'unknown');
    res.status(201).json({ client: result.rows[0] });
  } catch (err) {
    // Specific pg error codes â†’ specific user-facing messages. The
    // ats_phase1 migration creates the `clients` table; if it failed
    // silently at startup, 42P01 is what we'd see here.
    const e = err as { code?: string; message?: string; detail?: string };
    console.error('Client create error:', { code: e.code, message: e.message, detail: e.detail });
    if (e.code === '42P01') {
      res.status(503).json({
        error: 'Clients table is missing â€” the ats_phase1 database migration has not been applied. Contact your server admin to run migrations.',
        code: e.code,
      });
      return;
    }
    if (e.code === '23505') {
      res.status(409).json({ error: 'A client with that name already exists.', code: e.code });
      return;
    }
    // Include the pg error code + short message so the UI can actually show something useful
    res.status(500).json({
      error: `Failed to create client: ${e.message?.slice(0, 200) ?? 'unknown error'}`,
      code: e.code,
    });
  }
});

// PUT /orgs/:id
router.put('/orgs/:id', requireAuth, async (req: Request, res: Response) => {
  const parsed = clientSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() }); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  const setClause = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values: unknown[] = [req.params.id, ...entries.map(([, v]) => v)];

  try {
    const result = await query(
      `UPDATE clients SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Client not found' }); return; }
    res.json({ client: result.rows[0] });
  } catch (err) {
    console.error('Client update error:', err);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// DELETE /orgs/:id â€” soft delete (set status='churned')
router.delete('/orgs/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE clients SET status = 'churned', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Client not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Client delete error:', err);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// Contacts
router.post('/orgs/:id/contacts', requireAuth, async (req: Request, res: Response) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  try {
    const result = await query(
      `INSERT INTO client_contacts (client_id, facility_id, name, title, email, phone, is_primary, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, d.facility_id ?? null, d.name, d.title ?? null, d.email ?? null, d.phone ?? null, d.is_primary ?? false, d.notes ?? null]
    );
    res.status(201).json({ contact: result.rows[0] });
  } catch (err) {
    console.error('Client contact create error:', err);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

router.put('/orgs/:id/contacts/:contactId', requireAuth, async (req: Request, res: Response) => {
  const parsed = contactSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() }); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = entries.map(([k], i) => `${k} = $${i + 3}`).join(', ');
  const values: unknown[] = [req.params.contactId, req.params.id, ...entries.map(([, v]) => v)];
  try {
    const result = await query(
      `UPDATE client_contacts SET ${setClause}, updated_at = NOW() WHERE id = $1 AND client_id = $2 RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Contact not found' }); return; }
    res.json({ contact: result.rows[0] });
  } catch (err) {
    console.error('Client contact update error:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

router.delete('/orgs/:id/contacts/:contactId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM client_contacts WHERE id = $1 AND client_id = $2 RETURNING id`,
      [req.params.contactId, req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Contact not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Client contact delete error:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// Requirement templates
router.post('/orgs/:id/requirement-templates', requireAuth, async (req: Request, res: Response) => {
  const parsed = reqTemplateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  try {
    const result = await query(
      `INSERT INTO client_requirement_templates (client_id, kind, bundle_id, ad_hoc, notes)
       VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *`,
      [req.params.id, d.kind, d.bundle_id ?? null, JSON.stringify(d.ad_hoc ?? []), d.notes ?? null]
    );
    res.status(201).json({ template: result.rows[0] });
  } catch (err) {
    console.error('Requirement template create error:', err);
    res.status(500).json({ error: 'Failed to add requirement template' });
  }
});

router.delete('/orgs/:id/requirement-templates/:tplId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM client_requirement_templates WHERE id = $1 AND client_id = $2 RETURNING id`,
      [req.params.tplId, req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Requirement template delete error:', err);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

export default router;
