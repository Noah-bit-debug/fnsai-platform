import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getAuth } from '@clerk/express';
import { requireAuth } from '../middleware/auth';
import { query } from '../db/client';

const router = Router();

// Timestamp fields on GET are surfaced so clients can show "Last saved X ago".
// Every boolean defaults to TRUE at the DB level, so a brand-new user who hits
// the GET endpoint before ever saving gets a sensible default shape.

const prefsSchema = z.object({
  email_enabled: z.boolean().optional(),
  sms_enabled: z.boolean().optional(),
  inapp_enabled: z.boolean().optional(),
  notify_credential_expiry: z.boolean().optional(),
  notify_missing_document: z.boolean().optional(),
  notify_compliance_assign: z.boolean().optional(),
  notify_placement_change: z.boolean().optional(),
  notify_task_reminder: z.boolean().optional(),
  notify_submission_update: z.boolean().optional(),
  notify_sms_approval: z.boolean().optional(),
  notify_system_announcement: z.boolean().optional(),
  digest_schedule: z.enum(['off', 'daily', 'weekly']).optional(),
  digest_time_of_day: z.string().optional(),
  quiet_hours_enabled: z.boolean().optional(),
  quiet_start: z.string().optional(),
  quiet_end: z.string().optional(),
});

/** GET /me — fetch the current user's prefs; creates a default row on first hit. */
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const clerkId = auth?.userId;
  if (!clerkId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  try {
    // Try to read existing
    const existing = await query(
      `SELECT * FROM notification_prefs WHERE clerk_user_id = $1 LIMIT 1`,
      [clerkId]
    );
    if (existing.rows.length > 0) {
      res.json({ prefs: existing.rows[0] });
      return;
    }

    // Create the default row. ON CONFLICT handles the race where two parallel
    // requests from the same user (e.g. HMR + actual page load) both try to
    // insert — the losing one gets back the winner's row.
    const created = await query(
      `INSERT INTO notification_prefs (clerk_user_id) VALUES ($1)
       ON CONFLICT (clerk_user_id) DO UPDATE SET updated_at = notification_prefs.updated_at
       RETURNING *`,
      [clerkId]
    );
    res.json({ prefs: created.rows[0] });
  } catch (err: any) {
    // Table not migrated yet — return safe defaults so the page still renders.
    if (err?.code === '42P01') {
      res.json({
        prefs: {
          email_enabled: true, sms_enabled: true, inapp_enabled: true,
          notify_credential_expiry: true, notify_missing_document: true,
          notify_compliance_assign: true, notify_placement_change: true,
          notify_task_reminder: true, notify_submission_update: true,
          notify_sms_approval: true, notify_system_announcement: true,
          digest_schedule: 'daily', digest_time_of_day: '08:00',
          quiet_hours_enabled: false, quiet_start: '22:00', quiet_end: '07:00',
        },
      });
      return;
    }
    console.error('Notification prefs GET error:', err);
    res.status(500).json({ error: 'Failed to load preferences' });
  }
});

/** PUT /me — upsert. Accepts any subset of fields. */
router.put('/me', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const clerkId = auth?.userId;
  if (!clerkId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const entries = Object.entries(d).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  // Build parameterised UPDATE statement. Column names are whitelisted by the
  // zod schema (only known keys survive) so it's safe to interpolate them.
  const setParts = entries.map(([k], i) => `${k} = $${i + 2}`);
  const values: unknown[] = [clerkId, ...entries.map(([, v]) => v)];

  try {
    // Upsert: insert a default row if missing, then run the same SET on conflict.
    // Build the matching EXCLUDED.xxx list to avoid repeating the values.
    const excludedSet = entries.map(([k]) => `${k} = EXCLUDED.${k}`).join(', ');

    const result = await query(
      `INSERT INTO notification_prefs (clerk_user_id, ${entries.map(([k]) => k).join(', ')})
       VALUES ($1, ${entries.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (clerk_user_id) DO UPDATE
         SET ${excludedSet}, updated_at = NOW()
       RETURNING *`,
      values
    );
    // Suppress unused-var warning while keeping setParts readable in dev
    void setParts;
    res.json({ prefs: result.rows[0] });
  } catch (err: any) {
    if (err?.code === '42P01') {
      res.status(503).json({
        error: 'migration_pending',
        message: 'Notification preferences table not migrated yet. Contact an admin.',
      });
      return;
    }
    console.error('Notification prefs PUT error:', err);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

export default router;
