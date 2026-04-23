-- Phase 1.4 QA fix — drop the candidates.stage CHECK constraint.
--
-- The candidates table was created with:
--   stage TEXT DEFAULT 'application'
--     CHECK (stage IN ('application','interview','credentialing','onboarding',
--                      'placed','rejected','withdrawn'))
--
-- Phase 1.4 introduced dynamic pipeline_stages (12 default rows, admin-
-- configurable). The pipeline UI sends stage keys like 'new_lead',
-- 'screening', 'internal_review', 'submitted', 'client_submitted' — all
-- rejected by the old CHECK as "new row violates check constraint".
-- That surfaced to users as a 400 Bad Request on every move to a
-- non-legacy stage.
--
-- Fix: drop the CHECK constraint. Validation now happens in the
-- application layer (backend reads pipeline_stages to confirm the key
-- is real). Idempotent — no-op if the constraint has already been
-- dropped on a prior migration run.

DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
    FROM pg_constraint
   WHERE conrelid = 'candidates'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%stage%IN%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE candidates DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

-- Same CHECK on candidate_stage_history.to_stage if it exists.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
    FROM pg_constraint
   WHERE conrelid = 'candidate_stage_history'::regclass
     AND contype = 'c'
     AND (pg_get_constraintdef(oid) LIKE '%to_stage%IN%'
       OR pg_get_constraintdef(oid) LIKE '%from_stage%IN%');
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE candidate_stage_history DROP CONSTRAINT %I', con_name);
  END IF;
END $$;
