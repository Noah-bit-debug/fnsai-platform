import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/client';
import { sendNotification, getSetting } from '../services/complianceNotificationService';
import { sendEmail } from '../services/graph';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function startJobLog(jobName: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO comp_job_log (job_name, status) VALUES ($1, 'running') RETURNING id`,
    [jobName]
  );
  return result.rows[0].id;
}

async function completeJobLog(
  id: string,
  processed: number,
  affected: number,
  error?: string
): Promise<void> {
  const status = error ? 'failed' : 'completed';
  await pool.query(
    `UPDATE comp_job_log
     SET status = $1, records_processed = $2, records_affected = $3,
         error_message = $4, completed_at = NOW()
     WHERE id = $5`,
    [status, processed, affected, error ?? null, id]
  );
}

// ---------------------------------------------------------------------------
// GET /settings — fetch all notification settings
router.get('/settings', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT setting_key, setting_value FROM comp_notification_settings ORDER BY setting_key');
    const settings: Record<string, string> = {};
    for (const row of result.rows) settings[row.setting_key] = row.setting_value;
    res.json({ settings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /settings — update a single notification setting
router.patch('/settings', requireAuth, async (req: Request, res: Response) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' }) as any;
  try {
    await pool.query(
      `INSERT INTO comp_notification_settings (setting_key, setting_value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = NOW()`,
      [key, String(value)]
    );
    res.json({ success: true, key, value });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /status — last run info for each job + notification counts
// ---------------------------------------------------------------------------

router.get('/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [jobsResult, pendingResult] = await Promise.all([
      pool.query(`
        SELECT job_name, status, records_processed, records_affected, started_at, completed_at
        FROM comp_job_log
        WHERE id IN (SELECT MAX(id) FROM comp_job_log GROUP BY job_name)
        ORDER BY job_name
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'sent')    as sent,
          COUNT(*) FILTER (WHERE status = 'failed')  as failed,
          COUNT(*)                                    as total
        FROM comp_notifications_log
      `),
    ]);

    const notifCounts = pendingResult.rows[0] ?? { pending: 0, sent: 0, failed: 0, total: 0 };

    res.json({
      jobs: jobsResult.rows,
      notifications: {
        pending: parseInt(notifCounts.pending, 10),
        sent: parseInt(notifCounts.sent, 10),
        failed: parseInt(notifCounts.failed, 10),
        total: parseInt(notifCounts.total, 10),
      },
    });
  } catch (err: any) {
    console.error('[compliance-jobs] /status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /expire — expire records and optionally auto-renew
// ---------------------------------------------------------------------------

router.post('/expire', requireAuth, async (_req: Request, res: Response) => {
  const jobId = await startJobLog('expire');
  let expiredCount = 0;
  let autoRenewedCount = 0;

  try {
    // Find records to expire
    const toExpire = await pool.query(`
      SELECT id, user_clerk_id, item_id, item_type, title, expiration_date
      FROM comp_competency_records
      WHERE expiration_date < NOW()
        AND status NOT IN ('expired', 'not_started')
    `);

    const [autoRenewYearly, autoRenewBiAnnual] = await Promise.all([
      getSetting('auto_renew_yearly'),
      getSetting('auto_renew_bi_annual'),
    ]);

    for (const record of toExpire.rows) {
      // Mark as expired
      await pool.query(
        `UPDATE comp_competency_records SET status = 'expired' WHERE id = $1`,
        [record.id]
      );
      expiredCount++;

      // Auto-renew exams if configured
      if (record.item_type === 'exam') {
        const shouldRenew = autoRenewYearly === 'true' || autoRenewBiAnnual === 'true';
        if (shouldRenew) {
          const newRecord = await pool.query(
            `INSERT INTO comp_competency_records
               (user_clerk_id, item_id, item_type, title, status)
             VALUES ($1, $2, $3, $4, 'not_started')
             RETURNING id`,
            [record.user_clerk_id, record.item_id, record.item_type, record.title]
          );

          await sendNotification({
            user_clerk_id: record.user_clerk_id,
            notification_type: 'auto_renewed',
            competency_record_id: newRecord.rows[0].id,
            subject: `Compliance item renewed: ${record.title}`,
            body: `Your compliance item "${record.title}" has been automatically renewed. Please complete it to stay current.`,
          });

          autoRenewedCount++;
        }
      }
    }

    // Count overdue records (not_started/in_progress past due_date) — log only, no status change
    const overdueResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM comp_competency_records
      WHERE due_date < NOW() AND status IN ('not_started', 'in_progress')
    `);
    const overdueCount = parseInt(overdueResult.rows[0].count, 10);

    await completeJobLog(jobId, toExpire.rows.length + overdueCount, expiredCount + autoRenewedCount);

    res.json({ expired_count: expiredCount, auto_renewed_count: autoRenewedCount });
  } catch (err: any) {
    console.error('[compliance-jobs] /expire error:', err);
    await completeJobLog(jobId, 0, 0, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /notify-due-soon — queue due-soon notifications
// ---------------------------------------------------------------------------

router.post('/notify-due-soon', requireAuth, async (_req: Request, res: Response) => {
  const jobId = await startJobLog('notify-due-soon');

  try {
    const dueSoonDays = parseInt((await getSetting('notify_due_soon_days')) || '7', 10);

    // Records due within the window, not already notified in last 24h
    const records = await pool.query(`
      SELECT cr.id, cr.user_clerk_id, cr.title, cr.due_date,
             EXTRACT(DAY FROM cr.due_date - NOW())::int as days_until_due
      FROM comp_competency_records cr
      WHERE cr.due_date BETWEEN NOW() AND NOW() + ($1 || ' days')::INTERVAL
        AND cr.status IN ('not_started', 'in_progress')
        AND NOT EXISTS (
          SELECT 1 FROM comp_notifications_log nl
          WHERE nl.competency_record_id = cr.id
            AND nl.notification_type = 'due_soon'
            AND nl.created_at > NOW() - INTERVAL '24 hours'
        )
    `, [dueSoonDays]);

    let queuedCount = 0;

    for (const record of records.rows) {
      // No email stored in DB — log as pending (skipped). Admin configures sending separately.
      await sendNotification({
        user_clerk_id: record.user_clerk_id,
        notification_type: 'due_soon',
        competency_record_id: record.id,
        subject: `Compliance item due in ${record.days_until_due} days: ${record.title}`,
        body: `Your compliance item "${record.title}" is due on ${new Date(record.due_date).toLocaleDateString()}. Please complete it before the due date.`,
        // No recipient_email — will be logged as 'skipped'
      });
      queuedCount++;
    }

    await completeJobLog(jobId, records.rows.length, queuedCount);
    res.json({ queued_count: queuedCount });
  } catch (err: any) {
    console.error('[compliance-jobs] /notify-due-soon error:', err);
    await completeJobLog(jobId, 0, 0, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /notify-expiring — queue expiring-soon notifications
// ---------------------------------------------------------------------------

router.post('/notify-expiring', requireAuth, async (_req: Request, res: Response) => {
  const jobId = await startJobLog('notify-expiring');

  try {
    const expiringDays = parseInt((await getSetting('notify_expiring_soon_days')) || '30', 10);

    const records = await pool.query(`
      SELECT cr.id, cr.user_clerk_id, cr.title, cr.expiration_date,
             EXTRACT(DAY FROM cr.expiration_date - NOW())::int as days_until_expiry
      FROM comp_competency_records cr
      WHERE cr.expiration_date BETWEEN NOW() AND NOW() + ($1 || ' days')::INTERVAL
        AND cr.status IN ('completed', 'signed', 'read')
        AND NOT EXISTS (
          SELECT 1 FROM comp_notifications_log nl
          WHERE nl.competency_record_id = cr.id
            AND nl.notification_type = 'expiring_soon'
            AND nl.created_at > NOW() - INTERVAL '7 days'
        )
    `, [expiringDays]);

    let queuedCount = 0;

    for (const record of records.rows) {
      await sendNotification({
        user_clerk_id: record.user_clerk_id,
        notification_type: 'expiring_soon',
        competency_record_id: record.id,
        subject: `Compliance certification expiring in ${record.days_until_expiry} days: ${record.title}`,
        body: `Your completion of "${record.title}" expires on ${new Date(record.expiration_date).toLocaleDateString()} (${record.days_until_expiry} days from now). You may need to retake this item to maintain compliance.`,
        // No recipient_email — logged as 'skipped'
      });
      queuedCount++;
    }

    await completeJobLog(jobId, records.rows.length, queuedCount);
    res.json({ queued_count: queuedCount });
  } catch (err: any) {
    console.error('[compliance-jobs] /notify-expiring error:', err);
    await completeJobLog(jobId, 0, 0, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /process-notifications — attempt to send pending notifications
// ---------------------------------------------------------------------------

router.post('/process-notifications', requireAuth, async (_req: Request, res: Response) => {
  const jobId = await startJobLog('process-notifications');

  try {
    const pending = await pool.query(`
      SELECT id, recipient_email, subject, body
      FROM comp_notifications_log
      WHERE status = 'pending'
      LIMIT 50
    `);

    let sentCount = 0;
    let failedCount = 0;

    for (const notif of pending.rows) {
      if (!notif.recipient_email) {
        await pool.query(
          `UPDATE comp_notifications_log SET status = 'skipped', sent_at = NOW() WHERE id = $1`,
          [notif.id]
        );
        continue;
      }

      try {
        await sendEmail(notif.recipient_email, notif.subject, notif.body);
        await pool.query(
          `UPDATE comp_notifications_log SET status = 'sent', sent_at = NOW() WHERE id = $1`,
          [notif.id]
        );
        sentCount++;
      } catch (err: any) {
        await pool.query(
          `UPDATE comp_notifications_log
           SET status = 'failed', sent_at = NOW(), error_message = $1
           WHERE id = $2`,
          [err.message?.slice(0, 500), notif.id]
        );
        failedCount++;
      }
    }

    await completeJobLog(jobId, pending.rows.length, sentCount);
    res.json({ processed: pending.rows.length, sent: sentCount, failed: failedCount });
  } catch (err: any) {
    console.error('[compliance-jobs] /process-notifications error:', err);
    await completeJobLog(jobId, 0, 0, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /auto-assign — evaluate rules and create missing competency records
// ---------------------------------------------------------------------------

router.post('/auto-assign', requireAuth, async (_req: Request, res: Response) => {
  const jobId = await startJobLog('auto-assign');

  try {
    // Fetch published bundles with active assignment rules
    const bundlesResult = await pool.query(`
      SELECT b.id as bundle_id, b.title as bundle_title,
             ar.id as rule_id, ar.rule_type, ar.role, ar.specialty, ar.priority
      FROM comp_bundles b
      JOIN comp_assignment_rules ar ON ar.bundle_id = b.id
      WHERE b.status = 'published' AND ar.active = true
      ORDER BY ar.priority DESC
    `);

    const rules = bundlesResult.rows;

    // Fetch bundle items for all matched bundles
    const bundleIds = [...new Set(rules.map((r: any) => r.bundle_id))];
    let bundleItemsMap: Record<string, any[]> = {};

    if (bundleIds.length > 0) {
      const itemsResult = await pool.query(
        `SELECT bundle_id, item_id, item_type, title
         FROM comp_bundle_items
         WHERE bundle_id = ANY($1)`,
        [bundleIds]
      );
      for (const item of itemsResult.rows) {
        if (!bundleItemsMap[item.bundle_id]) bundleItemsMap[item.bundle_id] = [];
        bundleItemsMap[item.bundle_id].push(item);
      }
    }

    // Fetch all org users from our DB (auth middleware keeps it in sync
    // with Azure on every authenticated request). The `clerk_user_id`
    // column now stores Azure `oid` values — name is legacy.
    const usersResponse = await pool.query<{ id: string; role: string | null }>(
      `SELECT clerk_user_id AS id, role FROM users WHERE clerk_user_id IS NOT NULL`
    );
    const users = usersResponse.rows.map((r) => ({
      id: r.id,
      publicMetadata: { role: r.role ?? '' },
    }));

    // Fetch staff specialty lookup: clerk_user_id -> specialty
    const staffResult = await pool.query(
      `SELECT clerk_user_id, specialty FROM staff WHERE clerk_user_id IS NOT NULL`
    );
    const specialtyMap: Record<string, string> = {};
    for (const row of staffResult.rows) {
      specialtyMap[row.clerk_user_id] = row.specialty;
    }

    let usersEvaluated = 0;
    let assignmentsCreated = 0;

    for (const user of users) {
      usersEvaluated++;
      const userRole = user.publicMetadata.role;
      const userSpecialty = specialtyMap[user.id] ?? '';

      // Determine which bundles match this user
      const matchedBundleIds = new Set<string>();

      for (const rule of rules) {
        let matches = false;

        if (rule.rule_type === 'role') {
          matches = userRole === rule.role;
        } else if (rule.rule_type === 'specialty') {
          matches = userSpecialty === rule.specialty;
        } else if (rule.rule_type === 'role_specialty') {
          matches = userRole === rule.role && userSpecialty === rule.specialty;
        }

        if (matches) {
          matchedBundleIds.add(rule.bundle_id);
        }
      }

      // For each matched bundle, create missing competency records
      for (const bundleId of matchedBundleIds) {
        const items = bundleItemsMap[bundleId] ?? [];

        for (const item of items) {
          // Check if record already exists
          const exists = await pool.query(
            `SELECT id FROM comp_competency_records
             WHERE user_clerk_id = $1 AND item_id = $2 AND item_type = $3
             LIMIT 1`,
            [user.id, item.item_id, item.item_type]
          );

          if (exists.rows.length === 0) {
            await pool.query(
              `INSERT INTO comp_competency_records (user_clerk_id, item_id, item_type, title, status)
               VALUES ($1, $2, $3, $4, 'not_started')`,
              [user.id, item.item_id, item.item_type, item.title]
            );
            assignmentsCreated++;
          }
        }
      }
    }

    await completeJobLog(jobId, usersEvaluated, assignmentsCreated);
    res.json({ users_evaluated: usersEvaluated, assignments_created: assignmentsCreated });
  } catch (err: any) {
    console.error('[compliance-jobs] /auto-assign error:', err);
    await completeJobLog(jobId, 0, 0, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /run-all — run all 4 jobs in sequence
// ---------------------------------------------------------------------------

router.post('/run-all', requireAuth, async (req: Request, res: Response) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const authHeader = req.headers.authorization ?? '';

    const runJob = async (path: string) => {
      const r = await fetch(`${baseUrl}/api/v1/compliance/jobs/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
      });
      return r.json();
    };

    const [expireResult, dueSoonResult, expiringResult, processResult] = await Promise.all([
      runJob('expire').catch((e) => ({ error: e.message })),
      runJob('notify-due-soon').catch((e) => ({ error: e.message })),
      runJob('notify-expiring').catch((e) => ({ error: e.message })),
      runJob('process-notifications').catch((e) => ({ error: e.message })),
    ]);

    res.json({
      expire: expireResult,
      notify_due_soon: dueSoonResult,
      notify_expiring: expiringResult,
      process_notifications: processResult,
    });
  } catch (err: any) {
    console.error('[compliance-jobs] /run-all error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
