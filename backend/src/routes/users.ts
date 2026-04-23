import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { query } from '../db/client';

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
router.patch('/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { role } = req.body as { role: string };

    const VALID_ROLES = ['ceo', 'admin', 'manager', 'hr', 'recruiter', 'coordinator', 'viewer'];
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const result = await query(
      `UPDATE users
          SET role = $1, updated_at = NOW()
        WHERE clerk_user_id = $2
       RETURNING clerk_user_id, role`,
      [role, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, userId, role });
  } catch (err) {
    console.error('PATCH /users/:userId error:', err);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

export default router;
