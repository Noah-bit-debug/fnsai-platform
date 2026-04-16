-- Phase 3: Notifications, Job Log, and Notification Settings

CREATE TABLE IF NOT EXISTS comp_notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_clerk_id VARCHAR(255) NOT NULL,
  notification_type VARCHAR(100) NOT NULL,
  -- Types: welcome, new_assignment, reminder, due_soon, passed, failed, all_attempts_used, expiring_soon, expired, auto_renewed
  competency_record_id UUID REFERENCES comp_competency_records(id) ON DELETE SET NULL,
  subject VARCHAR(500),
  body TEXT,
  recipient_email VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comp_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comp_job_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  records_processed INT DEFAULT 0,
  records_affected INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Seed default notification settings
INSERT INTO comp_notification_settings (setting_key, setting_value)
VALUES
  ('notify_new_assignment', 'true'),
  ('notify_due_soon_days', '7'),
  ('notify_expiring_soon_days', '30'),
  ('notify_reminder_frequency_days', '3'),
  ('notify_passed', 'true'),
  ('notify_failed', 'true'),
  ('notify_all_attempts_used', 'true'),
  ('notify_expired', 'true'),
  ('auto_renew_yearly', 'true'),
  ('auto_renew_bi_annual', 'true'),
  ('sender_email', '')
ON CONFLICT (setting_key) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_comp_notifications_log_user_clerk_id ON comp_notifications_log(user_clerk_id);
CREATE INDEX IF NOT EXISTS idx_comp_notifications_log_status ON comp_notifications_log(status);
CREATE INDEX IF NOT EXISTS idx_comp_job_log_job_name ON comp_job_log(job_name);
