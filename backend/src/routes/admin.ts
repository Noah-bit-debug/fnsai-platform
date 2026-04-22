import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getAuth, clerkClient } from '@clerk/express';
import { requireAuth, requireClerkAdmin } from '../middleware/auth';
import { pool } from '../db/client';

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

// Resolve a migration file's path across dev vs prod layouts.
// - Prod: compiled dist/, SQL files copied there by scripts/copy-sql.js
// - Dev:  tsx runs .ts directly; __dirname = src/routes/, SQL in ../db/
// - Tolerant fallbacks for when someone moves the dist/ root around.
// Returns the first existing path or null if nothing is found.
function resolveMigrationPath(file: string): string | null {
  const candidates = [
    path.join(__dirname, '..', 'db', file),
    path.join(__dirname, '..', '..', 'src', 'db', file),
    path.join(process.cwd(), 'dist', 'db', file),
    path.join(process.cwd(), 'src', 'db', file),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

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
  'ats_phase2_stage_reorder.sql',
  'ats_phase2_pay_range.sql',
  'notification_prefs_migration.sql',
  'phase2_document_types.sql',
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
      const filePath = resolveMigrationPath(file);
      if (!filePath) {
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
