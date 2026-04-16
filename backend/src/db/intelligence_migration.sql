-- Intelligence Engine Migration
-- Adds tables for integrations, reports, knowledge base,
-- clarification questions, templates, suggestions, and daily summaries.
-- All tables use IF NOT EXISTS so this file is safe to re-run.

-- =============================================================
-- 1. INTEGRATIONS
-- =============================================================

CREATE TABLE IF NOT EXISTS integrations (
  id                      SERIAL PRIMARY KEY,
  type                    VARCHAR(50)  NOT NULL,
  name                    VARCHAR(100) NOT NULL,
  status                  VARCHAR(20)  NOT NULL DEFAULT 'disconnected',
  config                  JSONB        DEFAULT '{}',
  credentials_ref         VARCHAR(255),
  last_synced_at          TIMESTAMPTZ,
  sync_frequency_minutes  INTEGER      DEFAULT 60,
  enabled                 BOOLEAN      DEFAULT true,
  created_by              VARCHAR(255),
  created_at              TIMESTAMPTZ  DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_sync_logs (
  id              SERIAL PRIMARY KEY,
  integration_id  INTEGER REFERENCES integrations(id) ON DELETE CASCADE,
  status          VARCHAR(20)  NOT NULL,
  records_synced  INTEGER      DEFAULT 0,
  error_message   TEXT,
  metadata        JSONB        DEFAULT '{}',
  started_at      TIMESTAMPTZ  DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

-- =============================================================
-- 2. REPORT DEFINITIONS + REPORT RUNS
-- =============================================================

CREATE TABLE IF NOT EXISTS report_definitions (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  type            VARCHAR(50)  NOT NULL,
  category        VARCHAR(50),
  query_config    JSONB        DEFAULT '{}',
  filter_options  JSONB        DEFAULT '{}',
  is_public       BOOLEAN      DEFAULT false,
  created_by      VARCHAR(255),
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_runs (
  id             SERIAL PRIMARY KEY,
  definition_id  INTEGER REFERENCES report_definitions(id) ON DELETE SET NULL,
  run_name       VARCHAR(200),
  status         VARCHAR(20)  DEFAULT 'pending',
  filters        JSONB        DEFAULT '{}',
  output_data    JSONB,
  narrative      TEXT,
  generated_by   VARCHAR(255),
  started_at     TIMESTAMPTZ  DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

-- =============================================================
-- 3. KNOWLEDGE SOURCES + KNOWLEDGE ITEMS
-- =============================================================

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id               SERIAL PRIMARY KEY,
  name             VARCHAR(100) NOT NULL,
  type             VARCHAR(50)  NOT NULL,
  status           VARCHAR(20)  DEFAULT 'inactive',
  config           JSONB        DEFAULT '{}',
  permissions      JSONB        DEFAULT '{}',
  last_indexed_at  TIMESTAMPTZ,
  item_count       INTEGER      DEFAULT 0,
  enabled          BOOLEAN      DEFAULT false,
  created_by       VARCHAR(255),
  created_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id               SERIAL PRIMARY KEY,
  source_id        INTEGER REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  title            VARCHAR(500),
  content_preview  TEXT,
  content_hash     VARCHAR(64),
  metadata         JSONB       DEFAULT '{}',
  embedding_status VARCHAR(20) DEFAULT 'pending',
  indexed_at       TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- 4. CLARIFICATION QUESTIONS
-- =============================================================

CREATE TABLE IF NOT EXISTS clarification_questions (
  id              SERIAL PRIMARY KEY,
  context         VARCHAR(100),
  context_ref_id  INTEGER,
  question        TEXT        NOT NULL,
  why_asked       TEXT,
  options         JSONB,
  priority        VARCHAR(20) DEFAULT 'medium',
  status          VARCHAR(20) DEFAULT 'pending',
  answer          TEXT,
  answer_notes    TEXT,
  answered_by     VARCHAR(255),
  answered_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ
);

-- =============================================================
-- 5. TEMPLATES + TEMPLATE VERSIONS
-- =============================================================

CREATE TABLE IF NOT EXISTS templates (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  type          VARCHAR(50)  NOT NULL,
  category      VARCHAR(50),
  subject       VARCHAR(300),
  content       TEXT         NOT NULL,
  variables     JSONB        DEFAULT '[]',
  tags          JSONB        DEFAULT '[]',
  version       INTEGER      DEFAULT 1,
  is_active     BOOLEAN      DEFAULT true,
  use_count     INTEGER      DEFAULT 0,
  ai_generated  BOOLEAN      DEFAULT false,
  created_by    VARCHAR(255),
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS template_versions (
  id              SERIAL PRIMARY KEY,
  template_id     INTEGER REFERENCES templates(id) ON DELETE CASCADE,
  version         INTEGER      NOT NULL,
  subject         VARCHAR(300),
  content         TEXT         NOT NULL,
  change_summary  TEXT,
  changed_by      VARCHAR(255),
  changed_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- =============================================================
-- 6. SUGGESTIONS
-- =============================================================

CREATE TABLE IF NOT EXISTS suggestions (
  id               SERIAL PRIMARY KEY,
  type             VARCHAR(50)  NOT NULL,
  title            VARCHAR(300) NOT NULL,
  description      TEXT         NOT NULL,
  reason           TEXT,
  data_points      JSONB        DEFAULT '[]',
  priority         VARCHAR(20)  DEFAULT 'medium',
  status           VARCHAR(20)  DEFAULT 'pending',
  approval_notes   TEXT,
  edited_content   TEXT,
  reviewed_by      VARCHAR(255),
  reviewed_at      TIMESTAMPTZ,
  generated_at     TIMESTAMPTZ  DEFAULT NOW()
);

-- =============================================================
-- 7. DAILY SUMMARIES
-- =============================================================

CREATE TABLE IF NOT EXISTS daily_summaries (
  id                      SERIAL PRIMARY KEY,
  summary_date            DATE        NOT NULL UNIQUE,
  headline                TEXT,
  narrative               TEXT,
  metrics                 JSONB       DEFAULT '{}',
  risk_alerts             JSONB       DEFAULT '[]',
  suggestions_generated   INTEGER     DEFAULT 0,
  questions_generated     INTEGER     DEFAULT 0,
  status                  VARCHAR(20) DEFAULT 'generated',
  generated_at            TIMESTAMPTZ DEFAULT NOW()
);
