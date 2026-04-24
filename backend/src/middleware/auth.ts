import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { query } from '../db/client';

/**
 * Azure AD (Microsoft Entra ID) auth middleware.
 *
 * Replaces the previous @clerk/express-based stack. The public API surface
 * (getAuth, requireAuth, requireRole, requirePermission, logAudit,
 * requireClerkAdmin, AuthenticatedRequest, PERMISSIONS) is preserved so
 * the ~50 route files importing from here don't need to change.
 *
 * Flow:
 *   1. Frontend (MSAL.js) acquires an access token for the SPA's App
 *      Registration. Token is a signed JWT (RS256) from the Entra tenant.
 *   2. axios attaches it as `Authorization: Bearer <jwt>`.
 *   3. azureMiddleware() validates the signature against Microsoft's JWKS
 *      endpoint, checks issuer/audience/expiry, and attaches a normalised
 *      AuthContext to req.auth.
 *   4. Downstream middleware/routes call getAuth(req) — same pattern as
 *      before with @clerk/express.
 *
 * NOTE on the column name:
 *   The users table column is still called `clerk_user_id`. We now store
 *   the Azure `oid` (object id — a GUID, unique per user per tenant) in
 *   that column. Kept the name to avoid churning 100+ lines of SQL across
 *   route files; can be renamed in a future schema cleanup.
 */

// ─── Env config ───────────────────────────────────────────────────────────
const TENANT_ID = process.env.MICROSOFT_TENANT_ID ?? '';
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID ?? '';
// Entra v2.0 issuer is tenant-specific. If you switch to multi-tenant,
// change this to the `common` endpoint and validate `tid` claim manually.
const AZURE_ISSUER = process.env.AZURE_ISSUER ?? `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
// SPA tokens are bound to the App Registration's client id as audience.
// If you also issue tokens for a custom Web API App Registration, set
// AZURE_AUDIENCE to its Application ID URI (e.g. api://<guid>).
const AZURE_AUDIENCE = process.env.AZURE_AUDIENCE ?? AZURE_CLIENT_ID;

if (!TENANT_ID) {
  console.warn('[auth] MICROSOFT_TENANT_ID not set — JWT verification will fail.');
}

// ─── JWKS client (cached 24h — Microsoft rotates keys infrequently) ──────
const jwks = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${TENANT_ID || 'common'}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 24 * 60 * 60 * 1000,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getSigningKey(kid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    jwks.getSigningKey(kid, (err, key) => {
      if (err || !key) return reject(err ?? new Error('no key'));
      resolve(key.getPublicKey());
    });
  });
}

// ─── Claim shapes ─────────────────────────────────────────────────────────
export interface AzureClaims extends JwtPayload {
  oid: string;                    // User object id (stable GUID per user)
  tid: string;                    // Tenant id
  preferred_username?: string;    // Usually the UPN / email
  email?: string;
  name?: string;
  roles?: string[];               // Azure App Roles (optional — we use DB role)
}

/**
 * Public auth context attached to req.auth after successful verification.
 * `userId` is kept named that way (instead of `oid`) so downstream code
 * doesn't need to change.
 */
export interface AuthContext {
  userId: string;       // Azure `oid` — stable per user per tenant
  email: string | null;
  name: string | null;
  tid: string;
  roles: string[];      // Azure-issued app roles (not used for DB RBAC)
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────
/**
 * Global middleware (mounted once in index.ts). Parses the Bearer token
 * if present, validates it, and populates req.auth. Missing/invalid tokens
 * fall through with req.auth = undefined so the route-level requireAuth
 * guard can return 401 with a consistent shape.
 */
export function azureMiddleware() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return next();
    const token = header.slice('Bearer '.length).trim();
    if (!token) return next();

    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string' || !decoded.header?.kid) return next();

      const key = await getSigningKey(decoded.header.kid);
      const verifyOpts: jwt.VerifyOptions = {
        algorithms: ['RS256'],
        issuer: AZURE_ISSUER,
      };
      if (AZURE_AUDIENCE) verifyOpts.audience = AZURE_AUDIENCE;

      const claims = jwt.verify(token, key, verifyOpts) as AzureClaims;
      if (!claims.oid) return next();

      req.auth = {
        userId: claims.oid,
        email: (claims.email ?? claims.preferred_username ?? null)?.toLowerCase() ?? null,
        name: claims.name ?? null,
        tid: claims.tid,
        roles: claims.roles ?? [],
      };
    } catch (err) {
      // Swallow the error so the request continues to the route-level
      // requireAuth guard (which returns a consistent 401 shape). But we
      // LOG the reason always — even in prod — because "401 everywhere"
      // is the kind of problem you need Railway logs to diagnose:
      //   "jwt audience invalid. expected: <guid>"  → AZURE_AUDIENCE wrong
      //   "jwt issuer invalid. expected: <url>"     → MICROSOFT_TENANT_ID wrong
      //   "invalid signature"                       → JWKS / wrong tenant
      //   "jwt expired"                             → token stale, frontend bug
      // Non-PII: the message never contains the raw token or user claims.
      console.warn('[auth] JWT verify failed:', (err as Error).message);
    }
    next();
  };
}

/**
 * Compat shim — preserves the shape of @clerk/express's getAuth(req).
 * Returns `{ userId }`-at-minimum so downstream callers like
 * `getAuth(req)?.userId` keep working unchanged.
 */
export function getAuth(req: Request): AuthContext | undefined {
  return req.auth;
}

// ─── Guards ───────────────────────────────────────────────────────────────
export interface AuthenticatedRequest extends Request {
  userRecord?: {
    id: string;
    clerk_user_id: string;    // now holds Azure oid — see note at top
    email: string;
    name: string | null;
    role: string;
    mfa_enabled: boolean;
  };
}

// Legacy permission-key → new-catalog-key translation.
//
// Backward compatibility for the ~50 route files that still call
// `requirePermission('candidates_view')` etc. After Phase 8 RBAC landed,
// the canonical permission names live in services/permissions/catalog.ts
// as dotted keys (`candidates.view`). This map lets existing calls keep
// working — each legacy key resolves to one or more new permission keys
// that must ALL be held by the user.
//
// If a legacy key maps to multiple new keys, the user needs all of them
// (AND semantics). Missing any → 403.
//
// For new code: use the new dotted keys directly via the permission
// service in services/permissions/permissionService.ts.
export const LEGACY_PERMISSION_MAP: Record<string, string[]> = {
  // Canonical mappings — these become default-deny + audit-logged.
  system_settings:         ['admin.integrations.manage'],
  user_management:         ['admin.users.manage'],
  candidates_view:         ['candidates.view'],
  candidates_create:       ['candidates.create'],
  candidates_edit:         ['candidates.edit'],
  candidates_delete:       ['candidates.delete'],
  candidate_stage_move:    ['candidates.edit'],
  resume_upload:           ['candidates.view.documents'],
  credentialing_view:      ['credentialing.view'],
  credentialing_manage:    ['credentialing.edit'],
  onboarding_view:         ['onboarding.view'],
  onboarding_manage:       ['onboarding.manage'],
  staff_view:              ['hr.view'],
  staff_manage:            ['hr.edit'],
  placements_view:         ['candidates.view'],
  placements_manage:       ['candidates.edit'],
  financials_view:         ['finance.margins.view'],
  rates_view:              ['finance.pay_rates.view'],
  reminders_manage:        ['tasks.recruiter.assign'],
  all_reports:             ['compliance.reports.export'],
  team_reports:            ['compliance.view'],
  integrations_view:       ['admin.integrations.manage'],
  integrations_manage:     ['admin.integrations.manage'],
  reports_view:            ['compliance.view'],
  reports_create:          ['compliance.reports.export'],
  knowledge_view:          ['ai.chat.use'],
  knowledge_manage:        ['admin.integrations.manage'],
  clarification_manage:    ['ai.chat.use'],
  templates_view:          ['candidates.view'],
  templates_manage:        ['candidates.edit'],
  suggestions_view:        ['ai.chat.use'],
  suggestions_manage:      ['admin.integrations.manage'],
  time_tracking_view_own:  ['pto.view_own'],
  time_tracking_view_team: ['pto.view_team'],
  time_tracking_admin:     ['admin.users.manage'],
  admin_manage:            ['admin.roles.manage'],
};

// Re-export under the old name so existing imports keep working.
export const PERMISSIONS = LEGACY_PERMISSION_MAP;

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

/**
 * Backward-compat requirePermission — existing routes call this with a
 * legacy key like 'candidates_view'. We translate to the new catalog keys
 * and delegate to the new default-deny permission service, which gives us:
 *   - Default-deny (no role = no access)
 *   - User override support (grant/deny with expiry)
 *   - Audit logging of every denial
 *   - Per-user permission cache
 *
 * If the legacy key isn't in LEGACY_PERMISSION_MAP, we treat it as an
 * unknown permission and DENY rather than fall through. This is the
 * default-deny floor — never silently allow unknown permission keys.
 */
export function requirePermission(permission: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    // Resolve legacy key → new permission key(s). User must hold ALL of them.
    const newKeys = LEGACY_PERMISSION_MAP[permission];
    if (!newKeys) {
      console.warn(`[auth] requirePermission called with unknown legacy key '${permission}' — denying by default`);
      res.status(403).json({
        error: 'Forbidden',
        message: `Unknown permission '${permission}'. This route needs to be migrated to a registered permission key.`,
      });
      return;
    }

    try {
      // Lazy-import to avoid circular dependency between this file and the
      // permission service.
      const { userHasAllPermissions, resolveDbUserIdFromOid } = await import('../services/permissions/permissionService');
      const { logSecurityEvent } = await import('../services/permissions/auditLog');

      const dbUserId = await resolveDbUserIdFromOid(auth.userId);
      if (!dbUserId) {
        await logSecurityEvent({
          actorOid: auth.userId,
          action: 'permission.denied',
          permissionKey: permission,
          outcome: 'denied',
          reason: 'user has no DB record',
          req,
        });
        res.status(403).json({
          error: 'Forbidden',
          message: 'Your account is still being set up. Please sign out and back in.',
        });
        return;
      }

      const allowed = await userHasAllPermissions(dbUserId, newKeys);
      if (!allowed) {
        await logSecurityEvent({
          userId: dbUserId,
          actorOid: auth.userId,
          action: 'permission.denied',
          permissionKey: permission,
          outcome: 'denied',
          reason: `Missing permissions: ${newKeys.join(', ')}`,
          context: { legacy_key: permission, required_new_keys: newKeys },
          req,
        });
        res.status(403).json({
          error: 'Forbidden',
          message: `Permission '${permission}' denied. You need: ${newKeys.join(', ')}.`,
          required_permissions: newKeys,
        });
        return;
      }

      // Optional: load users row for legacy code that reads req.userRecord.
      const result = await query<{
        id: string;
        clerk_user_id: string;
        email: string;
        name: string | null;
        role: string;
        mfa_enabled: boolean;
      }>('SELECT * FROM users WHERE id = $1', [dbUserId]);
      if (result.rows.length > 0) {
        req.userRecord = result.rows[0];
      }

      next();
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}

/**
 * DB-free admin check. Previously consulted Clerk's publicMetadata.role.
 * Now reads the users table `role` column (populated by the user-sync
 * middleware on first authenticated request). Still tolerant of the edge
 * case where the user exists in Azure but has no DB row yet — in that
 * case we fall back to the AZURE_ADMIN_OIDS allowlist.
 *
 * AZURE_ADMIN_OIDS is a comma-separated list of Azure `oid` values,
 * replacing the old ADMIN_BOOTSTRAP_CLERK_USER_IDS env var.
 */
export async function requireClerkAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }

  const bootstrapIds = (
    process.env.AZURE_ADMIN_OIDS ??
    process.env.ADMIN_BOOTSTRAP_CLERK_USER_IDS ?? // legacy var name, still honored
    ''
  )
    .split(',').map(s => s.trim()).filter(Boolean);
  if (bootstrapIds.includes(auth.userId)) {
    next();
    return;
  }

  try {
    const result = await query<{ role: string }>(
      'SELECT role FROM users WHERE clerk_user_id = $1',
      [auth.userId]
    );
    const role = result.rows[0]?.role?.toLowerCase();
    if (role === 'admin' || role === 'ceo') {
      next();
      return;
    }
    res.status(403).json({
      error: 'Forbidden',
      message: `Role '${role ?? 'none'}' does not have admin access`,
    });
  } catch (err) {
    console.error('[auth] requireClerkAdmin DB lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Failed to verify admin role' });
  }
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
