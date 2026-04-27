-- Email Monitor — scope email_logs rows to the mailbox they were
-- scanned from.
--
-- The previous shape stored every scanned email in one shared bucket.
-- That works when only one mailbox is monitored (the
-- MICROSOFT_USER_ID env var), but the routes now resolve the mailbox
-- from the authenticated user's email — so two users hitting "Scan
-- Now" would mix their inboxes on the list view.
--
-- Adding a `mailbox` column lets the GET / endpoint filter by the
-- caller's own mailbox so each user sees only their own emails.
-- Existing rows without a mailbox value stay (NULL) — they're shown
-- only when the filter is intentionally relaxed.
--
-- Idempotent. Safe to re-run.

ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS mailbox TEXT;

CREATE INDEX IF NOT EXISTS idx_email_logs_mailbox_received
  ON email_logs(mailbox, received_at DESC);
