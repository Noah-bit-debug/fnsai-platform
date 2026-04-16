-- =============================================================================
-- SentrixAI Compliance Phase 1 Migration
-- PostgreSQL 15+
-- Run: psql $DATABASE_URL -f compliance_phase1_migration.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CATEGORIES (3-level taxonomy)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comp_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level       INT NOT NULL CHECK (level IN (1,2,3)),
  name        VARCHAR(200) NOT NULL,
  parent_id   UUID REFERENCES comp_categories(id) ON DELETE CASCADE,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comp_categories_parent_id
  ON comp_categories(parent_id);

-- ---------------------------------------------------------------------------
-- 2. POLICIES (digital policy signing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comp_policies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title              VARCHAR(500) NOT NULL,
  content            TEXT NOT NULL,
  version            VARCHAR(50) DEFAULT '1.0',
  expiration_days    INT,
  require_signature  BOOLEAN DEFAULT true,
  status             VARCHAR(20) DEFAULT 'draft'
                       CHECK (status IN ('draft','published','archived')),
  cat1_id            UUID REFERENCES comp_categories(id),
  cat2_id            UUID REFERENCES comp_categories(id),
  cat3_id            UUID REFERENCES comp_categories(id),
  applicable_roles   TEXT[] DEFAULT '{}',
  created_by         VARCHAR(255),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. DOCUMENTS (read-acknowledgement tracking)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comp_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            VARCHAR(500) NOT NULL,
  description      TEXT,
  file_url         TEXT,
  file_name        VARCHAR(500),
  file_type        VARCHAR(100),
  expiration_days  INT,
  require_read_ack BOOLEAN DEFAULT true,
  status           VARCHAR(20) DEFAULT 'draft'
                     CHECK (status IN ('draft','published','archived')),
  cat1_id          UUID REFERENCES comp_categories(id),
  cat2_id          UUID REFERENCES comp_categories(id),
  cat3_id          UUID REFERENCES comp_categories(id),
  applicable_roles TEXT[] DEFAULT '{}',
  created_by       VARCHAR(255),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. COMPETENCY RECORDS (central per-user per-item record)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comp_competency_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_clerk_id     VARCHAR(255) NOT NULL,
  staff_id          UUID REFERENCES staff(id) ON DELETE SET NULL,
  candidate_id      UUID REFERENCES candidates(id) ON DELETE SET NULL,
  item_type         VARCHAR(50) NOT NULL
                      CHECK (item_type IN ('policy','document','exam','checklist','bundle')),
  item_id           UUID NOT NULL,
  title             VARCHAR(500) NOT NULL,
  status            VARCHAR(30) DEFAULT 'not_started'
                      CHECK (status IN (
                        'not_started','in_progress','completed','expired',
                        'failed','signed','read'
                      )),
  assigned_date     TIMESTAMPTZ DEFAULT NOW(),
  started_date      TIMESTAMPTZ,
  completed_date    TIMESTAMPTZ,
  due_date          TIMESTAMPTZ,
  expiration_date   TIMESTAMPTZ,
  score             NUMERIC(5,2),
  ceus              NUMERIC(5,2) DEFAULT 0,
  attempts_used     INT DEFAULT 0,
  assigned_by       VARCHAR(255),
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comp_competency_records_user_clerk_id
  ON comp_competency_records(user_clerk_id);

CREATE INDEX IF NOT EXISTS idx_comp_competency_records_item_type_item_id
  ON comp_competency_records(item_type, item_id);

CREATE INDEX IF NOT EXISTS idx_comp_competency_records_status
  ON comp_competency_records(status);

-- ---------------------------------------------------------------------------
-- 5. POLICY SIGNATURES (audit trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comp_policy_signatures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id             UUID NOT NULL REFERENCES comp_policies(id),
  competency_record_id  UUID REFERENCES comp_competency_records(id),
  user_clerk_id         VARCHAR(255) NOT NULL,
  typed_signature       VARCHAR(500) NOT NULL,
  ip_address            VARCHAR(100),
  user_agent            TEXT,
  signed_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comp_policy_signatures_policy_id
  ON comp_policy_signatures(policy_id);

-- ---------------------------------------------------------------------------
-- 6. DOCUMENT READ LOGS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comp_document_read_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           UUID NOT NULL REFERENCES comp_documents(id),
  competency_record_id  UUID REFERENCES comp_competency_records(id),
  user_clerk_id         VARCHAR(255) NOT NULL,
  ip_address            VARCHAR(100),
  read_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comp_document_read_logs_document_id
  ON comp_document_read_logs(document_id);

-- ---------------------------------------------------------------------------
-- 7. ADMIN NOTES on competency records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comp_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_record_id  UUID NOT NULL REFERENCES comp_competency_records(id),
  author_clerk_id       VARCHAR(255) NOT NULL,
  content               TEXT NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 8. SEED: Cat1 (level=1) categories
-- ---------------------------------------------------------------------------
INSERT INTO comp_categories (level, name, sort_order)
  SELECT 1, 'RN', 1
  WHERE NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=1 AND name='RN');

INSERT INTO comp_categories (level, name, sort_order)
  SELECT 1, 'LVN/LPN', 2
  WHERE NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=1 AND name='LVN/LPN');

INSERT INTO comp_categories (level, name, sort_order)
  SELECT 1, 'CNA', 3
  WHERE NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=1 AND name='CNA');

INSERT INTO comp_categories (level, name, sort_order)
  SELECT 1, 'CMA', 4
  WHERE NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=1 AND name='CMA');

INSERT INTO comp_categories (level, name, sort_order)
  SELECT 1, 'Allied Health', 5
  WHERE NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=1 AND name='Allied Health');

INSERT INTO comp_categories (level, name, sort_order)
  SELECT 1, 'PCA/PCT', 6
  WHERE NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=1 AND name='PCA/PCT');

INSERT INTO comp_categories (level, name, sort_order)
  SELECT 1, 'Nursing Aide', 7
  WHERE NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=1 AND name='Nursing Aide');

INSERT INTO comp_categories (level, name, sort_order)
  SELECT 1, 'Non-Clinical', 8
  WHERE NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=1 AND name='Non-Clinical');

-- ─── Seed Cat2 specialties (children of Cat1 roles) ────────────────────────

-- Specialties under RN
INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'ICU / Critical Care', c.id, 1 FROM comp_categories c
WHERE c.level=1 AND c.name='RN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='ICU / Critical Care');

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Emergency Room (ER)', c.id, 2 FROM comp_categories c
WHERE c.level=1 AND c.name='RN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Emergency Room (ER)');

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Med-Surg', c.id, 3 FROM comp_categories c
WHERE c.level=1 AND c.name='RN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Med-Surg');

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Pediatrics', c.id, 4 FROM comp_categories c
WHERE c.level=1 AND c.name='RN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Pediatrics');

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Operating Room (OR)', c.id, 5 FROM comp_categories c
WHERE c.level=1 AND c.name='RN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Operating Room (OR)');

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Telemetry', c.id, 6 FROM comp_categories c
WHERE c.level=1 AND c.name='RN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Telemetry');

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Labor & Delivery (L&D)', c.id, 7 FROM comp_categories c
WHERE c.level=1 AND c.name='RN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Labor & Delivery (L&D)');

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Correctional', c.id, 8 FROM comp_categories c
WHERE c.level=1 AND c.name='RN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Correctional');

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Long-Term Care (LTC)', c.id, 9 FROM comp_categories c
WHERE c.level=1 AND c.name='RN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Long-Term Care (LTC)');

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Home Health', c.id, 10 FROM comp_categories c
WHERE c.level=1 AND c.name='RN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Home Health');

-- Specialties under LVN/LPN
INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Med-Surg', c.id, 1 FROM comp_categories c
WHERE c.level=1 AND c.name='LVN/LPN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Med-Surg' AND parent_id=c.id);

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Long-Term Care (LTC)', c.id, 2 FROM comp_categories c
WHERE c.level=1 AND c.name='LVN/LPN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Long-Term Care (LTC)' AND parent_id=c.id);

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Home Health', c.id, 3 FROM comp_categories c
WHERE c.level=1 AND c.name='LVN/LPN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Home Health' AND parent_id=c.id);

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Correctional', c.id, 4 FROM comp_categories c
WHERE c.level=1 AND c.name='LVN/LPN'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Correctional' AND parent_id=c.id);

-- Specialties under CNA
INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Long-Term Care (LTC)', c.id, 1 FROM comp_categories c
WHERE c.level=1 AND c.name='CNA'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Long-Term Care (LTC)' AND parent_id=c.id);

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Med-Surg', c.id, 2 FROM comp_categories c
WHERE c.level=1 AND c.name='CNA'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Med-Surg' AND parent_id=c.id);

INSERT INTO comp_categories (level, name, parent_id, sort_order)
SELECT 2, 'Home Health', c.id, 3 FROM comp_categories c
WHERE c.level=1 AND c.name='CNA'
AND NOT EXISTS (SELECT 1 FROM comp_categories WHERE level=2 AND name='Home Health' AND parent_id=c.id);
