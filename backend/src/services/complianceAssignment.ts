import { pool } from '../db/client';

export interface AssignBundleToCandidateResult {
  bundle_id: string;
  bundle_title?: string;
  created: number;
  skipped: number;
}

/**
 * Assigns all items in a compliance bundle to a candidate by creating
 * comp_competency_records keyed on candidate_id.
 * Idempotent: checks for existing (item_id, item_type, candidate_id) before inserting.
 */
export async function assignBundleToCandidate(params: {
  bundle_id: string;
  candidate_id: string;
  due_date?: string | null;
  assigned_by?: string;
}): Promise<AssignBundleToCandidateResult> {
  const { bundle_id, candidate_id, due_date, assigned_by } = params;
  const client = await pool.connect();
  try {
    const [bundleRes, itemsRes] = await Promise.all([
      client.query(`SELECT title FROM comp_bundles WHERE id = $1`, [bundle_id]),
      client.query(
        `SELECT item_id, item_type, item_title FROM comp_bundle_items
         WHERE bundle_id = $1 ORDER BY sort_order ASC`,
        [bundle_id]
      ),
    ]);

    const bundle_title = bundleRes.rows[0]?.title as string | undefined;
    const items = itemsRes.rows as Array<{ item_id: string; item_type: string; item_title: string }>;

    await client.query('BEGIN');
    let created = 0;
    let skipped = 0;

    for (const item of items) {
      const exists = await client.query(
        `SELECT id FROM comp_competency_records
         WHERE item_id = $1 AND item_type = $2 AND candidate_id = $3`,
        [item.item_id, item.item_type, candidate_id]
      );
      if (exists.rows.length > 0) { skipped++; continue; }

      await client.query(
        `INSERT INTO comp_competency_records
           (item_id, item_type, item_title, candidate_id, status, assigned_date, due_date, assigned_by)
         VALUES ($1, $2, $3, $4, 'not_started', NOW(), $5, $6)`,
        [item.item_id, item.item_type, item.item_title, candidate_id, due_date ?? null, assigned_by ?? null]
      );
      created++;
    }

    await client.query('COMMIT');
    return { bundle_id, bundle_title, created, skipped };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * When a placement is created, assign every onboarding bundle referenced by
 * the job's job_requirements rows to the candidate. Ad-hoc items on job_requirements
 * are NOT converted here — those still need to land in candidate_documents separately
 * (phase 5 punts on that; manual for now).
 * Returns per-bundle results for logging.
 */
export async function applyOnboardingBundlesForPlacement(params: {
  job_id: string;
  candidate_id: string;
  start_date?: string | null;
}): Promise<AssignBundleToCandidateResult[]> {
  const { job_id, candidate_id, start_date } = params;

  const reqs = await pool.query(
    `SELECT bundle_id FROM job_requirements
     WHERE job_id = $1 AND kind = 'onboarding' AND bundle_id IS NOT NULL`,
    [job_id]
  );
  const bundleIds = reqs.rows.map((r) => r.bundle_id as string);
  if (bundleIds.length === 0) return [];

  const results: AssignBundleToCandidateResult[] = [];
  for (const bundle_id of bundleIds) {
    try {
      const result = await assignBundleToCandidate({
        bundle_id,
        candidate_id,
        due_date: start_date ?? null,
        assigned_by: 'placement_auto',
      });
      results.push(result);
    } catch (err) {
      console.error('[compliance-auto-assign] Bundle assign failed:', bundle_id, err);
    }
  }
  return results;
}
