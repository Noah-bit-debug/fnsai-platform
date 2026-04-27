-- Phase 9 / Phase 2 — extend reminders for the candidate-schedule
-- timeline + AI-assisted drafting work.
--
-- New columns:
--   assigned_to_user_id  — who should action / follow up on this reminder.
--                          Joins via /api/v1/assignments isn't sufficient
--                          here because the reminder owner is a 1:1
--                          property, not a multi-role assignment.
--   category             — finer-grained than trigger_type. Used by the
--                          schedule timeline for grouping/icons.
--   tone                 — which tone the AI used when drafting (so the
--                          UI can display + offer a "regenerate with
--                          different tone" action).
--   provider_message_id  — ClerkChat message id once successfully sent.
--   error                — last send error message, when status='failed'.
--
-- Idempotent. ADD COLUMN IF NOT EXISTS makes this safe to re-run.

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS tone TEXT;

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS error TEXT;

-- Index on assigned_to so "my reminders" queries on the assignments
-- page (or my-work view) stay fast.
CREATE INDEX IF NOT EXISTS idx_reminders_assigned_to
  ON reminders(assigned_to_user_id, status)
  WHERE status IN ('scheduled', 'overdue');

-- Index on (candidate_id, scheduled_at) for the per-candidate timeline.
CREATE INDEX IF NOT EXISTS idx_reminders_candidate_schedule
  ON reminders(candidate_id, scheduled_at)
  WHERE candidate_id IS NOT NULL;
