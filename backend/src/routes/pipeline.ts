import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth';
import { query } from '../db/client';

const router = Router();

// Back-map new ATS stage keys to the old 4-bucket labels used by the current
// Pipeline.tsx frontend so Phase 1 migration is transparent to the existing UI.
// Phase 2 UI uses /kanban below which exposes all 12 configured stages.
const LEGACY_STAGE_MAP: Record<string, string> = {
  // Old keys map to themselves (pre-migration rows, if any)
  application: 'application',
  interview: 'interview',
  credentialing: 'credentialing',
  onboarding: 'onboarding',
  // New keys → old buckets for backward compat
  new_lead: 'application',
  screening: 'application',
  internal_review: 'credentialing',
  submitted: 'interview',
  client_submitted: 'interview',
  offer: 'onboarding',
  confirmed: 'onboarding',
  // Terminal stages — not shown in legacy 4-column view
};

// GET /overview — legacy 4-bucket view preserved for existing frontend
router.get('/overview', requireAuth, requirePermission('candidates_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT c.id, c.first_name, c.last_name, c.role, c.stage, c.email, c.phone,
              c.desired_pay_rate, c.availability_type, c.created_at, c.updated_at,
              u.name AS recruiter_name,
              f.name AS target_facility_name,
              EXTRACT(DAY FROM NOW() - c.updated_at)::INT AS days_in_stage,
              (
                SELECT COUNT(*)::INT FROM candidate_documents cd
                WHERE cd.candidate_id = c.id AND cd.status = 'missing' AND cd.required = true
              ) AS missing_docs_count
       FROM candidates c
       LEFT JOIN users u ON c.assigned_recruiter_id = u.id
       LEFT JOIN facilities f ON c.target_facility_id = f.id
       WHERE c.status = 'active'
       ORDER BY c.updated_at DESC`
    );

    const stages: Record<string, any[]> = {
      application: [],
      interview: [],
      credentialing: [],
      onboarding: [],
    };

    for (const row of result.rows) {
      const bucket = LEGACY_STAGE_MAP[row.stage as string];
      if (bucket && stages[bucket]) stages[bucket].push(row);
    }

    res.json({ stages, total: result.rows.length });
  } catch (err: any) {
    if (err?.code === '42P01') {
      res.json({ stages: { application: [], interview: [], credentialing: [], onboarding: [] }, total: 0 });
      return;
    }
    console.error('Pipeline overview error:', err);
    res.status(500).json({ error: 'Failed to fetch pipeline' });
  }
});

// GET /metrics — conversion rates and timing (unchanged)
router.get('/metrics', requireAuth, requirePermission('candidates_view'), async (_req: Request, res: Response) => {
  try {
    const stageCountsResult = await query(
      `SELECT stage, COUNT(*)::INT as count FROM candidates WHERE status = 'active' GROUP BY stage`
    );
    const placedResult = await query(
      `SELECT COUNT(*)::INT as placed FROM candidates WHERE stage = 'placed'`
    );
    const avgTimeResult = await query(
      `SELECT stage, AVG(EXTRACT(DAY FROM NOW() - updated_at))::NUMERIC(10,1) AS avg_days
       FROM candidates WHERE status = 'active' GROUP BY stage`
    );
    const weeklyResult = await query(
      `SELECT DATE_TRUNC('week', created_at)::DATE AS week, COUNT(*)::INT AS new_candidates
       FROM candidates WHERE created_at >= NOW() - INTERVAL '8 weeks'
       GROUP BY week ORDER BY week ASC`
    );

    const stageCounts: Record<string, number> = {};
    stageCountsResult.rows.forEach((r: any) => { stageCounts[r.stage] = r.count; });
    const avgDays: Record<string, number> = {};
    avgTimeResult.rows.forEach((r: any) => { avgDays[r.stage] = parseFloat(r.avg_days); });

    res.json({
      by_stage: stageCounts,
      total_placed: placedResult.rows[0].placed,
      avg_days_per_stage: avgDays,
      weekly_new: weeklyResult.rows,
    });
  } catch (err) {
    console.error('Pipeline metrics error:', err);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// ─── Phase 1.4 — Candidate Pipeline kanban (one card per candidate) ───────
// Distinct from /kanban below which is SUBMISSION-oriented. This one groups
// candidates by their own stage column using the full pipeline_stages taxonomy,
// so the Pipeline.tsx page can render drag-drop + filters across all stages
// (not the legacy 4-bucket mapping).
// Returns { stages: [{key,label,color,sort_order,stale_after_days, items:[...]}] }
router.get('/candidates-kanban', requireAuth, requirePermission('candidates_view'), async (_req: Request, res: Response) => {
  try {
    const [stagesRes, candsRes] = await Promise.all([
      query(
        `SELECT key, label, color, sort_order, is_terminal, stale_after_days
         FROM pipeline_stages
         WHERE tenant_id = 'default' AND active = TRUE
         ORDER BY sort_order ASC`
      ),
      query(
        `SELECT c.id, c.first_name, c.last_name, c.role, c.stage,
                c.email, c.phone, c.city, c.state,
                c.available_shifts, c.desired_pay_rate,
                c.specialties, c.years_experience,
                c.created_at, c.updated_at,
                u.name AS recruiter_name,
                EXTRACT(DAY FROM NOW() - c.updated_at)::INT AS days_in_stage,
                -- Job IDs this candidate has been submitted to (for job filter)
                COALESCE(
                  (SELECT array_agg(DISTINCT s.job_id)::UUID[]
                   FROM submissions s WHERE s.candidate_id = c.id),
                  '{}'::UUID[]
                ) AS submitted_job_ids,
                (SELECT COUNT(*)::INT FROM candidate_documents cd
                 WHERE cd.candidate_id = c.id AND cd.status = 'missing' AND cd.required = true
                ) AS missing_docs_count
         FROM candidates c
         LEFT JOIN users u ON c.assigned_recruiter_id = u.id
         WHERE c.status = 'active'
         ORDER BY c.updated_at DESC
         LIMIT 1000`
      ),
    ]);

    const candsByStage = new Map<string, Array<Record<string, unknown>>>();
    for (const c of candsRes.rows) {
      const key = (c.stage as string) ?? 'new_lead';
      if (!candsByStage.has(key)) candsByStage.set(key, []);
      candsByStage.get(key)!.push(c);
    }

    const stages = stagesRes.rows.map((st: any) => {
      const items = candsByStage.get(st.key) ?? [];
      const itemsWithStale = items.map((i: any) => ({
        ...i,
        is_stale: st.stale_after_days != null && i.days_in_stage > st.stale_after_days,
      }));
      return { ...st, items: itemsWithStale, count: itemsWithStale.length };
    });

    res.json({ stages, total: candsRes.rows.length });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ stages: [], total: 0 }); return; }
    console.error('Candidates-kanban fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch candidate pipeline' });
  }
});

// ─── Phase 2 Kanban: full 12-stage view over SUBMISSIONS (not candidates) ──
// Returns { stages: [{key,label,color,sort_order,stale_after_days, items:[...]}] }
router.get('/kanban', requireAuth, requirePermission('candidates_view'), async (_req: Request, res: Response) => {
  try {
    const [stagesRes, subsRes] = await Promise.all([
      query(
        `SELECT key, label, color, sort_order, is_terminal, stale_after_days
         FROM pipeline_stages
         WHERE tenant_id = 'default' AND active = TRUE
         ORDER BY sort_order ASC`
      ),
      query(
        `SELECT s.id, s.candidate_id, s.job_id, s.stage_key, s.ai_score, s.ai_fit_label,
                s.gate_status, s.recruiter_id, s.updated_at,
                (c.first_name || ' ' || c.last_name) AS candidate_name,
                c.role AS candidate_role,
                j.title AS job_title, j.job_code,
                cl.name AS client_name,
                f.name AS facility_name,
                u.name AS recruiter_name,
                EXTRACT(DAY FROM NOW() - s.updated_at)::INT AS days_in_stage
         FROM submissions s
         JOIN candidates c ON s.candidate_id = c.id
         JOIN jobs j ON s.job_id = j.id
         LEFT JOIN clients cl ON j.client_id = cl.id
         LEFT JOIN facilities f ON j.facility_id = f.id
         LEFT JOIN users u ON s.recruiter_id = u.id
         ORDER BY s.updated_at DESC
         LIMIT 1000`
      ),
    ]);

    const subsByStage = new Map<string, any[]>();
    for (const s of subsRes.rows) {
      const key = (s.stage_key as string) ?? 'new_lead';
      if (!subsByStage.has(key)) subsByStage.set(key, []);
      subsByStage.get(key)!.push(s);
    }

    const stages = stagesRes.rows.map((st: any) => {
      const items = subsByStage.get(st.key) ?? [];
      const itemsWithStale = items.map((i) => ({
        ...i,
        is_stale: st.stale_after_days != null && i.days_in_stage > st.stale_after_days,
      }));
      return { ...st, items: itemsWithStale, count: itemsWithStale.length };
    });

    res.json({ stages, total: subsRes.rows.length });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ stages: [], total: 0 }); return; }
    console.error('Kanban fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch kanban' });
  }
});

export default router;
