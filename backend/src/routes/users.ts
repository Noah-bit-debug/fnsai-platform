import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { query, pool } from '../db/client';
import { invalidateUserCache } from '../services/permissions/permissionService';

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
// This swaps the user's PRIMARY role only. It updates the legacy users.role
// column AND swaps the matching rbac_user_roles row inside one transaction,
// then invalidates the per-user permission cache so the change takes effect
// immediately without waiting for the 60s TTL.
//
// Any additional role assignments the user has (granted via UserAccess.tsx
// → POST /rbac/users/:id/roles) are preserved — we only replace the row
// that matched the OLD users.role value.
router.patch('/:userId', requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { role } = req.body as { role: string };

  const VALID_ROLES = ['ceo', 'admin', 'manager', 'hr', 'recruiter', 'coordinator', 'viewer'];
  if (!role || !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve the target user's DB id and their current legacy role.
    const userRow = await client.query<{ id: string; role: string | null }>(
      `SELECT id, role FROM users WHERE clerk_user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (userRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const dbUserId = userRow.rows[0].id;
    const oldRole = userRow.rows[0].role;

    // Resolve the new role's rbac_roles.id.
    const newRoleRow = await client.query<{ id: string }>(
      `SELECT id FROM rbac_roles WHERE key = $1 LIMIT 1`,
      [role]
    );
    if (newRoleRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({
        error: `Role "${role}" not found in rbac_roles. Backend may need a restart to seed the catalog.`,
      });
    }
    const newRoleId = newRoleRow.rows[0].id;

    // Update the legacy column.
    await client.query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`,
      [role, dbUserId]
    );

    // Remove the rbac_user_roles row matching the OLD primary role (if any).
    // Leaves any other role assignments intact.
    if (oldRole) {
      await client.query(
        `DELETE FROM rbac_user_roles
          WHERE user_id = $1
            AND role_id = (SELECT id FROM rbac_roles WHERE key = $2)`,
        [dbUserId, oldRole]
      );
    }

    // Grant the new role.
    await client.query(
      `INSERT INTO rbac_user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [dbUserId, newRoleId]
    );

    await client.query('COMMIT');

    // Drop the cached permission set so the next request resolves fresh.
    invalidateUserCache(dbUserId);

    res.json({ success: true, userId, role });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('PATCH /users/:userId error:', err);
    res.status(500).json({ error: 'Failed to update user role' });
  } finally {
    client.release();
  }
});

export default router;
