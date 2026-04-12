CREATE TABLE IF NOT EXISTS tracking_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  clerk_user_id VARCHAR(255) NOT NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  scheduled_window_start TIME,
  scheduled_window_end TIME,
  total_duration_seconds INTEGER DEFAULT 0,
  active_duration_seconds INTEGER DEFAULT 0,
  idle_duration_seconds INTEGER DEFAULT 0,
  break_duration_seconds INTEGER DEFAULT 0,
  adjusted_work_duration_seconds INTEGER DEFAULT 0,
  tracking_mode VARCHAR(30) DEFAULT 'scheduled',
  browser_type VARCHAR(50),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracking_activity_logs (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  clerk_user_id VARCHAR(255) NOT NULL,
  timestamp_start TIMESTAMPTZ NOT NULL,
  timestamp_end TIMESTAMPTZ,
  domain VARCHAR(255),
  page_title VARCHAR(500),
  activity_type VARCHAR(30) NOT NULL DEFAULT 'active',
  domain_classification VARCHAR(30) DEFAULT 'unknown',
  was_idle BOOLEAN DEFAULT false,
  was_break BOOLEAN DEFAULT false,
  was_manual_override BOOLEAN DEFAULT false,
  source_extension VARCHAR(50) DEFAULT 'chrome',
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracking_idle_events (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  clerk_user_id VARCHAR(255) NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idle_duration_seconds INTEGER NOT NULL DEFAULT 0,
  user_response VARCHAR(30) DEFAULT 'pending',
  was_deducted BOOLEAN DEFAULT false,
  manager_review_status VARCHAR(20) DEFAULT 'none',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracking_break_events (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  clerk_user_id VARCHAR(255) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_seconds INTEGER,
  source VARCHAR(30) DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracking_policies (
  id SERIAL PRIMARY KEY,
  scope_type VARCHAR(20) DEFAULT 'global',
  scope_id VARCHAR(255),
  tracking_mode VARCHAR(30) DEFAULT 'scheduled',
  scheduled_start TIME DEFAULT '08:00',
  scheduled_end TIME DEFAULT '17:00',
  idle_threshold_minutes INTEGER DEFAULT 5,
  auto_deduct_idle BOOLEAN DEFAULT false,
  notify_on_idle BOOLEAN DEFAULT true,
  require_review_for_exceptions BOOLEAN DEFAULT true,
  title_tracking_enabled BOOLEAN DEFAULT false,
  approved_domains JSONB DEFAULT '[]',
  excluded_domains JSONB DEFAULT '[]',
  allow_manual_override BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracking_domain_classifications (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL UNIQUE,
  classification VARCHAR(30) NOT NULL DEFAULT 'unknown',
  label VARCHAR(100),
  ai_suggested BOOLEAN DEFAULT false,
  admin_approved BOOLEAN DEFAULT false,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default global policy
INSERT INTO tracking_policies (scope_type, scope_id, tracking_mode, scheduled_start, scheduled_end)
VALUES ('global', 'default', 'scheduled', '08:00', '17:00')
ON CONFLICT DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_clerk_date ON tracking_sessions(clerk_user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_tracking_activity_session ON tracking_activity_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_tracking_idle_session ON tracking_idle_events(session_id);
CREATE INDEX IF NOT EXISTS idx_domain_classifications_domain ON tracking_domain_classifications(domain);
