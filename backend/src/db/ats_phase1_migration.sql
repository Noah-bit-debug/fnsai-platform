-- ATS Phase 1 Migration
-- Foundation tables for the CEIPAL-inspired ATS upgrade:
-- Clients (parent of facilities), Jobs, Submissions, configurable
-- pipeline stages, recruiter tasks, saved candidate views.
-- All statements are idempotent (IF NOT EXISTS / ALTER ADD IF NOT EXISTS).

-- ─── 1. Clients (parent organization / client company) ──────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  website TEXT,
  business_unit TEXT,
  offerings TEXT[] DEFAULT '{}',
  submission_format TEXT,          -- e.g. 'pdf_packet', 'email_attachment', 'portal'
  submission_format_notes TEXT,
  primary_contact_name TEXT,
  primary_contact_email TEXT,
  primary_contact_phone TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','prospect','churned')),
  notes TEXT,
  created_by VARCHAR(255),         -- clerk_user_id, matches compliance pattern
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(LOWER(name));

-- ─── 2. Facilities gains a nullable client_id ──────────────────────────────
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_facilities_client ON facilities(client_id);

-- ─── 3. Client contacts (multiple contacts per client, optionally per facility)
CREATE TABLE IF NOT EXISTS client_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  facility_id UUID REFERENCES facilities(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_contacts_client ON client_contacts(client_id);
CREATE INDEX IF NOT EXISTS idx_client_contacts_facility ON client_contacts(facility_id);

-- ─── 4. Client requirement templates (submission / onboarding) ─────────────
-- Hybrid per plan: reference a compliance bundle AND/OR add ad-hoc items.
CREATE TABLE IF NOT EXISTS client_requirement_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('submission','onboarding')),
  bundle_id UUID REFERENCES comp_bundles(id) ON DELETE SET NULL,
  -- ad_hoc shape: [{type:'doc'|'cert'|'license'|'skill', label, required, notes}]
  ad_hoc JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_req_templates_client ON client_requirement_templates(client_id);

-- ─── 5. Configurable pipeline stages (per-tenant) ──────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT DEFAULT 'default',
  key TEXT NOT NULL,                 -- stable slug
  label TEXT NOT NULL,
  sort_order INT NOT NULL,
  color TEXT,                        -- CSS color hint for Kanban
  is_terminal BOOLEAN DEFAULT FALSE, -- Placed / Rejected / Withdrawn / Not Joined
  stale_after_days INT,              -- warning threshold (NULL = no warning)
  active BOOLEAN DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, key)
);

-- Seed the 12 spec stages (idempotent via UNIQUE constraint + DO NOTHING).
INSERT INTO pipeline_stages (tenant_id, key, label, sort_order, color, is_terminal, stale_after_days)
VALUES
  ('default','new_lead','New Lead',1,'#6b7280',FALSE,NULL),
  ('default','screening','Screening',2,'#3b82f6',FALSE,3),
  ('default','internal_review','Internal Review',3,'#6366f1',FALSE,2),
  ('default','submitted','Submitted',4,'#8b5cf6',FALSE,5),
  ('default','client_submitted','Client Submitted',5,'#a855f7',FALSE,7),
  ('default','interview','Interview',6,'#ec4899',FALSE,3),
  ('default','offer','Offer',7,'#f59e0b',FALSE,2),
  ('default','confirmed','Confirmed',8,'#10b981',FALSE,5),
  ('default','placed','Placed',9,'#059669',TRUE,NULL),
  ('default','not_joined','Not Joined',10,'#ef4444',TRUE,NULL),
  ('default','rejected','Rejected',11,'#dc2626',TRUE,NULL),
  ('default','withdrawn','Withdrawn',12,'#9ca3af',TRUE,NULL)
ON CONFLICT (tenant_id, key) DO NOTHING;

-- Map old candidates.stage values → new keys. Existing values are text slugs
-- so this is a safe UPDATE; no enum to migrate.
UPDATE candidates SET stage = 'new_lead'        WHERE stage = 'application';
UPDATE candidates SET stage = 'internal_review' WHERE stage = 'credentialing';
UPDATE candidates SET stage = 'confirmed'       WHERE stage = 'onboarding';
-- 'interview', 'placed', 'rejected', 'withdrawn' already match new keys.

-- ─── 6. Jobs (requisitions) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_code TEXT UNIQUE,              -- e.g. "J-2026-0417"
  title TEXT NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  facility_id UUID REFERENCES facilities(id) ON DELETE SET NULL,
  client_job_id TEXT,                -- client's own tracking id
  profession TEXT,                   -- RN, LPN, LVN, CNA, RT, NP, PA, Other
  specialty TEXT,
  sub_specialty TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  lat DOUBLE PRECISION,              -- for radius search
  lng DOUBLE PRECISION,
  start_date DATE,
  end_date DATE,
  duration_weeks INT,
  job_type TEXT,                     -- travel, per_diem, contract, perm, local
  shift TEXT,                        -- days, nights, rotating, pm, noc
  hours_per_week INT,
  remote BOOLEAN DEFAULT FALSE,
  positions INT DEFAULT 1,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  primary_recruiter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  account_manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recruitment_manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  bill_rate NUMERIC(10,2),
  pay_rate NUMERIC(10,2),
  margin NUMERIC(10,2),
  stipend NUMERIC(10,2),
  description TEXT,
  summary TEXT,                      -- AI-generated short summary
  job_ad TEXT,                       -- AI-generated outbound ad
  boolean_search TEXT,               -- AI-generated boolean string
  status TEXT DEFAULT 'open' CHECK (status IN ('draft','open','on_hold','filled','closed','cancelled')),
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_facility ON jobs(facility_id);
CREATE INDEX IF NOT EXISTS idx_jobs_profession ON jobs(profession);
CREATE INDEX IF NOT EXISTS idx_jobs_recruiter ON jobs(primary_recruiter_id);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority);
CREATE INDEX IF NOT EXISTS idx_jobs_job_code ON jobs(job_code);

-- ─── 7. Job requirements (hybrid: bundle + ad-hoc) ─────────────────────────
CREATE TABLE IF NOT EXISTS job_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('submission','onboarding')),
  bundle_id UUID REFERENCES comp_bundles(id) ON DELETE SET NULL,
  -- ad_hoc: [{type:'doc'|'cert'|'license'|'skill', label, required, notes}]
  ad_hoc JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_requirements_job ON job_requirements(job_id);
CREATE INDEX IF NOT EXISTS idx_job_requirements_bundle ON job_requirements(bundle_id);

-- ─── 8. Submissions (candidate → job packaging) ────────────────────────────
CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  recruiter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  stage_key TEXT,                    -- references pipeline_stages.key (soft FK)
  candidate_summary TEXT,
  skill_ratings JSONB DEFAULT '[]',  -- [{skill, rating:1-5, notes}]
  bill_rate NUMERIC(10,2),
  pay_rate NUMERIC(10,2),
  stipend NUMERIC(10,2),
  expenses NUMERIC(10,2),
  margin NUMERIC(10,2),
  pdf_url TEXT,                      -- generated submission PDF
  ai_score NUMERIC(5,2),             -- 0-100
  ai_score_breakdown JSONB,          -- {title, skills, certifications, experience, education, location}
  ai_fit_label TEXT,                 -- e.g. 'excellent', 'strong', 'moderate', 'weak'
  ai_summary TEXT,
  ai_gaps JSONB DEFAULT '[]',        -- [{category, gap, severity}]
  gate_status TEXT CHECK (gate_status IN ('ok','missing','pending','unknown')),
  gate_missing JSONB DEFAULT '[]',   -- [{source:'bundle'|'ad_hoc', label, kind}]
  interview_scheduled_at TIMESTAMPTZ,
  interview_notes TEXT,
  references_data JSONB DEFAULT '[]',
  notes TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (candidate_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_submissions_candidate ON submissions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_submissions_job ON submissions(job_id);
CREATE INDEX IF NOT EXISTS idx_submissions_recruiter ON submissions(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_submissions_stage ON submissions(stage_key);

-- ─── 9. Submission stage history (immutable audit) ─────────────────────────
CREATE TABLE IF NOT EXISTS submission_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_by_name TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_submission_stage_history_submission ON submission_stage_history(submission_id);
CREATE INDEX IF NOT EXISTS idx_submission_stage_history_created ON submission_stage_history(created_at);

-- ─── 10. Recruiter tasks (extends reminders concept) ───────────────────────
CREATE TABLE IF NOT EXISTS recruiter_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT CHECK (task_type IN ('call','meeting','todo','follow_up','email','sms','other')),
  due_at TIMESTAMPTZ,
  timezone TEXT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  escalate_to UUID REFERENCES users(id) ON DELETE SET NULL,
  reminder_minutes_before INT,
  recurrence TEXT,                   -- 'daily' | 'weekly' | 'monthly' | RRULE string
  notify_email BOOLEAN DEFAULT TRUE,
  notify_sms BOOLEAN DEFAULT FALSE,
  -- context linkage — any or all may be null
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','done','snoozed','cancelled')),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recruiter_tasks_assigned ON recruiter_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_recruiter_tasks_due ON recruiter_tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_recruiter_tasks_status ON recruiter_tasks(status);
CREATE INDEX IF NOT EXISTS idx_recruiter_tasks_candidate ON recruiter_tasks(candidate_id);
CREATE INDEX IF NOT EXISTS idx_recruiter_tasks_job ON recruiter_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_recruiter_tasks_submission ON recruiter_tasks(submission_id);
CREATE INDEX IF NOT EXISTS idx_recruiter_tasks_client ON recruiter_tasks(client_id);

-- ─── 11. Saved candidate views (filters per user) ──────────────────────────
CREATE TABLE IF NOT EXISTS candidate_saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  is_shared BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_candidate_saved_views_user ON candidate_saved_views(user_id);

-- ─── 12. Placements gains FKs to bridge ATS → workforce ────────────────────
ALTER TABLE placements ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE placements ADD COLUMN IF NOT EXISTS submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL;
ALTER TABLE placements ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE placements ADD COLUMN IF NOT EXISTS candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL;
ALTER TABLE placements ADD COLUMN IF NOT EXISTS placement_code TEXT;
CREATE INDEX IF NOT EXISTS idx_placements_job ON placements(job_id);
CREATE INDEX IF NOT EXISTS idx_placements_submission ON placements(submission_id);
CREATE INDEX IF NOT EXISTS idx_placements_client ON placements(client_id);
CREATE INDEX IF NOT EXISTS idx_placements_candidate ON placements(candidate_id);

-- ─── 13. Candidate duplicate-detection indexes ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_candidates_email_lower ON candidates(LOWER(email));
-- Normalize phone to digits-only for matching across format variations
CREATE INDEX IF NOT EXISTS idx_candidates_phone_digits ON candidates(REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', '', 'g'));
CREATE INDEX IF NOT EXISTS idx_candidates_name_lower ON candidates(LOWER(first_name), LOWER(last_name));
