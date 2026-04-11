import { Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';
import { query } from '../db/client';

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
