/**
 * RBAC admin API — manage roles, permissions, user assignments, and
 * overrides. Mounted at /api/v1/rbac.
 *
 * Every endpoint requires admin.roles.manage (except the public-ish
 * my-permissions which the frontend uses on every page load).
 *
 * Audit logging: every mutation writes a security event so the history
 * is reconstructable.
 */

import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '../middleware/auth';
import { query } from '../db/client';
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  getPermissionDef,
  isCriticalPermission,
} from '../services/permissions/catalog';
import {
  resolveUserPermissions,
  resolveDbUserIdFromOid,
  requirePermission,
  invalidateUserCache,
  invalidateAllCaches,
  userHasPermission,
} from '../services/permissions/permissionService';
import { logSecurityEvent } from '../services/permissions/auditLog';

const router = Router();

// ─── GET /catalog — list every permission (for admin UI) ───────────────
router.get('/catalog', requireAuth, requirePermission('admin.roles.manage'), async (_req, res) => {
  res.json({
    permissions: PERMISSIONS,
    categories: CATEGORY_ORDER.map(c => ({ key: c, label: CATEGORY_LABELS[c] ?? c })),
  });
});

// ─── GET /my-permissions — frontend calls this on every page load ─────
// Returns the logged-in user's permission + role set. Used to build the
// sidebar, hide restricted features, etc. Does NOT require admin role —
// every authed user needs their own permissions.
router.get('/my-permissions', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const dbUserId = await resolveDbUserIdFromOid(auth?.userId);
  if (!dbUserId) {
    res.json({ permissions: [], roles: [], dbUserId: null });
    return;
  }
  const { permissions, roleKeys } = await resolveUserPermissions(dbUserId);
  res.json({
    permissions: Array.from(permissions),
    roles: roleKeys,
    dbUserId,
  });
});

// ─── GET /roles — list all roles ───────────────────────────────────────
router.get('/roles', requireAuth, requirePermission('admin.roles.manage'), async (_req, res) => {
  try {
    const roles = await query(
      `SELECT r.id, r.key, r.label, r.description, r.is_system,
              r.based_on_role,
              (SELECT COUNT(*)::INT FROM rbac_role_permissions rp WHERE rp.role_id = r.id) AS perm_count,
              (SELECT COUNT(*)::INT FROM rbac_user_roles ur WHERE ur.role_id = r.id) AS user_count,
              r.created_at, r.updated_at
         FROM rbac_roles r
        ORDER BY r.is_system DESC, r.label ASC`
    );
    res.json({ roles: roles.rows });
  } catch (err) {
    console.error('[rbac] /roles error:', err);
    res.status(500).json({ error: 'Failed to list roles' });
  }
});

// ─── GET /roles/:id — role details with permission list ────────────────
router.get('/roles/:id', requireAuth, requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const r = await query(
      `SELECT id, key, label, description, is_system, based_on_role, created_at, updated_at
         FROM rbac_roles WHERE id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'Role not found' }); return; }

    const perms = await query<{ permission_key: string }>(
      `SELECT permission_key FROM rbac_role_permissions WHERE role_id = $1`,
      [req.params.id]
    );

    res.json({
      role: r.rows[0],
      permissions: perms.rows.map(p => p.permission_key),
    });
  } catch (err) {
    console.error('[rbac] /roles/:id error:', err);
    res.status(500).json({ error: 'Failed to load role' });
  }
});

// ─── POST /roles — create a custom role ────────────────────────────────
router.post('/roles', requireAuth, requirePermission('admin.roles.create_custom'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);
  const { key, label, description, based_on_role, permissions: initialPerms } = req.body as {
    key: string; label: string; description?: string;
    based_on_role?: string; permissions?: string[];
  };

  if (!key || !/^[a-z][a-z0-9_-]{1,40}$/.test(key)) {
    res.status(400).json({ error: 'Key must be lowercase alphanumeric with hyphens/underscores, 2-40 chars.' });
    return;
  }
  if (!label || label.length < 2) {
    res.status(400).json({ error: 'Label is required.' });
    return;
  }

  try {
    // If based_on_role, copy its permissions as the starting point
    let copiedPerms: string[] = initialPerms ?? [];
    if (based_on_role && copiedPerms.length === 0) {
      const src = await query<{ permission_key: string }>(
        `SELECT permission_key FROM rbac_role_permissions WHERE role_id = $1`,
        [based_on_role]
      );
      copiedPerms = src.rows.map(r => r.permission_key);
    }

    const result = await query<{ id: string }>(
      `INSERT INTO rbac_roles (key, label, description, is_system, based_on_role, created_by)
       VALUES ($1, $2, $3, FALSE, $4, $5)
       RETURNING id`,
      [key, label, description ?? null, based_on_role ?? null, adminDbId]
    );
    const roleId = result.rows[0].id;

    for (const p of copiedPerms) {
      if (isCriticalPermission(p)) continue; // critical perms require separate grant flow
      await query(
        `INSERT INTO rbac_role_permissions (role_id, permission_key, granted_by)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [roleId, p, adminDbId]
      );
    }

    await logSecurityEvent({
      userId: adminDbId,
      actorOid: auth?.userId,
      action: 'role.created',
      outcome: 'allowed',
      reason: `Created custom role '${key}'`,
      context: { role_id: roleId, role_key: key, based_on_role, permission_count: copiedPerms.length },
      req,
    });

    res.status(201).json({ id: roleId, key });
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: 'A role with that key already exists.' }); return; }
    console.error('[rbac] POST /roles error:', err);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// ─── PUT /roles/:id — update label/description ─────────────────────────
router.put('/roles/:id', requireAuth, requirePermission('admin.roles.manage'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);
  const { label, description } = req.body as { label?: string; description?: string };

  try {
    const existing = await query<{ key: string; is_system: boolean }>(
      `SELECT key, is_system FROM rbac_roles WHERE id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) { res.status(404).json({ error: 'Role not found' }); return; }
    if (existing.rows[0].is_system) { res.status(400).json({ error: 'Cannot edit system roles directly.' }); return; }

    await query(
      `UPDATE rbac_roles
         SET label       = COALESCE($1, label),
             description = COALESCE($2, description),
             updated_at  = NOW()
       WHERE id = $3`,
      [label ?? null, description ?? null, req.params.id]
    );

    await logSecurityEvent({
      userId: adminDbId,
      actorOid: auth?.userId,
      action: 'role.edited',
      outcome: 'allowed',
      reason: `Edited role '${existing.rows[0].key}'`,
      context: { role_id: req.params.id, changes: { label, description } },
      req,
    });

    invalidateAllCaches();
    res.json({ success: true });
  } catch (err) {
    console.error('[rbac] PUT /roles/:id error:', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ─── PUT /roles/:id/permissions — replace the role's permission set ────
router.put('/roles/:id/permissions', requireAuth, requirePermission('admin.permissions.edit'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);
  const { permissions: newPerms } = req.body as { permissions: string[] };

  if (!Array.isArray(newPerms)) { res.status(400).json({ error: 'permissions must be an array of permission keys' }); return; }

  try {
    const role = await query<{ key: string; is_system: boolean }>(
      `SELECT key, is_system FROM rbac_roles WHERE id = $1`,
      [req.params.id]
    );
    if (role.rows.length === 0) { res.status(404).json({ error: 'Role not found' }); return; }

    // Guard: system roles' permissions are re-synced from catalog.ts on
    // every startup. Editing them via API is blocked — edit catalog.ts
    // instead, or duplicate the role.
    if (role.rows[0].is_system) {
      res.status(400).json({
        error: 'System role permissions are defined in catalog.ts. Edit the code or duplicate this role to customize.',
      });
      return;
    }

    // Validate every key exists in catalog
    const catalogKeys = new Set(PERMISSIONS.map(p => p.key));
    const invalid = newPerms.filter(k => !catalogKeys.has(k));
    if (invalid.length > 0) { res.status(400).json({ error: 'Invalid permission keys', invalid }); return; }

    // Diff: what are we granting vs revoking vs keeping
    const existing = await query<{ permission_key: string }>(
      `SELECT permission_key FROM rbac_role_permissions WHERE role_id = $1`,
      [req.params.id]
    );
    const existingSet = new Set(existing.rows.map(r => r.permission_key));
    const newSet = new Set(newPerms);
    const granting = newPerms.filter(k => !existingSet.has(k));
    const revoking = Array.from(existingSet).filter(k => !newSet.has(k));

    // Replace
    await query(`DELETE FROM rbac_role_permissions WHERE role_id = $1`, [req.params.id]);
    for (const k of newPerms) {
      await query(
        `INSERT INTO rbac_role_permissions (role_id, permission_key, granted_by) VALUES ($1, $2, $3)`,
        [req.params.id, k, adminDbId]
      );
    }

    await logSecurityEvent({
      userId: adminDbId,
      actorOid: auth?.userId,
      action: 'role.edited',
      outcome: 'allowed',
      reason: `Replaced permission set on role '${role.rows[0].key}'`,
      context: { role_id: req.params.id, granting, revoking },
      req,
    });

    invalidateAllCaches();
    res.json({ success: true, granted: granting.length, revoked: revoking.length });
  } catch (err) {
    console.error('[rbac] PUT /roles/:id/permissions error:', err);
    res.status(500).json({ error: 'Failed to update role permissions' });
  }
});

// ─── DELETE /roles/:id — delete a custom role ──────────────────────────
router.delete('/roles/:id', requireAuth, requirePermission('admin.roles.manage'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);

  try {
    const role = await query<{ key: string; is_system: boolean }>(
      `SELECT key, is_system FROM rbac_roles WHERE id = $1`,
      [req.params.id]
    );
    if (role.rows.length === 0) { res.status(404).json({ error: 'Role not found' }); return; }
    if (role.rows[0].is_system) { res.status(400).json({ error: 'Cannot delete system roles.' }); return; }

    await query(`DELETE FROM rbac_roles WHERE id = $1`, [req.params.id]);

    await logSecurityEvent({
      userId: adminDbId,
      actorOid: auth?.userId,
      action: 'role.deleted',
      outcome: 'allowed',
      reason: `Deleted custom role '${role.rows[0].key}'`,
      context: { role_id: req.params.id, role_key: role.rows[0].key },
      req,
    });

    invalidateAllCaches();
    res.json({ success: true });
  } catch (err) {
    console.error('[rbac] DELETE /roles/:id error:', err);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

// ─── GET /users/:userId/permissions — per-user access summary ──────────
router.get('/users/:userId/permissions', requireAuth, requirePermission('admin.users.manage'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { permissions, roleKeys } = await resolveUserPermissions(userId);

    const overrides = await query(
      `SELECT o.id, o.permission_key, o.effect, o.reason, o.expires_at, o.created_at,
              u.name AS created_by_name
         FROM rbac_user_overrides o
         LEFT JOIN users u ON u.id = o.created_by
        WHERE o.user_id = $1
          AND (o.expires_at IS NULL OR o.expires_at > NOW())
        ORDER BY o.created_at DESC`,
      [userId]
    );

    res.json({
      user_id: userId,
      role_keys: roleKeys,
      effective_permissions: Array.from(permissions),
      overrides: overrides.rows,
    });
  } catch (err) {
    console.error('[rbac] /users/:userId/permissions error:', err);
    res.status(500).json({ error: 'Failed to load user permissions' });
  }
});

// ─── POST /users/:userId/roles — assign a role to a user ───────────────
router.post('/users/:userId/roles', requireAuth, requirePermission('admin.users.manage'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);
  const { role_id } = req.body as { role_id: string };
  const { userId } = req.params;

  try {
    const role = await query<{ key: string }>(`SELECT key FROM rbac_roles WHERE id = $1`, [role_id]);
    if (role.rows.length === 0) { res.status(404).json({ error: 'Role not found' }); return; }

    await query(
      `INSERT INTO rbac_user_roles (user_id, role_id, assigned_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, role_id, adminDbId]
    );

    await logSecurityEvent({
      userId: adminDbId,
      actorOid: auth?.userId,
      action: 'role.assigned',
      outcome: 'allowed',
      reason: `Assigned role '${role.rows[0].key}' to user ${userId}`,
      context: { target_user_id: userId, role_id, role_key: role.rows[0].key },
      req,
    });

    invalidateUserCache(userId);
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('[rbac] POST /users/:userId/roles error:', err);
    res.status(500).json({ error: 'Failed to assign role' });
  }
});

// ─── DELETE /users/:userId/roles/:roleId — remove role from user ────────
router.delete('/users/:userId/roles/:roleId', requireAuth, requirePermission('admin.users.manage'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);
  const { userId, roleId } = req.params;

  try {
    await query(
      `DELETE FROM rbac_user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, roleId]
    );

    await logSecurityEvent({
      userId: adminDbId,
      actorOid: auth?.userId,
      action: 'role.removed',
      outcome: 'allowed',
      reason: `Removed role from user ${userId}`,
      context: { target_user_id: userId, role_id: roleId },
      req,
    });

    invalidateUserCache(userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[rbac] DELETE /users/:userId/roles/:roleId error:', err);
    res.status(500).json({ error: 'Failed to remove role' });
  }
});

// ─── POST /users/:userId/overrides — grant or deny a specific permission
router.post('/users/:userId/overrides', requireAuth, requirePermission('admin.overrides.grant'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);
  const { userId } = req.params;
  const { permission_key, effect, reason, expires_at } = req.body as {
    permission_key: string;
    effect: 'grant' | 'deny';
    reason?: string;
    expires_at?: string | null;
  };

  if (!permission_key || !['grant', 'deny'].includes(effect)) {
    res.status(400).json({ error: 'permission_key + effect (grant|deny) required' });
    return;
  }

  const def = getPermissionDef(permission_key);
  if (!def) { res.status(400).json({ error: 'Unknown permission key' }); return; }

  // Guard: critical perms require 2-person approval (requester cannot
  // auto-grant; requester must be different from target; ideally another
  // admin should approve). For simplicity we block self-grant + require
  // a justification reason.
  if (def.risk === 'critical') {
    if (!reason || reason.trim().length < 20) {
      res.status(400).json({
        error: 'Granting a critical permission requires a written justification of at least 20 characters.',
      });
      return;
    }
    if (userId === adminDbId && effect === 'grant') {
      res.status(403).json({
        error: 'You cannot grant yourself a critical permission. Have another admin grant it.',
      });
      return;
    }
  }

  try {
    await query(
      `INSERT INTO rbac_user_overrides (user_id, permission_key, effect, reason, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, permission_key) DO UPDATE
         SET effect = EXCLUDED.effect,
             reason = EXCLUDED.reason,
             expires_at = EXCLUDED.expires_at,
             created_by = EXCLUDED.created_by,
             created_at = NOW()`,
      [userId, permission_key, effect, reason ?? null, expires_at ?? null, adminDbId]
    );

    await logSecurityEvent({
      userId: adminDbId,
      actorOid: auth?.userId,
      action: 'override.granted',
      permissionKey: permission_key,
      outcome: 'allowed',
      reason: `${effect === 'grant' ? 'Granted' : 'Denied'} '${permission_key}' to user ${userId}. Reason: ${reason ?? 'none'}`,
      context: { target_user_id: userId, effect, expires_at, risk: def.risk },
      req,
    });

    invalidateUserCache(userId);
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('[rbac] POST /users/:userId/overrides error:', err);
    res.status(500).json({ error: 'Failed to create override' });
  }
});

// ─── DELETE /users/:userId/overrides/:id — remove an override ──────────
router.delete('/users/:userId/overrides/:id', requireAuth, requirePermission('admin.overrides.grant'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);
  const { userId, id } = req.params;

  try {
    const o = await query<{ permission_key: string; effect: string }>(
      `SELECT permission_key, effect FROM rbac_user_overrides WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (o.rows.length === 0) { res.status(404).json({ error: 'Override not found' }); return; }

    await query(`DELETE FROM rbac_user_overrides WHERE id = $1`, [id]);

    await logSecurityEvent({
      userId: adminDbId,
      actorOid: auth?.userId,
      action: 'override.revoked',
      permissionKey: o.rows[0].permission_key,
      outcome: 'allowed',
      reason: `Revoked override '${o.rows[0].permission_key}' from user ${userId}`,
      context: { target_user_id: userId, override_id: id, effect: o.rows[0].effect },
      req,
    });

    invalidateUserCache(userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[rbac] DELETE /users/:userId/overrides/:id error:', err);
    res.status(500).json({ error: 'Failed to delete override' });
  }
});

// ─── POST /simulate/start — begin View-as-Role session ────────────────
router.post('/simulate/start', requireAuth, requirePermission('admin.simulate.view_as_role'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);
  if (!adminDbId) { res.status(403).json({ error: 'No DB record for user' }); return; }

  const { simulated_role } = req.body as { simulated_role: string };
  if (!simulated_role) { res.status(400).json({ error: 'simulated_role required' }); return; }

  try {
    const role = await query<{ key: string }>(`SELECT key FROM rbac_roles WHERE key = $1`, [simulated_role]);
    if (role.rows.length === 0) { res.status(404).json({ error: 'Role not found' }); return; }

    // End any existing active simulation session for this user
    await query(
      `UPDATE rbac_simulation_sessions SET ended_at = NOW() WHERE real_user_id = $1 AND ended_at IS NULL`,
      [adminDbId]
    );
    const session = await query<{ id: string }>(
      `INSERT INTO rbac_simulation_sessions (real_user_id, simulated_role) VALUES ($1, $2) RETURNING id`,
      [adminDbId, simulated_role]
    );

    await logSecurityEvent({
      userId: adminDbId,
      actorOid: auth?.userId,
      action: 'simulation.started',
      outcome: 'allowed',
      reason: `Started 'View as ${simulated_role}' simulation`,
      context: { simulated_role, session_id: session.rows[0].id },
      req,
    });

    res.json({ session_id: session.rows[0].id, simulated_role });
  } catch (err) {
    console.error('[rbac] simulate/start error:', err);
    res.status(500).json({ error: 'Failed to start simulation' });
  }
});

// ─── POST /simulate/end — end current simulation session ──────────────
router.post('/simulate/end', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const adminDbId = await resolveDbUserIdFromOid(auth?.userId);
  if (!adminDbId) { res.status(403).json({ error: 'No DB record for user' }); return; }

  try {
    const updated = await query(
      `UPDATE rbac_simulation_sessions SET ended_at = NOW()
        WHERE real_user_id = $1 AND ended_at IS NULL
       RETURNING id`,
      [adminDbId]
    );

    if (updated.rows.length > 0) {
      await logSecurityEvent({
        userId: adminDbId,
        actorOid: auth?.userId,
        action: 'simulation.ended',
        outcome: 'allowed',
        context: { session_id: updated.rows[0].id },
        req,
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[rbac] simulate/end error:', err);
    res.status(500).json({ error: 'Failed to end simulation' });
  }
});

// ─── GET /simulate/current — return active simulation (if any) ────────
router.get('/simulate/current', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const dbUserId = await resolveDbUserIdFromOid(auth?.userId);
  if (!dbUserId) { res.json({ active: null }); return; }

  const r = await query<{ id: string; simulated_role: string; started_at: Date }>(
    `SELECT id, simulated_role, started_at
       FROM rbac_simulation_sessions
      WHERE real_user_id = $1 AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [dbUserId]
  );
  res.json({ active: r.rows[0] ?? null });
});

// ─── GET /simulate/permissions/:roleKey — preview what a role can see ─
router.get('/simulate/permissions/:roleKey', requireAuth, requirePermission('admin.simulate.view_as_role'), async (req, res) => {
  try {
    const role = await query<{ id: string }>(`SELECT id FROM rbac_roles WHERE key = $1`, [req.params.roleKey]);
    if (role.rows.length === 0) { res.status(404).json({ error: 'Role not found' }); return; }
    const perms = await query<{ permission_key: string }>(
      `SELECT permission_key FROM rbac_role_permissions WHERE role_id = $1`,
      [role.rows[0].id]
    );
    res.json({
      role_key: req.params.roleKey,
      permissions: perms.rows.map(p => p.permission_key),
    });
  } catch (err) {
    console.error('[rbac] simulate/permissions error:', err);
    res.status(500).json({ error: 'Failed to load role permissions' });
  }
});

export default router;
