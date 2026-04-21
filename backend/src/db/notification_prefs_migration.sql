-- Per-user notification preferences. One row per Clerk user.
-- Keyed by clerk_user_id (not the internal users.id UUID) so a user who
-- signs up before the internal row is created can still save preferences.
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS notification_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE NOT NULL,

  -- Channel enables. All default TRUE so "no setting" == "reasonable default".
  email_enabled      BOOLEAN DEFAULT TRUE,
  sms_enabled        BOOLEAN DEFAULT TRUE,
  inapp_enabled      BOOLEAN DEFAULT TRUE,

  -- Category granularity — user can opt out of a specific kind of notification
  -- even if the channel overall is enabled.
  notify_credential_expiry    BOOLEAN DEFAULT TRUE,
  notify_missing_document     BOOLEAN DEFAULT TRUE,
  notify_compliance_assign    BOOLEAN DEFAULT TRUE,
  notify_placement_change     BOOLEAN DEFAULT TRUE,
  notify_task_reminder        BOOLEAN DEFAULT TRUE,
  notify_submission_update    BOOLEAN DEFAULT TRUE,
  notify_sms_approval         BOOLEAN DEFAULT TRUE,
  notify_system_announcement  BOOLEAN DEFAULT TRUE,

  -- Digest schedule: 'off', 'daily', 'weekly'. Affects summary emails, not
  -- time-sensitive alerts which always fire if the channel is on.
  digest_schedule TEXT DEFAULT 'daily' CHECK (digest_schedule IN ('off','daily','weekly')),
  digest_time_of_day TIME DEFAULT '08:00',

  -- Quiet hours — if set, non-urgent notifications are deferred until after
  -- quiet_end. Urgent items (compliance expiry, critical incidents) still fire.
  quiet_hours_enabled BOOLEAN DEFAULT FALSE,
  quiet_start TIME DEFAULT '22:00',
  quiet_end   TIME DEFAULT '07:00',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_prefs_clerk ON notification_prefs(clerk_user_id);
