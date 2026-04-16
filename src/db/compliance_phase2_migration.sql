-- ============================================================
-- Compliance Phase 2 Migration
-- Exams, Checklists, Bundles, Certificates
-- ============================================================

-- Exams
CREATE TABLE IF NOT EXISTS comp_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  instructions TEXT,
  passing_score INT DEFAULT 80,
  max_attempts INT DEFAULT 3,
  expiration_type VARCHAR(20) DEFAULT 'one_time' CHECK (expiration_type IN ('one_time','yearly','bi_annual')),
  time_limit_minutes INT,
  randomize_questions BOOLEAN DEFAULT true,
  question_count INT DEFAULT 10,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  cat1_id UUID REFERENCES comp_categories(id),
  cat2_id UUID REFERENCES comp_categories(id),
  cat3_id UUID REFERENCES comp_categories(id),
  applicable_roles TEXT[] DEFAULT '{}',
  outline_url TEXT,
  ceus NUMERIC(5,2) DEFAULT 0,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comp_exam_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES comp_exams(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type VARCHAR(20) DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice','true_false')),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comp_exam_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES comp_exam_questions(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL,
  is_correct BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comp_exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES comp_exams(id),
  competency_record_id UUID REFERENCES comp_competency_records(id),
  user_clerk_id VARCHAR(255) NOT NULL,
  attempt_number INT NOT NULL,
  status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress','passed','failed','timed_out')),
  score NUMERIC(5,2),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  time_taken_seconds INT
);

CREATE TABLE IF NOT EXISTS comp_exam_attempt_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES comp_exam_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES comp_exam_questions(id),
  selected_answer_id UUID REFERENCES comp_exam_answers(id),
  is_correct BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Checklists
CREATE TABLE IF NOT EXISTS comp_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  mode VARCHAR(20) DEFAULT 'skills' CHECK (mode IN ('skills','questionnaire')),
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  cat1_id UUID REFERENCES comp_categories(id),
  cat2_id UUID REFERENCES comp_categories(id),
  cat3_id UUID REFERENCES comp_categories(id),
  applicable_roles TEXT[] DEFAULT '{}',
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comp_checklist_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES comp_checklists(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comp_checklist_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES comp_checklist_sections(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  description TEXT,
  exclude_from_score BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comp_checklist_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES comp_checklists(id),
  competency_record_id UUID REFERENCES comp_competency_records(id),
  user_clerk_id VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted')),
  submitted_at TIMESTAMPTZ,
  overall_score NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comp_checklist_skill_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES comp_checklist_submissions(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES comp_checklist_skills(id),
  rating INT CHECK (rating BETWEEN 1 AND 4),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bundles
CREATE TABLE IF NOT EXISTS comp_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  sequential BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  cat1_id UUID REFERENCES comp_categories(id),
  cat2_id UUID REFERENCES comp_categories(id),
  cat3_id UUID REFERENCES comp_categories(id),
  applicable_roles TEXT[] DEFAULT '{}',
  facility_id UUID REFERENCES facilities(id) ON DELETE SET NULL,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comp_bundle_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL REFERENCES comp_bundles(id) ON DELETE CASCADE,
  item_type VARCHAR(50) NOT NULL CHECK (item_type IN ('policy','document','exam','checklist')),
  item_id UUID NOT NULL,
  item_title VARCHAR(500) NOT NULL,
  sort_order INT DEFAULT 0,
  required BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comp_assignment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL REFERENCES comp_bundles(id) ON DELETE CASCADE,
  rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('role','specialty','role_specialty','onboarding_stage')),
  role VARCHAR(100),
  specialty VARCHAR(200),
  onboarding_stage VARCHAR(100),
  priority INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Certificates
CREATE TABLE IF NOT EXISTS comp_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_record_id UUID NOT NULL REFERENCES comp_competency_records(id),
  user_clerk_id VARCHAR(255) NOT NULL,
  exam_id UUID REFERENCES comp_exams(id),
  title VARCHAR(500) NOT NULL,
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  certificate_number VARCHAR(100) DEFAULT ('CERT-' || upper(substring(gen_random_uuid()::text, 1, 8)))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_comp_exam_attempts_user ON comp_exam_attempts(user_clerk_id);
CREATE INDEX IF NOT EXISTS idx_comp_exam_attempts_exam ON comp_exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_comp_checklist_submissions_user ON comp_checklist_submissions(user_clerk_id);
CREATE INDEX IF NOT EXISTS idx_comp_bundle_items_bundle ON comp_bundle_items(bundle_id);
CREATE INDEX IF NOT EXISTS idx_comp_assignment_rules_bundle ON comp_assignment_rules(bundle_id);
