-- Placement readiness tracking
CREATE TABLE IF NOT EXISTS comp_placement_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  is_ready BOOLEAN DEFAULT false,
  readiness_score INT DEFAULT 0,
  blocking_issues JSONB DEFAULT '[]',
  last_evaluated TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_readiness_staff ON comp_placement_readiness(staff_id) WHERE staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_readiness_candidate ON comp_placement_readiness(candidate_id) WHERE candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_readiness_ready ON comp_placement_readiness(is_ready);

-- In-platform direct messages
CREATE TABLE IF NOT EXISTS comp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_clerk_id VARCHAR(255) NOT NULL,
  recipient_clerk_id VARCHAR(255) NOT NULL,
  subject VARCHAR(500),
  body TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'general'
    CHECK (message_type IN ('general','compliance_reminder','assignment','system')),
  related_competency_record_id UUID REFERENCES comp_competency_records(id) ON DELETE SET NULL,
  parent_message_id UUID REFERENCES comp_messages(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ,
  archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comp_messages_recipient ON comp_messages(recipient_clerk_id);
CREATE INDEX IF NOT EXISTS idx_comp_messages_sender ON comp_messages(sender_clerk_id);
CREATE INDEX IF NOT EXISTS idx_comp_messages_created ON comp_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comp_messages_unread ON comp_messages(recipient_clerk_id, read_at) WHERE read_at IS NULL;
