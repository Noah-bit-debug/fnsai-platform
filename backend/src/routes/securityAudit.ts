/**
 * Security audit log viewer API. Mounted at /api/v1/security-audit.
 *
 * Read-only — audit logs are append-only by design. Only admins with
 * admin.security_logs.view or admin.ai_logs.view can read.
 *
 * Endpoints:
 *   GET /events         — filter security_audit_log by user/action/outcome/date
 *   GET /ai-events      — filter ai_security_log
 *   GET /stats          — aggregate counts (denials by user, by permission, etc.)
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { query } from '../db/client';
import { requirePermission } from '../services/permissions/permissionService';

const router = Router();

// ─── GET /events — security_audit_log ─────────────────────────────────
router.get('/events', requireAuth, requirePermission('admin.security_logs.view'), async (req: Request, res: Response) => {
  const {
    user_id, action, outcome, permission_key,
    from, to,
    limit = '100',
  } = req.query as Record<string, string | undefined>;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (user_id)       { conditions.push(`s.user_id = $${idx++}`);        params.push(user_id); }
  if (action)        { conditions.push(`s.action = $${idx++}`);         params.push(action); }
  if (outcome)       { conditions.push(`s.outcome = $${idx++}`);        params.push(outcome); }
  if (permission_key){ conditions.push(`s.permission_key = $${idx++}`); params.push(permission_key); }
  if (from)          { conditions.push(`s.created_at >= $${idx++}`);    params.push(from); }
  if (to)            { conditions.push(`s.created_at <= $${idx++}`);    params.push(to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const lim = Math.min(parseInt(limit, 10) || 100, 500);

  try {
    const r = await query(
      `SELECT s.id, s.user_id, s.actor_oid, s.action, s.permission_key, s.outcome,
              s.reason, s.context, s.ip_address, s.created_at,
              u.name AS user_name, u.email AS user_email
         FROM security_audit_log s
         LEFT JOIN users u ON u.id = s.user_id
         ${where}
        ORDER BY s.created_at DESC
        LIMIT ${lim}`,
      params
    );
    res.json({ events: r.rows });
  } catch (err) {
    console.error('[security-audit] /events error:', err);
    res.status(500).json({ error: 'Failed to load audit events' });
  }
});

// ─── GET /ai-events — ai_security_log ─────────────────────────────────
router.get('/ai-events', requireAuth, requirePermission('admin.ai_logs.view'), async (req: Request, res: Response) => {
  const {
    user_id, tool, outcome,
    from, to,
    limit = '100',
  } = req.query as Record<string, string | undefined>;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (user_id) { conditions.push(`a.user_id = $${idx++}`); params.push(user_id); }
  if (tool)    { conditions.push(`a.tool = $${idx++}`);    params.push(tool); }
  if (outcome) { conditions.push(`a.outcome = $${idx++}`); params.push(outcome); }
  if (from)    { conditions.push(`a.created_at >= $${idx++}`); params.push(from); }
  if (to)      { conditions.push(`a.created_at <= $${idx++}`); params.push(to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const lim = Math.min(parseInt(limit, 10) || 100, 500);

  try {
    const r = await query(
      `SELECT a.id, a.user_id, a.actor_oid, a.tool, a.prompt_summary,
              a.detected_topics, a.required_perms, a.missing_perms,
              a.outcome, a.injection_flags, a.response_safe, a.context,
              a.created_at,
              u.name AS user_name, u.email AS user_email
         FROM ai_security_log a
         LEFT JOIN users u ON u.id = a.user_id
         ${where}
        ORDER BY a.created_at DESC
        LIMIT ${lim}`,
      params
    );
    res.json({ events: r.rows });
  } catch (err) {
    console.error('[security-audit] /ai-events error:', err);
    res.status(500).json({ error: 'Failed to load AI events' });
  }
});

// ─── GET /stats — high-level counts ───────────────────────────────────
router.get('/stats', requireAuth, requirePermission('admin.security_logs.view'), async (req: Request, res: Response) => {
  try {
    const [denials24h, aiDenials24h, injections24h, topDenialUsers] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count
           FROM security_audit_log
          WHERE outcome = 'denied' AND created_at > NOW() - INTERVAL '24 hours'`
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count
           FROM ai_security_log
          WHERE outcome = 'denied' AND created_at > NOW() - INTERVAL '24 hours'`
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count
           FROM ai_security_log
          WHERE outcome = 'injection_blocked' AND created_at > NOW() - INTERVAL '24 hours'`
      ),
      query(
        `SELECT s.user_id, u.name, u.email, COUNT(*)::INT AS denial_count
           FROM security_audit_log s
           LEFT JOIN users u ON u.id = s.user_id
          WHERE s.outcome = 'denied'
            AND s.created_at > NOW() - INTERVAL '7 days'
          GROUP BY s.user_id, u.name, u.email
          ORDER BY denial_count DESC
          LIMIT 10`
      ),
    ]);

    res.json({
      permission_denials_24h: parseInt(denials24h.rows[0]?.count ?? '0', 10),
      ai_denials_24h: parseInt(aiDenials24h.rows[0]?.count ?? '0', 10),
      prompt_injections_blocked_24h: parseInt(injections24h.rows[0]?.count ?? '0', 10),
      top_denial_users_7d: topDenialUsers.rows,
    });
  } catch (err) {
    console.error('[security-audit] /stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;
