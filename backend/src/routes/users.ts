import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '../middleware/auth';
import { query } from '../db/client';
import {
  requirePermission,
  invalidateUserCache,
  resolveDbUserIdFromOid,
} from '../services/permissions/permissionService';
import { logSecurityEvent } from '../services/permissions/auditLog';

/**
 * User directory + role management.
 *
 * Previously backed by Clerk's admin API. Now backed by the `users` table,
 * which the auth middleware populates on every authenticated request. The
 * response shape is preserved (same field names, including `firstName`/
 * `lastName`/`imageUrl`) so the frontend's admin UI doesn't need changes.
 *
 * Azure-specific notes:
 *   - `id` returned to the frontend is the Azure `oid` (stored in the
 *     users.clerk_user_id column — name kept for backward-compat).
 *   - `imageUrl` isn't stored locally. If you want avatars, pull from
 *     Microsoft Graph `/me/photo/$value` on demand and cache.
 */

const router = Router();

interface UserRow {
  id: string;
  clerk_user_id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: Date | string;
  updated_at: Date | string;
}

// Split "First Last" into { firstName, lastName } for the frontend that
// was built against Clerk's shape.
function splitName(full: string | null): { firstName: string; lastName: string } {
  if (!full) return { firstName: '', lastName: '' };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// ─── GET /api/v1/users — list all org users ───────────────────
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query<UserRow>(
      `SELECT id, clerk_user_id, email, name, role, created_at, updated_at
         FROM users
        ORDER BY created_at DESC
        LIMIT 500`
    );
    const users = result.rows.map((u) => {
      const { firstName, lastName } = splitName(u.name);
      return {
        id: u.clerk_user_id,          // Azure oid — matches what the frontend
                                      // expects to use in PATCH /users/:id
        firstName,
        lastName,
        fullName: u.name || 'Unknown',
        email: u.email ?? '',
        role: u.role ?? 'viewer',
        lastSignInAt: null,           // Not tracked in DB (Azure doesn't push
                                      // this — could pull from sign-in logs)
        createdAt: u.created_at,
        imageUrl: '',                 // See note at top of file
      };
    });
    res.json({ users, total: users.length });
  } catch (err) {
    console.error('GET /users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── PATCH /api/v1/users/:userId — update role ───────────────
// `:userId` here is the Azure oid (what we return as `id` from GET /users).
//
// This endpoint is the legacy "set primary role" path used by the admin UI
// dropdown. It writes to BOTH the legacy `users.role` column and the new
// `rbac_user_roles` table — otherwise the new permission engine (which
// reads from rbac_user_roles) would keep serving the old permission set
// and a promotion to e.g. CEO would silently fail to take effect.
router.patch(
  '/:userId',
  requireAuth,
  requirePermission('admin.users.manage'),
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { role } = req.body as { role: string };

      if (!role || typeof role !== 'string') {
        return res.status(400).json({ error: 'role is required' });
      }

      // Resolve target user's DB UUID from their Azure oid.
      const target = await query<{ id: string }>(
        `SELECT id FROM users WHERE clerk_user_id = $1`,
        [userId]
      );
      if (target.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const targetDbUserId = target.rows[0].id;

      // Validate role against rbac_roles (the source of truth — system
      // roles are seeded from catalog.ts on startup, and admins may have
      // added custom ones).
      const roleRow = await query<{ id: string; key: string }>(
        `SELECT id, key FROM rbac_roles WHERE key = $1`,
        [role]
      );
      if (roleRow.rows.length === 0) {
        const valid = await query<{ key: string }>(
          `SELECT key FROM rbac_roles ORDER BY is_system DESC, key ASC`
        );
        return res.status(400).json({
          error: `Invalid role '${role}'. Must be one of: ${valid.rows.map(r => r.key).join(', ')}`,
        });
      }
      const newRoleId = roleRow.rows[0].id;
      const newRoleKey = roleRow.rows[0].key;

      const auth = getAuth(req);
      const adminDbId = await resolveDbUserIdFromOid(auth?.userId);

      // Sync legacy column.
      await query(
        `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`,
        [newRoleKey, targetDbUserId]
      );

      // Replace rbac_user_roles assignments with the new single role. The
      // dropdown represents a single primary role; multi-role assignments
      // are managed via the dedicated /rbac/users/:userId/roles endpoints.
      await query(`DELETE FROM rbac_user_roles WHERE user_id = $1`, [targetDbUserId]);
      await query(
        `INSERT INTO rbac_user_roles (user_id, role_id, assigned_by)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [targetDbUserId, newRoleId, adminDbId]
      );

      // Drop the cached permission set so the user's next request gets the
      // new role's permissions immediately instead of waiting for the
      // 60-second TTL.
      invalidateUserCache(targetDbUserId);

      await logSecurityEvent({
        userId: adminDbId,
        actorOid: auth?.userId,
        action: 'role.assigned',
        outcome: 'allowed',
        reason: `Set role '${newRoleKey}' on user ${userId}`,
        context: {
          target_user_id: targetDbUserId,
          target_oid: userId,
          role_id: newRoleId,
          role_key: newRoleKey,
        },
        req,
      });

      res.json({ success: true, userId, role: newRoleKey });
    } catch (err) {
      console.error('PATCH /users/:userId error:', err);
      res.status(500).json({ error: 'Failed to update user role' });
    }
  }
);

export default router;
