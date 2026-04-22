-- ATS Phase 2 — Pay range on jobs.
--
-- Per Phase 1.2A: jobs should be able to express a pay range (min/max)
-- instead of only a single rate. Keep the existing pay_rate column for
-- backward compatibility (and as the single-value shorthand when min == max
-- or when only one value is known). Add pay_rate_min and pay_rate_max
-- so the UI can show "$45-$60/hr" or "$52/hr" as appropriate.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pay_rate_min NUMERIC(10,2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pay_rate_max NUMERIC(10,2);

-- Backfill: if an existing row has pay_rate set but no min/max, use
-- pay_rate as both — it was effectively a single-point "range".
UPDATE jobs
SET pay_rate_min = pay_rate, pay_rate_max = pay_rate
WHERE pay_rate IS NOT NULL
  AND pay_rate_min IS NULL
  AND pay_rate_max IS NULL;

-- Helpful index if we start filtering by rate band on the job board.
CREATE INDEX IF NOT EXISTS idx_jobs_pay_rate_max ON jobs(pay_rate_max);
