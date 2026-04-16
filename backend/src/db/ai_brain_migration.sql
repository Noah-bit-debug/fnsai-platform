-- AI Brain enhanced tables
CREATE TABLE IF NOT EXISTS ai_brain_clarifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  context TEXT,
  source_type VARCHAR(50) DEFAULT 'general',
  status VARCHAR(20) DEFAULT 'pending',
  answer TEXT,
  answered_by_clerk_id VARCHAR(255),
  answered_at TIMESTAMPTZ,
  approved_as_rule BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_brain_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_clerk_id VARCHAR(255),
  action_type VARCHAR(100) NOT NULL,
  source VARCHAR(100),
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_brain_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_clerk_id VARCHAR(255),
  original_filename VARCHAR(500),
  destination_path VARCHAR(1000),
  onedrive_item_id VARCHAR(500),
  onedrive_web_url TEXT,
  file_size BIGINT,
  mime_type VARCHAR(100),
  routing_confidence VARCHAR(20) DEFAULT 'low',
  routing_reason TEXT,
  candidate_context VARCHAR(255),
  status VARCHAR(50) DEFAULT 'uploaded',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_brain_refresh_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type VARCHAR(100) NOT NULL,
  source_label VARCHAR(255),
  triggered_by_clerk_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'running',
  items_indexed INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

INSERT INTO ai_brain_clarifications (question, context, source_type, status)
VALUES
  ('Should BLS certification reminders start 30 days or 60 days before expiration for all clinician roles?', 'Needed to configure automated compliance reminder timing', 'policy', 'pending'),
  ('When a candidate file is uploaded without a name in the filename, should it go to a general Unassigned folder or prompt for candidate selection?', 'Needed for smart file routing logic', 'file_routing', 'pending')
ON CONFLICT DO NOTHING;
