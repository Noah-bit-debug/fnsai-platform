/**
 * Phase 6.5 — Client Portal routes
 *
 * Two sides:
 *   Admin side  (authed) — generate / list / revoke share tokens per
 *                          facility or client.
 *   Public side (no auth, token in URL) — returns read-only facility
 *                          data for the token: active placements,
 *                          submissions in progress, upcoming pipeline.
 *
 * Mounted at /api/v1/client-portal.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';

const router = Router();

// Cryptographically random token — 32 chars of hex (128 bits of entropy).
// Unguessable in practice. NOT a JWT — we don't need signing because the
// token IS the credential and is looked up in the DB on every request.
function generateToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ─── Admin: token CRUD ───────────────────────────────────────────────────
// All /admin-tokens/* require auth. Public view uses /view/:token below.

const createTokenSchema = z.object({
  facility_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  display_label: z.string().max(200).optional().nullable(),
  expires_at: z.string().optional().nullable(),           // ISO datetime
}).refine((d) => !!d.facility_id || !!d.client_id, {
  message: 'Must provide either facility_id or client_id',
});

router.get('/admin-tokens', requireAuth, async (req: Request, res: Response) => {
  const { facility_id, client_id } = req.query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (typeof facility_id === 'string') { params.push(facility_id); conds.push(`t.facility_id = $${params.length}`); }
  if (typeof client_id === 'string')   { params.push(client_id);   conds.push(`t.client_id   = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT t.*,
              f.name AS facility_name,
              c.name AS client_name
         FROM client_view_tokens t
         LEFT JOIN facilities f ON t.facility_id = f.id
         LEFT JOIN clients    c ON t.client_id   = c.id
         ${where}
         ORDER BY t.created_at DESC`,
      params
    );
    res.json({ tokens: result.rows });
  } catch (err) {
    console.error('client-portal admin list error:', err);
    res.status(500).json({ error: 'Failed to fetch tokens' });
  }
});

router.post('/admin-tokens', requireAuth, async (req: Request, res: Response) => {
  const parse = createTokenSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const d = parse.data;
  const token = generateToken();
  const userId = getAuth(req)?.userId ?? 'unknown';
  // Phase 6.5 QA diagnostic (bug 6.5-c) — log exactly what was received
  // and what's being stored so we can tell if an expires_at value is
  // being silently dropped somewhere.
  console.log('[client-portal] creating token:', {
    facility_id: d.facility_id ?? null,
    client_id: d.client_id ?? null,
    display_label: d.display_label ?? null,
    expires_at_raw: d.expires_at ?? null,
    expires_at_parsed: d.expires_at ? new Date(d.expires_at).toISOString() : null,
  });
  try {
    const result = await query(
      `INSERT INTO client_view_tokens (token, facility_id, client_id, display_label, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [token, d.facility_id ?? null, d.client_id ?? null, d.display_label ?? null, d.expires_at ?? null, userId]
    );
    console.log('[client-portal] token stored:', {
      id: result.rows[0].id,
      expires_at: result.rows[0].expires_at,
    });
    await logAudit(null, userId, 'client_portal.token_create', result.rows[0].id as string, { facility_id: d.facility_id, client_id: d.client_id }, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('client-portal admin create error:', err);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

router.delete('/admin-tokens/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    // Revoke instead of hard-delete so the audit trail survives.
    const result = await query(
      `UPDATE client_view_tokens SET revoked = TRUE WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Token not found' }); return; }
    await logAudit(null, getAuth(req)?.userId ?? 'unknown', 'client_portal.token_revoke', req.params.id, {}, req.ip);
    res.json({ success: true });
  } catch (err) {
    console.error('client-portal admin revoke error:', err);
    res.status(500).json({ error: 'Failed to revoke' });
  }
});

// ─── Public: /view/:token — read-only snapshot for the client ────────────
// NO requireAuth. The token is the credential. Always filter results by
// the token's facility_id / client_id so no other data leaks.

router.get('/view/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token || token.length < 10) { res.status(400).json({ error: 'Invalid token' }); return; }

  try {
    // Look up + validate
    const tRes = await query(
      `SELECT t.*, f.name AS facility_name, c.name AS client_name
         FROM client_view_tokens t
         LEFT JOIN facilities f ON t.facility_id = f.id
         LEFT JOIN clients    c ON t.client_id   = c.id
        WHERE t.token = $1`,
      [token]
    );
    if (tRes.rows.length === 0) { res.status(404).json({ error: 'Invalid or unknown link' }); return; }
    // Phase 6.5 QA fix (bug 6.5-c) — expires_at comes off the pg driver
    // as a Date object for TIMESTAMPTZ columns, not a string. Previous
    // type annotation claimed `string` and the Date-on-Date roundtrip
    // was fine BUT the annotation hid whether the column was actually
    // populated. Now we explicitly handle both Date and string forms
    // and log the comparison so any future discrepancy is visible.
    const tokRaw = tRes.rows[0] as Record<string, unknown>;
    const tok = {
      id: String(tokRaw.id),
      facility_id: (tokRaw.facility_id as string | null) ?? null,
      client_id: (tokRaw.client_id as string | null) ?? null,
      display_label: (tokRaw.display_label as string | null) ?? null,
      revoked: Boolean(tokRaw.revoked),
      expires_at: tokRaw.expires_at as Date | string | null,
      facility_name: (tokRaw.facility_name as string | null) ?? null,
      client_name: (tokRaw.client_name as string | null) ?? null,
    };
    if (tok.revoked) { res.status(410).json({ error: 'This link has been revoked by the admin.' }); return; }

    // Expiry check. Normalize to epoch ms regardless of pg's return type.
    if (tok.expires_at) {
      const expiryMs = tok.expires_at instanceof Date
        ? tok.expires_at.getTime()
        : new Date(tok.expires_at).getTime();
      const nowMs = Date.now();
      console.log('[client-portal] expiry check for token', token.slice(0, 8) + '…:', {
        raw: tok.expires_at,
        expiryMs, nowMs,
        diff_hours: ((expiryMs - nowMs) / 3600000).toFixed(2),
        expired: expiryMs < nowMs,
      });
      if (!Number.isFinite(expiryMs)) {
        // Corrupt expires_at — fail closed, block access.
        res.status(500).json({ error: 'Link has an invalid expiry. Please ask admin to regenerate.' });
        return;
      }
      if (expiryMs < nowMs) {
        res.status(410).json({ error: 'This link has expired.' });
        return;
      }
    }

    // Track access
    void query(
      `UPDATE client_view_tokens SET last_accessed_at = NOW(), access_count = access_count + 1 WHERE id = $1`,
      [tok.id]
    );

    // Resolve facility IDs in scope. If the token is facility-scoped,
    // we have one ID. If client-scoped, gather all facility IDs under
    // that client.
    let facilityIds: string[] = [];
    if (tok.facility_id) facilityIds = [tok.facility_id];
    else if (tok.client_id) {
      const fRes = await query(
        `SELECT id FROM facilities WHERE client_id = $1`,
        [tok.client_id]
      );
      facilityIds = fRes.rows.map((r) => r.id as string);
    }
    // Phase 6.5 QA fix (bug 6.5-b) — use the client/facility's actual
    // name for the public H1. The admin-entered display_label is an
    // internal tag for identifying the token ("QA Test Link", "Xyrene
    // Marketing Link") and shouldn't leak to the client-facing page.
    // Fall back to display_label only if nothing else is set.
    const publicLabel =
      tok.client_name ?? tok.facility_name ?? tok.display_label ?? 'Client Portal';

    if (facilityIds.length === 0) {
      // Phase 6.5 QA fix (bug 6.5-a) — this branch was missing
      // generated_at, which made the frontend render "Generated Invalid
      // Date". Include it (and the admin label + scope too for parity).
      res.json({
        label: publicLabel,
        admin_label: tok.display_label ?? null,
        scope: tok.facility_id ? 'facility' : 'client',
        generated_at: new Date().toISOString(),
        facilities: [], active_staff: [], upcoming_submissions: [], open_jobs: [],
      });
      return;
    }

    // Active staff placed at these facilities
    const staffRes = await query(
      `SELECT p.id AS placement_id, p.status, p.start_date, p.end_date,
              s.first_name, s.last_name, s.role,
              f.name AS facility_name
         FROM placements p
         JOIN staff s      ON p.staff_id = s.id
         JOIN facilities f ON p.facility_id = f.id
        WHERE p.facility_id = ANY($1::uuid[])
          AND p.status IN ('active','pending')
        ORDER BY p.start_date DESC NULLS LAST
        LIMIT 200`,
      [facilityIds]
    );

    // Upcoming submissions — candidates being submitted to jobs at these
    // facilities. Uses the jobs table to link through the facility.
    const subsRes = await query(
      `SELECT sub.id, sub.status, sub.submitted_at, sub.created_at,
              c.first_name, c.last_name, c.current_role AS candidate_role,
              j.title AS job_title,
              f.name AS facility_name
         FROM submissions sub
         JOIN jobs j       ON sub.job_id = j.id
         JOIN candidates c ON sub.candidate_id = c.id
         LEFT JOIN facilities f ON j.facility_id = f.id
        WHERE j.facility_id = ANY($1::uuid[])
          AND sub.status IN ('draft','pending','submitted','interviewing')
        ORDER BY sub.created_at DESC
        LIMIT 200`,
      [facilityIds]
    );

    // Open jobs at these facilities (for coverage transparency)
    const jobsRes = await query(
      `SELECT j.id, j.title, j.status, j.created_at,
              f.name AS facility_name
         FROM jobs j
         LEFT JOIN facilities f ON j.facility_id = f.id
        WHERE j.facility_id = ANY($1::uuid[])
          AND j.status IN ('open','filling')
        ORDER BY j.created_at DESC
        LIMIT 100`,
      [facilityIds]
    );

    // Facility summary list (names of all facilities in scope)
    const facRes = await query(
      `SELECT id, name, city, state FROM facilities WHERE id = ANY($1::uuid[]) ORDER BY name`,
      [facilityIds]
    );

    res.json({
      // Use the same public-label logic as the empty branch above.
      label: publicLabel,
      admin_label: tok.display_label ?? null,
      scope: tok.facility_id ? 'facility' : 'client',
      generated_at: new Date().toISOString(),
      facilities: facRes.rows,
      active_staff: staffRes.rows,
      upcoming_submissions: subsRes.rows,
      open_jobs: jobsRes.rows,
    });
  } catch (err) {
    console.error('client-portal view error:', err);
    res.status(500).json({ error: 'Failed to load portal data' });
  }
});

export default router;
