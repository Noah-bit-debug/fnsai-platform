import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getAuth, requireAuth, requireClerkAdmin } from '../middleware/auth';
import { pool, query, withTransaction } from '../db/client';

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
  'phase2_courses.sql',
  'phase4_bd_bids.sql',
  'phase4_bd_core.sql',
  'phase4_4_expansion.sql',
  'phase5_plan_tasks.sql',
  'phase5_4_reports_columns.sql',
  'phase5_weekly_monthly_summaries.sql',
  'phase6_client_portal.sql',
  'phase1_4_stage_check_drop.sql',
  'phase8_security_rbac.sql',
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

// GET /whoami — identity echo. Returns the caller's Azure oid, email, name,
// and resolved DB role. Useful for "why can't I access X" debugging without
// having to decode the JWT by hand. No auth beyond a valid session — this
// is identity-about-you, not privileged data.
//
// Field names keep the `clerk_` prefix for API backward-compatibility with
// any frontend that was built against the original shape; the value is now
// the Azure object id (oid).
router.get('/whoami', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const result = await query<{ role: string | null; email: string | null; name: string | null }>(
      'SELECT role, email, name FROM users WHERE clerk_user_id = $1',
      [auth.userId]
    );
    const row = result.rows[0];
    const role = row?.role ?? null;
    res.json({
      clerk_user_id: auth.userId,     // legacy field name — holds Azure oid
      azure_oid: auth.userId,
      email: row?.email ?? auth.email ?? null,
      name: row?.name ?? auth.name ?? null,
      role_in_db: role,
      is_admin: ['admin', 'ceo'].includes((role ?? '').toLowerCase()),
      tenant_id: auth.tid,
    });
  } catch (err) {
    console.error('[admin] whoami failed:', (err as Error).message);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// HARD DELETE — admin-only, irreversible, audit-snapshotted.
//
// Used for one-shot data removal: GDPR-style erasure requests, test-data
// cleanup, removal of accidentally-created duplicates. Soft-archive
// (status='withdrawn' on candidates) is the normal-operation path
// exposed via the UI Archive button. Hard delete is the escape hatch.
//
// Safety design:
//   1. Admin-only (requireClerkAdmin — no other path).
//   2. UUID input only — never accepts a name. Names are too easy to
//      mismatch and produce collateral damage. Caller obtains the UUID
//      from the candidate/staff list or the SQL preview script.
//   3. Snapshot the row + every dependent row to security_events.context
//      *before* deleting. The audit row references the deleted IDs but
//      retains the full PII payload as `wipe_snapshot`, so a regulator
//      who later asks "what existed for that subject ID" can answer.
//      (If the goal is to ALSO scrub that snapshot, follow up with a
//      separate script — keeping it default-on covers the more common
//      compliance posture.)
//   4. Wrapped in a single transaction. Any failure rolls everything
//      back; the snapshot, the cascades, and the parent delete all
//      land or none of them do.
//   5. Returns a per-table count so the caller can see the blast
//      radius and verify it matches expectations.
// ─────────────────────────────────────────────────────────────────────────

interface WipeReport {
  reason: string;
  parent_table: 'candidates' | 'staff';
  parent_id: string;
  snapshot: Record<string, unknown>;
  rows_deleted: Record<string, number>;
}

async function logWipe(actorOid: string | null, ip: string | null, report: WipeReport): Promise<void> {
  // security_events is the dedicated audit sink for sensitive operations.
  // Falls back to console.error if the table isn't present (older deploys).
  try {
    await query(
      `INSERT INTO security_events (actor_oid, action, outcome, reason, context, ip_address)
       VALUES ($1, 'admin.hard_delete', 'allowed', $2, $3, $4)`,
      [actorOid, report.reason, JSON.stringify(report), ip],
    );
  } catch (err) {
    console.error('[admin.hard_delete] failed to write security_events:', err);
  }
}

router.post('/candidates/:id/hard-delete', requireAuth, requireClerkAdmin, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const { id } = req.params;
  const reason = String((req.body as { reason?: unknown })?.reason ?? '').trim();
  if (reason.length < 5) {
    res.status(400).json({ error: 'reason is required (≥ 5 chars) — written to audit log.' });
    return;
  }

  try {
    const out = await withTransaction(async (client) => {
      // Snapshot the row first
      const cur = await client.query(`SELECT * FROM candidates WHERE id = $1`, [id]);
      if (cur.rows.length === 0) return { found: false as const };

      // Collect the row counts that *will be* deleted, before we touch them
      const counts: Record<string, number> = {};
      const tally = async (label: string, sql: string, params: unknown[]) => {
        const r = await client.query(sql, params);
        counts[label] = r.rows[0]?.n ?? 0;
      };
      await tally('candidate_documents',       `SELECT COUNT(*)::INT AS n FROM candidate_documents WHERE candidate_id=$1`, [id]);
      await tally('candidate_stage_history',   `SELECT COUNT(*)::INT AS n FROM candidate_stage_history WHERE candidate_id=$1`, [id]);
      await tally('submissions',               `SELECT COUNT(*)::INT AS n FROM submissions WHERE candidate_id=$1`, [id]);
      await tally('placements',                `SELECT COUNT(*)::INT AS n FROM placements WHERE candidate_id=$1`, [id]);
      await tally('onboarding_forms',          `SELECT COUNT(*)::INT AS n FROM onboarding_forms WHERE candidate_id=$1`, [id]);
      await tally('reminders',                 `SELECT COUNT(*)::INT AS n FROM reminders WHERE candidate_id=$1`, [id]);

      // Non-CASCADE children — wipe explicitly
      await client.query(`DELETE FROM reminders WHERE candidate_id=$1`, [id]);
      await client.query(`DELETE FROM onboarding_forms WHERE candidate_id=$1`, [id]);
      await client.query(`DELETE FROM placements WHERE candidate_id=$1`, [id]);

      // Parent row — CASCADE handles the rest (candidate_documents,
      // candidate_stage_history, submissions, submission_stage_history,
      // comp_competency_records, comp_placement_readiness,
      // comp_onboarding_assignments).
      const del = await client.query(`DELETE FROM candidates WHERE id=$1 RETURNING id`, [id]);
      counts.candidates = del.rowCount ?? 0;

      return {
        found: true as const,
        snapshot: cur.rows[0],
        counts,
      };
    });

    if (!out.found) { res.status(404).json({ error: 'Candidate not found' }); return; }

    await logWipe(auth?.userId ?? null, req.ip ?? null, {
      reason,
      parent_table: 'candidates',
      parent_id: id,
      snapshot: out.snapshot,
      rows_deleted: out.counts,
    });

    res.json({ success: true, parent_id: id, rows_deleted: out.counts });
  } catch (err: any) {
    console.error('[admin.hard_delete candidate]', err);
    res.status(500).json({ error: 'Hard delete failed', detail: err?.message });
  }
});

router.post('/staff/:id/hard-delete', requireAuth, requireClerkAdmin, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const { id } = req.params;
  const reason = String((req.body as { reason?: unknown })?.reason ?? '').trim();
  if (reason.length < 5) {
    res.status(400).json({ error: 'reason is required (≥ 5 chars) — written to audit log.' });
    return;
  }

  try {
    const out = await withTransaction(async (client) => {
      const cur = await client.query(`SELECT * FROM staff WHERE id = $1`, [id]);
      if (cur.rows.length === 0) return { found: false as const };

      const counts: Record<string, number> = {};
      const tally = async (label: string, sql: string, params: unknown[]) => {
        const r = await client.query(sql, params);
        counts[label] = r.rows[0]?.n ?? 0;
      };
      await tally('credentials',      `SELECT COUNT(*)::INT AS n FROM credentials WHERE staff_id=$1`, [id]);
      await tally('placements',       `SELECT COUNT(*)::INT AS n FROM placements WHERE staff_id=$1`, [id]);
      await tally('documents',        `SELECT COUNT(*)::INT AS n FROM documents WHERE staff_id=$1`, [id]);
      await tally('incidents',        `SELECT COUNT(*)::INT AS n FROM incidents WHERE staff_id=$1`, [id]);
      await tally('onboarding_forms', `SELECT COUNT(*)::INT AS n FROM onboarding_forms WHERE staff_id=$1`, [id]);
      await tally('reminders',        `SELECT COUNT(*)::INT AS n FROM reminders WHERE staff_id=$1`, [id]);

      // Non-CASCADE children
      await client.query(`DELETE FROM reminders WHERE staff_id=$1`, [id]);
      await client.query(`DELETE FROM onboarding_forms WHERE staff_id=$1`, [id]);
      await client.query(`DELETE FROM placements WHERE staff_id=$1`, [id]);
      await client.query(`DELETE FROM documents WHERE staff_id=$1`, [id]);
      await client.query(`DELETE FROM incidents WHERE staff_id=$1`, [id]);

      // Parent — credentials CASCADE off staff_id
      const del = await client.query(`DELETE FROM staff WHERE id=$1 RETURNING id`, [id]);
      counts.staff = del.rowCount ?? 0;

      return {
        found: true as const,
        snapshot: cur.rows[0],
        counts,
      };
    });

    if (!out.found) { res.status(404).json({ error: 'Staff not found' }); return; }

    await logWipe(auth?.userId ?? null, req.ip ?? null, {
      reason,
      parent_table: 'staff',
      parent_id: id,
      snapshot: out.snapshot,
      rows_deleted: out.counts,
    });

    res.json({ success: true, parent_id: id, rows_deleted: out.counts });
  } catch (err: any) {
    console.error('[admin.hard_delete staff]', err);
    res.status(500).json({ error: 'Hard delete failed', detail: err?.message });
  }
});

export default router;
