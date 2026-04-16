import { pool } from '../db/client';

export type GateKind = 'submission' | 'onboarding';
export type GateStatus = 'ok' | 'missing' | 'pending' | 'unknown';

export interface GateMissingItem {
  source: 'bundle' | 'ad_hoc';
  kind: string;             // 'policy' | 'document' | 'exam' | 'checklist' | 'doc' | 'cert' | 'license' | 'skill'
  item_id?: string;         // bundle items or null for ad-hoc
  label: string;
  required: boolean;
  status?: string;          // current status from comp_competency_records / candidate_documents if known
}

export interface GateResult {
  status: GateStatus;
  kind: GateKind;
  total_required: number;
  satisfied: number;
  pending: number;
  missing: GateMissingItem[];
}

interface AdHocItem {
  type?: string;
  kind?: string;
  label?: string;
  required?: boolean;
  notes?: string;
}

/**
 * Runs the credential gate for a candidate against either a job or a client.
 * Reads:
 *   - job_requirements OR client_requirement_templates for the bundle_id + ad_hoc list
 *   - comp_bundle_items for the bundle's items
 *   - comp_competency_records for per-user completion status (keyed by candidate.id as UUID string)
 *   - candidate_documents for ad-hoc document / cert / license items (label match)
 *
 * Status rules:
 *   - ok: all required items are 'completed' / 'signed' / 'approved' (or item is non-required and missing)
 *   - missing: at least one required item has no record at all
 *   - pending: all required items have records but some are 'in_progress' / 'not_started' / 'pending'
 *   - unknown: no requirements configured
 */
export async function runGate(params: {
  candidate_id: string;
  kind: GateKind;
  job_id?: string;
  client_id?: string;
}): Promise<GateResult> {
  const { candidate_id, kind, job_id, client_id } = params;
  if (!job_id && !client_id) {
    throw new Error('runGate requires either job_id or client_id');
  }

  // 1. Load requirement rows (may be multiple of same kind)
  const reqQuery = job_id
    ? `SELECT bundle_id, ad_hoc FROM job_requirements WHERE job_id = $1 AND kind = $2`
    : `SELECT bundle_id, ad_hoc FROM client_requirement_templates WHERE client_id = $1 AND kind = $2`;
  const reqRes = await pool.query(reqQuery, [job_id ?? client_id, kind]);

  if (reqRes.rows.length === 0) {
    return { status: 'unknown', kind, total_required: 0, satisfied: 0, pending: 0, missing: [] };
  }

  const bundleIds: string[] = [];
  const adHocItems: AdHocItem[] = [];
  for (const row of reqRes.rows) {
    if (row.bundle_id) bundleIds.push(row.bundle_id);
    if (Array.isArray(row.ad_hoc)) adHocItems.push(...row.ad_hoc);
  }

  // 2. Load bundle items for all referenced bundles
  const bundleItems: Array<{ item_id: string; item_type: string; item_title: string; required: boolean }> = [];
  if (bundleIds.length > 0) {
    const biRes = await pool.query(
      `SELECT item_id, item_type, item_title, COALESCE(required, TRUE) AS required
       FROM comp_bundle_items
       WHERE bundle_id = ANY($1::uuid[])`,
      [bundleIds]
    );
    bundleItems.push(...biRes.rows);
  }

  // 3. Load this candidate's competency records (covers policies / documents / exams / checklists)
  const recRes = await pool.query(
    `SELECT item_type, item_id, status
     FROM comp_competency_records
     WHERE candidate_id = $1`,
    [candidate_id]
  );
  const recordMap = new Map<string, string>(); // key: `${item_type}:${item_id}` → status
  for (const r of recRes.rows) {
    recordMap.set(`${r.item_type}:${r.item_id}`, r.status);
  }

  // 4. Load candidate_documents for ad-hoc label matching
  const docRes = await pool.query(
    `SELECT LOWER(label) AS label, status FROM candidate_documents WHERE candidate_id = $1`,
    [candidate_id]
  );
  const docMap = new Map<string, string>();
  for (const d of docRes.rows) {
    docMap.set(d.label, d.status);
  }

  const missing: GateMissingItem[] = [];
  let required = 0;
  let satisfied = 0;
  let pending = 0;

  const SATISFIED_STATUSES = new Set(['completed', 'signed', 'read', 'approved']);
  const PENDING_STATUSES = new Set(['in_progress', 'not_started', 'pending', 'received']);

  // Evaluate bundle items
  for (const bi of bundleItems) {
    if (!bi.required) continue;
    required++;
    const status = recordMap.get(`${bi.item_type}:${bi.item_id}`);
    if (status && SATISFIED_STATUSES.has(status)) {
      satisfied++;
    } else if (status && PENDING_STATUSES.has(status)) {
      pending++;
      missing.push({
        source: 'bundle',
        kind: bi.item_type,
        item_id: bi.item_id,
        label: bi.item_title,
        required: true,
        status,
      });
    } else {
      missing.push({
        source: 'bundle',
        kind: bi.item_type,
        item_id: bi.item_id,
        label: bi.item_title,
        required: true,
        status: status ?? 'missing',
      });
    }
  }

  // Evaluate ad-hoc items (match against candidate_documents by label)
  for (const item of adHocItems) {
    const req = item.required !== false; // default true
    if (!req) continue;
    required++;
    const label = (item.label ?? '').toString().trim();
    const status = docMap.get(label.toLowerCase());
    if (status && (status === 'approved' || status === 'received')) {
      satisfied++;
    } else if (status && status === 'pending') {
      pending++;
      missing.push({
        source: 'ad_hoc',
        kind: (item.type ?? item.kind ?? 'doc').toString(),
        label,
        required: true,
        status,
      });
    } else {
      missing.push({
        source: 'ad_hoc',
        kind: (item.type ?? item.kind ?? 'doc').toString(),
        label,
        required: true,
        status: status ?? 'missing',
      });
    }
  }

  let status: GateStatus;
  if (required === 0) status = 'unknown';
  else if (satisfied === required) status = 'ok';
  else if (satisfied + pending === required) status = 'pending';
  else status = 'missing';

  return { status, kind, total_required: required, satisfied, pending, missing };
}
