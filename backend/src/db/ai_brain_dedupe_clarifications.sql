-- AI Brain — deduplicate review queue clarifications, then prevent
-- duplicates going forward.
--
-- The three places that insert ai_brain_clarifications rows (chat
-- handler, manual POST, file-routing handler) had no dedup check, so
-- the same question would land in the review queue every time the AI
-- detected a need for clarification. This migration cleans up the
-- existing duplicates and adds a unique index so the application
-- code's ON CONFLICT DO NOTHING fast path can rely on the DB to
-- enforce single-question semantics.
--
-- Idempotent. Safe to re-run.

-- 1. Collapse duplicates: keep the oldest row per normalized question,
--    delete the rest. Normalization is lower-case + trim so casing /
--    whitespace tweaks still count as the same question. If any of the
--    dupes had been answered, we prefer to keep the answered one (so
--    the queue shows a resolved entry rather than re-asking).
DELETE FROM ai_brain_clarifications a
 USING ai_brain_clarifications b
 WHERE a.id <> b.id
   AND lower(btrim(a.question)) = lower(btrim(b.question))
   AND (
        -- prefer to keep the answered one over the pending one
        (a.status = 'pending' AND b.status <> 'pending')
        OR
        -- otherwise keep the oldest (smallest created_at)
        (a.status = b.status AND a.created_at > b.created_at)
        OR
        -- tie-breaker on identical timestamps: smaller id wins (b kept)
        (a.status = b.status AND a.created_at = b.created_at AND a.id > b.id)
   );

-- 2. Enforce uniqueness going forward. Functional UNIQUE INDEX on the
--    normalized question text. Application INSERTs use ON CONFLICT DO
--    NOTHING against this constraint name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_brain_clarifications_norm_question
  ON ai_brain_clarifications (lower(btrim(question)));
