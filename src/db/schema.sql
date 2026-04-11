-- SentrixAI Database Schema
-- PostgreSQL 15+

-- Users (synced from Clerk)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'coordinator' CHECK (role IN ('admin','coordinator','viewer')),
  mfa_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staff (healthcare professionals)
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT CHECK (role IN ('RN','LPN','LVN','CNA','RT','NP','PA','Other')),
  specialty TEXT,
  status TEXT DEFAULT 'onboarding' CHECK (status IN ('active','available','onboarding','inactive','terminated')),
  facility_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Facilities (clients)
CREATE TABLE IF NOT EXISTS facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT,
  address TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contract_status TEXT DEFAULT 'active' CHECK (contract_status IN ('active','renewing','expired','pending')),
  special_requirements JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Credentials
CREATE TABLE IF NOT EXISTS credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  issuer TEXT,
  issue_date DATE,
  expiry_date DATE,
  status TEXT DEFAULT 'valid' CHECK (status IN ('valid','expiring','expiring_soon','expired','pending','missing')),
  document_url TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Placements
CREATE TABLE IF NOT EXISTS placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES staff(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  role TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('active','pending','unfilled','completed','cancelled')),
  contract_status TEXT DEFAULT 'not_sent' CHECK (contract_status IN ('not_sent','pending_esign','signed','expired')),
  foxit_envelope_id TEXT,
  hourly_rate DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Onboarding checklists
CREATE TABLE IF NOT EXISTS onboarding_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  category TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','missing')),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Custom checklist templates
CREATE TABLE IF NOT EXISTS checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  facility_id UUID REFERENCES facilities(id),
  items JSONB DEFAULT '[]',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES staff(id),
  facility_id UUID REFERENCES facilities(id),
  placement_id UUID REFERENCES placements(id),
  name TEXT NOT NULL,
  type TEXT,
  file_url TEXT,
  sharepoint_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','checking','passed','issues_found','rejected')),
  ai_review_result JSONB,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document QA (AI asks questions about uncertain fields)
CREATE TABLE IF NOT EXISTS document_qa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id),
  document_type TEXT,
  question TEXT NOT NULL,
  context TEXT,
  answer TEXT,
  answer_scope TEXT CHECK (answer_scope IN ('always','facility_specific','staff_type','optional','one_time')),
  answered_by UUID REFERENCES users(id),
  answered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Rules (learned from QA + 3-strike corrections)
CREATE TABLE IF NOT EXISTS ai_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_text TEXT NOT NULL,
  scope TEXT,
  facility_id UUID REFERENCES facilities(id),
  staff_role TEXT,
  source TEXT CHECK (source IN ('document_qa','three_strike','manual','setup_wizard')),
  correction_count INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Three-strike corrections
CREATE TABLE IF NOT EXISTS ai_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES ai_rules(id),
  correction_text TEXT NOT NULL,
  corrected_by UUID REFERENCES users(id),
  is_exception BOOLEAN DEFAULT false,
  exception_details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Incidents
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES staff(id),
  facility_id UUID REFERENCES facilities(id),
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','under_review','resolved','closed')),
  workers_comp_claim BOOLEAN DEFAULT false,
  filed_by UUID REFERENCES users(id),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Timesheets
CREATE TABLE IF NOT EXISTS timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  placement_id UUID REFERENCES placements(id),
  week_start DATE NOT NULL,
  hours_worked DECIMAL(5,2),
  submitted_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','verified','disputed','approved')),
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insurance policies
CREATE TABLE IF NOT EXISTS insurance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('workers_comp','professional_liability','epli','general_liability','other')),
  provider TEXT,
  policy_number TEXT,
  annual_premium DECIMAL(10,2),
  coverage_limit TEXT,
  status TEXT DEFAULT 'quote_needed' CHECK (status IN ('quote_needed','quote_received','applied','active','expired')),
  renewal_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS approvals (ClerkChat)
CREATE TABLE IF NOT EXISTS sms_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired','escalated')),
  reference_id UUID,
  reference_type TEXT,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  followup_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email scan log
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlook_message_id TEXT UNIQUE,
  from_address TEXT,
  from_name TEXT,
  subject TEXT,
  received_at TIMESTAMPTZ,
  ai_category TEXT CHECK (ai_category IN ('urgent','important','low','spam')),
  ai_summary TEXT,
  action_required BOOLEAN DEFAULT false,
  actioned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log (all actions)
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  actor TEXT,
  action TEXT NOT NULL,
  subject TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Company settings (setup wizard output)
CREATE TABLE IF NOT EXISTS company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI knowledge base entries
CREATE TABLE IF NOT EXISTS knowledge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  source TEXT CHECK (source IN ('sharepoint','outlook','manual','document_qa','correction','website','training_video')),
  source_url TEXT,
  facility_id UUID REFERENCES facilities(id),
  tags TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(status);
CREATE INDEX IF NOT EXISTS idx_credentials_expiry ON credentials(expiry_date);
CREATE INDEX IF NOT EXISTS idx_placements_facility ON placements(facility_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_received ON email_logs(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_staff ON documents(staff_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_staff ON onboarding_items(staff_id);
CREATE INDEX IF NOT EXISTS idx_credentials_staff ON credentials(staff_id);
CREATE INDEX IF NOT EXISTS idx_sms_approvals_status ON sms_approvals(status);
CREATE INDEX IF NOT EXISTS idx_ai_rules_active ON ai_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_active ON knowledge_items(is_active);
