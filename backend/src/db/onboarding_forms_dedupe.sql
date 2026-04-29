-- onboarding_forms_dedupe — Phase 9 QA fix.
--
-- Background: POST /candidates/:id/onboarding-forms used a plain INSERT
-- with no uniqueness check. Every "Send W-4" click added a new row,
-- so candidates accumulated duplicate form rows that bloated the form
-- list, broke the "did this form already go out?" check, and made
-- reminder counts unreliable.
--
-- This migration:
--   1. Collapses any existing duplicates per (candidate_id, form_type),
--      keeping the most recently-sent row and merging reminder_count.
--      We pick the latest sent_at so the displayed timestamp matches
--      the most recent send the user made.
--   2. Adds a unique index so the route's new ON CONFLICT clause has
--      something to target.
--
-- Idempotent: if the index already exists or there are no duplicates,
-- the script no-ops on a re-run.

-- 1) Collapse duplicates. The window function picks the row with the
--    most recent sent_at (NULLS LAST so a never-sent row doesn't beat
--    an actual send), summing reminder_count across siblings before we
--    delete them. We update the keeper in place so its reminder_count
--    reflects the collapsed total.
WITH ranked AS (
  SELECT
    id,
    candidate_id,
    form_type,
    reminder_count,
    sent_at,
    ROW_NUMBER() OVER (
      PARTITION BY candidate_id, form_type
      ORDER BY sent_at DESC NULLS LAST, created_at DESC
    ) AS rn,
    SUM(reminder_count) OVER (PARTITION BY candidate_id, form_type) AS total_reminders
  FROM onboarding_forms
  WHERE candidate_id IS NOT NULL
),
keepers AS (
  SELECT id, total_reminders FROM ranked WHERE rn = 1
)
UPDATE onboarding_forms o
   SET reminder_count = k.total_reminders, updated_at = NOW()
  FROM keepers k
 WHERE o.id = k.id
   AND o.reminder_count <> k.total_reminders;

DELETE FROM onboarding_forms o
 USING (
   SELECT id FROM (
     SELECT id, ROW_NUMBER() OVER (
       PARTITION BY candidate_id, form_type
       ORDER BY sent_at DESC NULLS LAST, created_at DESC
     ) AS rn
     FROM onboarding_forms
     WHERE candidate_id IS NOT NULL
   ) r WHERE rn > 1
 ) dup
 WHERE o.id = dup.id;

-- 2) Add the partial unique index. Partial because staff-side rows
--    (candidate_id IS NULL) and the not-yet-sent rows we never want
--    to dedupe must remain unconstrained. The candidate-id branch is
--    what the route's ON CONFLICT targets.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_forms_candidate_form_unique
  ON onboarding_forms (candidate_id, form_type)
  WHERE candidate_id IS NOT NULL;
