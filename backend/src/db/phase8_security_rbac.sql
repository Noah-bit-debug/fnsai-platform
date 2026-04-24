-- Phase 8 — Security & RBAC architecture upgrade.
--
-- Implements a default-deny permission system with:
--   - A catalog of ~80 granular permissions (seeded from catalog.ts)
--   - Roles (system + custom) with permission grants
--   - User-role assignments (many-to-many — a user can hold multiple roles)
--   - User-specific permission overrides (grant/deny, optional expiry)
--   - Security audit log (append-only)
--   - File access rules for SharePoint/OneDrive/Graph search scoping
--   - AI guard logs for denial/prompt-injection tracking
--
-- Idempotent — every CREATE uses IF NOT EXISTS, every ALTER uses ADD
-- COLUMN IF NOT EXISTS. Safe to re-run.

-- ─── Permissions catalog ───────────────────────────────────────────────
-- Seeded at backend startup from catalog.ts. DO NOT insert rows directly —
-- the catalog code is the source of truth.
CREATE TABLE IF NOT EXISTS permissions (
  key         TEXT PRIMARY KEY,                    -- e.g. 'candidates.view'
  category    TEXT NOT NULL,                       -- e.g. 'candidates'
  label       TEXT NOT NULL,
  description TEXT,
  risk_level  TEXT NOT NULL DEFAULT 'medium'
              CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  -- 'critical' perms require 2-person approval to grant (see
  -- pending_permission_grants below).
  is_ai_only  BOOLEAN NOT NULL DEFAULT FALSE,      -- true if this is strictly an AI capability
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Roles ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rbac_roles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key            TEXT UNIQUE NOT NULL,             -- 'ceo', 'admin', custom slugs
  label          TEXT NOT NULL,
  description    TEXT,
  is_system      BOOLEAN NOT NULL DEFAULT FALSE,   -- system roles cannot be deleted
  based_on_role  UUID REFERENCES rbac_roles(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rbac_roles_key ON rbac_roles(key);

-- ─── Role → Permission grants ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  role_id        UUID REFERENCES rbac_roles(id) ON DELETE CASCADE,
  permission_key TEXT REFERENCES permissions(key) ON DELETE CASCADE,
  granted_at     TIMESTAMPTZ DEFAULT NOW(),
  granted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_rbac_role_perms_role ON rbac_role_permissions(role_id);

-- ─── User → Role assignments ───────────────────────────────────────────
-- A user can hold multiple roles (e.g. "Recruiter" + "Manager"). Effective
-- permissions = union of all role perms + user overrides.
CREATE TABLE IF NOT EXISTS rbac_user_roles (
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id      UUID REFERENCES rbac_roles(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ DEFAULT NOW(),
  assigned_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_user ON rbac_user_roles(user_id);

-- ─── User-specific permission overrides ────────────────────────────────
-- Effect 'grant' = user gets this permission even if their role doesn't.
-- Effect 'deny'  = user is BLOCKED even if their role grants it.
-- expires_at NULL = permanent. Non-NULL = auto-expires.
CREATE TABLE IF NOT EXISTS rbac_user_overrides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT REFERENCES permissions(key) ON DELETE CASCADE,
  effect         TEXT NOT NULL CHECK (effect IN ('grant', 'deny')),
  reason         TEXT,                              -- business justification
  expires_at     TIMESTAMPTZ,                       -- NULL = permanent
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_rbac_overrides_user ON rbac_user_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_rbac_overrides_expires ON rbac_user_overrides(expires_at)
  WHERE expires_at IS NOT NULL;

-- ─── Pending 2-person approval for critical permissions ────────────────
-- When someone tries to grant a 'critical' permission, it goes here and
-- waits for a second admin to approve.
CREATE TABLE IF NOT EXISTS rbac_pending_grants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by      UUID REFERENCES users(id) ON DELETE CASCADE,
  target_user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  permission_key    TEXT REFERENCES permissions(key) ON DELETE CASCADE,
  justification     TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  approved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  approval_decision TEXT,
  approved_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '48 hours'),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rbac_pending_target ON rbac_pending_grants(target_user_id);
CREATE INDEX IF NOT EXISTS idx_rbac_pending_status ON rbac_pending_grants(status);

-- ─── Security audit log ────────────────────────────────────────────────
-- Append-only. Every permission-sensitive action lands here.
CREATE TABLE IF NOT EXISTS security_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_oid      TEXT,                              -- Azure oid, retained even if user row is deleted
  action         TEXT NOT NULL,                     -- 'permission.denied', 'ai.query', etc.
  permission_key TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied', 'error')),
  reason         TEXT,                              -- why denied or why granted
  context        JSONB,                             -- request path, target entity, tool used, etc.
  ip_address     TEXT,
  user_agent     TEXT,
  session_id     TEXT,                              -- correlate a sequence of events
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_security_audit_user ON security_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_action ON security_audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_outcome ON security_audit_log(outcome)
  WHERE outcome = 'denied';

-- ─── File / folder access rules ────────────────────────────────────────
-- Scopes SharePoint/OneDrive search by role. Patterns use glob syntax.
-- More-specific (longer) patterns win. 'deny' overrides 'allow' at same length.
CREATE TABLE IF NOT EXISTS rbac_file_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id     UUID REFERENCES rbac_roles(id) ON DELETE CASCADE,
  pattern     TEXT NOT NULL,                        -- '/HR/*', '/Bids/2025/**', '/CEO_Private/**'
  effect      TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  priority    INT NOT NULL DEFAULT 0,               -- higher priority wins on conflict
  description TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rbac_file_rules_role ON rbac_file_rules(role_id);

-- ─── AI guard logs ─────────────────────────────────────────────────────
-- Dedicated table for AI-specific security events. Makes it easy to run
-- queries like "show me every AI query about finance from non-finance
-- users" without scanning the main security log.
CREATE TABLE IF NOT EXISTS ai_security_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_oid       TEXT,
  tool            TEXT NOT NULL,                    -- 'ai_chat', 'ai_task_wizard', 'ai_email_search', etc.
  prompt_summary  TEXT,                             -- first 500 chars of user input (redacted of PII)
  detected_topics TEXT[],                           -- ['finance', 'candidates', 'bids']
  required_perms  TEXT[],                           -- permissions that would have been needed
  missing_perms   TEXT[],                           -- subset user lacked
  outcome         TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied', 'injection_blocked', 'partial')),
  injection_flags TEXT[],                           -- e.g. ['ignore_instructions', 'pretend_admin']
  response_safe   BOOLEAN,                          -- did we return a safe denial?
  context         JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_security_user ON ai_security_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_security_outcome ON ai_security_log(outcome)
  WHERE outcome IN ('denied', 'injection_blocked');
CREATE INDEX IF NOT EXISTS idx_ai_security_tool ON ai_security_log(tool);

-- ─── Role simulation sessions ──────────────────────────────────────────
-- Tracks "View as Role" sessions so audit logs can record WHO actually
-- triggered an action vs which role was simulated at the time.
CREATE TABLE IF NOT EXISTS rbac_simulation_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  real_user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  simulated_role  TEXT NOT NULL REFERENCES rbac_roles(key),
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  actions_count   INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sim_sessions_user ON rbac_simulation_sessions(real_user_id)
  WHERE ended_at IS NULL;

-- ─── Migrate existing users.role into the new user_roles table ─────────
-- Legacy: users.role held a single role string. New: users can hold
-- multiple roles. This migration preserves the single role each user has,
-- creating an rbac_user_roles entry once the rbac_roles rows exist (seeded
-- by the backend on startup — see catalog.ts).
--
-- We use a deferred approach: run this again manually via the admin
-- Migrate endpoint after startup, so rbac_roles exists by then.
DO $$
BEGIN
  -- Only run if rbac_roles has been seeded (check for 'ceo')
  IF EXISTS (SELECT 1 FROM rbac_roles WHERE key = 'ceo') THEN
    INSERT INTO rbac_user_roles (user_id, role_id)
    SELECT u.id, r.id
      FROM users u
      JOIN rbac_roles r ON r.key = u.role
     WHERE u.role IS NOT NULL
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;
END $$;
