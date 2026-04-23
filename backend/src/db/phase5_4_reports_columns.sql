-- Phase 5.4 QA fix — report_runs + report_definitions schema drift
--
-- The reports route was written expecting columns that were never added
-- to the original intelligence_migration.sql. Every report generation
-- attempt errored with "column 'report_type' of relation 'report_runs'
-- does not exist" (or similar for result_data / run_by), which the old
-- shallow catch block surfaced as a generic "Failed to generate report".
--
-- Rather than rewrite every query to match the original column names
-- (output_data, generated_by, filter_options, type), add the missing
-- columns alongside the existing ones. The route writes to the new
-- names; old data (if any) stays in the old columns. Idempotent.

-- ─── report_runs ──────────────────────────────────────────────────────
-- Add report_type, result_data, run_by if missing.

ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS report_type VARCHAR(50);
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS result_data JSONB;
-- run_by is used as a UUID lookup into users.id in the route, but the
-- existing generated_by column is VARCHAR(255) (clerk_user_id). Add a
-- new UUID column; the route's subquery resolves clerk_user_id → users.id
-- so this lines up.
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS run_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- One-shot backfill: if any old rows exist with output_data but no
-- result_data, copy over. No-op for new installs.
UPDATE report_runs SET result_data = output_data WHERE result_data IS NULL AND output_data IS NOT NULL;

-- ─── report_definitions ──────────────────────────────────────────────
-- Route uses `report_type` column (old schema named it `type`) and
-- `default_filters` (old schema `filter_options`). Add alongside.

ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS report_type VARCHAR(50);
ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS default_filters JSONB DEFAULT '{}';
ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS schedule_cron VARCHAR(100);

-- Backfill so old rows still work.
UPDATE report_definitions SET report_type = type WHERE report_type IS NULL AND type IS NOT NULL;
UPDATE report_definitions SET default_filters = filter_options WHERE default_filters = '{}'::jsonb AND filter_options IS NOT NULL;
