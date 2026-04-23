-- Phase 5.2 — Action Plan tasks with subtasks + reminders
--
-- Separate from recruiter_tasks (that table is for candidate/job-scoped
-- recruiting work). Action Plan tasks are organizational operational work:
-- "Set up workers' comp", "Update facility agreements", etc. The old
-- ActionPlan.tsx stored these in localStorage.
--
-- Shape decisions:
--   * Mirror the existing frontend CustomTask type so the wire-up is a
--     near-mechanical rewrite of load/save paths.
--   * Subtasks live in a separate child table (not jsonb column) so the
--     frontend can toggle one without rewriting the whole task row, and
--     so completion timestamps per subtask survive.
--   * Reminders are scheduled dates + optional message. Not wired to an
--     actual notification pipeline in this phase — the UI flags them as
--     "due soon" when loading, and that's the trigger. Can extend later
--     to push via email/SMS without schema change.

CREATE TABLE IF NOT EXISTS plan_task_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  color VARCHAR(16),
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_task_groups_created_by ON plan_task_groups(created_by);

CREATE TABLE IF NOT EXISTS plan_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(300) NOT NULL,
  category VARCHAR(50),
  priority VARCHAR(10) NOT NULL DEFAULT 'Medium'
    CHECK (priority IN ('High','Medium','Low')),
  due_date DATE,
  notes TEXT,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  done_at TIMESTAMPTZ,
  group_id UUID REFERENCES plan_task_groups(id) ON DELETE SET NULL,
  -- Optional owner. If set, this task appears in that user's "my tasks"
  -- view; otherwise it's shared/team-visible.
  assigned_to VARCHAR(255),
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_group     ON plan_tasks(group_id);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_priority  ON plan_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_due_date  ON plan_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_done      ON plan_tasks(done);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_assigned  ON plan_tasks(assigned_to);

CREATE TABLE IF NOT EXISTS plan_subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES plan_tasks(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  done_at TIMESTAMPTZ,
  done_by VARCHAR(255),
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_subtasks_task ON plan_subtasks(task_id, order_index);

CREATE TABLE IF NOT EXISTS plan_task_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES plan_tasks(id) ON DELETE CASCADE,
  -- When to surface this reminder. Query "WHERE remind_at <= NOW() + N"
  -- to find upcoming reminders.
  remind_at TIMESTAMPTZ NOT NULL,
  message TEXT,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_task_reminders_remind_at ON plan_task_reminders(remind_at) WHERE dismissed = FALSE;
CREATE INDEX IF NOT EXISTS idx_plan_task_reminders_task      ON plan_task_reminders(task_id);
