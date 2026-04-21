import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getAuth, clerkClient } from '@clerk/express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/client';

/**
 * DB-free admin check. The regular requireRole middleware looks up the
 * caller in the `users` SQL table, but the whole point of the admin
 * endpoints below is to fix a broken DB — so relying on the DB to
 * authorize is a chicken-and-egg problem. Instead, check Clerk's
 * publicMetadata directly, which is where the frontend actually reads
 * the role from.
 *
 * Also honors ADMIN_BOOTSTRAP_CLERK_USER_IDS env var (comma-separated
 * Clerk user IDs) as a belt-and-suspenders allowlist for the very first
 * bootstrap when no role has been assigned yet.
 */
async function requireClerkAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }

  // Env-var allowlist for emergency bootstrap
  const bootstrapIds = (process.env.ADMIN_BOOTSTRAP_CLERK_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (bootstrapIds.includes(auth.userId)) {
    next();
    return;
  }

  try {
    const user = await clerkClient.users.getUser(auth.userId);
    const role = (user.publicMetadata?.role as string | undefined)?.toLowerCase();
    if (role === 'admin' || role === 'ceo') {
      next();
      return;
    }
    res.status(403).json({
      error: 'Forbidden',
      message: `Clerk role '${role ?? 'none'}' does not have admin access`,
      hint: 'Set publicMetadata.role = "admin" in Clerk, or add your Clerk user ID to ADMIN_BOOTSTRAP_CLERK_USER_IDS env var',
    });
  } catch (err) {
    console.error('[admin] Clerk lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Failed to verify admin role via Clerk' });
  }
}

/**
 * Admin-only operational endpoints. Keep this small and tightly gated —
 * things in here can do real damage if misused.
 *
 * Why this exists:
 *   The server runs migrations on startup, but errors are caught so a
 *   single bad migration doesn't prevent the whole API from booting.
 *   Downside: a silently-failed migration leaves the prod DB in a broken
 *   state and the only ways to fix it used to be (a) redeploy hoping it
 *   re-runs, or (b) direct psql access. This endpoint is option (c):
 *   admin hits a button, server re-runs every migration SQL file and
 *   returns a per-file report with the real pg error details.
 */

const router = Router();

// Same ordered list as runMigrations() in index.ts. Keeping this in sync by
// hand is fine — it changes every few months and the review process should
// catch drift.
const MIGRATION_FILES = [
  'schema.sql',
  'candidates_migration.sql',
  'intelligence_migration.sql',
  'time_tracking_migration.sql',
  'compliance_phase1_migration.sql',
  'compliance_phase2_migration.sql',
  'compliance_phase3_migration.sql',
  'compliance_phase4_migration.sql',
  'compliance_phase5_migration.sql',
  'compliance_phase6_migration.sql',
  'pre_role_assignments_migration.sql',
  'ai_brain_migration.sql',
  'ats_phase1_migration.sql',
  'notification_prefs_migration.sql',
];

interface MigrationResult {
  file: string;
  status: 'ok' | 'skipped' | 'error';
  error?: {
    code?: string;
    message?: string;
    detail?: string;
    hint?: string;
    position?: string;
  };
}

// POST /migrate — re-run every migration SQL file. Idempotent by design
// (all our migrations use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS / ON CONFLICT DO NOTHING), so running this on a healthy DB is
// a no-op. On a half-migrated DB, it patches the missing tables.
router.post('/migrate', requireAuth, requireClerkAdmin, async (_req: Request, res: Response) => {
  const results: MigrationResult[] = [];
  const client = await pool.connect();
  try {
    for (const file of MIGRATION_FILES) {
      const filePath = path.join(__dirname, '..', 'db', file);
      if (!fs.existsSync(filePath)) {
        results.push({ file, status: 'skipped' });
        continue;
      }
      try {
        const sql = fs.readFileSync(filePath, 'utf-8');
        await client.query(sql);
        results.push({ file, status: 'ok' });
      } catch (err) {
        const e = err as { code?: string; message?: string; detail?: string; hint?: string; position?: string };
        results.push({
          file,
          status: 'error',
          error: {
            code: e.code,
            message: e.message,
            detail: e.detail,
            hint: e.hint,
            position: e.position,
          },
        });
      }
    }
  } finally {
    client.release();
  }

  const ok = results.filter(r => r.status === 'ok').length;
  const errs = results.filter(r => r.status === 'error').length;
  res.json({
    summary: { total: results.length, ok, errors: errs },
    results,
  });
});

// GET /schema-check — quick sanity check that critical tables exist.
// Useful for post-deploy verification without having to spin up a client.
router.get('/schema-check', requireAuth, requireClerkAdmin, async (_req: Request, res: Response) => {
  const criticalTables = [
    'users', 'candidates', 'staff', 'facilities',
    'clients', 'jobs', 'submissions', 'pipeline_stages', 'recruiter_tasks',
    'placements', 'credentials', 'comp_bundles',
    'notification_prefs', 'esign_documents',
  ];

  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [criticalTables]
    );
    const present = new Set(existing.rows.map(r => r.table_name as string));
    const report = criticalTables.map(t => ({ table: t, exists: present.has(t) }));
    const missing = report.filter(r => !r.exists).map(r => r.table);
    res.json({
      ok: missing.length === 0,
      missing,
      report,
    });
  } catch (err) {
    const e = err as Error;
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// GET /whoami — DB-free identity echo. Returns the caller's Clerk user id,
// email, and publicMetadata role. Useful for "why can't I access X" debugging
// without having to paste the JWT into clerk.dev. No auth beyond a valid
// session — this is identity-about-you, not privileged data.
router.get('/whoami', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(auth.userId);
    res.json({
      clerk_user_id: auth.userId,
      email: user.emailAddresses?.[0]?.emailAddress ?? null,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      role_in_clerk_metadata: user.publicMetadata?.role ?? null,
      is_admin_via_clerk: ['admin', 'ceo'].includes(
        ((user.publicMetadata?.role as string | undefined) ?? '').toLowerCase()
      ),
    });
  } catch (err) {
    console.error('[admin] whoami failed:', (err as Error).message);
    res.status(500).json({ error: 'Failed to load Clerk user' });
  }
});

export default router;
