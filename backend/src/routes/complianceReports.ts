import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/client';

const router = Router();

// ---------------------------------------------------------------------------
// GET /overview â€” overall compliance dashboard data
// ---------------------------------------------------------------------------

router.get('/overview', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [
      statusBreakdown,
      typeBreakdown,
      contentCounts,
      expiringSoon,
      overdue,
    ] = await Promise.all([
      pool.query(`
        SELECT status, COUNT(*) as count
        FROM comp_competency_records
        GROUP BY status
      `),
      pool.query(`
        SELECT item_type, status, COUNT(*) as count
        FROM comp_competency_records
        GROUP BY item_type, status
      `),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM comp_policies    WHERE status = 'published') as published_policies,
          (SELECT COUNT(*) FROM comp_documents   WHERE status = 'published') as published_documents,
          (SELECT COUNT(*) FROM comp_exams       WHERE status = 'published') as published_exams,
          (SELECT COUNT(*) FROM comp_checklists  WHERE status = 'published') as published_checklists
      `),
      pool.query(`
        SELECT COUNT(*) as count
        FROM comp_competency_records
        WHERE expiration_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
          AND status IN ('completed', 'signed', 'read')
      `),
      pool.query(`
        SELECT COUNT(*) as count
        FROM comp_competency_records
        WHERE due_date < NOW()
          AND status IN ('not_started', 'in_progress')
      `),
    ]);

    // Build by_status map
    const byStatus: Record<string, number> = {};
    let totalRecords = 0;
    for (const row of statusBreakdown.rows) {
      byStatus[row.status] = parseInt(row.count, 10);
      totalRecords += parseInt(row.count, 10);
    }

    // Completed = completed + signed + read
    const completedTotal =
      (byStatus['completed'] ?? 0) +
      (byStatus['signed'] ?? 0) +
      (byStatus['read'] ?? 0);
    const completionRate = totalRecords > 0
      ? Math.round((completedTotal / totalRecords) * 100)
      : 0;

    // Build by_type map
    const byType: Record<string, Record<string, number>> = {};
    for (const row of typeBreakdown.rows) {
      if (!byType[row.item_type]) byType[row.item_type] = { total: 0 };
      byType[row.item_type][row.status] = parseInt(row.count, 10);
      byType[row.item_type].total = (byType[row.item_type].total ?? 0) + parseInt(row.count, 10);
    }

    const counts = contentCounts.rows[0];

    res.json({
      total_records: totalRecords,
      by_status: byStatus,
      completion_rate: completionRate,
      by_type: byType,
      published_content: {
        policies:   parseInt(counts.published_policies, 10),
        documents:  parseInt(counts.published_documents, 10),
        exams:      parseInt(counts.published_exams, 10),
        checklists: parseInt(counts.published_checklists, 10),
      },
      expiring_soon_count: parseInt(expiringSoon.rows[0].count, 10),
      overdue_count:       parseInt(overdue.rows[0].count, 10),
    });
  } catch (err: any) {
    console.error('[compliance-reports] /overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /users â€” per-user completion stats
// ---------------------------------------------------------------------------

router.get('/users', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        user_clerk_id,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN ('completed', 'signed', 'read'))           as completed_count,
        COUNT(*) FILTER (WHERE status IN ('not_started', 'in_progress'))            as pending_count,
        COUNT(*) FILTER (WHERE status = 'expired')                                  as expired_count,
        COUNT(*) FILTER (WHERE status = 'failed')                                   as failed_count,
        MIN(due_date) FILTER (
          WHERE due_date IS NOT NULL AND status NOT IN ('completed', 'signed', 'read')
        ) as next_due_date
      FROM comp_competency_records
      GROUP BY user_clerk_id
      ORDER BY completed_count DESC
    `);

    const users = result.rows.map((row) => {
      const total = parseInt(row.total, 10);
      const completed = parseInt(row.completed_count, 10);
      return {
        user_clerk_id:    row.user_clerk_id,
        total,
        completed_count:  completed,
        pending_count:    parseInt(row.pending_count, 10),
        expired_count:    parseInt(row.expired_count, 10),
        failed_count:     parseInt(row.failed_count, 10),
        next_due_date:    row.next_due_date ?? null,
        completion_rate:  total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });

    res.json({ users });
  } catch (err: any) {
    console.error('[compliance-reports] /users error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /content â€” per-content-item completion rates
// ---------------------------------------------------------------------------

router.get('/content', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        item_type,
        item_id,
        title,
        COUNT(*) as total_assigned,
        COUNT(*) FILTER (WHERE status IN ('completed', 'signed', 'read')) as completed_count,
        COUNT(*) FILTER (WHERE status = 'expired')                         as expired_count,
        COUNT(*) FILTER (WHERE status = 'failed')                          as failed_count
      FROM comp_competency_records
      GROUP BY item_type, item_id, title
      ORDER BY total_assigned DESC
      LIMIT 50
    `);

    const items = result.rows.map((row) => {
      const total = parseInt(row.total_assigned, 10);
      const completed = parseInt(row.completed_count, 10);
      return {
        item_type:       row.item_type,
        item_id:         row.item_id,
        title:           row.title,
        total_assigned:  total,
        completed_count: completed,
        expired_count:   parseInt(row.expired_count, 10),
        failed_count:    parseInt(row.failed_count, 10),
        completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });

    res.json({ items });
  } catch (err: any) {
    console.error('[compliance-reports] /content error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /expiring â€” items expiring in next N days (default 30, ?days=N)
// ---------------------------------------------------------------------------

router.get('/expiring', requireAuth, async (req: Request, res: Response) => {
  try {
    const days = parseInt((req.query.days as string) ?? '30', 10);

    const result = await pool.query(`
      SELECT *,
             EXTRACT(DAY FROM expiration_date - NOW())::int as days_until_expiry
      FROM comp_competency_records
      WHERE expiration_date BETWEEN NOW() AND NOW() + ($1 || ' days')::INTERVAL
        AND status IN ('completed', 'signed', 'read')
      ORDER BY expiration_date ASC
    `, [days]);

    res.json({ records: result.rows });
  } catch (err: any) {
    console.error('[compliance-reports] /expiring error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /overdue â€” past due, not completed
// ---------------------------------------------------------------------------

router.get('/overdue', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT *,
             EXTRACT(DAY FROM NOW() - due_date)::int as days_overdue
      FROM comp_competency_records
      WHERE due_date < NOW()
        AND status IN ('not_started', 'in_progress')
      ORDER BY due_date ASC
    `);

    res.json({ records: result.rows });
  } catch (err: any) {
    console.error('[compliance-reports] /overdue error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /notifications â€” recent notification log (last 100)
// ---------------------------------------------------------------------------

router.get('/notifications', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM comp_notifications_log
      ORDER BY created_at DESC
      LIMIT 100
    `);

    res.json({ notifications: result.rows });
  } catch (err: any) {
    console.error('[compliance-reports] /notifications error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /user/:userId â€” Full compliance report for a specific user.
// ---------------------------------------------------------------------------

router.get('/user/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const recordsResult = await pool.query(
      `SELECT
         cr.*,
         CASE
           WHEN cr.item_type = 'exam' THEN (
             SELECT score FROM comp_exam_attempts
             WHERE competency_record_id = cr.id AND status = 'passed'
             LIMIT 1
           )
           ELSE NULL
         END as exam_score,
         CASE
           WHEN cr.item_type = 'checklist' THEN (
             SELECT overall_score FROM comp_checklist_submissions
             WHERE competency_record_id = cr.id
             LIMIT 1
           )
           ELSE NULL
         END as checklist_score
       FROM comp_competency_records cr
       WHERE cr.user_clerk_id = $1
       ORDER BY cr.assigned_date DESC`,
      [userId],
    );

    const rows = recordsResult.rows;
    const total = rows.length;
    const completed = rows.filter(
      (r) => ['completed', 'signed', 'read'].includes(r.status),
    ).length;
    const pending = rows.filter(
      (r) => ['not_started', 'in_progress'].includes(r.status),
    ).length;
    const expired = rows.filter((r) => r.status === 'expired').length;

    const byType: Record<string, { total: number; completed: number }> = {};
    for (const r of rows) {
      if (!byType[r.item_type]) byType[r.item_type] = { total: 0, completed: 0 };
      byType[r.item_type].total += 1;
      if (['completed', 'signed', 'read'].includes(r.status)) {
        byType[r.item_type].completed += 1;
      }
    }

    res.json({
      user_clerk_id: userId,
      records: rows,
      summary: {
        total,
        completed,
        pending,
        expired,
        completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
        by_type: byType,
      },
    });
  } catch (err: any) {
    console.error('[compliance-reports] GET /user/:userId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /exam/:examId â€” Exam analytics.
// ---------------------------------------------------------------------------

router.get('/exam/:examId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { examId } = req.params;

    const [statsResult, uniqueResult, distResult] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) as total_attempts,
           COUNT(*) FILTER (WHERE status = 'passed') as passed,
           COUNT(*) FILTER (WHERE status = 'failed') as failed,
           AVG(score) FILTER (WHERE score IS NOT NULL) as avg_score,
           MAX(score) as max_score,
           MIN(score) FILTER (WHERE score IS NOT NULL) as min_score
         FROM comp_exam_attempts
         WHERE exam_id = $1`,
        [examId],
      ),
      pool.query(
        `SELECT COUNT(DISTINCT user_clerk_id) as unique_takers
         FROM comp_exam_attempts
         WHERE exam_id = $1`,
        [examId],
      ),
      pool.query(
        `SELECT
           CASE
             WHEN score < 60 THEN 'below_60'
             WHEN score < 70 THEN '60_69'
             WHEN score < 80 THEN '70_79'
             WHEN score < 90 THEN '80_89'
             ELSE '90_100'
           END as bucket,
           COUNT(*) as count
         FROM comp_exam_attempts
         WHERE exam_id = $1 AND score IS NOT NULL
         GROUP BY bucket`,
        [examId],
      ),
    ]);

    const s = statsResult.rows[0];
    const totalAttempts = parseInt(s.total_attempts, 10);
    const passed        = parseInt(s.passed, 10);
    const failed        = parseInt(s.failed, 10);
    const uniqueTakers  = parseInt(uniqueResult.rows[0].unique_takers, 10);

    const scoreDistribution: Record<string, number> = {
      below_60: 0, '60_69': 0, '70_79': 0, '80_89': 0, '90_100': 0,
    };
    for (const row of distResult.rows) {
      scoreDistribution[row.bucket] = parseInt(row.count, 10);
    }

    res.json({
      exam_id: examId,
      stats: {
        total_attempts: totalAttempts,
        passed,
        failed,
        avg_score:     s.avg_score != null ? parseFloat(parseFloat(s.avg_score).toFixed(2)) : null,
        max_score:     s.max_score != null ? parseFloat(s.max_score) : null,
        min_score:     s.min_score != null ? parseFloat(s.min_score) : null,
        unique_takers: uniqueTakers,
        pass_rate:     totalAttempts > 0 ? Math.round((passed / totalAttempts) * 100) : 0,
      },
      score_distribution: scoreDistribution,
    });
  } catch (err: any) {
    console.error('[compliance-reports] GET /exam/:examId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /trends â€” Completion trends last 30 days.
// ---------------------------------------------------------------------------

router.get('/trends', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        DATE_TRUNC('day', completed_date)::date as day,
        COUNT(*) as completions,
        COUNT(*) FILTER (WHERE item_type = 'exam')      as exams,
        COUNT(*) FILTER (WHERE item_type = 'policy')    as policies,
        COUNT(*) FILTER (WHERE item_type = 'document')  as documents,
        COUNT(*) FILTER (WHERE item_type = 'checklist') as checklists
      FROM comp_competency_records
      WHERE completed_date >= NOW() - INTERVAL '30 days'
        AND status IN ('completed', 'signed', 'read')
      GROUP BY DATE_TRUNC('day', completed_date)
      ORDER BY day ASC
    `);

    const days = result.rows.map((row) => ({
      day:         row.day,
      completions: parseInt(row.completions, 10),
      exams:       parseInt(row.exams, 10),
      policies:    parseInt(row.policies, 10),
      documents:   parseInt(row.documents, 10),
      checklists:  parseInt(row.checklists, 10),
    }));

    res.json({ days });
  } catch (err: any) {
    console.error('[compliance-reports] GET /trends error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /export/records â€” CSV export of competency records.
// ---------------------------------------------------------------------------

router.get('/export/records', requireAuth, async (req: Request, res: Response) => {
  try {
    const { status, item_type, user_clerk_id, from_date, to_date } = req.query as Record<string, string | undefined>;

    const conditions: string[] = [];
    const params: (string | undefined)[] = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (item_type) {
      params.push(item_type);
      conditions.push(`item_type = $${params.length}`);
    }
    if (user_clerk_id) {
      params.push(user_clerk_id);
      conditions.push(`user_clerk_id = $${params.length}`);
    }
    if (from_date) {
      params.push(from_date);
      conditions.push(`assigned_date >= $${params.length}`);
    }
    if (to_date) {
      params.push(to_date);
      conditions.push(`assigned_date <= $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, user_clerk_id, item_type, title, status,
              assigned_date, completed_date, due_date, expiration_date,
              score, ceus, attempts_used
       FROM comp_competency_records
       ${where}
       ORDER BY assigned_date DESC`,
      params,
    );

    const header = 'id,user_clerk_id,item_type,title,status,assigned_date,completed_date,due_date,expiration_date,score,ceus,attempts_used\n';

    const escape = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = result.rows
      .map((r) =>
        [
          r.id, r.user_clerk_id, r.item_type, r.title, r.status,
          r.assigned_date, r.completed_date, r.due_date, r.expiration_date,
          r.score, r.ceus, r.attempts_used,
        ]
          .map(escape)
          .join(','),
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="compliance_records.csv"');
    res.send(header + rows);
  } catch (err: any) {
    console.error('[compliance-reports] GET /export/records error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /export/certificates â€” CSV export of all certificates.
// ---------------------------------------------------------------------------

router.get('/export/certificates', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, user_clerk_id, title, certificate_number, issued_at, expires_at
       FROM comp_certificates
       ORDER BY issued_at DESC`,
    );

    const header = 'id,user_clerk_id,title,certificate_number,issued_at,expires_at\n';

    const escape = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = result.rows
      .map((r) =>
        [r.id, r.user_clerk_id, r.title, r.certificate_number, r.issued_at, r.expires_at]
          .map(escape)
          .join(','),
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="compliance_certificates.csv"');
    res.send(header + rows);
  } catch (err: any) {
    console.error('[compliance-reports] GET /export/certificates error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

