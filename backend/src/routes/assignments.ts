/**
 * Generic assignment API. Mounted at /api/v1/assignments.
 *
 * One polymorphic table (assignments) handles ownership + follow-up
 * roles for every assignable entity in the app — candidates, tasks,
 * reminders, submissions, etc. The discriminator is `assignable_type`.
 *
 * Endpoints:
 *   GET    /                            list (filterable by user/type/status)
 *   GET    /my-work                     "My Assigned Work" — the calling user
 *   GET    /for/:type/:id               who's assigned to this item
 *   POST   /                            create an assignment
 *   PATCH  /:id                         update (status, due_at, notes, role)
 *   DELETE /:id                         remove an assignment
 *   POST   /:id/complete                mark completed (shortcut)
 *   POST   /:id/reassign                hand off to a different user
 *
 * Permissions:
 *   assignments.view    — see assignments
 *   assignments.manage  — create / reassign / delete
 *
 * Self-completion: a user can ALWAYS mark their own assignment complete
 * even without assignments.manage, since "I finished my work" should
 * never require an admin.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, getAuth } from '../middleware/auth';
import { query } from '../db/client';
import { requirePermission, resolveDbUserIdFromOid } from '../services/permissions/permissionService';

const router = Router();

const ASSIGNABLE_TYPES = [
  'candidate', 'task', 'reminder', 'submission',
  'placement', 'incident', 'bid',
] as const;

const ASSIGNMENT_ROLES = [
  'owner', 'recruiter', 'hr', 'manager_reviewer',
  'credentialing', 'follow_up',
] as const;

const createSchema = z.object({
  assignable_type: z.enum(ASSIGNABLE_TYPES),
  assignable_id:   z.string().uuid(),
  user_id:         z.string().uuid(),
  role:            z.enum(ASSIGNMENT_ROLES).default('owner'),
  due_at:          z.string().datetime().optional().nullable(),
  notes:           z.string().max(2000).optional().nullable(),
});

const patchSchema = z.object({
  status:  z.enum(['active', 'completed', 'cancelled']).optional(),
  due_at:  z.string().datetime().nullable().optional(),
  notes:   z.string().max(2000).nullable().optional(),
  role:    z.enum(ASSIGNMENT_ROLES).optional(),
});

const reassignSchema = z.object({
  user_id: z.string().uuid(),
  notes:   z.string().max(2000).optional().nullable(),
});

// Common SELECT — joins users for the assignee + assigner so the
// frontend doesn't need a second round-trip to render names.
const SELECT_WITH_USERS = `
  SELECT a.id, a.assignable_type, a.assignable_id, a.user_id, a.role,
         a.due_at, a.status, a.notes, a.assigned_by,
         a.created_at, a.updated_at, a.completed_at,
         u.name  AS assignee_name,
         u.email AS assignee_email,
         ab.name  AS assigned_by_name
    FROM assignments a
    LEFT JOIN users u  ON u.id  = a.user_id
    LEFT JOIN users ab ON ab.id = a.assigned_by
`;

// ─── GET / — filtered list ─────────────────────────────────────────────
router.get('/', requireAuth, requirePermission('assignments.view'), async (req: Request, res: Response) => {
  const { user_id, assignable_type, assignable_id, status, role } = req.query;
  const conds: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (user_id)         { conds.push(`a.user_id = $${i++}`);         params.push(user_id); }
  if (assignable_type) { conds.push(`a.assignable_type = $${i++}`); params.push(assignable_type); }
  if (assignable_id)   { conds.push(`a.assignable_id = $${i++}`);   params.push(assignable_id); }
  if (status)          { conds.push(`a.status = $${i++}`);          params.push(status); }
  if (role)            { conds.push(`a.role = $${i++}`);            params.push(role); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  try {
    const r = await query(`${SELECT_WITH_USERS} ${where} ORDER BY a.due_at NULLS LAST, a.created_at DESC LIMIT 500`, params);
    res.json({ assignments: r.rows });
  } catch (err) {
    console.error('[assignments] list error:', err);
    res.status(500).json({ error: 'Failed to list assignments' });
  }
});

// ─── GET /my-work — calling user's active assignments ─────────────────
//
// Only requires authentication, NOT assignments.view — every user can
// see their own work even if they can't browse others' assignments.
router.get('/my-work', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const dbUserId = await resolveDbUserIdFromOid(auth?.userId);
  if (!dbUserId) { res.json({ assignments: [] }); return; }

  const { include_done } = req.query;
  // Default to active only; explicitly opt in to see history.
  const statusFilter = include_done === 'true'
    ? `a.status IN ('active', 'completed')`
    : `a.status = 'active'`;

  try {
    const r = await query(
      `${SELECT_WITH_USERS}
       WHERE a.user_id = $1 AND ${statusFilter}
       ORDER BY a.status ASC, a.due_at NULLS LAST, a.created_at DESC
       LIMIT 500`,
      [dbUserId]
    );
    res.json({ assignments: r.rows, db_user_id: dbUserId });
  } catch (err) {
    console.error('[assignments] /my-work error:', err);
    res.status(500).json({ error: 'Failed to load your work' });
  }
});

// ─── GET /for/:type/:id — assignments on a specific item ──────────────
//
// Used by entity pages (candidate detail, task detail) to render the
// "owners" sidebar section.
router.get('/for/:type/:id', requireAuth, requirePermission('assignments.view'), async (req: Request, res: Response) => {
  const { type, id } = req.params;
  if (!ASSIGNABLE_TYPES.includes(type as typeof ASSIGNABLE_TYPES[number])) {
    res.status(400).json({ error: 'Invalid assignable_type' });
    return;
  }
  try {
    const r = await query(
      `${SELECT_WITH_USERS}
       WHERE a.assignable_type = $1 AND a.assignable_id = $2 AND a.status <> 'cancelled'
       ORDER BY a.role ASC, a.created_at ASC`,
      [type, id]
    );
    res.json({ assignments: r.rows });
  } catch (err) {
    console.error('[assignments] /for error:', err);
    res.status(500).json({ error: 'Failed to load assignments' });
  }
});

// ─── POST / — create ───────────────────────────────────────────────────
router.post('/', requireAuth, requirePermission('assignments.manage'), async (req: Request, res: Response) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }
  const d = parse.data;
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);

  try {
    const r = await query<{ id: string }>(
      `INSERT INTO assignments (assignable_type, assignable_id, user_id, role, due_at, notes, assigned_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (assignable_type, assignable_id, user_id, role) DO UPDATE
         SET status = 'active',
             due_at = EXCLUDED.due_at,
             notes  = EXCLUDED.notes,
             assigned_by = EXCLUDED.assigned_by,
             updated_at = NOW(),
             completed_at = NULL
       RETURNING id`,
      [d.assignable_type, d.assignable_id, d.user_id, d.role, d.due_at ?? null, d.notes ?? null, adminDbId]
    );

    // For candidates, also keep the legacy assigned_recruiter_id column
    // in sync when the assignment role is "recruiter" — there are still
    // places in the app that read that column directly (filters, kanban
    // grouping, dashboards). Other roles are tracked only in the new table.
    if (d.assignable_type === 'candidate' && d.role === 'recruiter') {
      await query(
        `UPDATE candidates SET assigned_recruiter_id = $1, updated_at = NOW() WHERE id = $2`,
        [d.user_id, d.assignable_id]
      );
    }

    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    console.error('[assignments] create error:', err);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

// ─── PATCH /:id — update ───────────────────────────────────────────────
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const parse = patchSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }
  const d = parse.data;

  const auth = getAuth(req);
  const dbUserId = await resolveDbUserIdFromOid(auth?.userId);

  // Self-edit shortcut: if the only change is status: 'completed' AND
  // the assignment belongs to the caller, allow without assignments.manage.
  // Otherwise require assignments.manage.
  const owns = await query<{ user_id: string }>(
    `SELECT user_id FROM assignments WHERE id = $1`,
    [req.params.id]
  );
  if (owns.rows.length === 0) { res.status(404).json({ error: 'Assignment not found' }); return; }

  const isSelf = owns.rows[0].user_id === dbUserId;
  const onlyStatusComplete = d.status === 'completed'
    && d.due_at === undefined && d.notes === undefined && d.role === undefined;

  if (!(isSelf && onlyStatusComplete)) {
    // Need full manage permission for any other edit.
    const perm = await query<{ has: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM rbac_user_roles ur
           JOIN rbac_role_permissions rp ON rp.role_id = ur.role_id
          WHERE ur.user_id = $1 AND rp.permission_key = 'assignments.manage'
       ) AS has`,
      [dbUserId]
    );
    if (!perm.rows[0]?.has) { res.status(403).json({ error: 'Forbidden' }); return; }
  }

  try {
    const r = await query(
      `UPDATE assignments SET
         status       = COALESCE($1, status),
         due_at       = CASE WHEN $2::text IS NULL THEN due_at ELSE $3::timestamptz END,
         notes        = CASE WHEN $4::text IS NULL THEN notes  ELSE $5::text END,
         role         = COALESCE($6, role),
         completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
         updated_at   = NOW()
       WHERE id = $7
       RETURNING id, status, completed_at`,
      [
        d.status ?? null,
        d.due_at === undefined ? null : 'set', d.due_at ?? null,
        d.notes  === undefined ? null : 'set', d.notes  ?? null,
        d.role ?? null,
        req.params.id,
      ]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[assignments] patch error:', err);
    res.status(500).json({ error: 'Failed to update assignment' });
  }
});

// ─── POST /:id/complete — convenience wrapper ──────────────────────────
router.post('/:id/complete', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const dbUserId = await resolveDbUserIdFromOid(auth?.userId);
  // Only the assignee or someone with assignments.manage may complete.
  const r = await query<{ user_id: string }>(`SELECT user_id FROM assignments WHERE id = $1`, [req.params.id]);
  if (r.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
  if (r.rows[0].user_id !== dbUserId) {
    const perm = await query<{ has: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM rbac_user_roles ur
           JOIN rbac_role_permissions rp ON rp.role_id = ur.role_id
          WHERE ur.user_id = $1 AND rp.permission_key = 'assignments.manage'
       ) AS has`, [dbUserId]
    );
    if (!perm.rows[0]?.has) { res.status(403).json({ error: 'Forbidden' }); return; }
  }
  await query(
    `UPDATE assignments SET status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [req.params.id]
  );
  res.json({ success: true });
});

// ─── POST /:id/reassign — hand off ─────────────────────────────────────
router.post('/:id/reassign', requireAuth, requirePermission('assignments.manage'), async (req: Request, res: Response) => {
  const parse = reassignSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);

  try {
    const r = await query<{ assignable_type: string; assignable_id: string; role: string }>(
      `UPDATE assignments
          SET user_id     = $1,
              notes       = COALESCE($2, notes),
              assigned_by = $3,
              updated_at  = NOW()
        WHERE id = $4
       RETURNING assignable_type, assignable_id, role`,
      [parse.data.user_id, parse.data.notes ?? null, adminDbId, req.params.id]
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    // Mirror to legacy column for candidate-recruiter (see POST /).
    if (r.rows[0].assignable_type === 'candidate' && r.rows[0].role === 'recruiter') {
      await query(
        `UPDATE candidates SET assigned_recruiter_id = $1, updated_at = NOW() WHERE id = $2`,
        [parse.data.user_id, r.rows[0].assignable_id]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[assignments] reassign error:', err);
    res.status(500).json({ error: 'Failed to reassign' });
  }
});

// ─── DELETE /:id ───────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('assignments.manage'), async (req: Request, res: Response) => {
  try {
    const r = await query(`DELETE FROM assignments WHERE id = $1 RETURNING id`, [req.params.id]);
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('[assignments] delete error:', err);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

export default router;
