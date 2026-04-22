import { Request, Response, NextFunction } from 'express';
import { getAuth, clerkClient } from '@clerk/express';
import { query } from '../db/client';

/**
 * DB-free admin check — verifies the caller has admin/ceo role directly
 * from Clerk's publicMetadata instead of the users SQL table. Use this
 * for any operational/debug endpoint that must work even when the DB is
 * partial or broken (the users table row sync runs off a trigger that
 * doesn't always fire, so the SQL-backed requireRole can 403 legitimate
 * admins on edge cases).
 *
 * Also honors ADMIN_BOOTSTRAP_CLERK_USER_IDS env var as a belt-and-
 * suspenders allowlist for initial bootstrap.
 */
export async function requireClerkAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }

  const bootstrapIds = (process.env.ADMIN_BOOTSTRAP_CLERK_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (bootstrapIds.includes(auth.userId)) {
    next();
    return;
  }

  try {
    const user = await clerkClient.users.getUser(auth.userId);
    const role = (user.publicMetadata?.role as string | undefined)?.toLowerCase();
    if (role === 'admin' || role === 'ceo') {
      next();
      return;
    }
    res.status(403).json({
      error: 'Forbidden',
      message: `Clerk role '${role ?? 'none'}' does not have admin access`,
    });
  } catch (err) {
    console.error('[auth] requireClerkAdmin Clerk lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Failed to verify admin role via Clerk' });
  }
}

export interface AuthenticatedRequest extends Request {
  userRecord?: {
    id: string;
    clerk_user_id: string;
    email: string;
    name: string | null;
    role: string;
    mfa_enabled: boolean;
  };
}

// Permission definitions — maps permission key to allowed roles
export const PERMISSIONS: Record<string, string[]> = {
  system_settings:      ['ceo', 'admin'],
  user_management:      ['ceo', 'manager', 'admin'],
  candidates_view:      ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  candidates_create:    ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  candidates_edit:      ['ceo', 'manager', 'hr', 'admin', 'coordinator'],
  candidates_delete:    ['ceo', 'manager', 'admin'],
  candidate_stage_move: ['ceo', 'manager', 'hr', 'admin'],
  resume_upload:        ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  credentialing_view:   ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  credentialing_manage: ['ceo', 'manager', 'hr', 'admin'],
  onboarding_view:      ['ceo', 'manager', 'hr', 'admin', 'coordinator'],
  onboarding_manage:    ['ceo', 'manager', 'hr', 'admin'],
  staff_view:           ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  staff_manage:         ['ceo', 'manager', 'hr', 'admin'],
  placements_view:      ['ceo', 'manager', 'hr', 'admin', 'coordinator'],
  placements_manage:    ['ceo', 'manager', 'admin'],
  financials_view:      ['ceo', 'admin'],
  rates_view:           ['ceo', 'manager', 'admin'],
  reminders_manage:     ['ceo', 'manager', 'hr', 'admin'],
  all_reports:          ['ceo', 'manager', 'admin'],
  team_reports:         ['ceo', 'manager', 'hr', 'admin'],
  integrations_view:    ['ceo', 'manager', 'admin'],
  integrations_manage:  ['ceo', 'admin'],
  reports_view:         ['ceo', 'manager', 'hr', 'admin'],
  reports_create:       ['ceo', 'manager', 'admin'],
  knowledge_view:       ['ceo', 'manager', 'hr', 'admin'],
  knowledge_manage:     ['ceo', 'admin'],
  clarification_manage: ['ceo', 'manager', 'hr', 'admin'],
  templates_view:       ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  templates_manage:     ['ceo', 'manager', 'hr', 'admin'],
  suggestions_view:     ['ceo', 'manager', 'hr', 'recruiter', 'admin'],
  suggestions_manage:      ['ceo', 'manager', 'admin'],
  time_tracking_view_own:  ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator', 'viewer'],
  time_tracking_view_team: ['ceo', 'manager', 'hr', 'admin'],
  time_tracking_admin:     ['ceo', 'admin'],
};

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }
  next();
}

export function requireRole(roles: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    try {
      const result = await query<{
        id: string;
        clerk_user_id: string;
        email: string;
        name: string | null;
        role: string;
        mfa_enabled: boolean;
      }>('SELECT * FROM users WHERE clerk_user_id = $1', [auth.userId]);

      if (result.rows.length === 0) {
        res.status(403).json({ error: 'Forbidden', message: 'User record not found' });
        return;
      }

      const userRecord = result.rows[0];
      if (!roles.includes(userRecord.role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: `Role '${userRecord.role}' does not have access to this resource`,
        });
        return;
      }

      req.userRecord = userRecord;
      next();
    } catch (err) {
      console.error('Role check error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}

export function requirePermission(permission: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    try {
      const result = await query<{
        id: string;
        clerk_user_id: string;
        email: string;
        name: string | null;
        role: string;
        mfa_enabled: boolean;
      }>('SELECT * FROM users WHERE clerk_user_id = $1', [auth.userId]);

      if (result.rows.length === 0) {
        // If user not in DB, allow if they have a valid Clerk session (first login)
        next();
        return;
      }

      const userRecord = result.rows[0];
      const allowedRoles = PERMISSIONS[permission];

      if (!allowedRoles) {
        // Unknown permission key — default to requireAuth only
        req.userRecord = userRecord;
        next();
        return;
      }

      if (!allowedRoles.includes(userRecord.role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: `Permission '${permission}' not granted to role '${userRecord.role}'`,
          required_roles: allowedRoles,
        });
        return;
      }

      req.userRecord = userRecord;
      next();
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}

export async function logAudit(
  userId: string | null,
  actor: string,
  action: string,
  subject?: string,
  details?: Record<string, unknown>,
  ipAddress?: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (user_id, actor, action, subject, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, actor, action, subject, details ? JSON.stringify(details) : null, ipAddress]
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}
