-- Phase 2.6 — Courses / training content inside bundles.
--
-- User feedback: "Bundles should not only be exams/checklists. They
-- should support structured training content too."
--
-- New comp_courses table holds a training module (markdown content,
-- optional video, optional quiz exam, attestation flag). Extends
-- comp_bundle_items.item_type to include 'course'. Tracks per-user
-- completion in comp_course_completions so My Compliance can report
-- progress.
--
-- Documents inside bundles already work via item_type = 'document'
-- (comp_documents) — no change needed there.

-- ─── comp_courses ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comp_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  description TEXT,

  -- The actual training body. Markdown so the frontend can render
  -- headers, bullets, images, tables. Stored as text; no length cap.
  content_markdown TEXT,

  -- Optional embedded video (YouTube / Vimeo / direct URL). Frontend
  -- detects and embeds.
  video_url TEXT,

  -- How long the course typically takes. Used to nudge users if they
  -- complete WAY faster than this (possible skim-through).
  estimated_minutes INT,

  -- Optional tail exam — staff must pass this to complete the course.
  quiz_exam_id UUID REFERENCES comp_exams(id) ON DELETE SET NULL,
  pass_threshold NUMERIC(5,2),

  -- If true, staff must sign an attestation ("I read and understand")
  -- at the end. Replaces or supplements the quiz for content-only
  -- courses (SOPs, policy walkthroughs).
  require_attestation BOOLEAN DEFAULT TRUE,

  -- Org-wide status
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),

  -- Categories follow the same 3-level taxonomy as policies/documents
  cat1_id UUID REFERENCES comp_categories(id),
  cat2_id UUID REFERENCES comp_categories(id),
  cat3_id UUID REFERENCES comp_categories(id),

  applicable_roles TEXT[] DEFAULT '{}',

  created_by VARCHAR(255),  -- clerk_user_id
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comp_courses_status ON comp_courses(status);
CREATE INDEX IF NOT EXISTS idx_comp_courses_cat1   ON comp_courses(cat1_id);

-- ─── comp_course_completions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comp_course_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES comp_courses(id) ON DELETE CASCADE,
  -- Tracked by clerk_user_id so we don't need a users FK dependency
  user_clerk_id VARCHAR(255) NOT NULL,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Total seconds the user had the course open. Used to flag
  -- obvious skim-throughs (content 20min, user spent 30s).
  duration_seconds INT DEFAULT 0,

  -- Attestation
  attestation_signed BOOLEAN DEFAULT FALSE,
  attestation_signed_at TIMESTAMPTZ,
  attestation_signer_name TEXT,   -- "Noah Moise" snapshot so historical
                                  -- records don't break if name changes

  -- Quiz — NULL if the course has no quiz
  quiz_attempt_id UUID REFERENCES comp_exam_attempts(id) ON DELETE SET NULL,
  quiz_score NUMERIC(5,2),
  passed BOOLEAN,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (course_id, user_clerk_id)  -- one completion row per user per course
);

CREATE INDEX IF NOT EXISTS idx_comp_course_completions_user   ON comp_course_completions(user_clerk_id);
CREATE INDEX IF NOT EXISTS idx_comp_course_completions_course ON comp_course_completions(course_id);

-- ─── Widen comp_bundle_items.item_type to allow 'course' ──────────────────
-- Postgres doesn't let you redefine a CHECK constraint; drop + re-add.
-- Idempotent — IF EXISTS before drop, NOT EXISTS semantics on re-add
-- via DO block so re-runs don't fail.
ALTER TABLE comp_bundle_items DROP CONSTRAINT IF EXISTS comp_bundle_items_item_type_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comp_bundle_items_item_type_check_v2'
  ) THEN
    ALTER TABLE comp_bundle_items ADD CONSTRAINT comp_bundle_items_item_type_check_v2
      CHECK (item_type IN ('policy','document','exam','checklist','course'));
  END IF;
END$$;
