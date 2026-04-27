-- Phase 9 — Generic assignment system.
--
-- Replaces the ad-hoc "owner_id" columns scattered across candidates,
-- tasks, etc. with one polymorphic table:
--
--   (assignable_type, assignable_id) → (user_id, role)
--
-- A candidate can have an HR owner + recruiter + manager-reviewer
-- simultaneously, all tracked in this one table. "My Assigned Work"
-- is just a SELECT keyed on user_id.
--
-- We deliberately did NOT add new columns to candidates/tasks because
-- (a) the same shape repeats for every entity, (b) one user can hold
-- multiple roles on the same candidate, and (c) we want history
-- (who-was-assigned-when) without per-table audit columns.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What's being assigned. assignable_type is a discriminator so we can
  -- key off (type, id) without per-entity FKs (which would require
  -- dropping/recreating constraints any time we add a new assignable
  -- entity).
  assignable_type  TEXT NOT NULL
                   CHECK (assignable_type IN (
                     'candidate', 'task', 'reminder', 'submission',
                     'placement', 'incident', 'bid'
                   )),
  assignable_id    UUID NOT NULL,
  -- Who owns the work
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The kind of ownership. Multiple users can hold different roles on
  -- the same item (e.g. one recruiter + one HR follow-up).
  role             TEXT NOT NULL DEFAULT 'owner'
                   CHECK (role IN (
                     'owner', 'recruiter', 'hr', 'manager_reviewer',
                     'credentialing', 'follow_up'
                   )),
  -- Optional scheduling for the assignment itself (separate from the
  -- assignable item's own due dates — this is "when this person should
  -- act").
  due_at           TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'completed', 'cancelled')),
  notes            TEXT,
  -- Provenance
  assigned_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,

  -- A user can only hold one of each (role) on a given item — re-assigning
  -- the same role to the same user is a no-op rather than a duplicate.
  UNIQUE (assignable_type, assignable_id, user_id, role)
);

-- Hot-path indexes:
--   - "what's assigned to me" query (My Assigned Work)
--   - "who owns this candidate" query (badge on candidate page)
CREATE INDEX IF NOT EXISTS idx_assignments_user_status
  ON assignments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_assignments_target
  ON assignments(assignable_type, assignable_id);
CREATE INDEX IF NOT EXISTS idx_assignments_due
  ON assignments(due_at)
  WHERE status = 'active' AND due_at IS NOT NULL;

-- One-time backfill: seed the table from the legacy
-- candidates.assigned_recruiter_id column so existing data shows up
-- in My Assigned Work without a manual reassignment step.
INSERT INTO assignments (assignable_type, assignable_id, user_id, role, assigned_by, created_at)
SELECT 'candidate', c.id, c.assigned_recruiter_id, 'recruiter', c.assigned_recruiter_id, COALESCE(c.created_at, NOW())
  FROM candidates c
 WHERE c.assigned_recruiter_id IS NOT NULL
ON CONFLICT (assignable_type, assignable_id, user_id, role) DO NOTHING;
