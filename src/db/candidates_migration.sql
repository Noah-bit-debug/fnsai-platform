-- Candidates Migration
-- Run this against your Railway PostgreSQL database

-- Update users role constraint to support new roles
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('ceo','manager','hr','recruiter','admin','coordinator','viewer'));

-- Candidates (hiring pipeline)
CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  role TEXT CHECK (role IN ('RN','LPN','LVN','CNA','RT','NP','PA','Other')),
  specialties TEXT[] DEFAULT '{}',
  skills TEXT[] DEFAULT '{}',
  certifications TEXT[] DEFAULT '{}',
  licenses TEXT[] DEFAULT '{}',
  years_experience INT,
  education TEXT,
  resume_url TEXT,
  parsed_resume JSONB,
  stage TEXT DEFAULT 'application' CHECK (stage IN ('application','interview','credentialing','onboarding','placed','rejected','withdrawn')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','placed','rejected','withdrawn')),
  assigned_recruiter_id UUID REFERENCES users(id),
  target_facility_id UUID REFERENCES facilities(id),
  desired_pay_rate DECIMAL(10,2),
  offered_pay_rate DECIMAL(10,2),
  availability_start DATE,
  availability_type TEXT CHECK (availability_type IN ('full_time','part_time','per_diem','contract')),
  available_shifts TEXT[] DEFAULT '{}',
  recruiter_notes TEXT,
  hr_notes TEXT,
  source TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Candidate stage history
CREATE TABLE IF NOT EXISTS candidate_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  moved_by UUID REFERENCES users(id),
  moved_by_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Candidate documents (credentialing checklist)
CREATE TABLE IF NOT EXISTS candidate_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT DEFAULT 'missing' CHECK (status IN ('missing','pending','received','approved','rejected','expired')),
  file_url TEXT,
  expiry_date DATE,
  notes TEXT,
  required BOOLEAN DEFAULT true,
  uploaded_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reusable document checklist templates
CREATE TABLE IF NOT EXISTS candidate_document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  documents JSONB DEFAULT '[]',
  is_default BOOLEAN DEFAULT false,
  facility_id UUID REFERENCES facilities(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reminders (email + SMS automation)
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('email','sms','both')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('missing_document','incomplete_onboarding','pending_application','credential_expiry','manual')),
  candidate_id UUID REFERENCES candidates(id),
  staff_id UUID REFERENCES staff(id),
  recipient_email TEXT,
  recipient_phone TEXT,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','completed','overdue','failed','cancelled')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Onboarding forms (W-4, I-9, direct deposit, etc.)
CREATE TABLE IF NOT EXISTS onboarding_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id),
  staff_id UUID REFERENCES staff(id),
  form_type TEXT NOT NULL CHECK (form_type IN ('w4','i9','direct_deposit','emergency_contact','hipaa','handbook','other')),
  status TEXT DEFAULT 'not_sent' CHECK (status IN ('not_sent','sent','opened','completed','expired')),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  reminder_count INT DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,
  form_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_candidates_stage ON candidates(stage);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_recruiter ON candidates(assigned_recruiter_id);
CREATE INDEX IF NOT EXISTS idx_candidate_stage_history_candidate ON candidate_stage_history(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_documents_candidate ON candidate_documents(candidate_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_candidate ON reminders(candidate_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_forms_candidate ON onboarding_forms(candidate_id);
