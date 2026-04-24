/**
 * Permission Service — runtime engine for default-deny RBAC.
 *
 * Core operations:
 *   - seedCatalog()           — called on backend startup; syncs catalog.ts
 *                                into the `permissions` + `rbac_roles` tables.
 *   - resolveUserPermissions  — returns the effective set of permission keys
 *                                for a given user, including role grants,
 *                                overrides, and expiry filtering.
 *   - userHasPermission       — fast boolean check.
 *   - requirePermission       — Express middleware (default-deny).
 *   - requireAnyPermission    — middleware: pass if user has ANY of listed.
 *   - requireAllPermissions   — middleware: user must have ALL of listed.
 *
 * Caching:
 *   User permissions are cached in-process for 60 seconds. Role/override
 *   changes invalidate the affected user's cache immediately via
 *   `invalidateUserCache(userId)`.
 *
 * Default-deny:
 *   If a user has no role assignment, they have NO permissions — not even
 *   the login-baseline ones. Every permission must be explicitly granted
 *   via a role or user override. This includes AI usage, file access,
 *   everything.
 */

import { Request, Response, NextFunction } from 'express';
import { query } from '../../db/client';
import { getAuth } from '../../middleware/auth';
import { logSecurityEvent } from './auditLog';
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  PermissionDef,
  SystemRoleDef,
  getPermissionDef,
} from './catalog';

// ─── Seed: sync catalog.ts into DB on startup ───────────────────────────
//
// Runs once at backend boot. The DB rows are a cached projection of what's
// in catalog.ts — we delete stale permissions (not in catalog anymore) and
// upsert current ones. System roles' permission sets are also re-synced.
//
// Custom roles and their grants are NEVER touched here — only system roles.
export async function seedCatalog(): Promise<void> {
  try {
    // 1. Upsert every permission from the catalog
    for (const p of PERMISSIONS) {
      await query(
        `INSERT INTO permissions (key, category, label, description, risk_level, is_ai_only, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (key) DO UPDATE
           SET category    = EXCLUDED.category,
               label       = EXCLUDED.label,
               description = EXCLUDED.description,
               risk_level  = EXCLUDED.risk_level,
               is_ai_only  = EXCLUDED.is_ai_only,
               updated_at  = NOW()`,
        [p.key, p.category, p.label, p.description, p.risk, p.aiOnly ?? false]
      );
    }

    // 2. Delete permissions no longer in catalog (rare — but keeps the table
    //    aligned to the code)
    const keys = PERMISSIONS.map(p => p.key);
    await query(
      `DELETE FROM permissions WHERE key <> ALL($1::text[])`,
      [keys]
    );

    // 3. Upsert system roles
    for (const role of SYSTEM_ROLES) {
      await query(
        `INSERT INTO rbac_roles (key, label, description, is_system, created_at)
         VALUES ($1, $2, $3, TRUE, NOW())
         ON CONFLICT (key) DO UPDATE
           SET label       = EXCLUDED.label,
               description = EXCLUDED.description,
               is_system   = TRUE,
               updated_at  = NOW()`,
        [role.key, role.label, role.description]
      );
    }

    // 4. Resync permission grants for each system role
    for (const role of SYSTEM_ROLES) {
      const r = await query<{ id: string }>(
        `SELECT id FROM rbac_roles WHERE key = $1`,
        [role.key]
      );
      const roleId = r.rows[0]?.id;
      if (!roleId) continue;

      // Clear existing grants for this system role only (leave custom roles alone)
      await query(
        `DELETE FROM rbac_role_permissions WHERE role_id = $1`,
        [roleId]
      );
      // Re-insert the current grant list
      for (const permKey of role.permissions) {
        await query(
          `INSERT INTO rbac_role_permissions (role_id, permission_key, granted_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT DO NOTHING`,
          [roleId, permKey]
        );
      }
    }

    // 5. Legacy-user-role migration: any user with users.role populated but
    //    NO rbac_user_roles row — create one so they keep their permissions.
    await query(
      `INSERT INTO rbac_user_roles (user_id, role_id)
       SELECT u.id, r.id
         FROM users u
         JOIN rbac_roles r ON r.key = u.role
        WHERE u.role IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM rbac_user_roles ur WHERE ur.user_id = u.id
          )
       ON CONFLICT (user_id, role_id) DO NOTHING`
    );

    console.log(`[rbac] Catalog seeded: ${PERMISSIONS.length} permissions, ${SYSTEM_ROLES.length} system roles.`);
  } catch (err) {
    console.error('[rbac] Catalog seed failed:', (err as Error).message);
  }
}

// ─── Per-user permission cache ──────────────────────────────────────────
interface CachedPermissions {
  permissions: Set<string>;
  roleKeys: string[];
  fetchedAt: number;
}
const userCache = new Map<string, CachedPermissions>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
}

export function invalidateAllCaches(): void {
  userCache.clear();
}

// ─── Core resolution ────────────────────────────────────────────────────
//
// Returns the effective permission set for the given user.
// Algorithm:
//   1. Get all roles assigned to the user.
//   2. Get all permissions granted by those roles.
//   3. Apply user overrides: 'grant' adds (even if role didn't have it),
//      'deny' removes (even if role granted it).
//   4. Filter out expired overrides.
//
// Returns an EMPTY set for users with no role assignments — this is the
// default-deny floor. They cannot do anything.
export async function resolveUserPermissions(
  userId: string | null | undefined
): Promise<{ permissions: Set<string>; roleKeys: string[] }> {
  if (!userId) return { permissions: new Set(), roleKeys: [] };

  // Cache check
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { permissions: cached.permissions, roleKeys: cached.roleKeys };
  }

  // 1. Role-granted permissions
  const rolePerms = await query<{ permission_key: string; role_key: string }>(
    `SELECT rp.permission_key, r.key AS role_key
       FROM rbac_user_roles ur
       JOIN rbac_role_permissions rp ON rp.role_id = ur.role_id
       JOIN rbac_roles r              ON r.id     = ur.role_id
      WHERE ur.user_id = $1`,
    [userId]
  );

  const permissions = new Set<string>();
  const roleKeysSet = new Set<string>();
  for (const row of rolePerms.rows) {
    permissions.add(row.permission_key);
    roleKeysSet.add(row.role_key);
  }

  // 2. User overrides (only non-expired)
  const overrides = await query<{ permission_key: string; effect: 'grant' | 'deny' }>(
    `SELECT permission_key, effect
       FROM rbac_user_overrides
      WHERE user_id = $1
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId]
  );

  for (const o of overrides.rows) {
    if (o.effect === 'grant') permissions.add(o.permission_key);
    else if (o.effect === 'deny') permissions.delete(o.permission_key);
  }

  // Cache
  const result = {
    permissions,
    roleKeys: Array.from(roleKeysSet),
  };
  userCache.set(userId, { ...result, fetchedAt: Date.now() });
  return result;
}

// ─── Fast checks ────────────────────────────────────────────────────────

export async function userHasPermission(
  userId: string | null | undefined,
  permissionKey: string
): Promise<boolean> {
  if (!userId) return false;
  const { permissions } = await resolveUserPermissions(userId);
  return permissions.has(permissionKey);
}

export async function userHasAnyPermission(
  userId: string | null | undefined,
  permissionKeys: string[]
): Promise<boolean> {
  if (!userId || permissionKeys.length === 0) return false;
  const { permissions } = await resolveUserPermissions(userId);
  return permissionKeys.some(k => permissions.has(k));
}

export async function userHasAllPermissions(
  userId: string | null | undefined,
  permissionKeys: string[]
): Promise<boolean> {
  if (!userId || permissionKeys.length === 0) return false;
  const { permissions } = await resolveUserPermissions(userId);
  return permissionKeys.every(k => permissions.has(k));
}

// ─── Helpers: resolve users.id from Azure oid ───────────────────────────

export async function resolveDbUserIdFromOid(oid: string | null | undefined): Promise<string | null> {
  if (!oid) return null;
  const r = await query<{ id: string }>(
    `SELECT id FROM users WHERE clerk_user_id = $1 LIMIT 1`,
    [oid]
  );
  return r.rows[0]?.id ?? null;
}

// ─── Express middleware ─────────────────────────────────────────────────
//
// These replace the older requirePermission from middleware/auth.ts with
// a default-deny implementation that checks the new permission catalog.
//
// The old PERMISSIONS map in middleware/auth.ts is kept as a backward-
// compat shim but now delegates to requirePermission here via the same
// key names for the subset of permissions that existed before.

export function requirePermission(permissionKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    // Resolve DB user id from Azure oid
    const dbUserId = await resolveDbUserIdFromOid(auth.userId);
    if (!dbUserId) {
      // User auth succeeded but no DB row yet — default deny, log.
      await logSecurityEvent({
        actorOid: auth.userId,
        action: 'permission.denied',
        permissionKey,
        outcome: 'denied',
        reason: 'user has no DB record yet',
        req,
      });
      res.status(403).json({
        error: 'Forbidden',
        message: 'Your account is still being set up. Please sign out and back in.',
      });
      return;
    }

    const allowed = await userHasPermission(dbUserId, permissionKey);
    if (!allowed) {
      const def = getPermissionDef(permissionKey);
      await logSecurityEvent({
        userId: dbUserId,
        actorOid: auth.userId,
        action: 'permission.denied',
        permissionKey,
        outcome: 'denied',
        reason: `Missing permission: ${permissionKey}`,
        context: { category: def?.category, risk: def?.risk },
        req,
      });
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires permission: ${def?.label ?? permissionKey}. If you believe you should have access, contact your administrator.`,
        required_permission: permissionKey,
      });
      return;
    }

    // Allow — attach resolved user + permissions to the request for downstream use
    (req as any).rbacUserId = dbUserId;
    next();
  };
}

export function requireAnyPermission(permissionKeys: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const dbUserId = await resolveDbUserIdFromOid(auth.userId);
    if (!dbUserId) {
      res.status(403).json({ error: 'Forbidden', message: 'Account setup incomplete.' });
      return;
    }
    const allowed = await userHasAnyPermission(dbUserId, permissionKeys);
    if (!allowed) {
      await logSecurityEvent({
        userId: dbUserId,
        actorOid: auth.userId,
        action: 'permission.denied',
        outcome: 'denied',
        reason: `Missing any of: ${permissionKeys.join(', ')}`,
        req,
      });
      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have any of the required permissions.',
        required_any: permissionKeys,
      });
      return;
    }
    (req as any).rbacUserId = dbUserId;
    next();
  };
}

// ─── Rate limiting for permission denials (anti-enumeration) ────────────
//
// If a user rapidly triggers many 403s on different permissions, they're
// probably probing — trying to map out what they can access. We keep a
// count per user per 5-minute window and escalate (tempban 15 min) past
// a threshold. Doesn't interfere with normal usage — thresholds are set
// above anything a legitimate user would hit.

const denialCounts = new Map<string, { count: number; resetAt: number; bannedUntil?: number }>();
const WINDOW_MS = 5 * 60 * 1000;
const DENIAL_THRESHOLD = 30;   // 30 denials in 5 minutes = probing
const BAN_DURATION_MS = 15 * 60 * 1000;

export function checkDenialRateLimit(userId: string): { banned: boolean; remainingSec?: number } {
  const now = Date.now();
  const entry = denialCounts.get(userId);

  if (entry?.bannedUntil && entry.bannedUntil > now) {
    return { banned: true, remainingSec: Math.ceil((entry.bannedUntil - now) / 1000) };
  }

  if (!entry || entry.resetAt < now) {
    denialCounts.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return { banned: false };
  }

  entry.count++;
  if (entry.count > DENIAL_THRESHOLD) {
    entry.bannedUntil = now + BAN_DURATION_MS;
    return { banned: true, remainingSec: Math.ceil(BAN_DURATION_MS / 1000) };
  }
  return { banned: false };
}

// ─── Public API: get-my-permissions (for frontend) ──────────────────────
//
// Called by the frontend after sign-in to build the sidebar/route filter.
// Returns the full permission list the user has so the UI can render
// conditionally.

export async function getMyPermissions(userId: string): Promise<{
  permissions: string[];
  roles: string[];
}> {
  const { permissions, roleKeys } = await resolveUserPermissions(userId);
  return {
    permissions: Array.from(permissions),
    roles: roleKeys,
  };
}

// ─── Re-exports for convenience ─────────────────────────────────────────
export { PERMISSIONS, SYSTEM_ROLES } from './catalog';
export type { PermissionDef, SystemRoleDef } from './catalog';
