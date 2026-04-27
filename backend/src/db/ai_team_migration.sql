-- Phase 9 / Phase 3 — AI Team workspace.
--
-- A "team task" is a single user-created brief that gets handed to a
-- multi-persona AI loop. The orchestrator persona delegates to specialist
-- personas (HR, recruiting, compliance, credentialing, operations) which
-- in turn call read-only tools against the rest of the database. The
-- final output goes back to the user for approve / edit / reject.
--
-- Three tables:
--   ai_team_tasks      — one row per user brief
--   ai_team_messages   — append-only conversation log (human + every
--                          persona turn + tool call + tool result)
--   ai_team_artifacts  — structured outputs (drafts, lists, recommended
--                          actions) that the user might want to act on
--                          after approval
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS ai_team_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN (
                    'draft',                -- created but not started
                    'running',              -- agent loop in progress
                    'awaiting_approval',    -- final draft sitting for the user
                    'approved',             -- user accepted
                    'rejected',             -- user threw it back
                    'failed'                -- runner error / loop limit
                  )),
  -- Final synthesized output from the orchestrator. Populated when the
  -- model emits a finalize_output tool call. The user can edit this in
  -- place before approving.
  final_output    TEXT,
  -- Convenience metric: number of model turns spent (across orchestrator
  -- + all specialists). Used to surface cost in the UI and as a guard
  -- in the runner loop.
  turn_count      INT NOT NULL DEFAULT 0,
  error           TEXT,
  -- Optional foreign key context — when a task was started from a
  -- candidate / submission / etc page, we record the source so the
  -- detail page can link back.
  source_type     TEXT,
  source_id       UUID,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_team_tasks_owner_status
  ON ai_team_tasks(created_by, status);
CREATE INDEX IF NOT EXISTS idx_ai_team_tasks_status_created
  ON ai_team_tasks(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_team_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES ai_team_tasks(id) ON DELETE CASCADE,
  -- Logical ordering inside a task. The runner increments per turn.
  step_index      INT  NOT NULL,
  -- Who emitted this message:
  --   user             — initial brief or follow-up
  --   orchestrator     — top-level coordinator persona
  --   recruiting_ai    — recruiting specialist
  --   hr_ai            — HR specialist
  --   compliance_ai    — compliance specialist
  --   credentialing_ai — credentialing specialist
  --   operations_ai    — ops/coordination specialist
  --   tool             — synthetic message holding a tool result
  --   system           — runner status (started, hit-limit, error)
  persona         TEXT NOT NULL
                  CHECK (persona IN (
                    'user', 'orchestrator',
                    'recruiting_ai', 'hr_ai', 'compliance_ai',
                    'credentialing_ai', 'operations_ai',
                    'tool', 'system'
                  )),
  -- One of: 'text', 'tool_use', 'tool_result', 'status'.
  kind            TEXT NOT NULL DEFAULT 'text'
                  CHECK (kind IN ('text', 'tool_use', 'tool_result', 'status')),
  -- Plain text content (when kind='text' or 'status')
  content         TEXT,
  -- For kind='tool_use': the tool name + args. For kind='tool_result':
  -- the call id + the JSON result. Stored as JSONB so we can query
  -- "all tasks that called search_candidates" when debugging.
  tool_payload    JSONB,
  -- Token + duration accounting (best-effort, off Anthropic's response).
  input_tokens    INT,
  output_tokens   INT,
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_team_messages_task
  ON ai_team_messages(task_id, step_index ASC);

CREATE TABLE IF NOT EXISTS ai_team_artifacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES ai_team_tasks(id) ON DELETE CASCADE,
  -- Structured outputs the orchestrator wants to leave behind for the
  -- user to act on. e.g. kind='recommended_reminder' content has the
  -- subject/body/scheduled_at; user can one-click create the reminder.
  kind            TEXT NOT NULL,
  label           TEXT,
  payload         JSONB NOT NULL,
  -- True once the user actioned this artifact (e.g. created the
  -- recommended reminder / sent the recommended message).
  applied         BOOLEAN NOT NULL DEFAULT FALSE,
  applied_at      TIMESTAMPTZ,
  applied_ref     TEXT,                    -- e.g. id of the row created
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_team_artifacts_task
  ON ai_team_artifacts(task_id, applied);
