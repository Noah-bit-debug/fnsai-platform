-- Phase 5 — weekly + monthly operational summaries
--
-- Extends the existing daily_summaries table to support three period
-- types: day (the original), week (7-day rollup ending on summary_date),
-- month (~30-day rollup). A summary is uniquely identified by the
-- (summary_date, period) pair — so you can have a "2026-04-23 day"
-- summary AND a "2026-04-23 week" summary side by side.
--
-- Idempotent. Existing rows default to period='day' which matches prior
-- behavior, so the audit trail survives intact.

-- 1. Add period column (default 'day' preserves existing rows).
ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS period VARCHAR(10) NOT NULL DEFAULT 'day'
  CHECK (period IN ('day', 'week', 'month'));

-- 2. Replace the `summary_date UNIQUE` constraint with a composite
--    unique(summary_date, period). The old constraint name is
--    auto-generated so we drop it by introspection. Safe to re-run
--    because we only drop if it exists.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  -- Find the existing UNIQUE constraint on summary_date (single-column).
  SELECT conname INTO con_name
    FROM pg_constraint
   WHERE conrelid = 'daily_summaries'::regclass
     AND contype = 'u'
     AND array_length(conkey, 1) = 1
     AND conkey[1] = (
       SELECT attnum FROM pg_attribute
        WHERE attrelid = 'daily_summaries'::regclass
          AND attname = 'summary_date'
     )
   LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE daily_summaries DROP CONSTRAINT %I', con_name);
  END IF;

  -- Add the composite unique if it doesn't already exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'daily_summaries'::regclass
       AND contype = 'u'
       AND conname = 'daily_summaries_date_period_uniq'
  ) THEN
    ALTER TABLE daily_summaries
      ADD CONSTRAINT daily_summaries_date_period_uniq UNIQUE (summary_date, period);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_daily_summaries_period ON daily_summaries(period);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date_desc ON daily_summaries(summary_date DESC);

-- 3. Columns the route already referenced but the original schema
--    never added. These caused the list query to 500 with
--    "column daily_summaries.reviewed_by does not exist". Safe add.
ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- 4. Role-scoped summaries (recruiting / hr / credentialing / bd / ceo).
--    Every (date, period, scope) combination is a distinct row, so a
--    single day can have e.g. a day-all summary, a week-recruiting
--    summary, and a month-ceo summary at the same time.
ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'all'
  CHECK (scope IN ('all', 'recruiting', 'hr', 'credentialing', 'bd', 'ceo'));

-- Replace the (date, period) unique with (date, period, scope). Same
-- introspection pattern as the earlier block so it's idempotent.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
    FROM pg_constraint
   WHERE conrelid = 'daily_summaries'::regclass
     AND contype = 'u'
     AND conname = 'daily_summaries_date_period_uniq';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE daily_summaries DROP CONSTRAINT %I', con_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'daily_summaries'::regclass
       AND contype = 'u'
       AND conname = 'daily_summaries_date_period_scope_uniq'
  ) THEN
    ALTER TABLE daily_summaries
      ADD CONSTRAINT daily_summaries_date_period_scope_uniq UNIQUE (summary_date, period, scope);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_daily_summaries_scope ON daily_summaries(scope);
