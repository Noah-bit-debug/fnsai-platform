-- Phase 4.3 — Business Development core entities (leads / contacts / follow-ups)
--
-- The BusinessDev.tsx page has existed for a while but persisted its data
-- only to localStorage, which means:
--   * Data disappeared on logout / clear-cache / device-change
--   * Was never visible to teammates
--   * Could never feed into reports or the AI Brain
--
-- The Phase 4 notes don't ask for a rewrite of this page, but the overall
-- rules say "Use real data and real workflows" — localStorage isn't real
-- data. This migration moves the existing three tabs onto Postgres
-- without changing the UI's mental model (one row per lead, one per
-- contact, one per follow-up). The frontend keeps its types; only the
-- persistence layer changes.
--
-- Column shapes mirror the frontend types in BusinessDev.tsx so the
-- migration from localStorage → API is a 1:1 field rename.

CREATE TABLE IF NOT EXISTS bd_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company VARCHAR(200) NOT NULL,
  contact_name VARCHAR(200),
  phone VARCHAR(50),
  email VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'prospect'
    CHECK (status IN ('prospect','qualified','proposal','negotiating','closed','lost')),
  source VARCHAR(20) NOT NULL DEFAULT 'cold_call'
    CHECK (source IN ('cold_call','referral','website','linkedin','event')),
  last_contact DATE,
  next_follow_up DATE,
  notes TEXT,
  created_by VARCHAR(255),                                   -- clerk_user_id
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_leads_status         ON bd_leads(status);
CREATE INDEX IF NOT EXISTS idx_bd_leads_next_followup  ON bd_leads(next_follow_up);
CREATE INDEX IF NOT EXISTS idx_bd_leads_created_by     ON bd_leads(created_by);

CREATE TABLE IF NOT EXISTS bd_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  title VARCHAR(200),
  company VARCHAR(200),
  email VARCHAR(200),
  phone VARCHAR(50),
  last_contact DATE,
  notes TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_contacts_company    ON bd_contacts(company);
CREATE INDEX IF NOT EXISTS idx_bd_contacts_created_by ON bd_contacts(created_by);

CREATE TABLE IF NOT EXISTS bd_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_contact VARCHAR(300) NOT NULL,                     -- "Company / Contact Name"
  follow_up_date DATE NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'call'
    CHECK (type IN ('call','email','meeting')),
  priority VARCHAR(10) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('high','medium','low')),
  status VARCHAR(10) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','done')),
  notes TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_followups_date     ON bd_followups(follow_up_date);
CREATE INDEX IF NOT EXISTS idx_bd_followups_status   ON bd_followups(status);
CREATE INDEX IF NOT EXISTS idx_bd_followups_priority ON bd_followups(priority);
