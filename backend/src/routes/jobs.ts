import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getAuth } from '../middleware/auth';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { generateJobAd, generateJobSummary, type JobForAI } from '../services/ai';
import { generateBooleanSearch } from '../services/boolean';

const router = Router();

// ─── Schemas ───────────────────────────────────────────────────────────────
// Defined as a plain object first so we can derive a partial (.partial())
// for PUT without losing types. Refinement (pay_rate_min <= pay_rate_max)
// is applied by wrapping into jobSchema below, while jobUpdateSchema uses
// the raw shape with .partial() + a manual refine.
const jobObject = z.object({
  job_code: z.string().max(50).optional().nullable(),
  title: z.string().min(1).max(300),
  client_id: z.string().uuid().optional().nullable(),
  facility_id: z.string().uuid().optional().nullable(),
  client_job_id: z.string().max(100).optional().nullable(),
  profession: z.string().max(50).optional().nullable(),
  specialty: z.string().max(100).optional().nullable(),
  sub_specialty: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  duration_weeks: z.number().int().min(0).optional().nullable(),
  job_type: z.string().max(50).optional().nullable(),
  shift: z.string().max(50).optional().nullable(),
  hours_per_week: z.number().int().min(0).max(168).optional().nullable(),
  remote: z.boolean().optional(),
  positions: z.number().int().min(1).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  primary_recruiter_id: z.string().uuid().optional().nullable(),
  account_manager_id: z.string().uuid().optional().nullable(),
  recruitment_manager_id: z.string().uuid().optional().nullable(),
  bill_rate: z.number().optional().nullable(),
  pay_rate: z.number().optional().nullable(),
  // Phase 1.2A — pay range. min/max are optional; if only one single-point
  // value is known, pay_rate is the shorthand and min/max can be omitted.
  // Frontend validates min <= max before submitting; backend re-checks
  // in the refine below.
  pay_rate_min: z.number().optional().nullable(),
  pay_rate_max: z.number().optional().nullable(),
  margin: z.number().optional().nullable(),
  stipend: z.number().optional().nullable(),
  description: z.string().max(20000).optional().nullable(),
  status: z.enum(['draft', 'open', 'on_hold', 'filled', 'closed', 'cancelled']).optional(),
});

const jobSchema = jobObject.refine(
  (d) => d.pay_rate_min == null || d.pay_rate_max == null || d.pay_rate_min <= d.pay_rate_max,
  { message: 'pay_rate_min must be <= pay_rate_max', path: ['pay_rate_min'] }
);
const jobUpdateSchema = jobObject.partial().refine(
  (d) => d.pay_rate_min == null || d.pay_rate_max == null || d.pay_rate_min <= d.pay_rate_max,
  { message: 'pay_rate_min must be <= pay_rate_max', path: ['pay_rate_min'] }
);

const requirementSchema = z.object({
  kind: z.enum(['submission', 'onboarding']),
  bundle_id: z.string().uuid().optional().nullable(),
  ad_hoc: z
    .array(
      z.object({
        type: z.enum(['doc', 'cert', 'license', 'skill']).optional(),
        kind: z.string().optional(),
        label: z.string().min(1),
        required: z.boolean().optional(),
        notes: z.string().optional(),
      })
    )
    .optional()
    .default([]),
  notes: z.string().max(5000).optional().nullable(),
});

// ─── Helpers ───────────────────────────────────────────────────────────────
function generateJobCode(): string {
  const now = new Date();
  const y = now.getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `J-${y}-${rand}`;
}

// ─── GET / — list jobs ─────────────────────────────────────────────────────
router.get('/', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  const { status, client_id, facility_id, profession, specialty, priority, recruiter_id, search } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status) { conditions.push(`j.status = $${idx++}`); params.push(status); }
  if (client_id) { conditions.push(`j.client_id = $${idx++}`); params.push(client_id); }
  if (facility_id) { conditions.push(`j.facility_id = $${idx++}`); params.push(facility_id); }
  if (profession) { conditions.push(`j.profession = $${idx++}`); params.push(profession); }
  if (specialty) { conditions.push(`j.specialty ILIKE $${idx++}`); params.push(`%${specialty}%`); }
  if (priority) { conditions.push(`j.priority = $${idx++}`); params.push(priority); }
  if (recruiter_id) { conditions.push(`j.primary_recruiter_id = $${idx++}`); params.push(recruiter_id); }
  if (search) {
    conditions.push(`(j.title ILIKE $${idx} OR j.job_code ILIKE $${idx} OR j.city ILIKE $${idx} OR j.state ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT j.*,
              c.name AS client_name,
              f.name AS facility_name,
              u1.name AS primary_recruiter_name,
              u2.name AS account_manager_name,
              (SELECT COUNT(*)::INT FROM submissions s WHERE s.job_id = j.id) AS submission_count,
              EXTRACT(DAY FROM NOW() - j.created_at)::INT AS age_days
       FROM jobs j
       LEFT JOIN clients c ON j.client_id = c.id
       LEFT JOIN facilities f ON j.facility_id = f.id
       LEFT JOIN users u1 ON j.primary_recruiter_id = u1.id
       LEFT JOIN users u2 ON j.account_manager_id = u2.id
       ${where}
       ORDER BY
         CASE j.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         j.created_at DESC`,
      params
    );
    res.json({ jobs: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ jobs: [] }); return; }
    console.error('Jobs list error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// ─── GET /:id — full job record with requirements ──────────────────────────
router.get('/:id', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const [jobRes, reqRes] = await Promise.all([
      query(
        `SELECT j.*,
                c.name AS client_name,
                f.name AS facility_name,
                u1.name AS primary_recruiter_name,
                u2.name AS account_manager_name,
                u3.name AS recruitment_manager_name
         FROM jobs j
         LEFT JOIN clients c ON j.client_id = c.id
         LEFT JOIN facilities f ON j.facility_id = f.id
         LEFT JOIN users u1 ON j.primary_recruiter_id = u1.id
         LEFT JOIN users u2 ON j.account_manager_id = u2.id
         LEFT JOIN users u3 ON j.recruitment_manager_id = u3.id
         WHERE j.id = $1`,
        [req.params.id]
      ),
      query(
        `SELECT r.*, b.title AS bundle_title
         FROM job_requirements r
         LEFT JOIN comp_bundles b ON r.bundle_id = b.id
         WHERE r.job_id = $1
         ORDER BY r.kind, r.created_at`,
        [req.params.id]
      ),
    ]);
    if (jobRes.rows.length === 0) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json({ job: jobRes.rows[0], requirements: reqRes.rows });
  } catch (err) {
    console.error('Job fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// ─── POST / — create ───────────────────────────────────────────────────────
router.post('/', requireAuth, requirePermission('candidates_create'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = jobSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const data = parsed.data;
  const jobCode = data.job_code || generateJobCode();
  const auth = getAuth(req);

  try {
    const result = await query(
      `INSERT INTO jobs (
         job_code, title, client_id, facility_id, client_job_id, profession, specialty, sub_specialty,
         city, state, zip, lat, lng, start_date, end_date, duration_weeks, job_type, shift, hours_per_week,
         remote, positions, priority, primary_recruiter_id, account_manager_id, recruitment_manager_id,
         bill_rate, pay_rate, pay_rate_min, pay_rate_max, margin, stipend, description, status, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
       ) RETURNING *`,
      [
        jobCode, data.title, data.client_id, data.facility_id, data.client_job_id, data.profession, data.specialty, data.sub_specialty,
        data.city, data.state, data.zip, data.lat, data.lng, data.start_date, data.end_date, data.duration_weeks, data.job_type, data.shift, data.hours_per_week,
        data.remote ?? false, data.positions ?? 1, data.priority ?? 'normal', data.primary_recruiter_id, data.account_manager_id, data.recruitment_manager_id,
        data.bill_rate, data.pay_rate, data.pay_rate_min, data.pay_rate_max, data.margin, data.stipend, data.description, data.status ?? 'open', auth.userId ?? null,
      ]
    );
    await logAudit(req.userRecord?.id ?? null, auth.userId ?? 'system', 'job.create', result.rows[0].id as string);
    res.status(201).json({ job: result.rows[0] });
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: 'Job code already exists' }); return; }
    console.error('Job create error:', err);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// ─── PUT /:id — update ────────────────────────────────────────────────────
router.put('/:id', requireAuth, requirePermission('candidates_edit'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = jobUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (fields.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  const setClause = fields.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  const values = fields.map(([, v]) => v);
  values.push(req.params.id);

  try {
    const result = await query(
      `UPDATE jobs SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Job not found' }); return; }
    await logAudit(req.userRecord?.id ?? null, getAuth(req).userId ?? 'system', 'job.update', req.params.id);
    res.json({ job: result.rows[0] });
  } catch (err) {
    console.error('Job update error:', err);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

// ─── DELETE /:id ───────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('candidates_delete'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(`DELETE FROM jobs WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Job not found' }); return; }
    await logAudit(req.userRecord?.id ?? null, getAuth(req).userId ?? 'system', 'job.delete', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Job delete error:', err);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// ─── POST /:id/requirements — add a requirement row ───────────────────────
router.post('/:id/requirements', requireAuth, requirePermission('candidates_edit'), async (req: Request, res: Response) => {
  const parsed = requirementSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const { kind, bundle_id, ad_hoc, notes } = parsed.data;

  try {
    const result = await query(
      `INSERT INTO job_requirements (job_id, kind, bundle_id, ad_hoc, notes)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING *`,
      [req.params.id, kind, bundle_id ?? null, JSON.stringify(ad_hoc ?? []), notes ?? null]
    );
    res.status(201).json({ requirement: result.rows[0] });
  } catch (err) {
    console.error('Job requirement add error:', err);
    res.status(500).json({ error: 'Failed to add requirement' });
  }
});

// ─── DELETE /:id/requirements/:reqId ──────────────────────────────────────
router.delete('/:id/requirements/:reqId', requireAuth, requirePermission('candidates_edit'), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM job_requirements WHERE id = $1 AND job_id = $2 RETURNING id`,
      [req.params.reqId, req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Requirement not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Job requirement delete error:', err);
    res.status(500).json({ error: 'Failed to delete requirement' });
  }
});

// ─── Inline AI actions ────────────────────────────────────────────────────
async function loadJobForAI(jobId: string): Promise<JobForAI | null> {
  const result = await query(
    `SELECT j.*, c.name AS client_name, f.name AS facility_name
     FROM jobs j
     LEFT JOIN clients c ON j.client_id = c.id
     LEFT JOIN facilities f ON j.facility_id = f.id
     WHERE j.id = $1`,
    [jobId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0] as Record<string, unknown>;

  // Pull required credentials/skills from job_requirements (bundle title + ad_hoc labels)
  const reqRes = await query(
    `SELECT r.kind, r.ad_hoc, b.title AS bundle_title
     FROM job_requirements r
     LEFT JOIN comp_bundles b ON r.bundle_id = b.id
     WHERE r.job_id = $1 AND r.kind = 'submission'`,
    [jobId]
  );
  const required_credentials: string[] = [];
  const required_skills: string[] = [];
  for (const row of reqRes.rows) {
    if (row.bundle_title) required_credentials.push(row.bundle_title as string);
    const ad = Array.isArray(row.ad_hoc) ? row.ad_hoc : [];
    for (const it of ad) {
      const label = it.label?.toString();
      if (!label) continue;
      if (it.type === 'skill') required_skills.push(label);
      else required_credentials.push(label);
    }
  }

  return {
    title: String(r.title ?? ''),
    profession: r.profession as string | null,
    specialty: r.specialty as string | null,
    sub_specialty: r.sub_specialty as string | null,
    city: r.city as string | null,
    state: r.state as string | null,
    job_type: r.job_type as string | null,
    shift: r.shift as string | null,
    hours_per_week: r.hours_per_week as number | null,
    duration_weeks: r.duration_weeks as number | null,
    start_date: r.start_date as string | null,
    pay_rate: r.pay_rate as number | null,
    bill_rate: r.bill_rate as number | null,
    stipend: r.stipend as number | null,
    description: r.description as string | null,
    required_credentials,
    required_skills,
    client_name: r.client_name as string | null,
    facility_name: r.facility_name as string | null,
  };
}

router.post('/:id/ai/boolean', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const { guardAIRequest } = await import('../services/permissions/aiGuard');
    const guard = await guardAIRequest({
      req, tool: 'ai_job_boolean', toolPermission: 'ai.chat.use',
      additionalRequired: ['jobs.view', 'ai.topic.candidates'],
      prompt: `Boolean search for job ${req.params.id}`,
    });
    if (!guard.allowed) { res.status(403).json({ error: guard.denialMessage }); return; }

    const job = await loadJobForAI(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    const boolean_search = await generateBooleanSearch(job);
    await query(`UPDATE jobs SET boolean_search = $1, updated_at = NOW() WHERE id = $2`, [boolean_search, req.params.id]);
    res.json({ boolean_search });
  } catch (err) {
    console.error('Job AI boolean error:', err);
    res.status(500).json({ error: 'Failed to generate boolean search' });
  }
});

router.post('/:id/ai/job-ad', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const { guardAIRequest } = await import('../services/permissions/aiGuard');
    const guard = await guardAIRequest({
      req, tool: 'ai_job_ad', toolPermission: 'ai.chat.use',
      additionalRequired: ['jobs.view'],
      prompt: `Job ad for ${req.params.id}`,
    });
    if (!guard.allowed) { res.status(403).json({ error: guard.denialMessage }); return; }

    const job = await loadJobForAI(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    const job_ad = await generateJobAd(job);
    await query(`UPDATE jobs SET job_ad = $1, updated_at = NOW() WHERE id = $2`, [job_ad, req.params.id]);
    res.json({ job_ad });
  } catch (err) {
    console.error('Job AI job-ad error:', err);
    res.status(500).json({ error: 'Failed to generate job ad' });
  }
});

router.post('/:id/ai/summary', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const { guardAIRequest } = await import('../services/permissions/aiGuard');
    const guard = await guardAIRequest({
      req, tool: 'ai_job_summary', toolPermission: 'ai.chat.use',
      additionalRequired: ['jobs.view'],
      prompt: `Job summary for ${req.params.id}`,
    });
    if (!guard.allowed) { res.status(403).json({ error: guard.denialMessage }); return; }

    const job = await loadJobForAI(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    const summary = await generateJobSummary(job);
    await query(`UPDATE jobs SET summary = $1, updated_at = NOW() WHERE id = $2`, [summary, req.params.id]);
    res.json({ summary });
  } catch (err) {
    console.error('Job AI summary error:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// ─── GET /:id/matching-candidates — basic ranked list ─────────────────────
router.get('/:id/matching-candidates', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const jobRes = await query(
      `SELECT profession, specialty, city, state FROM jobs WHERE id = $1`,
      [req.params.id]
    );
    if (jobRes.rows.length === 0) { res.status(404).json({ error: 'Job not found' }); return; }
    const j = jobRes.rows[0] as { profession: string | null; specialty: string | null; city: string | null; state: string | null };

    // Simple scoring at the DB level: profession match + specialty intersection + location match.
    // Phase 3 will introduce richer scoring via candidateScoring service.
    //
    // Per Phase 1.2B — exclude candidates already submitted to this job.
    // A submission exists => this candidate has already been pitched.
    // Keeping them in the matching list causes recruiters to pitch the
    // same person twice; filter them out and return them separately.
    const [matchRes, submittedRes] = await Promise.all([
      query(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.role, c.specialties, c.city, c.state, c.years_experience,
                (CASE WHEN c.role = $1 THEN 40 ELSE 0 END
                 + CASE WHEN $2 = ANY(c.specialties) THEN 30 ELSE 0 END
                 + CASE WHEN c.city ILIKE $3 THEN 20 WHEN c.state = $4 THEN 10 ELSE 0 END) AS match_score
         FROM candidates c
         WHERE c.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM submissions s
             WHERE s.candidate_id = c.id AND s.job_id = $5
           )
         ORDER BY match_score DESC, c.updated_at DESC
         LIMIT 50`,
        [j.profession, j.specialty, j.city ? `%${j.city}%` : null, j.state, req.params.id]
      ),
      query(
        `SELECT c.id, c.first_name, c.last_name, c.role, c.city, c.state,
                s.stage_key, s.ai_score, s.ai_fit_label, s.updated_at
         FROM submissions s
         JOIN candidates c ON c.id = s.candidate_id
         WHERE s.job_id = $1
         ORDER BY s.updated_at DESC`,
        [req.params.id]
      ),
    ]);
    res.json({
      candidates: matchRes.rows,
      already_submitted: submittedRes.rows,
    });
  } catch (err) {
    console.error('Matching candidates error:', err);
    res.status(500).json({ error: 'Failed to fetch matching candidates' });
  }
});

export default router;
