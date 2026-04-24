import { Router, Request, Response } from 'express';
import { getAuth } from '../middleware/auth';
import { requireAuth, requirePermission } from '../middleware/auth';
import { query } from '../db/client';

const router = Router();

/**
 * GET /overview — single call that returns all ATS dashboard widgets in one
 * response. Expensive queries are computed in parallel. Shape:
 *   { funnel, recruiter_leaderboard, jobs_at_risk, submission_to_placement,
 *     active_jobs_summary, tasks }
 */
router.get('/overview', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  // Optional recruiter filter — scopes funnel, conversion, jobs-at-risk, active-jobs, tasks
  // to records owned by this recruiter (submissions.recruiter_id, jobs.primary_recruiter_id,
  // recruiter_tasks.assigned_to). Leaderboard ignores this filter so top recruiters are always visible.
  // Uses bound `$1::uuid` with an IS-NULL short-circuit so each query can take an optional filter.
  let rid: string | null = null;
  if (typeof req.query.recruiter_id === 'string' && req.query.recruiter_id.trim().length > 0) {
    rid = req.query.recruiter_id;
  } else if (req.query.me === 'true' || req.query.me === '1') {
    // Resolve the authenticated user to their DB id
    const auth = getAuth(req);
    if (auth?.userId) {
      const userRes = await query<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = $1`, [auth.userId]);
      if (userRes.rows.length > 0) rid = userRes.rows[0].id;
    }
  }

  try {
    const [
      funnelRes,
      recruiterRes,
      jobsAtRiskRes,
      conversionRes,
      activeJobsRes,
      tasksRes,
    ] = await Promise.all([
      // 1. Pipeline funnel — submissions by stage
      query(
        `SELECT ps.key, ps.label, ps.color, ps.sort_order, ps.is_terminal,
                COUNT(s.id)::INT AS count
         FROM pipeline_stages ps
         LEFT JOIN submissions s ON s.stage_key = ps.key
           AND ($1::uuid IS NULL OR s.recruiter_id = $1::uuid)
         WHERE ps.tenant_id = 'default' AND ps.active = TRUE
         GROUP BY ps.key, ps.label, ps.color, ps.sort_order, ps.is_terminal
         ORDER BY ps.sort_order ASC`,
        [rid]
      ),
      // 2. Recruiter leaderboard — top 10 by submission count last 30 days
      query(
        `SELECT u.id, u.name, u.email,
                COUNT(DISTINCT s.id) FILTER (WHERE s.created_at >= NOW() - INTERVAL '30 days')::INT AS submissions_30d,
                COUNT(DISTINCT s.id) FILTER (WHERE s.stage_key = 'placed')::INT AS placements,
                COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'open')::INT AS open_jobs
         FROM users u
         LEFT JOIN submissions s ON s.recruiter_id = u.id
         LEFT JOIN jobs j ON j.primary_recruiter_id = u.id
         WHERE u.role IN ('recruiter', 'manager', 'coordinator', 'admin')
         GROUP BY u.id, u.name, u.email
         HAVING COUNT(DISTINCT s.id) > 0 OR COUNT(DISTINCT j.id) > 0
         ORDER BY submissions_30d DESC, placements DESC
         LIMIT 10`
      ),
      // 3. Jobs at risk — open jobs older than 14d with < 3 submissions
      query(
        `SELECT j.id, j.job_code, j.title, j.profession, j.specialty, j.priority,
                j.city, j.state,
                EXTRACT(DAY FROM NOW() - j.created_at)::INT AS age_days,
                (SELECT COUNT(*)::INT FROM submissions s WHERE s.job_id = j.id) AS submission_count,
                cl.name AS client_name, u.name AS recruiter_name
         FROM jobs j
         LEFT JOIN clients cl ON j.client_id = cl.id
         LEFT JOIN users u ON j.primary_recruiter_id = u.id
         WHERE j.status = 'open'
           AND j.created_at < NOW() - INTERVAL '14 days'
           AND (SELECT COUNT(*) FROM submissions s WHERE s.job_id = j.id) < 3
           AND ($1::uuid IS NULL OR j.primary_recruiter_id = $1::uuid)
         ORDER BY j.priority DESC, age_days DESC
         LIMIT 20`,
        [rid]
      ),
      // 4. Submission → placement conversion
      query(
        `SELECT
           COUNT(*)::INT AS total,
           COUNT(*) FILTER (WHERE stage_key = 'placed')::INT AS placed,
           COUNT(*) FILTER (WHERE stage_key = 'client_submitted')::INT AS client_submitted,
           COUNT(*) FILTER (WHERE stage_key = 'interview')::INT AS interview,
           COUNT(*) FILTER (WHERE stage_key = 'offer')::INT AS offer,
           COUNT(*) FILTER (WHERE stage_key IN ('rejected', 'withdrawn', 'not_joined'))::INT AS lost
         FROM submissions
         WHERE created_at >= NOW() - INTERVAL '90 days'
           AND ($1::uuid IS NULL OR recruiter_id = $1::uuid)`,
        [rid]
      ),
      // 5. Active jobs summary
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'open')::INT AS open_jobs,
           COUNT(*) FILTER (WHERE status = 'on_hold')::INT AS on_hold_jobs,
           COUNT(*) FILTER (WHERE status = 'filled')::INT AS filled_jobs,
           COUNT(*) FILTER (WHERE priority = 'urgent' AND status = 'open')::INT AS urgent_open,
           SUM(positions) FILTER (WHERE status = 'open')::INT AS total_positions_open
         FROM jobs
         WHERE ($1::uuid IS NULL OR primary_recruiter_id = $1::uuid)`,
        [rid]
      ),
      // 6. Tasks summary
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'open')::INT AS open_tasks,
           COUNT(*) FILTER (WHERE status = 'open' AND due_at < NOW())::INT AS overdue,
           COUNT(*) FILTER (WHERE status = 'open' AND due_at::date = CURRENT_DATE)::INT AS due_today,
           COUNT(*) FILTER (WHERE status = 'done' AND completed_at >= NOW() - INTERVAL '7 days')::INT AS completed_7d
         FROM recruiter_tasks
         WHERE ($1::uuid IS NULL OR assigned_to = $1::uuid)`,
        [rid]
      ),
    ]);

    const conv = conversionRes.rows[0] as Record<string, number>;
    const submission_to_placement = {
      total: conv.total ?? 0,
      placed: conv.placed ?? 0,
      client_submitted: conv.client_submitted ?? 0,
      interview: conv.interview ?? 0,
      offer: conv.offer ?? 0,
      lost: conv.lost ?? 0,
      placement_rate: conv.total > 0 ? Math.round((conv.placed / conv.total) * 1000) / 10 : 0,
    };

    res.json({
      funnel: funnelRes.rows,
      recruiter_leaderboard: recruiterRes.rows,
      jobs_at_risk: jobsAtRiskRes.rows,
      submission_to_placement,
      active_jobs_summary: activeJobsRes.rows[0] ?? {},
      tasks: tasksRes.rows[0] ?? {},
    });
  } catch (err: any) {
    // 42P01 = table doesn't exist (not yet migrated). Return empty shape.
    if (err?.code === '42P01') {
      res.json({
        funnel: [], recruiter_leaderboard: [], jobs_at_risk: [],
        submission_to_placement: { total: 0, placed: 0, client_submitted: 0, interview: 0, offer: 0, lost: 0, placement_rate: 0 },
        active_jobs_summary: {}, tasks: {},
      });
      return;
    }
    console.error('ATS reports overview error:', err);
    res.status(500).json({ error: 'Failed to fetch ATS reports overview' });
  }
});

export default router;
