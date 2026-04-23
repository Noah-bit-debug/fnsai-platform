import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';
import { parseResume, ResumeParseError } from '../services/resumeParser';
import { reviewDocument, DocumentReviewError } from '../services/documentReviewer';

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

// Phase 1.4 QA fix — the enum previously only accepted the 7 legacy
// stage keys. But Phase 1.4 introduced dynamic pipeline_stages rows
// (12 default: new_lead, screening, interview, internal_review,
// submitted, client_submitted, offer, credentialing, onboarding,
// placed, rejected, withdrawn). Every move to one of the NEW keys
// was rejected with a zod validation 400 before the handler even ran.
// Now we accept any non-empty string at the edge; the handler below
// validates it exists in the pipeline_stages table before any DB write.
const stageSchema = z.object({
  stage: z.string().min(1).max(50),
  notes: z.string().max(2000).optional().nullable(),
});

// GET / — list candidates
router.get('/', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  // Phase 1.1D — added role + shift filters. role matches the enum column
  // directly; shift matches against available_shifts TEXT[] via ANY().
  const { stage, status, assigned_recruiter_id, search, role, shift } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (stage) { conditions.push(`c.stage = $${idx++}`); params.push(stage); }
  if (status) { conditions.push(`c.status = $${idx++}`); params.push(status); }
  if (assigned_recruiter_id) { conditions.push(`c.assigned_recruiter_id = $${idx++}`); params.push(assigned_recruiter_id); }
  if (role) { conditions.push(`c.role = $${idx++}`); params.push(role); }
  if (shift) { conditions.push(`$${idx++} = ANY(c.available_shifts)`); params.push(shift); }
  if (search) {
    // Phase 1 QA: search placeholder promised role matching but query
    // didn't include it. Expand to also match role + specialty-array
    // membership so typing "RN" or "ICU" works as expected.
    conditions.push(
      `(c.first_name ILIKE $${idx}
        OR c.last_name ILIKE $${idx}
        OR c.email ILIKE $${idx}
        OR c.role ILIKE $${idx}
        OR $${idx + 1} = ANY(c.specialties)
        OR EXISTS (SELECT 1 FROM unnest(c.specialties) sp WHERE sp ILIKE $${idx}))`
    );
    params.push(`%${search}%`);
    params.push(String(search));
    idx += 2;
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
      // Phase 1 QA fix: raw clerk_user_ids were leaking through as
      // moved_by_name for old rows where the INSERT stored auth.userId
      // (e.g. "user_2xyz...") into moved_by_name instead of a real name.
      // Two-way lookup: try FK first (csh.moved_by = users.id), then try
      // treating moved_by_name as a clerk_user_id. Fall back to any
      // non-clerk-shaped moved_by_name string, then "Unknown user".
      query(
        `SELECT csh.*,
                COALESCE(
                  u_fk.name,
                  u_clerk.name,
                  CASE WHEN csh.moved_by_name LIKE 'user_%' THEN NULL ELSE csh.moved_by_name END,
                  'Unknown user'
                ) AS moved_by_name
         FROM candidate_stage_history csh
         LEFT JOIN users u_fk    ON csh.moved_by      = u_fk.id
         LEFT JOIN users u_clerk ON csh.moved_by_name = u_clerk.clerk_user_id
         WHERE csh.candidate_id = $1
         ORDER BY csh.created_at ASC`,
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
    // Auto-assign recruiter: if caller didn't specify one, default to the
    // logged-in user's users.id. Per Phase 1.1A — recruiter creating a
    // candidate should own it by default. Manual override still works via
    // the explicit assigned_recruiter_id param.
    const result = await query(
      `INSERT INTO candidates (first_name, last_name, email, phone, address, city, state, zip, role,
        specialties, skills, certifications, licenses, years_experience, education, resume_url,
        assigned_recruiter_id, target_facility_id, desired_pay_rate, offered_pay_rate,
        availability_start, availability_type, available_shifts, recruiter_notes, hr_notes, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               COALESCE($17, (SELECT id FROM users WHERE clerk_user_id = $27 LIMIT 1)),
               $18,$19,$20,$21,$22,$23,$24,$25,$26,
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

    await logAudit(null, auth?.userId ?? 'unknown', 'candidate.create', String(candidate.id),
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
    // Phase 1.4 QA fix — validate that the requested stage is one the
    // admin has actually configured. Falls back to the legacy 7 keys
    // if the pipeline_stages table doesn't exist (fresh DB before that
    // migration ran).
    const LEGACY_STAGES = ['application','interview','credentialing','onboarding','placed','rejected','withdrawn'];
    let validStageKeys: string[] = LEGACY_STAGES;
    try {
      const stagesRes = await query<{ key: string }>(`SELECT key FROM pipeline_stages WHERE active = TRUE`);
      if (stagesRes.rows.length > 0) {
        validStageKeys = stagesRes.rows.map((r) => r.key);
      }
    } catch { /* table missing — fall through to legacy list */ }

    if (!validStageKeys.includes(stage)) {
      res.status(400).json({
        error: `Unknown stage '${stage}'. Valid stages: ${validStageKeys.join(', ')}`,
      });
      return;
    }

    const current = await query(
      `SELECT stage, target_facility_id FROM candidates WHERE id = $1`,
      [id]
    );
    if (current.rows.length === 0) { res.status(404).json({ error: 'Candidate not found' }); return; }

    const fromStage = current.rows[0].stage as string;
    const targetFacilityId = (current.rows[0].target_facility_id ?? null) as string | null;

    await query(`UPDATE candidates SET stage = $1, updated_at = NOW() WHERE id = $2`, [stage, id]);
    await query(
      `INSERT INTO candidate_stage_history (candidate_id, from_stage, to_stage, moved_by, moved_by_name, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, fromStage, stage, req.userRecord?.id ?? null, req.userRecord?.name ?? req.userRecord?.email ?? 'Unknown', notes ?? null]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'candidate.stageMove', id,
      { from: fromStage, to: stage }, (req.ip ?? 'unknown'));

    // ─── Auto-create placement when candidate lands in 'placed' ─────────────
    // Mirrors the submission-level auto-placement. Idempotent: skips if a
    // placement for this candidate already exists. Preference order for the
    // job/submission link:
    //   1. Most-recent submission for this candidate (if ATS is in use)
    //   2. Candidate.target_facility_id (older workflow)
    //   3. Standalone placement with candidate_id only
    // Failures are logged, never surface to the caller — the stage move
    // itself is the primary contract of this endpoint.
    let placement_created = false;
    let placement_id: string | null = null;
    if (stage === 'placed') {
      try {
        const existing = await query(`SELECT id FROM placements WHERE candidate_id = $1 LIMIT 1`, [id]);
        if (existing.rows.length > 0) {
          placement_id = existing.rows[0].id as string;
        } else {
          // Try to find a latest submission → gives us job_id + facility_id + client_id
          let jobId: string | null = null;
          let submissionId: string | null = null;
          let facilityId: string | null = targetFacilityId;
          let clientId: string | null = null;
          let startDate: string | null = null;
          let endDate: string | null = null;
          let payRate: number | null = null;
          let role: string = 'Placement';

          const subRes = await query(
            `SELECT s.id AS submission_id, s.job_id, s.pay_rate,
                    j.facility_id, j.client_id, j.start_date, j.end_date, j.title
             FROM submissions s
             LEFT JOIN jobs j ON s.job_id = j.id
             WHERE s.candidate_id = $1
             ORDER BY s.created_at DESC
             LIMIT 1`,
            [id]
          ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

          if (subRes.rows.length > 0) {
            const r = subRes.rows[0] as {
              submission_id: string; job_id: string; pay_rate: string | null;
              facility_id: string | null; client_id: string | null;
              start_date: string | null; end_date: string | null; title: string | null;
            };
            submissionId = r.submission_id;
            jobId = r.job_id;
            facilityId = r.facility_id ?? facilityId;
            clientId = r.client_id;
            startDate = r.start_date;
            endDate = r.end_date;
            payRate = r.pay_rate != null ? Number(r.pay_rate) : null;
            if (r.title) role = r.title;
          }

          const placementCode = `P-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
          const ins = await query(
            `INSERT INTO placements (
               facility_id, role, staff_id, candidate_id, job_id, submission_id, client_id,
               start_date, end_date, hourly_rate, status, contract_status, placement_code, notes
             ) VALUES (
               $1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, 'pending', 'not_sent', $10, $11
             ) RETURNING id`,
            [
              facilityId, role, id, jobId, submissionId, clientId,
              startDate, endDate, payRate, placementCode,
              `Auto-created from candidate stage move to 'placed'.`,
            ]
          );
          placement_id = ins.rows[0].id as string;
          placement_created = true;

          await logAudit(
            req.userRecord?.id ?? null, auth?.userId ?? 'system',
            'placement.auto_create_from_candidate', placement_id,
            { candidate_id: id, job_id: jobId, submission_id: submissionId, facility_id: facilityId }
          );
        }
      } catch (placementErr) {
        console.error('[candidate.move-stage] Placement auto-create failed:', placementErr);
      }
    }

    res.json({ success: true, from: fromStage, to: stage, placement_created, placement_id });
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
      const parsed = await parseResume(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );

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
      // ResumeParseError carries a user-facing message we can pass straight
      // through. Everything else is a real 500 and stays generic.
      if (err instanceof ResumeParseError) {
        console.error('Parse resume error:', err.message);
        // 422 = the request was valid but we couldn't process the content
        res.status(422).json({ error: err.userFacing });
        return;
      }
      console.error('Parse resume error:', err);
      res.status(500).json({ error: 'Resume parsing failed. Please retry or fill in manually.' });
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

// POST /:id/documents/:docId/review — Phase 1.3B credential gate AI review.
// Uploads a file, runs Claude document review, saves the review into the
// candidate_documents row (as structured notes), optionally auto-updates
// status when confidence is 'high'. Returns the full review to the frontend.
router.post('/:id/documents/:docId/review', requireAuth, requirePermission('credentialing_manage'),
  upload.single('file'), async (req: Request, res: Response) => {
    const { id, docId } = req.params;
    const auth = getAuth(req);
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded (multipart field name: "file")' });
      return;
    }

    try {
      // Load the doc row so we know the document_type the user claimed.
      const docRes = await query(
        `SELECT * FROM candidate_documents WHERE id = $1 AND candidate_id = $2`,
        [docId, id]
      );
      if (docRes.rows.length === 0) {
        res.status(404).json({ error: 'Document row not found' });
        return;
      }
      const doc = docRes.rows[0];

      const review = await reviewDocument(req.file.buffer, req.file.mimetype, String(doc.document_type));

      // Persist: store the review as JSON in notes, update expiry if AI found
      // one, and auto-advance status ONLY when AI is confident. Anything
      // uncertain stays 'pending' for a human to approve.
      const nextStatus = review.confidence === 'high' && review.type_match && review.complete && !review.expired
        ? 'approved'
        : (review.recommended_status === 'rejected' ? 'rejected' : 'pending');

      const reviewNote = JSON.stringify({
        reviewed_at: new Date().toISOString(),
        reviewed_by: auth?.userId ?? null,
        ai: review,
      });

      await query(
        `UPDATE candidate_documents SET
           status = $1,
           expiry_date = COALESCE($2, expiry_date),
           notes = $3,
           uploaded_at = NOW(),
           updated_at = NOW()
         WHERE id = $4 AND candidate_id = $5`,
        [nextStatus, review.expiry_date, reviewNote, docId, id]
      );

      await logAudit(null, auth?.userId ?? 'unknown', 'candidate.document.ai_review', docId,
        { label: doc.label, confidence: review.confidence, status: nextStatus },
        (req.ip ?? 'unknown'));

      res.json({
        success: true,
        review,
        status: nextStatus,
        file: { name: req.file.originalname, size: req.file.size },
      });
    } catch (err) {
      if (err instanceof DocumentReviewError) {
        console.error('Doc review error:', err.message);
        res.status(422).json({ error: err.userFacing });
        return;
      }
      console.error('Doc review route error:', err);
      res.status(500).json({ error: 'Document review failed. Please retry or approve manually.' });
    }
  }
);

// GET /:id/stage-history
router.get('/:id/stage-history', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT csh.*,
              COALESCE(
                u_fk.name, u_clerk.name,
                CASE WHEN csh.moved_by_name LIKE 'user_%' THEN NULL ELSE csh.moved_by_name END,
                'Unknown user'
              ) AS moved_by_name
       FROM candidate_stage_history csh
       LEFT JOIN users u_fk    ON csh.moved_by      = u_fk.id
       LEFT JOIN users u_clerk ON csh.moved_by_name = u_clerk.clerk_user_id
       WHERE csh.candidate_id = $1
       ORDER BY csh.created_at ASC`,
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

// ═══════════════════════════════════════════════════════════════════════════
// QA Phase 4: Candidate → Staff conversion
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /:id/convert-to-staff
 * Converts an onboarding-complete candidate into a staff record and wires
 * backlinks (any placements tied to this candidate are updated with the new
 * staff_id). Idempotent: if a staff row with the same email already exists,
 * that record is reused.
 */
router.post('/:id/convert-to-staff', requireAuth, requirePermission('staff_manage'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const candRes = await query(
      `SELECT first_name, last_name, email, phone, role FROM candidates WHERE id = $1`,
      [req.params.id]
    );
    if (candRes.rows.length === 0) { res.status(404).json({ error: 'Candidate not found' }); return; }
    const c = candRes.rows[0] as { first_name: string; last_name: string; email: string | null; phone: string | null; role: string | null };

    // Look up or create staff
    let staffId: string | null = null;
    if (c.email) {
      const existing = await query<{ id: string }>(`SELECT id FROM staff WHERE LOWER(email) = LOWER($1) LIMIT 1`, [c.email]);
      if (existing.rows.length > 0) staffId = existing.rows[0].id;
    }

    if (!staffId) {
      const ins = await query<{ id: string }>(
        `INSERT INTO staff (first_name, last_name, email, phone, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING id`,
        [c.first_name, c.last_name, c.email, c.phone, c.role]
      );
      staffId = ins.rows[0].id;
    } else {
      // Promote existing staff to 'active' in case they were onboarding
      await query(`UPDATE staff SET status = 'active', updated_at = NOW() WHERE id = $1`, [staffId]);
    }

    // Update any placements that referenced this candidate to point at the staff row
    await query(
      `UPDATE placements SET staff_id = $1 WHERE candidate_id = $2 AND staff_id IS NULL`,
      [staffId, req.params.id]
    );

    // Mark candidate as placed (if not already) and log
    await query(`UPDATE candidates SET status = 'placed', stage = 'placed', updated_at = NOW() WHERE id = $1`, [req.params.id]);

    await logAudit(
      req.userRecord?.id ?? null, getAuth(req).userId ?? 'system',
      'candidate.convert_to_staff', req.params.id,
      { staff_id: staffId }
    );

    res.json({ staff_id: staffId, created: true });
  } catch (err) {
    console.error('Convert-to-staff error:', err);
    res.status(500).json({ error: 'Failed to convert candidate to staff' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ATS Phase 5: AI outreach endpoints (SMS, recruiter summary, client summary)
// ═══════════════════════════════════════════════════════════════════════════

async function loadCandidateForOutreach(candidateId: string) {
  const r = await query(
    `SELECT first_name, last_name, role, specialties, skills, certifications, licenses,
            years_experience, city, state, desired_pay_rate, availability_type, available_shifts
     FROM candidates WHERE id = $1`,
    [candidateId]
  );
  if (r.rows.length === 0) return null;
  return r.rows[0] as import('../services/ai').CandidateForOutreach;
}

async function loadJobForOutreachById(jobId: string) {
  const r = await query(
    `SELECT j.title, j.profession, j.specialty, j.sub_specialty, j.city, j.state,
            j.job_type, j.shift, j.hours_per_week, j.duration_weeks, j.start_date,
            j.pay_rate, j.bill_rate, j.stipend, j.description,
            cl.name AS client_name, f.name AS facility_name
     FROM jobs j
     LEFT JOIN clients cl ON j.client_id = cl.id
     LEFT JOIN facilities f ON j.facility_id = f.id
     WHERE j.id = $1`,
    [jobId]
  );
  if (r.rows.length === 0) return null;
  return r.rows[0] as unknown as import('../services/ai').JobForAI;
}

router.post('/:id/ai/sms-outreach', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const { generateSmsOutreach } = await import('../services/ai');
    const cand = await loadCandidateForOutreach(req.params.id);
    if (!cand) { res.status(404).json({ error: 'Candidate not found' }); return; }
    const jobId = typeof req.body?.job_id === 'string' ? req.body.job_id : null;
    const job = jobId ? await loadJobForOutreachById(jobId) : undefined;
    const message = await generateSmsOutreach(cand, job ?? undefined);
    res.json({ message });
  } catch (err) {
    console.error('SMS outreach generation error:', err);
    res.status(500).json({ error: 'Failed to generate SMS' });
  }
});

router.post('/:id/ai/recruiter-summary', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const { generateRecruiterSummary } = await import('../services/ai');
    const cand = await loadCandidateForOutreach(req.params.id);
    if (!cand) { res.status(404).json({ error: 'Candidate not found' }); return; }
    const jobId = typeof req.body?.job_id === 'string' ? req.body.job_id : null;
    const job = jobId ? await loadJobForOutreachById(jobId) : undefined;
    const summary = await generateRecruiterSummary(cand, job ?? undefined);
    res.json({ summary });
  } catch (err) {
    console.error('Recruiter summary error:', err);
    res.status(500).json({ error: 'Failed to generate recruiter summary' });
  }
});

router.post('/:id/ai/client-summary', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const { generateClientSummary } = await import('../services/ai');
    const cand = await loadCandidateForOutreach(req.params.id);
    if (!cand) { res.status(404).json({ error: 'Candidate not found' }); return; }
    const jobId = typeof req.body?.job_id === 'string' ? req.body.job_id : null;
    const job = jobId ? await loadJobForOutreachById(jobId) : undefined;
    const summary = await generateClientSummary(cand, job ?? undefined);
    res.json({ summary });
  } catch (err) {
    console.error('Client summary error:', err);
    res.status(500).json({ error: 'Failed to generate client summary' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ATS Phase 3: Matching jobs for a given candidate
// ═══════════════════════════════════════════════════════════════════════════

// GET /:id/matching-jobs — ranked list of open jobs this candidate may fit
router.get('/:id/matching-jobs', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const candRes = await query(
      `SELECT role, specialties, city, state FROM candidates WHERE id = $1`,
      [req.params.id]
    );
    if (candRes.rows.length === 0) { res.status(404).json({ error: 'Candidate not found' }); return; }
    const c = candRes.rows[0] as { role: string | null; specialties: string[] | null; city: string | null; state: string | null };
    const specialties = c.specialties ?? [];

    // Mirror of jobs./matching-candidates scoring: profession + specialty overlap + location
    const result = await query(
      `SELECT j.id, j.job_code, j.title, j.profession, j.specialty, j.city, j.state, j.priority,
              cl.name AS client_name, f.name AS facility_name,
              (CASE WHEN j.profession = $1 THEN 40 ELSE 0 END
               + CASE WHEN j.specialty = ANY($2::text[]) THEN 30 ELSE 0 END
               + CASE WHEN j.city ILIKE $3 THEN 20 WHEN j.state = $4 THEN 10 ELSE 0 END) AS match_score,
              EXISTS (SELECT 1 FROM submissions s WHERE s.candidate_id = $5 AND s.job_id = j.id) AS already_submitted
       FROM jobs j
       LEFT JOIN clients cl ON j.client_id = cl.id
       LEFT JOIN facilities f ON j.facility_id = f.id
       WHERE j.status = 'open'
       ORDER BY match_score DESC, j.created_at DESC
       LIMIT 50`,
      [c.role, specialties, c.city ? `%${c.city}%` : null, c.state, req.params.id]
    );
    res.json({ jobs: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ jobs: [] }); return; }
    console.error('Candidate matching jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch matching jobs' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ATS Phase 1: Duplicate detection + saved views
// ═══════════════════════════════════════════════════════════════════════════

// GET /duplicates?email=&phone=&name=&exclude_id=
// Returns candidates matching any of the provided signals. Used by new-candidate
// forms and a merge-candidate UX (Phase 3 will add the actual merge).
router.get('/duplicates', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  const { email, phone, name, exclude_id } = req.query;
  if (!email && !phone && !name) { res.status(400).json({ error: 'Provide at least one of: email, phone, name' }); return; }

  const matchConditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (email) {
    matchConditions.push(`LOWER(email) = LOWER($${idx++})`);
    params.push(email);
  }
  if (phone) {
    matchConditions.push(`REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', '', 'g') = REGEXP_REPLACE($${idx++}, '[^0-9]', '', 'g')`);
    params.push(phone);
  }
  if (name) {
    const parts = String(name).trim().split(/\s+/);
    if (parts.length >= 2) {
      matchConditions.push(`(LOWER(first_name) = LOWER($${idx}) AND LOWER(last_name) = LOWER($${idx + 1}))`);
      params.push(parts[0], parts.slice(1).join(' '));
      idx += 2;
    } else {
      matchConditions.push(`(LOWER(first_name) = LOWER($${idx}) OR LOWER(last_name) = LOWER($${idx}))`);
      params.push(parts[0]);
      idx++;
    }
  }

  const excludeClause = exclude_id ? `AND id <> $${idx++}` : '';
  if (exclude_id) params.push(exclude_id);

  try {
    const result = await query(
      `SELECT id, first_name, last_name, email, phone, role, stage, status, created_at
       FROM candidates
       WHERE (${matchConditions.join(' OR ')})
       ${excludeClause}
       ORDER BY created_at DESC
       LIMIT 20`,
      params
    );
    res.json({ candidates: result.rows, match_count: result.rows.length });
  } catch (err) {
    console.error('Duplicate lookup error:', err);
    res.status(500).json({ error: 'Failed to look up duplicates' });
  }
});

// POST /:id/merge — Phase 1 stub. Records intent; actual merge lands in Phase 3.
router.post('/:id/merge', requireAuth, requirePermission('candidates_edit'), async (req: AuthenticatedRequest, res: Response) => {
  const { target_id, notes } = req.body as { target_id?: string; notes?: string };
  if (!target_id) { res.status(400).json({ error: 'target_id required' }); return; }
  await logAudit(
    req.userRecord?.id ?? null,
    getAuth(req).userId ?? 'system',
    'candidate.merge_requested',
    req.params.id,
    { target_id, notes }
  );
  res.status(202).json({ status: 'queued', message: 'Merge recorded. Manual review required until Phase 3 ships automatic merge.' });
});

// ─── Saved candidate views ────────────────────────────────────────────────
router.get('/saved-views', requireAuth, requirePermission('candidates_view'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM candidate_saved_views WHERE user_id = $1 OR is_shared = TRUE ORDER BY created_at DESC`,
      [req.userRecord?.id ?? null]
    );
    res.json({ views: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ views: [] }); return; }
    console.error('Saved views error:', err);
    res.status(500).json({ error: 'Failed to fetch saved views' });
  }
});

router.post('/saved-views', requireAuth, requirePermission('candidates_view'), async (req: AuthenticatedRequest, res: Response) => {
  const { name, filters, is_shared } = req.body as { name?: string; filters?: Record<string, unknown>; is_shared?: boolean };
  if (!name || typeof name !== 'string') { res.status(400).json({ error: 'name is required' }); return; }
  try {
    const result = await query(
      `INSERT INTO candidate_saved_views (user_id, name, filters, is_shared) VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
      [req.userRecord?.id ?? null, name, JSON.stringify(filters ?? {}), is_shared ?? false]
    );
    res.status(201).json({ view: result.rows[0] });
  } catch (err) {
    console.error('Saved view create error:', err);
    res.status(500).json({ error: 'Failed to save view' });
  }
});

router.delete('/saved-views/:id', requireAuth, requirePermission('candidates_view'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM candidate_saved_views WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.userRecord?.id ?? null]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'View not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Saved view delete error:', err);
    res.status(500).json({ error: 'Failed to delete view' });
  }
});

export default router;
