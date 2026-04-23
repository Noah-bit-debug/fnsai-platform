import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getAuth } from '../middleware/auth';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { runGate } from '../services/credentialGate';
import { scoreCandidateForJob, type ScoringCandidate, type ScoringJob } from '../services/candidateScoring';
import { applyOnboardingBundlesForPlacement } from '../services/complianceAssignment';

const router = Router();

const submissionSchema = z.object({
  candidate_id: z.string().uuid(),
  job_id: z.string().uuid(),
  recruiter_id: z.string().uuid().optional().nullable(),
  stage_key: z.string().max(50).optional().nullable(),
  candidate_summary: z.string().max(5000).optional().nullable(),
  skill_ratings: z.array(z.object({ skill: z.string(), rating: z.number().int().min(1).max(5), notes: z.string().optional() })).optional(),
  bill_rate: z.number().optional().nullable(),
  pay_rate: z.number().optional().nullable(),
  stipend: z.number().optional().nullable(),
  expenses: z.number().optional().nullable(),
  margin: z.number().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

const moveStageSchema = z.object({
  stage_key: z.string().min(1).max(50),
  note: z.string().max(2000).optional().nullable(),
});

// â”€â”€â”€ GET / â€” list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  const { candidate_id, job_id, recruiter_id, stage_key, fit_label, gate_status } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (candidate_id) { conditions.push(`s.candidate_id = $${idx++}`); params.push(candidate_id); }
  if (job_id) { conditions.push(`s.job_id = $${idx++}`); params.push(job_id); }
  if (recruiter_id) { conditions.push(`s.recruiter_id = $${idx++}`); params.push(recruiter_id); }
  if (stage_key) { conditions.push(`s.stage_key = $${idx++}`); params.push(stage_key); }
  if (fit_label) { conditions.push(`s.ai_fit_label = $${idx++}`); params.push(fit_label); }
  if (gate_status) { conditions.push(`s.gate_status = $${idx++}`); params.push(gate_status); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT s.*,
              (c.first_name || ' ' || c.last_name) AS candidate_name,
              c.role AS candidate_role,
              j.title AS job_title,
              j.job_code,
              cl.name AS client_name,
              f.name AS facility_name,
              u.name AS recruiter_name,
              ps.label AS stage_label, ps.color AS stage_color
       FROM submissions s
       JOIN candidates c ON s.candidate_id = c.id
       JOIN jobs j ON s.job_id = j.id
       LEFT JOIN clients cl ON j.client_id = cl.id
       LEFT JOIN facilities f ON j.facility_id = f.id
       LEFT JOIN users u ON s.recruiter_id = u.id
       LEFT JOIN pipeline_stages ps ON ps.key = s.stage_key AND ps.tenant_id = 'default'
       ${where}
       ORDER BY s.created_at DESC
       LIMIT 500`,
      params
    );
    res.json({ submissions: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ submissions: [] }); return; }
    console.error('Submissions list error:', err);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// â”€â”€â”€ GET /:id â€” full record + stage history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/:id', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const [subRes, histRes] = await Promise.all([
      query(
        `SELECT s.*,
                (c.first_name || ' ' || c.last_name) AS candidate_name,
                c.role AS candidate_role,
                j.title AS job_title, j.job_code, j.profession AS job_profession, j.specialty AS job_specialty,
                cl.name AS client_name,
                f.name AS facility_name,
                u.name AS recruiter_name
         FROM submissions s
         JOIN candidates c ON s.candidate_id = c.id
         JOIN jobs j ON s.job_id = j.id
         LEFT JOIN clients cl ON j.client_id = cl.id
         LEFT JOIN facilities f ON j.facility_id = f.id
         LEFT JOIN users u ON s.recruiter_id = u.id
         WHERE s.id = $1`,
        [req.params.id]
      ),
      // Per Phase 1.3A: replace raw changed_by UUID with a human name.
      // Prefer the denormalized changed_by_name if it was stored; fall
      // back to the current users.name from the FK; fall back to a
      // reasonable "Unknown user" rather than letting a UUID bleed through
      // to the UI.
      query(
        `SELECT h.*,
                COALESCE(NULLIF(h.changed_by_name, ''), u.name, 'Unknown user') AS display_changed_by
         FROM submission_stage_history h
         LEFT JOIN users u ON u.id = h.changed_by
         WHERE h.submission_id = $1
         ORDER BY h.created_at DESC`,
        [req.params.id]
      ),
    ]);
    if (subRes.rows.length === 0) { res.status(404).json({ error: 'Submission not found' }); return; }
    res.json({ submission: subRes.rows[0], stage_history: histRes.rows });
  } catch (err) {
    console.error('Submission fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

// â”€â”€â”€ POST / â€” create (auto gate + auto score) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/', requireAuth, requirePermission('candidates_create'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = submissionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const auth = getAuth(req);

  try {
    // Load candidate + job for scoring
    const [candRes, jobRes] = await Promise.all([
      query(`SELECT * FROM candidates WHERE id = $1`, [d.candidate_id]),
      query(`SELECT * FROM jobs WHERE id = $1`, [d.job_id]),
    ]);
    if (candRes.rows.length === 0) { res.status(404).json({ error: 'Candidate not found' }); return; }
    if (jobRes.rows.length === 0) { res.status(404).json({ error: 'Job not found' }); return; }

    // Gate + AI score (in parallel). Swallow AI errors so creation never 500s on model issues.
    const gatePromise = runGate({ candidate_id: d.candidate_id, kind: 'submission', job_id: d.job_id });
    const cand = candRes.rows[0] as unknown as ScoringCandidate;
    const job = jobRes.rows[0] as unknown as ScoringJob;
    const scorePromise = scoreCandidateForJob(cand, job).catch((e) => {
      console.error('Scoring failed:', e);
      return null;
    });

    const [gate, score] = await Promise.all([gatePromise, scorePromise]);

    const initialStage = d.stage_key ?? 'internal_review';

    const ins = await query(
      `INSERT INTO submissions (
         candidate_id, job_id, recruiter_id, stage_key, candidate_summary, skill_ratings,
         bill_rate, pay_rate, stipend, expenses, margin,
         ai_score, ai_score_breakdown, ai_fit_label, ai_summary, ai_gaps,
         gate_status, gate_missing, notes, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::jsonb,$17,$18::jsonb,$19,$20
       ) RETURNING *`,
      [
        d.candidate_id, d.job_id, d.recruiter_id ?? null, initialStage, d.candidate_summary ?? null,
        JSON.stringify(d.skill_ratings ?? []),
        d.bill_rate ?? null, d.pay_rate ?? null, d.stipend ?? null, d.expenses ?? null, d.margin ?? null,
        score?.total ?? null, score ? JSON.stringify(score.breakdown) : null,
        score?.fit_label ?? null, score?.summary ?? null,
        score ? JSON.stringify(score.gaps) : '[]',
        gate.status, JSON.stringify(gate.missing), d.notes ?? null, auth.userId ?? null,
      ]
    );

    const submission = ins.rows[0];

    // Seed initial stage history
    await query(
      `INSERT INTO submission_stage_history (submission_id, from_stage, to_stage, changed_by_name, note)
       VALUES ($1, NULL, $2, $3, $4)`,
      [submission.id, initialStage, req.userRecord?.name ?? auth.userId ?? 'system', 'Submission created']
    );

    await logAudit(req.userRecord?.id ?? null, auth.userId ?? 'system', 'submission.create', submission.id as string, {
      job_id: d.job_id, candidate_id: d.candidate_id, gate_status: gate.status, ai_score: score?.total,
    });

    res.status(201).json({ submission, gate, score });
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: 'Submission already exists for this candidate and job' }); return; }
    console.error('Submission create error:', err);
    res.status(500).json({ error: 'Failed to create submission' });
  }
});

// â”€â”€â”€ PUT /:id â€” update editable fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.put('/:id', requireAuth, requirePermission('candidates_edit'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = submissionSchema.partial().omit({ candidate_id: true, job_id: true }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  const setParts: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [k, v] of entries) {
    if (k === 'skill_ratings') {
      setParts.push(`${k} = $${idx}::jsonb`);
      values.push(JSON.stringify(v));
    } else {
      setParts.push(`${k} = $${idx}`);
      values.push(v);
    }
    idx++;
  }
  values.push(req.params.id);

  try {
    const result = await query(
      `UPDATE submissions SET ${setParts.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Submission not found' }); return; }
    res.json({ submission: result.rows[0] });
  } catch (err) {
    console.error('Submission update error:', err);
    res.status(500).json({ error: 'Failed to update submission' });
  }
});

// â”€â”€â”€ POST /:id/move-stage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/:id/move-stage', requireAuth, requirePermission('candidate_stage_move'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = moveStageSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const { stage_key, note } = parsed.data;

  try {
    // Verify the stage exists
    const stageRes = await query(`SELECT key FROM pipeline_stages WHERE key = $1 AND tenant_id = 'default'`, [stage_key]);
    if (stageRes.rows.length === 0) { res.status(400).json({ error: `Unknown stage: ${stage_key}` }); return; }

    const current = await query(`SELECT stage_key FROM submissions WHERE id = $1`, [req.params.id]);
    if (current.rows.length === 0) { res.status(404).json({ error: 'Submission not found' }); return; }
    const fromStage = current.rows[0].stage_key as string | null;

    const updated = await query(
      `UPDATE submissions SET stage_key = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [stage_key, req.params.id]
    );

    await query(
      `INSERT INTO submission_stage_history (submission_id, from_stage, to_stage, changed_by, changed_by_name, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.params.id, fromStage, stage_key, req.userRecord?.id ?? null, req.userRecord?.name ?? getAuth(req).userId ?? 'system', note ?? null]
    );

    // â”€â”€â”€ Phase 5: auto-create placement when moving to 'placed' â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Idempotent: only creates a placement row if none exists for this
    // submission_id yet. The existing placements table is staff-oriented
    // (staff_id FK is nullable) â€” ATS-sourced placements set candidate_id
    // instead and leave staff_id null until the candidate is converted to
    // a staff record. Onboarding/compliance downstream can watch for these.
    let placement_created = false;
    let placement_id: string | null = null;
    let compliance_bundles_assigned: { bundle_id: string; bundle_title?: string; created: number; skipped: number }[] = [];
    if (stage_key === 'placed') {
      try {
        const existing = await query(
          `SELECT id FROM placements WHERE submission_id = $1 LIMIT 1`,
          [req.params.id]
        );
        if (existing.rows.length === 0) {
          const sub = updated.rows[0] as {
            id: string; candidate_id: string; job_id: string; recruiter_id?: string | null;
            bill_rate?: string | null; pay_rate?: string | null;
          };
          const jobRes = await query(
            `SELECT j.facility_id, j.client_id, j.start_date, j.end_date, j.title,
                    j.pay_rate AS job_pay_rate
             FROM jobs j WHERE j.id = $1`,
            [sub.job_id]
          );
          const j = jobRes.rows[0] as {
            facility_id?: string | null; client_id?: string | null;
            start_date?: string | null; end_date?: string | null; title: string;
            job_pay_rate?: string | null;
          } | undefined;

          const placementCode = `P-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
          const placementRate = sub.pay_rate ?? j?.job_pay_rate ?? null;

          const ins = await query(
            `INSERT INTO placements (
               facility_id, role, staff_id, candidate_id, job_id, submission_id, client_id,
               start_date, end_date, hourly_rate, status, contract_status, placement_code, notes
             ) VALUES (
               $1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, 'pending', 'not_sent', $10, $11
             ) RETURNING id`,
            [
              j?.facility_id ?? null, j?.title ?? 'Placement', sub.candidate_id, sub.job_id,
              sub.id, j?.client_id ?? null, j?.start_date ?? null, j?.end_date ?? null,
              placementRate, placementCode,
              `Auto-created from submission ${sub.id.slice(0, 8)} on stage change to 'placed'.`,
            ]
          );
          placement_id = ins.rows[0].id as string;
          placement_created = true;
          await logAudit(
            req.userRecord?.id ?? null, getAuth(req).userId ?? 'system',
            'placement.auto_create', placement_id,
            { submission_id: sub.id, candidate_id: sub.candidate_id, job_id: sub.job_id }
          );

          // Auto-assign onboarding compliance bundles (non-fatal on error)
          try {
            compliance_bundles_assigned = await applyOnboardingBundlesForPlacement({
              job_id: sub.job_id,
              candidate_id: sub.candidate_id,
              start_date: j?.start_date ?? null,
            });
            if (compliance_bundles_assigned.length > 0) {
              await logAudit(
                req.userRecord?.id ?? null, getAuth(req).userId ?? 'system',
                'compliance.auto_assign', placement_id,
                {
                  candidate_id: sub.candidate_id, job_id: sub.job_id,
                  bundles: compliance_bundles_assigned.map((b) => ({
                    bundle_id: b.bundle_id, bundle_title: b.bundle_title,
                    created: b.created, skipped: b.skipped,
                  })),
                }
              );
            }
          } catch (compErr) {
            console.error('[move-stage] Compliance auto-assign failed:', compErr);
          }
        } else {
          placement_id = existing.rows[0].id as string;
        }
      } catch (placementErr) {
        // Never fail the stage move because of placement creation; just log.
        console.error('[move-stage] Placement auto-create failed:', placementErr);
      }
    }

    await logAudit(req.userRecord?.id ?? null, getAuth(req).userId ?? 'system', 'submission.stage_move', req.params.id, { from: fromStage, to: stage_key });
    res.json({ submission: updated.rows[0], placement_created, placement_id, compliance_bundles_assigned });
  } catch (err) {
    console.error('Submission move-stage error:', err);
    res.status(500).json({ error: 'Failed to move stage' });
  }
});

// â”€â”€â”€ POST /:id/score â€” re-run AI scoring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/:id/score', requireAuth, requirePermission('candidates_edit'), async (req: Request, res: Response) => {
  try {
    const loaded = await query(
      `SELECT s.*, c.first_name, c.last_name, c.role, c.specialties, c.skills, c.certifications, c.licenses,
              c.years_experience, c.education, c.city, c.state, c.parsed_resume,
              j.title, j.profession, j.specialty, j.sub_specialty, j.city AS job_city, j.state AS job_state, j.description
       FROM submissions s
       JOIN candidates c ON s.candidate_id = c.id
       JOIN jobs j ON s.job_id = j.id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (loaded.rows.length === 0) { res.status(404).json({ error: 'Submission not found' }); return; }
    const r = loaded.rows[0] as Record<string, unknown>;

    const candidate: ScoringCandidate = {
      first_name: r.first_name as string,
      last_name: r.last_name as string,
      role: r.role as string | null,
      specialties: (r.specialties as string[]) ?? [],
      skills: (r.skills as string[]) ?? [],
      certifications: (r.certifications as string[]) ?? [],
      licenses: (r.licenses as string[]) ?? [],
      years_experience: r.years_experience as number | null,
      education: r.education as string | null,
      city: r.city as string | null,
      state: r.state as string | null,
      parsed_resume: r.parsed_resume,
    };
    const job: ScoringJob = {
      title: r.title as string,
      profession: r.profession as string | null,
      specialty: r.specialty as string | null,
      sub_specialty: r.sub_specialty as string | null,
      city: r.job_city as string | null,
      state: r.job_state as string | null,
      description: r.description as string | null,
    };

    const score = await scoreCandidateForJob(candidate, job);

    await query(
      `UPDATE submissions SET
         ai_score = $1,
         ai_score_breakdown = $2::jsonb,
         ai_fit_label = $3,
         ai_summary = $4,
         ai_gaps = $5::jsonb,
         updated_at = NOW()
       WHERE id = $6`,
      [score.total, JSON.stringify(score.breakdown), score.fit_label, score.summary, JSON.stringify(score.gaps), req.params.id]
    );
    res.json({ score });
  } catch (err) {
    console.error('Submission re-score error:', err);
    res.status(500).json({ error: 'Failed to score submission' });
  }
});

// â”€â”€â”€ POST /:id/recheck-gate â€” re-run credential gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/:id/recheck-gate', requireAuth, requirePermission('candidates_edit'), async (req: Request, res: Response) => {
  try {
    const sub = await query(`SELECT candidate_id, job_id FROM submissions WHERE id = $1`, [req.params.id]);
    if (sub.rows.length === 0) { res.status(404).json({ error: 'Submission not found' }); return; }
    const { candidate_id, job_id } = sub.rows[0] as { candidate_id: string; job_id: string };
    const gate = await runGate({ candidate_id, kind: 'submission', job_id });
    await query(
      `UPDATE submissions SET gate_status = $1, gate_missing = $2::jsonb, updated_at = NOW() WHERE id = $3`,
      [gate.status, JSON.stringify(gate.missing), req.params.id]
    );
    res.json({ gate });
  } catch (err) {
    console.error('Gate recheck error:', err);
    res.status(500).json({ error: 'Failed to recheck gate' });
  }
});

// â”€â”€â”€ POST /:id/pdf â€” generate submission PDF (minimal draft) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Phase 2 will replace this with a styled template.
router.post('/:id/pdf', requireAuth, requirePermission('candidates_edit'), async (_req: Request, res: Response) => {
  // Stub for Phase 1 â€” returns a placeholder URL. Frontend should show "PDF generation coming soon" UX.
  res.json({ pdf_url: null, status: 'not_implemented', message: 'Submission PDF generation will land in Phase 2.' });
});

export default router;
