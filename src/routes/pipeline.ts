import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth';
import { query } from '../db/client';

const router = Router();

// GET /overview — all candidates by stage
router.get('/overview', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
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
      if (stages[row.stage]) {
        stages[row.stage].push(row);
      }
    }

    res.json({ stages, total: result.rows.length });
  } catch (err) {
    console.error('Pipeline overview error:', err);
    res.status(500).json({ error: 'Failed to fetch pipeline' });
  }
});

// GET /metrics — conversion rates and timing
router.get('/metrics', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  try {
    const stageCountsResult = await query(
      `SELECT stage, COUNT(*)::INT as count FROM candidates WHERE status = 'active' GROUP BY stage`
    );

    const placedResult = await query(
      `SELECT COUNT(*)::INT as placed FROM candidates WHERE stage = 'placed'`
    );

    const avgTimeResult = await query(
      `SELECT
         stage,
         AVG(EXTRACT(DAY FROM NOW() - updated_at))::NUMERIC(10,1) AS avg_days
       FROM candidates
       WHERE status = 'active'
       GROUP BY stage`
    );

    const weeklyResult = await query(
      `SELECT
         DATE_TRUNC('week', created_at)::DATE AS week,
         COUNT(*)::INT AS new_candidates
       FROM candidates
       WHERE created_at >= NOW() - INTERVAL '8 weeks'
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

export default router;
