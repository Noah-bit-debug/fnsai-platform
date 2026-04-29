-- =============================================================================
-- HARD DELETE — wipe all records of "Jazzlyn Price" + "Belinda" (single row)
-- =============================================================================
--
-- Defensive single-transaction script. Order:
--   1. Find candidates + staff matching the names (PREVIEW — no writes)
--   2. Show every dependent row that would be deleted
--   3. Run the deletes inside a transaction
--   4. STOP — print a summary, ask the human to type COMMIT or ROLLBACK
--
-- Run from the Railway database shell (or local psql against
-- $DATABASE_URL). Do NOT pipe to psql — you need the interactive prompt
-- so you can ROLLBACK if the row counts look wrong.
--
-- USAGE:
--   railway connect Postgres   # or: psql "$DATABASE_URL"
--   \i backend/src/scripts/wipe_jazzlyn_belinda.sql
--   -- review the output, then either:
--   COMMIT;     -- finalize the delete (irreversible)
--   ROLLBACK;   -- undo, leaves data intact
--
-- This handles the FK graph the schema actually has:
--   - CASCADEd children clean themselves up (candidate_documents,
--     candidate_stage_history, submissions, submission_stage_history,
--     comp_competency_records, comp_placement_readiness,
--     comp_onboarding_assignments, credentials, etc.).
--   - Non-CASCADE children are deleted explicitly first:
--       reminders, onboarding_forms, documents (staff-side),
--       incidents (staff-side), placements (staff-side; candidate-side
--       has ON DELETE SET NULL but we delete the row outright since
--       these names should leave nothing behind).
--   - audit_log rows are intentionally PRESERVED. Healthcare staffing
--     compliance regs (HIPAA, state licensing) require the audit
--     trail of who-did-what-when. The candidate/staff row is gone,
--     audit_log keeps its historical record by candidate_id even
--     though the FK is dangling.
--
-- This script is conservative on Belinda: matches first_name = 'Belinda'
-- (case-insensitive). The user confirmed there's only one Belinda in
-- the system — the preview block at the top will list everyone matched
-- before any DELETE runs. If preview shows >1 Belinda, ROLLBACK.
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Build the kill list once into temp tables. Every DELETE below
--    references these. CTEs work too but temp tables let psql \echo
--    interleave with the DELETE counts cleanly.
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _wipe_candidate_ids AS
SELECT id FROM candidates
 WHERE (LOWER(first_name) = 'jazzlyn' AND LOWER(last_name) = 'price')
    OR  LOWER(first_name) = 'belinda';

CREATE TEMP TABLE _wipe_staff_ids AS
SELECT id FROM staff
 WHERE (LOWER(first_name) = 'jazzlyn' AND LOWER(last_name) = 'price')
    OR  LOWER(first_name) = 'belinda';

\echo ''
\echo '════════════════════════ PREVIEW ════════════════════════'
\echo 'Candidates matched:'
SELECT id, first_name, last_name, email, phone, role, stage, status, created_at
  FROM candidates
 WHERE id IN (SELECT id FROM _wipe_candidate_ids)
 ORDER BY created_at;

\echo ''
\echo 'Staff matched:'
SELECT id, first_name, last_name, email, phone, role, status, created_at
  FROM staff
 WHERE id IN (SELECT id FROM _wipe_staff_ids)
 ORDER BY created_at;

\echo ''
\echo 'Submissions for matched candidates:'
SELECT id, candidate_id, job_id, stage_key, created_at
  FROM submissions
 WHERE candidate_id IN (SELECT id FROM _wipe_candidate_ids);

\echo ''
\echo 'Placements (candidate or staff side):'
SELECT id, candidate_id, staff_id, status, created_at
  FROM placements
 WHERE candidate_id IN (SELECT id FROM _wipe_candidate_ids)
    OR staff_id     IN (SELECT id FROM _wipe_staff_ids);

\echo ''
\echo 'Onboarding forms:'
SELECT id, candidate_id, staff_id, form_type, status
  FROM onboarding_forms
 WHERE candidate_id IN (SELECT id FROM _wipe_candidate_ids)
    OR staff_id     IN (SELECT id FROM _wipe_staff_ids);

\echo ''
\echo 'Reminders:'
SELECT id, candidate_id, staff_id, due_at
  FROM reminders
 WHERE candidate_id IN (SELECT id FROM _wipe_candidate_ids)
    OR staff_id     IN (SELECT id FROM _wipe_staff_ids);

\echo ''
\echo 'Incidents (staff side):'
SELECT id, staff_id, type, status, date
  FROM incidents
 WHERE staff_id IN (SELECT id FROM _wipe_staff_ids);

\echo ''
\echo 'Credentials (cascade-deleted via staff, shown for visibility):'
SELECT id, staff_id, type, status, expiry_date
  FROM credentials
 WHERE staff_id IN (SELECT id FROM _wipe_staff_ids);

\echo ''
\echo 'Documents (staff side, non-CASCADE):'
SELECT id, staff_id, doc_type, status
  FROM documents
 WHERE staff_id IN (SELECT id FROM _wipe_staff_ids);

\echo ''
\echo '════════════════════════ DELETE ═════════════════════════'

-- -----------------------------------------------------------------------------
-- 2. Delete non-CASCADE children first. Order: leaf rows → parents.
-- -----------------------------------------------------------------------------

-- reminders FK has no ON DELETE — wipe explicitly
DELETE FROM reminders
 WHERE candidate_id IN (SELECT id FROM _wipe_candidate_ids)
    OR staff_id     IN (SELECT id FROM _wipe_staff_ids);
\echo 'reminders deleted ↑'

-- onboarding_forms FK has no ON DELETE
DELETE FROM onboarding_forms
 WHERE candidate_id IN (SELECT id FROM _wipe_candidate_ids)
    OR staff_id     IN (SELECT id FROM _wipe_staff_ids);
\echo 'onboarding_forms deleted ↑'

-- placements has ON DELETE SET NULL on candidate_id, no cascade on staff_id.
-- We delete the row outright since the people are leaving entirely.
DELETE FROM placements
 WHERE candidate_id IN (SELECT id FROM _wipe_candidate_ids)
    OR staff_id     IN (SELECT id FROM _wipe_staff_ids);
\echo 'placements deleted ↑'

-- documents (staff side) has no cascade
DELETE FROM documents
 WHERE staff_id IN (SELECT id FROM _wipe_staff_ids);
\echo 'documents deleted ↑'

-- incidents has no cascade on staff_id
DELETE FROM incidents
 WHERE staff_id IN (SELECT id FROM _wipe_staff_ids);
\echo 'incidents deleted ↑'

-- -----------------------------------------------------------------------------
-- 3. Delete the parents. CASCADE handles the rest:
--      candidate_documents, candidate_stage_history, submissions,
--      submission_stage_history, comp_competency_records,
--      comp_placement_readiness, comp_onboarding_assignments,
--      credentials, etc.
-- -----------------------------------------------------------------------------
DELETE FROM candidates WHERE id IN (SELECT id FROM _wipe_candidate_ids);
\echo 'candidates deleted ↑'

DELETE FROM staff WHERE id IN (SELECT id FROM _wipe_staff_ids);
\echo 'staff deleted ↑'

-- -----------------------------------------------------------------------------
-- 4. Final summary. Numbers should be ZERO if the cascades worked.
--    If any of these are non-zero, something's still pointing at the
--    deleted IDs — ROLLBACK and investigate.
-- -----------------------------------------------------------------------------
\echo ''
\echo '════════════════════════ POST-DELETE SANITY ═════════════'

SELECT 'candidates remaining'    AS what, COUNT(*) FROM candidates
  WHERE id IN (SELECT id FROM _wipe_candidate_ids)
UNION ALL
SELECT 'staff remaining'         AS what, COUNT(*) FROM staff
  WHERE id IN (SELECT id FROM _wipe_staff_ids)
UNION ALL
SELECT 'submissions remaining'   AS what, COUNT(*) FROM submissions
  WHERE candidate_id IN (SELECT id FROM _wipe_candidate_ids)
UNION ALL
SELECT 'documents (cand) remaining' AS what, COUNT(*) FROM candidate_documents
  WHERE candidate_id IN (SELECT id FROM _wipe_candidate_ids)
UNION ALL
SELECT 'placements remaining'    AS what, COUNT(*) FROM placements
  WHERE candidate_id IN (SELECT id FROM _wipe_candidate_ids)
     OR staff_id     IN (SELECT id FROM _wipe_staff_ids);

\echo ''
\echo '════════════════════════ DECISION ═══════════════════════'
\echo 'Review every row count above. If anything looks wrong:'
\echo '    ROLLBACK;'
\echo 'If everything looks correct (and the candidates/staff lists at'
\echo 'the top matched the people you intended to remove):'
\echo '    COMMIT;'
\echo ''
\echo 'NOTE: audit_log entries are INTENTIONALLY preserved. They'
\echo 'reference the deleted IDs but no longer have a parent row.'
\echo 'This is the regulatory-defensible posture — the historical'
\echo 'record of who-did-what is kept, only the PII row itself is'
\echo 'gone. If you also need to scrub audit_log, run the separate'
\echo 'wipe_jazzlyn_belinda_audit.sql script (not provided here —'
\echo 'modifying audit history requires legal review).'
\echo '═════════════════════════════════════════════════════════'

-- INTENTIONALLY no COMMIT/ROLLBACK — the human types it.
