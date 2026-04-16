import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';
import { parseResume } from '../services/resumeParser';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const candidateSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  role: z.enum(['RN','LPN','LVN','CNA','RT','NP','PA','Other']).optional().nullable(),
  specialties: z.array(z.string()).optional().default([]),
  skills: z.array(z.string()).optional().default([]),
  certifications: z.array(z.string()).optional().default([]),
  licenses: z.array(z.string()).optional().default([]),
  years_experience: z.number().int().min(0).max(50).optional().nullable(),
  education: z.string().max(1000).optional().nullable(),
  resume_url: z.string().url().optional().nullable(),
  assigned_recruiter_id: z.string().uuid().optional().nullable(),
  target_facility_id: z.string().uuid().optional().nullable(),
  desired_pay_rate: z.number().positive().optional().nullable(),
  offered_pay_rate: z.number().positive().optional().nullable(),
  availability_start: z.string().optional().nullable(),
  availability_type: z.enum(['full_time','part_time','per_diem','contract']).optional().nullable(),
  available_shifts: z.array(z.string()).optional().default([]),
  recruiter_notes: z.string().max(5000).optional().nullable(),
  hr_notes: z.string().max(5000).optional().nullable(),
  source: z.string().max(200).optional().nullable(),
});

const stageSchema = z.object({
  stage: z.enum(['application','interview','credentialing','onboarding','placed','rejected','withdrawn']),
  notes: z.string().max(2000).optional().nullable(),
});

// GET / — list candidates
router.get('/', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  const { stage, status, assigned_recruiter_id, search } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (stage) { conditions.push(`c.stage = $${idx++}`); params.push(stage); }
  if (status) { conditions.push(`c.status = $${idx++}`); params.push(status); }
  if (assigned_recruiter_id) { conditions.push(`c.assigned_recruiter_id = $${idx++}`); params.push(assigned_recruiter_id); }
  if (search) {
    conditions.push(`(c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx} OR c.email ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT c.*,
              u.name AS recruiter_name, u.email AS recruiter_email,
              f.name AS target_facility_name,
              EXTRACT(DAY FROM NOW() - c.updated_at)::INT AS days_since_update
       FROM candidates c
       LEFT JOIN users u ON c.assigned_recruiter_id = u.id
       LEFT JOIN facilities f ON c.target_facility_id = f.id
       ${where}
       ORDER BY c.created_at DESC`,
      params
    );
    res.json({ candidates: result.rows });
  } catch (err: any) {
    // Table not yet migrated — return empty list rather than 500
    if (err?.code === '42P01') {
      res.json({ candidates: [] });
      return;
    }
    console.error('Candidates list error:', err);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

// GET /stats/overview
router.get('/stats/overview', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const stagesResult = await query(
      `SELECT stage, COUNT(*)::INT as count FROM candidates WHERE status = 'active' GROUP BY stage`
    );
    const totalResult = await query(`SELECT COUNT(*)::INT as total FROM candidates WHERE status = 'active'`);
    const recentResult = await query(
      `SELECT COUNT(*)::INT as count FROM candidates WHERE created_at >= NOW() - INTERVAL '7 days'`
    );
    const by_stage: Record<string, number> = {};
    stagesResult.rows.forEach((r: any) => { by_stage[r.stage] = r.count; });
    res.json({
      total: totalResult.rows[0].total,
      by_stage,
      recent_7_days: recentResult.rows[0].count,
    });
  } catch (err) {
    console.error('Candidate stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /:id — single candidate with history, documents, forms
router.get('/:id', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [candidateRes, historyRes, docsRes, formsRes] = await Promise.all([
      query(
        `SELECT c.*, u.name AS recruiter_name, f.name AS target_facility_name
         FROM candidates c
         LEFT JOIN users u ON c.assigned_recruiter_id = u.id
         LEFT JOIN facilities f ON c.target_facility_id = f.id
         WHERE c.id = $1`,
        [id]
      ),
      query(
        `SELECT csh.*, u.name AS moved_by_name
         FROM candidate_stage_history csh
         LEFT JOIN users u ON csh.moved_by = u.id
         WHERE csh.candidate_id = $1 ORDER BY csh.created_at ASC`,
        [id]
      ),
      query(`SELECT * FROM candidate_documents WHERE candidate_id = $1 ORDER BY created_at ASC`, [id]),
      query(`SELECT * FROM onboarding_forms WHERE candidate_id = $1 ORDER BY created_at ASC`, [id]),
    ]);

    if (candidateRes.rows.length === 0) {
      res.status(404).json({ error: 'Candidate not found' });
      return;
    }

    res.json({
      ...candidateRes.rows[0],
      stage_history: historyRes.rows,
      documents: docsRes.rows,
      onboarding_forms: formsRes.rows,
    });
  } catch (err) {
    console.error('Candidate get error:', err);
    res.status(500).json({ error: 'Failed to fetch candidate' });
  }
});

// POST / — create candidate
router.post('/', requireAuth, requirePermission('candidates_create'), async (req: Request, res: Response) => {
  const parse = candidateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }
  const auth = getAuth(req);
  const d = parse.data;
  try {
    const result = await query(
      `INSERT INTO candidates (first_name, last_name, email, phone, address, city, state, zip, role,
        specialties, skills, certifications, licenses, years_experience, education, resume_url,
        assigned_recruiter_id, target_facility_id, desired_pay_rate, offered_pay_rate,
        availability_start, availability_type, available_shifts, recruiter_notes, hr_notes, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
               (SELECT id FROM users WHERE clerk_user_id = $27 LIMIT 1))
       RETURNING *`,
      [d.first_name, d.last_name, d.email, d.phone, d.address, d.city, d.state, d.zip, d.role,
       d.specialties, d.skills, d.certifications, d.licenses, d.years_experience, d.education,
       d.resume_url, d.assigned_recruiter_id, d.target_facility_id, d.desired_pay_rate,
       d.offered_pay_rate, d.availability_start, d.availability_type, d.available_shifts,
       d.recruiter_notes, d.hr_notes, d.source, auth?.userId ?? null]
    );
    const candidate = result.rows[0];

    // Create initial stage history entry
    await query(
      `INSERT INTO candidate_stage_history (candidate_id, from_stage, to_stage, moved_by_name, notes)
       VALUES ($1, NULL, 'application', $2, 'Candidate created')`,
      [candidate.id, auth?.userId ?? 'system']
    );

    await logAudit(null, auth?.userId ?? 'unknown', 'candidate.create', candidate.id,
      { name: `${d.first_name} ${d.last_name}` }, (req.ip ?? 'unknown'));

    res.status(201).json(candidate);
  } catch (err) {
    console.error('Candidate create error:', err);
    res.status(500).json({ error: 'Failed to create candidate' });
  }
});

// PUT /:id — update candidate
router.put('/:id', requireAuth, requirePermission('candidates_edit'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = candidateSchema.partial().safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }
  const auth = getAuth(req);
  const d = parse.data;
  const fields = Object.keys(d).filter(k => (d as any)[k] !== undefined);
  if (fields.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  const setClause = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = fields.map(k => (d as any)[k]);
  try {
    const result = await query(
      `UPDATE candidates SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Candidate not found' }); return; }
    await logAudit(null, auth?.userId ?? 'unknown', 'candidate.update', id, { fields }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Candidate update error:', err);
    res.status(500).json({ error: 'Failed to update candidate' });
  }
});

// DELETE /:id — soft delete
router.delete('/:id', requireAuth, requirePermission('candidates_delete'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  try {
    const result = await query(
      `UPDATE candidates SET status = 'withdrawn', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Candidate not found' }); return; }
    await logAudit(null, auth?.userId ?? 'unknown', 'candidate.delete', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true });
  } catch (err) {
    console.error('Candidate delete error:', err);
    res.status(500).json({ error: 'Failed to delete candidate' });
  }
});

// POST /:id/move-stage
router.post('/:id/move-stage', requireAuth, requirePermission('candidate_stage_move'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const parse = stageSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }
  const auth = getAuth(req);
  const { stage, notes } = parse.data;
  try {
    const current = await query(`SELECT stage FROM candidates WHERE id = $1`, [id]);
    if (current.rows.length === 0) { res.status(404).json({ error: 'Candidate not found' }); return; }

    const fromStage = current.rows[0].stage;
    await query(`UPDATE candidates SET stage = $1, updated_at = NOW() WHERE id = $2`, [stage, id]);
    await query(
      `INSERT INTO candidate_stage_history (candidate_id, from_stage, to_stage, moved_by, moved_by_name, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, fromStage, stage, req.userRecord?.id ?? null, req.userRecord?.name ?? req.userRecord?.email ?? 'Unknown', notes ?? null]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'candidate.stageMove', id,
      { from: fromStage, to: stage }, (req.ip ?? 'unknown'));
    res.json({ success: true, from: fromStage, to: stage });
  } catch (err) {
    console.error('Stage move error:', err);
    res.status(500).json({ error: 'Failed to move stage' });
  }
});

// POST /:id/parse-resume — AI resume parsing
router.post('/:id/parse-resume', requireAuth, requirePermission('resume_upload'),
  upload.single('resume'), async (req: Request, res: Response) => {
    const { id } = req.params;
    const auth = getAuth(req);
    if (!req.file) {
      res.status(400).json({ error: 'No resume file uploaded' });
      return;
    }
    try {
      const parsed = await parseResume(req.file.buffer, req.file.mimetype);

      // Save parsed data to candidate if id is not 'new'
      if (id !== 'new') {
        await query(
          `UPDATE candidates SET parsed_resume = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(parsed), id]
        );
      }

      await logAudit(null, auth?.userId ?? 'unknown', 'candidate.parseResume', id,
        { fileName: req.file.originalname }, (req.ip ?? 'unknown'));
      res.json({ success: true, parsed });
    } catch (err) {
      console.error('Parse resume error:', err);
      res.status(500).json({ error: 'Resume parsing failed' });
    }
  }
);

// GET /:id/documents
router.get('/:id/documents', requireAuth, requirePermission('credentialing_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT cd.*, u.name AS approved_by_name FROM candidate_documents cd
       LEFT JOIN users u ON cd.approved_by = u.id
       WHERE cd.candidate_id = $1 ORDER BY cd.required DESC, cd.label ASC`,
      [id]
    );
    res.json({ documents: result.rows });
  } catch (err) {
    console.error('Candidate documents error:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// POST /:id/documents
router.post('/:id/documents', requireAuth, requirePermission('credentialing_manage'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  const { document_type, label, required = true, expiry_date, notes } = req.body;
  if (!document_type || !label) {
    res.status(400).json({ error: 'document_type and label are required' });
    return;
  }
  try {
    const result = await query(
      `INSERT INTO candidate_documents (candidate_id, document_type, label, required, expiry_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, document_type, label, required, expiry_date || null, notes || null]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'candidate.document.add', id,
      { label }, (req.ip ?? 'unknown'));
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add document error:', err);
    res.status(500).json({ error: 'Failed to add document' });
  }
});

// PUT /:id/documents/:docId
router.put('/:id/documents/:docId', requireAuth, requirePermission('credentialing_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id, docId } = req.params;
  const { status, file_url, expiry_date, notes } = req.body;
  const auth = getAuth(req);
  try {
    const approvedBy = status === 'approved' ? req.userRecord?.id : null;

    const result = await query(
      `UPDATE candidate_documents SET
         status = COALESCE($1, status),
         file_url = COALESCE($2, file_url),
         expiry_date = COALESCE($3, expiry_date),
         notes = COALESCE($4, notes),
         uploaded_at = CASE WHEN $1 IN ('received','approved') THEN NOW() ELSE uploaded_at END,
         approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END,
         approved_by = CASE WHEN $1 = 'approved' THEN $5::UUID ELSE NULL END,
         updated_at = NOW()
       WHERE id = $6 AND candidate_id = $7 RETURNING *`,
      [status || null, file_url || null, expiry_date || null, notes || null, approvedBy, docId, id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Document not found' }); return; }
    await logAudit(null, auth?.userId ?? 'unknown', 'candidate.document.update', docId,
      { status }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update document error:', err);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// GET /:id/stage-history
router.get('/:id/stage-history', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT csh.*, u.name AS moved_by_name FROM candidate_stage_history csh
       LEFT JOIN users u ON csh.moved_by = u.id
       WHERE csh.candidate_id = $1 ORDER BY csh.created_at ASC`,
      [id]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error('Stage history error:', err);
    res.status(500).json({ error: 'Failed to fetch stage history' });
  }
});

// GET /:id/onboarding-forms
router.get('/:id/onboarding-forms', requireAuth, requirePermission('onboarding_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(`SELECT * FROM onboarding_forms WHERE candidate_id = $1 ORDER BY created_at ASC`, [id]);
    res.json({ forms: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch onboarding forms' });
  }
});

// POST /:id/onboarding-forms — send onboarding form
router.post('/:id/onboarding-forms', requireAuth, requirePermission('onboarding_manage'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  const { form_type } = req.body;
  const validTypes = ['w4','i9','direct_deposit','emergency_contact','hipaa','handbook','other'];
  if (!form_type || !validTypes.includes(form_type)) {
    res.status(400).json({ error: 'Invalid form_type' });
    return;
  }
  try {
    const result = await query(
      `INSERT INTO onboarding_forms (candidate_id, form_type, status, sent_at)
       VALUES ($1, $2, 'sent', NOW()) RETURNING *`,
      [id, form_type]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'candidate.form.sent', id,
      { form_type }, (req.ip ?? 'unknown'));
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Send form error:', err);
    res.status(500).json({ error: 'Failed to send form' });
  }
});

export default router;
