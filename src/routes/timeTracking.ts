import { Router, Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── SESSION MANAGEMENT ──────────────────────────────────────────────────────

// POST /sessions/start
router.post('/sessions/start', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { tracking_mode, browser_type, scheduled_window_start, scheduled_window_end } = req.body;

  try {
    // End any existing active session for this user
    await query(
      `UPDATE tracking_sessions
       SET status = 'completed',
           end_time = NOW(),
           total_duration_seconds = EXTRACT(EPOCH FROM (NOW() - start_time))::INTEGER,
           updated_at = NOW()
       WHERE clerk_user_id = $1 AND status = 'active'`,
      [clerkUserId]
    );

    // Look up internal user_id
    const userRes = await query(`SELECT id FROM users WHERE clerk_user_id = $1 LIMIT 1`, [clerkUserId]);
    const userId = userRes.rows[0]?.id ?? null;

    const result = await query(
      `INSERT INTO tracking_sessions
         (user_id, clerk_user_id, session_date, start_time, tracking_mode, browser_type,
          scheduled_window_start, scheduled_window_end, status)
       VALUES ($1, $2, CURRENT_DATE, NOW(), $3, $4, $5, $6, 'active')
       RETURNING *`,
      [userId, clerkUserId, tracking_mode ?? 'scheduled', browser_type ?? null,
       scheduled_window_start ?? null, scheduled_window_end ?? null]
    );

    await logAudit(null, clerkUserId, 'time_tracking.session.start', String(result.rows[0].id),
      { tracking_mode, browser_type }, req.ip ?? 'unknown');

    res.status(201).json({ session: result.rows[0] });
  } catch (err) {
    console.error('Start session error:', err);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// POST /sessions/:id/heartbeat
router.post('/sessions/:id/heartbeat', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const { id } = req.params;
  const { active_seconds_delta = 0, idle_seconds_delta = 0, break_seconds_delta = 0 } = req.body;

  try {
    // Fetch policy to check auto_deduct_idle
    const policyRes = await query(
      `SELECT auto_deduct_idle, idle_threshold_minutes FROM tracking_policies
       WHERE (scope_type = 'user' AND scope_id = $1 AND is_active = true)
          OR (scope_type = 'global' AND is_active = true)
       ORDER BY CASE scope_type WHEN 'user' THEN 0 ELSE 1 END
       LIMIT 1`,
      [clerkUserId]
    );
    const policy = policyRes.rows[0] ?? { auto_deduct_idle: false };
    const idleDeduction = policy.auto_deduct_idle ? idle_seconds_delta : 0;

    const result = await query(
      `UPDATE tracking_sessions
       SET active_duration_seconds = active_duration_seconds + $1,
           idle_duration_seconds   = idle_duration_seconds   + $2,
           break_duration_seconds  = break_duration_seconds  + $3,
           adjusted_work_duration_seconds = active_duration_seconds + $1 - $4,
           total_duration_seconds  = EXTRACT(EPOCH FROM (NOW() - start_time))::INTEGER,
           status = 'active',
           updated_at = NOW()
       WHERE id = $5 AND clerk_user_id = $6
       RETURNING *`,
      [active_seconds_delta, idle_seconds_delta, break_seconds_delta,
       idleDeduction, id, clerkUserId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Session not found or not owned by user' });
      return;
    }
    res.json({ session: result.rows[0] });
  } catch (err) {
    console.error('Heartbeat error:', err);
    res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});

// POST /sessions/:id/end
router.post('/sessions/:id/end', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const { id } = req.params;
  const { active_seconds = 0, idle_seconds = 0, break_seconds = 0 } = req.body;

  try {
    const policyRes = await query(
      `SELECT auto_deduct_idle FROM tracking_policies
       WHERE (scope_type = 'user' AND scope_id = $1 AND is_active = true)
          OR (scope_type = 'global' AND is_active = true)
       ORDER BY CASE scope_type WHEN 'user' THEN 0 ELSE 1 END
       LIMIT 1`,
      [clerkUserId]
    );
    const policy = policyRes.rows[0] ?? { auto_deduct_idle: false };
    const idleDeduction = policy.auto_deduct_idle ? idle_seconds : 0;
    const adjustedWork = Math.max(0, active_seconds - idleDeduction);

    const result = await query(
      `UPDATE tracking_sessions
       SET end_time = NOW(),
           active_duration_seconds = $1,
           idle_duration_seconds   = $2,
           break_duration_seconds  = $3,
           adjusted_work_duration_seconds = $4,
           total_duration_seconds  = EXTRACT(EPOCH FROM (NOW() - start_time))::INTEGER,
           status = 'completed',
           updated_at = NOW()
       WHERE id = $5 AND clerk_user_id = $6
       RETURNING *`,
      [active_seconds, idle_seconds, break_seconds, adjustedWork, id, clerkUserId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Session not found or not owned by user' });
      return;
    }

    await logAudit(null, clerkUserId, 'time_tracking.session.end', id,
      { active_seconds, idle_seconds, break_seconds, adjusted_work: adjustedWork }, req.ip ?? 'unknown');

    res.json({ session: result.rows[0] });
  } catch (err) {
    console.error('End session error:', err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// GET /sessions/active
router.get('/sessions/active', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  try {
    const result = await query(
      `SELECT * FROM tracking_sessions
       WHERE clerk_user_id = $1 AND status = 'active'
       ORDER BY start_time DESC LIMIT 1`,
      [clerkUserId]
    );
    res.json({ session: result.rows[0] ?? null });
  } catch (err) {
    console.error('Active session error:', err);
    res.status(500).json({ error: 'Failed to fetch active session' });
  }
});

// GET /sessions/today
router.get('/sessions/today', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  try {
    const result = await query(
      `SELECT *,
              EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time))::INTEGER AS elapsed_seconds
       FROM tracking_sessions
       WHERE clerk_user_id = $1 AND session_date = CURRENT_DATE
       ORDER BY start_time DESC`,
      [clerkUserId]
    );

    const totals = result.rows.reduce((acc: Record<string, number>, s: Record<string, unknown>) => ({
      total_active:   acc.total_active   + (Number(s.active_duration_seconds) || 0),
      total_idle:     acc.total_idle     + (Number(s.idle_duration_seconds) || 0),
      total_break:    acc.total_break    + (Number(s.break_duration_seconds) || 0),
      total_adjusted: acc.total_adjusted + (Number(s.adjusted_work_duration_seconds) || 0),
    }), { total_active: 0, total_idle: 0, total_break: 0, total_adjusted: 0 });

    res.json({ sessions: result.rows, totals });
  } catch (err) {
    console.error('Today sessions error:', err);
    res.status(500).json({ error: 'Failed to fetch today sessions' });
  }
});

// ─── ACTIVITY LOGS ───────────────────────────────────────────────────────────

// POST /activity/batch
router.post('/activity/batch', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const { session_id, logs } = req.body;

  if (!session_id || !Array.isArray(logs) || logs.length === 0) {
    res.status(400).json({ error: 'session_id and non-empty logs array required' });
    return;
  }

  try {
    // Verify session ownership
    const sessionRes = await query(
      `SELECT id FROM tracking_sessions WHERE id = $1 AND clerk_user_id = $2`,
      [session_id, clerkUserId]
    );
    if (sessionRes.rows.length === 0) {
      res.status(404).json({ error: 'Session not found or not owned by user' });
      return;
    }

    // Fetch domain classifications in bulk
    const domains = [...new Set(logs.map((l: { domain?: string }) => l.domain).filter(Boolean))] as string[];
    let classificationMap: Record<string, string> = {};
    if (domains.length > 0) {
      const classRes = await query(
        `SELECT domain, classification FROM tracking_domain_classifications
         WHERE domain = ANY($1)`,
        [domains]
      );
      classificationMap = Object.fromEntries(classRes.rows.map((r: { domain: string; classification: string }) => [r.domain, r.classification]));
    }

    // Build bulk insert
    const valueRows: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    let totalActiveDelta = 0;
    let totalIdleDelta = 0;

    for (const log of logs as Array<{
      timestamp_start: string;
      timestamp_end?: string;
      domain?: string;
      page_title?: string;
      activity_type?: string;
      duration_seconds?: number;
    }>) {
      const classification = classificationMap[log.domain ?? ''] ?? 'unknown';
      const isIdle = log.activity_type === 'idle';
      const dur = log.duration_seconds ?? 0;
      if (isIdle) totalIdleDelta += dur;
      else totalActiveDelta += dur;

      valueRows.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
      params.push(
        session_id, clerkUserId,
        log.timestamp_start, log.timestamp_end ?? null,
        log.domain ?? null, log.page_title ?? null,
        log.activity_type ?? 'active', classification,
        isIdle, dur
      );
    }

    await query(
      `INSERT INTO tracking_activity_logs
         (session_id, clerk_user_id, timestamp_start, timestamp_end, domain, page_title,
          activity_type, domain_classification, was_idle, duration_seconds)
       VALUES ${valueRows.join(', ')}`,
      params
    );

    // Update session totals
    await query(
      `UPDATE tracking_sessions
       SET active_duration_seconds = active_duration_seconds + $1,
           idle_duration_seconds   = idle_duration_seconds   + $2,
           total_duration_seconds  = EXTRACT(EPOCH FROM (NOW() - start_time))::INTEGER,
           updated_at = NOW()
       WHERE id = $3`,
      [totalActiveDelta, totalIdleDelta, session_id]
    );

    res.status(201).json({ inserted: logs.length });
  } catch (err) {
    console.error('Activity batch error:', err);
    res.status(500).json({ error: 'Failed to insert activity logs' });
  }
});

// GET /activity/:sessionId
router.get('/activity/:sessionId', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const { sessionId } = req.params;
  const userRecord = req.userRecord;

  try {
    // Allow managers/admins to view any session; others can only view their own
    const isManager = userRecord && ['ceo', 'manager', 'hr', 'admin'].includes(userRecord.role);
    const sessionRes = await query(
      `SELECT id, clerk_user_id FROM tracking_sessions WHERE id = $1`,
      [sessionId]
    );
    if (sessionRes.rows.length === 0) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isManager && sessionRes.rows[0].clerk_user_id !== clerkUserId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const result = await query(
      `SELECT * FROM tracking_activity_logs WHERE session_id = $1 ORDER BY timestamp_start ASC`,
      [sessionId]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    console.error('Activity logs error:', err);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// ─── IDLE EVENTS ─────────────────────────────────────────────────────────────

// POST /idle-events
router.post('/idle-events', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const { session_id, detected_at, idle_duration_seconds } = req.body;

  if (!session_id || !detected_at) {
    res.status(400).json({ error: 'session_id and detected_at are required' });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO tracking_idle_events
         (session_id, clerk_user_id, detected_at, idle_duration_seconds)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [session_id, clerkUserId, detected_at, idle_duration_seconds ?? 0]
    );
    res.status(201).json({ idle_event: result.rows[0] });
  } catch (err) {
    console.error('Idle event insert error:', err);
    res.status(500).json({ error: 'Failed to insert idle event' });
  }
});

// PATCH /idle-events/:id/respond
router.patch('/idle-events/:id/respond', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const { id } = req.params;
  const { user_response, notes } = req.body;

  if (!['was_working', 'was_idle'].includes(user_response)) {
    res.status(400).json({ error: 'user_response must be was_working or was_idle' });
    return;
  }

  try {
    const eventRes = await query(
      `SELECT * FROM tracking_idle_events WHERE id = $1 AND clerk_user_id = $2`,
      [id, clerkUserId]
    );
    if (eventRes.rows.length === 0) {
      res.status(404).json({ error: 'Idle event not found' });
      return;
    }
    const event = eventRes.rows[0];
    const wasDeducted = user_response === 'was_idle';

    const result = await query(
      `UPDATE tracking_idle_events
       SET user_response = $1, was_deducted = $2, notes = $3
       WHERE id = $4 RETURNING *`,
      [user_response, wasDeducted, notes ?? null, id]
    );

    // If user was actually working, add idle time back to active_duration
    if (user_response === 'was_working') {
      await query(
        `UPDATE tracking_sessions
         SET active_duration_seconds = active_duration_seconds + $1,
             adjusted_work_duration_seconds = adjusted_work_duration_seconds + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [event.idle_duration_seconds, event.session_id]
      );
    }

    await logAudit(null, clerkUserId, 'time_tracking.idle.respond', id,
      { user_response, was_deducted: wasDeducted }, req.ip ?? 'unknown');

    res.json({ idle_event: result.rows[0] });
  } catch (err) {
    console.error('Idle event respond error:', err);
    res.status(500).json({ error: 'Failed to update idle event' });
  }
});

// ─── BREAK EVENTS ────────────────────────────────────────────────────────────

// POST /breaks
router.post('/breaks', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const { session_id, start_time, source } = req.body;

  if (!session_id || !start_time) {
    res.status(400).json({ error: 'session_id and start_time are required' });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO tracking_break_events (session_id, clerk_user_id, start_time, source)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [session_id, clerkUserId, start_time, source ?? 'manual']
    );
    res.status(201).json({ break_event: result.rows[0] });
  } catch (err) {
    console.error('Break insert error:', err);
    res.status(500).json({ error: 'Failed to start break' });
  }
});

// PATCH /breaks/:id/end
router.patch('/breaks/:id/end', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const { id } = req.params;
  const { end_time } = req.body;

  if (!end_time) {
    res.status(400).json({ error: 'end_time is required' });
    return;
  }

  try {
    // Fetch break to calculate duration
    const breakRes = await query(
      `SELECT * FROM tracking_break_events WHERE id = $1 AND clerk_user_id = $2`,
      [id, clerkUserId]
    );
    if (breakRes.rows.length === 0) {
      res.status(404).json({ error: 'Break event not found' });
      return;
    }
    const breakEvent = breakRes.rows[0] as Record<string, unknown>;
    const durationSeconds = Math.max(0, Math.round(
      (new Date(end_time as string).getTime() - new Date(breakEvent.start_time as string).getTime()) / 1000
    ));

    const result = await query(
      `UPDATE tracking_break_events
       SET end_time = $1, duration_seconds = $2
       WHERE id = $3 RETURNING *`,
      [end_time, durationSeconds, id]
    );

    // Update session break totals
    await query(
      `UPDATE tracking_sessions
       SET break_duration_seconds = break_duration_seconds + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [durationSeconds, breakEvent.session_id]
    );

    res.json({ break_event: result.rows[0] });
  } catch (err) {
    console.error('Break end error:', err);
    res.status(500).json({ error: 'Failed to end break' });
  }
});

// ─── REPORTING — OWN ─────────────────────────────────────────────────────────

// GET /me — today's totals, weekly summary, recent sessions (last 7 days)
router.get('/me', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  try {
    const todayRes = await query(
      `SELECT
         COALESCE(SUM(active_duration_seconds), 0)   AS today_active,
         COALESCE(SUM(idle_duration_seconds), 0)     AS today_idle,
         COALESCE(SUM(break_duration_seconds), 0)    AS today_break,
         COALESCE(SUM(adjusted_work_duration_seconds), 0) AS today_adjusted,
         COUNT(*) AS session_count
       FROM tracking_sessions
       WHERE clerk_user_id = $1 AND session_date = CURRENT_DATE`,
      [clerkUserId]
    );

    const weekRes = await query(
      `SELECT
         session_date,
         COALESCE(SUM(active_duration_seconds), 0)   AS active,
         COALESCE(SUM(idle_duration_seconds), 0)     AS idle,
         COALESCE(SUM(break_duration_seconds), 0)    AS break_time,
         COALESCE(SUM(adjusted_work_duration_seconds), 0) AS adjusted
       FROM tracking_sessions
       WHERE clerk_user_id = $1
         AND session_date >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY session_date
       ORDER BY session_date DESC`,
      [clerkUserId]
    );

    const recentRes = await query(
      `SELECT * FROM tracking_sessions
       WHERE clerk_user_id = $1
         AND session_date >= CURRENT_DATE - INTERVAL '6 days'
       ORDER BY start_time DESC LIMIT 50`,
      [clerkUserId]
    );

    res.json({
      today: todayRes.rows[0],
      weekly_by_day: weekRes.rows,
      recent_sessions: recentRes.rows,
    });
  } catch (err) {
    console.error('Me time data error:', err);
    res.status(500).json({ error: 'Failed to fetch time data' });
  }
});

// GET /me/summary — daily totals for last 30 days (for charts)
router.get('/me/summary', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  try {
    const result = await query(
      `SELECT
         session_date,
         COALESCE(SUM(active_duration_seconds), 0)        AS active_seconds,
         COALESCE(SUM(idle_duration_seconds), 0)          AS idle_seconds,
         COALESCE(SUM(break_duration_seconds), 0)         AS break_seconds,
         COALESCE(SUM(adjusted_work_duration_seconds), 0) AS adjusted_seconds,
         COUNT(*) AS sessions
       FROM tracking_sessions
       WHERE clerk_user_id = $1
         AND session_date >= CURRENT_DATE - INTERVAL '29 days'
       GROUP BY session_date
       ORDER BY session_date ASC`,
      [clerkUserId]
    );
    res.json({ summary: result.rows });
  } catch (err) {
    console.error('Me summary error:', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ─── REPORTING — TEAM / MANAGER ──────────────────────────────────────────────

// GET /team — manager view of today's team stats
router.get('/team', requireAuth, requirePermission('time_tracking_view_team'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT
         u.clerk_user_id,
         u.name,
         u.email,
         u.role,
         COALESCE(SUM(ts.active_duration_seconds), 0)        AS today_active_seconds,
         COALESCE(SUM(ts.idle_duration_seconds), 0)          AS today_idle_seconds,
         COALESCE(SUM(ts.break_duration_seconds), 0)         AS today_break_seconds,
         COALESCE(SUM(ts.adjusted_work_duration_seconds), 0) AS today_adjusted_seconds,
         MAX(ts.status)                                       AS session_status,
         COUNT(ts.id)                                        AS session_count
       FROM users u
       LEFT JOIN tracking_sessions ts
         ON ts.clerk_user_id = u.clerk_user_id
         AND ts.session_date = CURRENT_DATE
       GROUP BY u.clerk_user_id, u.name, u.email, u.role
       ORDER BY u.name ASC`
    );
    res.json({ team: result.rows });
  } catch (err) {
    console.error('Team stats error:', err);
    res.status(500).json({ error: 'Failed to fetch team stats' });
  }
});

// GET /reports — per-day per-user breakdown
router.get('/reports', requireAuth, requirePermission('time_tracking_view_team'), async (req: Request, res: Response) => {
  const { from_date, to_date, clerk_user_id, department } = req.query;

  if (!from_date || !to_date) {
    res.status(400).json({ error: 'from_date and to_date are required' });
    return;
  }

  const conditions: string[] = ['ts.session_date BETWEEN $1 AND $2'];
  const params: unknown[] = [from_date, to_date];
  let idx = 3;

  if (clerk_user_id) { conditions.push(`ts.clerk_user_id = $${idx++}`); params.push(clerk_user_id); }
  if (department)    { conditions.push(`u.department = $${idx++}`);     params.push(department); }

  const where = conditions.join(' AND ');

  try {
    const result = await query(
      `SELECT
         ts.session_date,
         ts.clerk_user_id,
         u.name,
         u.email,
         COUNT(ts.id)::INTEGER                                AS total_sessions,
         COALESCE(SUM(ts.active_duration_seconds), 0)        AS active_duration,
         COALESCE(SUM(ts.idle_duration_seconds), 0)          AS idle_duration,
         COALESCE(SUM(ts.break_duration_seconds), 0)         AS break_duration,
         COALESCE(SUM(ts.adjusted_work_duration_seconds), 0) AS adjusted_work_duration
       FROM tracking_sessions ts
       LEFT JOIN users u ON u.clerk_user_id = ts.clerk_user_id
       WHERE ${where}
       GROUP BY ts.session_date, ts.clerk_user_id, u.name, u.email
       ORDER BY ts.session_date DESC, u.name ASC`,
      params
    );
    res.json({ reports: result.rows });
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// ─── POLICY ──────────────────────────────────────────────────────────────────

// GET /policy — get policy applicable to current user
router.get('/policy', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  try {
    const result = await query(
      `SELECT * FROM tracking_policies
       WHERE is_active = true
         AND ((scope_type = 'user' AND scope_id = $1)
           OR (scope_type = 'global'))
       ORDER BY CASE scope_type WHEN 'user' THEN 0 ELSE 1 END
       LIMIT 1`,
      [clerkUserId]
    );
    res.json({ policy: result.rows[0] ?? null });
  } catch (err) {
    console.error('Policy fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch policy' });
  }
});

// GET /policy/all — admin only
router.get('/policy/all', requireAuth, requirePermission('time_tracking_admin'), async (_req: Request, res: Response) => {
  try {
    const result = await query(`SELECT * FROM tracking_policies ORDER BY scope_type, created_at DESC`);
    res.json({ policies: result.rows });
  } catch (err) {
    console.error('Policy all error:', err);
    res.status(500).json({ error: 'Failed to fetch policies' });
  }
});

// POST /policy — create or update policy
router.post('/policy', requireAuth, requirePermission('time_tracking_admin'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const {
    scope_type, scope_id, tracking_mode, scheduled_start, scheduled_end,
    idle_threshold_minutes, auto_deduct_idle, notify_on_idle,
    title_tracking_enabled, approved_domains, excluded_domains,
    require_review_for_exceptions, allow_manual_override,
  } = req.body;

  try {
    const result = await query(
      `INSERT INTO tracking_policies
         (scope_type, scope_id, tracking_mode, scheduled_start, scheduled_end,
          idle_threshold_minutes, auto_deduct_idle, notify_on_idle,
          title_tracking_enabled, approved_domains, excluded_domains,
          require_review_for_exceptions, allow_manual_override, created_by, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
       ON CONFLICT (scope_type, scope_id) DO UPDATE SET
         tracking_mode = EXCLUDED.tracking_mode,
         scheduled_start = EXCLUDED.scheduled_start,
         scheduled_end = EXCLUDED.scheduled_end,
         idle_threshold_minutes = EXCLUDED.idle_threshold_minutes,
         auto_deduct_idle = EXCLUDED.auto_deduct_idle,
         notify_on_idle = EXCLUDED.notify_on_idle,
         title_tracking_enabled = EXCLUDED.title_tracking_enabled,
         approved_domains = EXCLUDED.approved_domains,
         excluded_domains = EXCLUDED.excluded_domains,
         require_review_for_exceptions = EXCLUDED.require_review_for_exceptions,
         allow_manual_override = EXCLUDED.allow_manual_override,
         updated_at = NOW()
       RETURNING *`,
      [
        scope_type ?? 'global', scope_id ?? 'default',
        tracking_mode ?? 'scheduled',
        scheduled_start ?? '08:00', scheduled_end ?? '17:00',
        idle_threshold_minutes ?? 5,
        auto_deduct_idle ?? false, notify_on_idle ?? true,
        title_tracking_enabled ?? false,
        JSON.stringify(approved_domains ?? []),
        JSON.stringify(excluded_domains ?? []),
        require_review_for_exceptions ?? true,
        allow_manual_override ?? true,
        clerkUserId,
      ]
    );

    await logAudit(null, clerkUserId ?? 'unknown', 'time_tracking.policy.upsert',
      String(result.rows[0].id), { scope_type, scope_id }, req.ip ?? 'unknown');

    res.status(201).json({ policy: result.rows[0] });
  } catch (err) {
    console.error('Policy upsert error:', err);
    res.status(500).json({ error: 'Failed to save policy' });
  }
});

// ─── DOMAIN CLASSIFICATIONS ───────────────────────────────────────────────────

// GET /domains
router.get('/domains', requireAuth, requirePermission('time_tracking_view_own'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM tracking_domain_classifications ORDER BY domain ASC`
    );
    res.json({ domains: result.rows });
  } catch (err) {
    console.error('Domains list error:', err);
    res.status(500).json({ error: 'Failed to fetch domains' });
  }
});

// POST /domains
router.post('/domains', requireAuth, requirePermission('time_tracking_admin'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const { domain, classification, label } = req.body;

  if (!domain || !classification) {
    res.status(400).json({ error: 'domain and classification are required' });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO tracking_domain_classifications
         (domain, classification, label, admin_approved, created_by)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (domain) DO UPDATE SET
         classification = EXCLUDED.classification,
         label = EXCLUDED.label,
         admin_approved = true
       RETURNING *`,
      [domain.toLowerCase(), classification, label ?? null, clerkUserId]
    );
    res.status(201).json({ domain: result.rows[0] });
  } catch (err) {
    console.error('Domain insert error:', err);
    res.status(500).json({ error: 'Failed to add domain classification' });
  }
});

// DELETE /domains/:id
router.delete('/domains/:id', requireAuth, requirePermission('time_tracking_admin'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const { id } = req.params;
  try {
    const result = await query(
      `DELETE FROM tracking_domain_classifications WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Domain classification not found' });
      return;
    }
    await logAudit(null, clerkUserId ?? 'unknown', 'time_tracking.domain.delete', id, {}, req.ip ?? 'unknown');
    res.json({ success: true });
  } catch (err) {
    console.error('Domain delete error:', err);
    res.status(500).json({ error: 'Failed to delete domain classification' });
  }
});

// POST /domains/ai-suggest — AI suggests classifications for unknown domains
router.post('/domains/ai-suggest', requireAuth, requirePermission('time_tracking_admin'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  try {
    // Fetch recently seen unclassified domains from activity logs
    const unclassifiedRes = await query(
      `SELECT DISTINCT al.domain, COUNT(*) AS occurrences
       FROM tracking_activity_logs al
       LEFT JOIN tracking_domain_classifications dc ON dc.domain = al.domain
       WHERE al.domain IS NOT NULL
         AND dc.id IS NULL
         AND al.created_at >= NOW() - INTERVAL '7 days'
       GROUP BY al.domain
       ORDER BY occurrences DESC
       LIMIT 30`
    );

    if (unclassifiedRes.rows.length === 0) {
      res.json({ suggestions: [], message: 'No unclassified domains found in the last 7 days' });
      return;
    }

    const domainList = unclassifiedRes.rows
      .map((r: { domain: string; occurrences: number }) => `${r.domain} (${r.occurrences} visits)`)
      .join('\n');

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are classifying website domains for a healthcare staffing company's time tracking system.

Classify each domain as one of: work, communication, reference, social, entertainment, news, shopping, unknown.

For each domain, return JSON with this exact format:
[{"domain": "example.com", "classification": "work", "label": "Short description", "confidence": "high|medium|low"}]

Domains to classify:
${domainList}

Return only the JSON array, no other text.`,
      }],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      res.status(500).json({ error: 'Unexpected AI response format' });
      return;
    }

    let suggestions: Array<{ domain: string; classification: string; label: string; confidence: string }> = [];
    try {
      suggestions = JSON.parse(content.text);
    } catch {
      res.status(500).json({ error: 'Failed to parse AI response', raw: content.text });
      return;
    }

    // Mark suggestions in DB as ai_suggested (not yet admin_approved)
    for (const s of suggestions) {
      await query(
        `INSERT INTO tracking_domain_classifications
           (domain, classification, label, ai_suggested, admin_approved, created_by)
         VALUES ($1, $2, $3, true, false, $4)
         ON CONFLICT (domain) DO NOTHING`,
        [s.domain.toLowerCase(), s.classification, s.label, clerkUserId]
      );
    }

    await logAudit(null, clerkUserId ?? 'unknown', 'time_tracking.domains.ai_suggest', 'system',
      { count: suggestions.length }, req.ip ?? 'unknown');

    res.json({ suggestions });
  } catch (err) {
    console.error('AI domain suggest error:', err);
    res.status(500).json({ error: 'Failed to generate AI domain suggestions' });
  }
});

// ─── AI SUMMARY ──────────────────────────────────────────────────────────────

// POST /ai-summary — generate AI work pattern summary
router.post('/ai-summary', requireAuth, requirePermission('time_tracking_view_own'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  const userRecord = req.userRecord;
  const { clerk_user_id: targetClerkId, from_date, to_date } = req.body;

  if (!from_date || !to_date) {
    res.status(400).json({ error: 'from_date and to_date are required' });
    return;
  }

  // Only managers/admins can request summaries for other users
  const isManager = userRecord && ['ceo', 'manager', 'hr', 'admin'].includes(userRecord.role);
  const summaryFor = (targetClerkId && isManager) ? targetClerkId : clerkUserId;

  try {
    // Gather metrics
    const metricsRes = await query(
      `SELECT
         COUNT(*)::INTEGER                                    AS total_sessions,
         COALESCE(SUM(active_duration_seconds), 0)           AS total_active,
         COALESCE(SUM(idle_duration_seconds), 0)             AS total_idle,
         COALESCE(SUM(break_duration_seconds), 0)            AS total_break,
         COALESCE(SUM(adjusted_work_duration_seconds), 0)    AS total_adjusted,
         ROUND(AVG(active_duration_seconds))::INTEGER        AS avg_active_per_session,
         COUNT(CASE WHEN status = 'completed' THEN 1 END)    AS completed_sessions,
         MIN(session_date)                                   AS first_date,
         MAX(session_date)                                   AS last_date
       FROM tracking_sessions
       WHERE clerk_user_id = $1
         AND session_date BETWEEN $2 AND $3`,
      [summaryFor, from_date, to_date]
    );

    const domainRes = await query(
      `SELECT
         dc.classification,
         COUNT(*)::INTEGER AS visit_count,
         COALESCE(SUM(al.duration_seconds), 0) AS total_seconds
       FROM tracking_activity_logs al
       LEFT JOIN tracking_domain_classifications dc ON dc.domain = al.domain
       WHERE al.clerk_user_id = $1
         AND al.created_at::DATE BETWEEN $2 AND $3
       GROUP BY dc.classification
       ORDER BY total_seconds DESC`,
      [summaryFor, from_date, to_date]
    );

    const idleRes = await query(
      `SELECT COUNT(*)::INTEGER AS total_idle_events,
              COUNT(CASE WHEN user_response = 'was_working' THEN 1 END) AS resolved_as_working,
              COUNT(CASE WHEN user_response = 'was_idle' THEN 1 END)    AS confirmed_idle,
              COUNT(CASE WHEN user_response = 'pending' THEN 1 END)     AS pending_response
       FROM tracking_idle_events
       WHERE clerk_user_id = $1
         AND created_at::DATE BETWEEN $2 AND $3`,
      [summaryFor, from_date, to_date]
    );

    const metrics = metricsRes.rows[0] as Record<string, unknown>;
    const domainBreakdown = domainRes.rows as Array<{ classification: string; total_seconds: number }>;
    const idleStats = idleRes.rows[0] as Record<string, unknown>;

    const formatHours = (seconds: number) => (seconds / 3600).toFixed(1);

    const userRes = await query(`SELECT name, email FROM users WHERE clerk_user_id = $1`, [summaryFor]);
    const userName = userRes.rows[0]?.name ?? 'the user';

    const prompt = `You are analyzing work tracking data for ${userName} from ${from_date} to ${to_date}.

Work Session Metrics:
- Total sessions: ${metrics.total_sessions}
- Total active time: ${formatHours(Number(metrics.total_active) || 0)} hours
- Total idle time: ${formatHours(Number(metrics.total_idle) || 0)} hours
- Total break time: ${formatHours(Number(metrics.total_break) || 0)} hours
- Adjusted work time: ${formatHours(Number(metrics.total_adjusted) || 0)} hours
- Average active time per session: ${formatHours(Number(metrics.avg_active_per_session) || 0)} hours

Domain Activity Breakdown:
${domainBreakdown.map((d: { classification: string; total_seconds: number }) => `- ${d.classification ?? 'unknown'}: ${formatHours(d.total_seconds)} hours`).join('\n')}

Idle Event Stats:
- Total idle events: ${idleStats.total_idle_events}
- Confirmed idle: ${idleStats.confirmed_idle}
- Resolved as working: ${idleStats.resolved_as_working}
- Pending response: ${idleStats.pending_response}

Generate a concise work pattern summary. Return JSON with:
{
  "summary": "2-3 sentence narrative overview",
  "patterns": ["key pattern 1", "key pattern 2", "key pattern 3"],
  "recommendations": ["recommendation 1", "recommendation 2"]
}
Return only the JSON, no other text.`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      res.status(500).json({ error: 'Unexpected AI response format' });
      return;
    }

    let aiResult: { summary: string; patterns: string[]; recommendations: string[] };
    try {
      aiResult = JSON.parse(content.text);
    } catch {
      res.status(500).json({ error: 'Failed to parse AI summary', raw: content.text });
      return;
    }

    res.json({
      ...aiResult,
      metrics,
      domain_breakdown: domainBreakdown,
      idle_stats: idleStats,
      period: { from_date, to_date },
      generated_for: summaryFor,
    });
  } catch (err) {
    console.error('AI summary error:', err);
    res.status(500).json({ error: 'Failed to generate AI summary' });
  }
});

export default router;
