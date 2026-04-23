-- Phase 4.4 — Workforce + BD expansion
--
-- Adds six feature areas in one migration so they land together:
--   Workforce:  scheduling (shifts), PTO (requests + balances)
--               (Timekeeping reuses the existing `timesheets` table.)
--   BD:         contracts (+ versions), RFPs (+ ingestion), revenue
--               forecasting computes from bd_bids — no new table needed.
--
-- Design choices:
--   * Shifts and PTO live at the staff+facility level. A shift has one
--     staff and one facility; PTO requests are staff-scoped.
--   * Contracts can optionally link to a facility and/or the winning bid.
--     Versions are stored as separate rows so the contract record keeps
--     its identity while the file + changes summary history grows.
--   * RFPs are inbox-style records with parsed_text + AI summary; once
--     the BD team drafts a bid from one, `bid_id` back-links the two.

-- ─── Workforce: shifts (scheduling) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  facility_id UUID REFERENCES facilities(id) ON DELETE SET NULL,
  -- The role for this specific shift (one staff may cover multiple roles
  -- over time — for a travel nurse covering an LVN gap, say). Copied
  -- from staff.role at creation but editable per shift.
  role VARCHAR(50),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  hourly_rate NUMERIC(6,2),
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','confirmed','completed','cancelled','no_show')),
  notes TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_shifts_staff    ON work_shifts(staff_id, start_time);
CREATE INDEX IF NOT EXISTS idx_work_shifts_facility ON work_shifts(facility_id, start_time);
CREATE INDEX IF NOT EXISTS idx_work_shifts_start    ON work_shifts(start_time);
CREATE INDEX IF NOT EXISTS idx_work_shifts_status   ON work_shifts(status);

-- ─── Workforce: PTO (balances + requests) ─────────────────────────────────

-- One row per staff member. Updated when admin grants hours, when a PTO
-- request is approved (deducts), or on scheduled accrual (not implemented
-- in this phase — admin can manually adjust balances).
CREATE TABLE IF NOT EXISTS pto_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
  vacation_hours NUMERIC(7,2) NOT NULL DEFAULT 0,
  sick_hours     NUMERIC(7,2) NOT NULL DEFAULT 0,
  personal_hours NUMERIC(7,2) NOT NULL DEFAULT 0,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pto_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL
    CHECK (type IN ('vacation','sick','personal','unpaid')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  -- Total hours requested. Half-days supported via decimal (e.g. 4.00).
  hours NUMERIC(7,2) NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','denied','cancelled')),
  approved_by VARCHAR(255),
  approved_at TIMESTAMPTZ,
  denial_reason TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pto_requests_staff  ON pto_requests(staff_id, start_date);
CREATE INDEX IF NOT EXISTS idx_pto_requests_status ON pto_requests(status);

-- ─── BD: contracts (+ versions) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bd_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  client_name VARCHAR(200),
  facility_id UUID REFERENCES facilities(id) ON DELETE SET NULL,
  -- Once a bid is won, the resulting contract points back to the bid.
  bid_id UUID REFERENCES bd_bids(id) ON DELETE SET NULL,
  -- Mirrors the latest bd_contract_versions.version for quick reads.
  current_version INT NOT NULL DEFAULT 1,
  effective_date DATE,
  expiration_date DATE,
  total_value NUMERIC(12,2),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','expired','terminated')),
  -- AI-generated plain-English summary of key terms, updated whenever a
  -- new version is uploaded. Null until the AI runs.
  terms_summary TEXT,
  notes TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_contracts_status     ON bd_contracts(status);
CREATE INDEX IF NOT EXISTS idx_bd_contracts_expiration ON bd_contracts(expiration_date);
CREATE INDEX IF NOT EXISTS idx_bd_contracts_facility   ON bd_contracts(facility_id);
CREATE INDEX IF NOT EXISTS idx_bd_contracts_bid        ON bd_contracts(bid_id);

CREATE TABLE IF NOT EXISTS bd_contract_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES bd_contracts(id) ON DELETE CASCADE,
  version INT NOT NULL,
  file_path VARCHAR(500),
  file_name VARCHAR(300),
  -- Free-text admin note about what changed in this version. Prefixed
  -- by the AI with a short generated diff-ish summary where available.
  changes_summary TEXT,
  uploaded_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (contract_id, version)
);
CREATE INDEX IF NOT EXISTS idx_bd_contract_versions_contract ON bd_contract_versions(contract_id, version);

-- ─── BD: RFPs (inbox + ingestion) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bd_rfps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(300),
  client_name VARCHAR(200),
  file_path VARCHAR(500),
  file_name VARCHAR(300),
  -- Raw text extracted from the PDF/DOCX at upload time.
  parsed_text TEXT,
  -- AI-generated 2-5 sentence summary of the RFP (scope, deadlines, key reqs).
  parsed_summary TEXT,
  due_date DATE,
  -- Once the BD team drafts a bid from this RFP, backlink here.
  bid_id UUID REFERENCES bd_bids(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','reviewed','drafted','declined','expired')),
  received_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_rfps_status       ON bd_rfps(status);
CREATE INDEX IF NOT EXISTS idx_bd_rfps_due_date     ON bd_rfps(due_date);
CREATE INDEX IF NOT EXISTS idx_bd_rfps_received_at  ON bd_rfps(received_at DESC);

-- No revenue_forecasts table — projections compute from bd_bids in the
-- route handler so they stay fresh without a recomputation job.

-- ─── Phase 4.4 QA fix — allow NULL facility_id on timesheets ──────────────
--
-- The Timekeeping page's facility dropdown was effectively blocking
-- submissions during QA (empty for users whose facilities haven't been
-- wired up yet, or when a timesheet genuinely isn't facility-bound like
-- orientation hours). Relaxing the NOT NULL matches the pattern in
-- Incidents (facility optional) and Scheduling (facility optional).
-- Idempotent — no-op if already nullable.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'timesheets' AND column_name = 'facility_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE timesheets ALTER COLUMN facility_id DROP NOT NULL;
  END IF;
END $$;
