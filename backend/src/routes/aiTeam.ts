/**
 * AI Team workspace API. Mounted at /api/v1/ai-team.
 *
 * Endpoints:
 *   GET    /tasks                   list (filterable by status / mine)
 *   POST   /tasks                   create new task (status='draft')
 *   GET    /tasks/:id               task detail (task + messages + artifacts)
 *   POST   /tasks/:id/run           kick off the orchestrator loop. Async —
 *                                   returns immediately; client polls /tasks/:id
 *                                   to watch the thread fill in.
 *   POST   /tasks/:id/approve       accept the final output
 *   POST   /tasks/:id/reject        reject + reset to 'rejected' (kept for audit)
 *   PATCH  /tasks/:id/output        edit final_output before approving
 *   DELETE /tasks/:id               delete the whole thread
 *   POST   /tasks/:id/artifacts/:aid/applied
 *                                   mark an artifact as actioned by the user
 *
 * Permission gate:
 *   ai.team.use is required for everything. The catalog already grants this
 *   to ceo / admin / manager.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, getAuth } from '../middleware/auth';
import { query } from '../db/client';
import { requirePermission, resolveDbUserIdFromOid } from '../services/permissions/permissionService';
import { runTask } from '../services/aiTeam/runner';

const router = Router();

const createSchema = z.object({
  title:       z.string().min(3).max(200),
  description: z.string().min(10).max(8000),
  source_type: z.string().max(40).optional().nullable(),
  source_id:   z.string().uuid().optional().nullable(),
});

const editOutputSchema = z.object({
  final_output: z.string().min(1).max(20000),
});

// ─── GET /tasks ────────────────────────────────────────────────────────
router.get('/tasks', requireAuth, requirePermission('ai.team.use'), async (req: Request, res: Response) => {
  const { status, mine } = req.query;
  const auth = getAuth(req);
  const conds: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (status) { conds.push(`status = $${i++}`); params.push(status); }
  if (mine === 'true' && auth?.userId) {
    const dbId = await resolveDbUserIdFromOid(auth.userId);
    if (dbId) { conds.push(`created_by = $${i++}`); params.push(dbId); }
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  try {
    const r = await query(
      `SELECT t.id, t.title, t.description, t.status, t.turn_count, t.error,
              t.source_type, t.source_id, t.created_by,
              u.name AS created_by_name,
              t.created_at, t.updated_at, t.completed_at
         FROM ai_team_tasks t
         LEFT JOIN users u ON u.id = t.created_by
         ${where}
        ORDER BY t.created_at DESC
        LIMIT 200`,
      params
    );
    res.json({ tasks: r.rows });
  } catch (err) {
    console.error('[ai-team] list error:', err);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// ─── POST /tasks ───────────────────────────────────────────────────────
router.post('/tasks', requireAuth, requirePermission('ai.team.use'), async (req: Request, res: Response) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const auth = getAuth(req);
  const dbUserId = await resolveDbUserIdFromOid(auth?.userId);
  try {
    const r = await query<{ id: string }>(
      `INSERT INTO ai_team_tasks (title, description, source_type, source_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [parse.data.title, parse.data.description, parse.data.source_type ?? null, parse.data.source_id ?? null, dbUserId]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    console.error('[ai-team] create error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// ─── GET /tasks/:id ────────────────────────────────────────────────────
router.get('/tasks/:id', requireAuth, requirePermission('ai.team.use'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const t = await query(
      `SELECT t.*, u.name AS created_by_name
         FROM ai_team_tasks t
         LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = $1`,
      [id]
    );
    if (t.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }

    const msgs = await query(
      `SELECT id, step_index, persona, kind, content, tool_payload,
              input_tokens, output_tokens, duration_ms, created_at
         FROM ai_team_messages
        WHERE task_id = $1
        ORDER BY step_index ASC, created_at ASC`,
      [id]
    );
    const artifacts = await query(
      `SELECT id, kind, label, payload, applied, applied_at, applied_ref, created_at
         FROM ai_team_artifacts
        WHERE task_id = $1
        ORDER BY created_at ASC`,
      [id]
    );
    res.json({
      task: t.rows[0],
      messages: msgs.rows,
      artifacts: artifacts.rows,
    });
  } catch (err) {
    console.error('[ai-team] get error:', err);
    res.status(500).json({ error: 'Failed to load task' });
  }
});

// ─── POST /tasks/:id/run ───────────────────────────────────────────────
//
// Kicks off the orchestrator loop. Returns immediately with status='running';
// the runner appends messages as it goes and the client polls /tasks/:id.
//
// Concurrency: an atomic conditional UPDATE acts as a row-level lock — only
// one caller wins the flip from non-running to running. A SELECT-then-call
// pattern would be racy; two near-simultaneous POSTs would both pass the
// check and spawn two runners writing to the same task.
router.post('/tasks/:id/run', requireAuth, requirePermission('ai.team.use'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Take the slot in one shot. Returns the row only if the flip happened.
    const claim = await query<{ id: string; prior_status: string }>(
      `UPDATE ai_team_tasks
          SET status = 'running', updated_at = NOW(), error = NULL
        WHERE id = $1
          AND status NOT IN ('running', 'approved', 'rejected')
       RETURNING id, status AS prior_status`,
      [id]
    );
    if (claim.rows.length === 0) {
      // Either the task doesn't exist, is already running, or is terminal.
      const t = await query<{ status: string }>(`SELECT status FROM ai_team_tasks WHERE id = $1`, [id]);
      if (t.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
      if (t.rows[0].status === 'running') {
        res.status(409).json({ error: 'Task is already running' });
        return;
      }
      res.status(409).json({ error: `Task is ${t.rows[0].status}; reopen by creating a new task.` });
      return;
    }
    // Fire-and-forget the run. Errors are persisted onto the task row by
    // runTask itself; we don't make the HTTP request wait.
    runTask(id).catch((err) => {
      console.error('[ai-team] run failed:', err);
    });
    res.status(202).json({ accepted: true, task_id: id });
  } catch (err) {
    console.error('[ai-team] run error:', err);
    res.status(500).json({ error: 'Failed to start run' });
  }
});

// ─── POST /tasks/:id/approve ───────────────────────────────────────────
router.post('/tasks/:id/approve', requireAuth, requirePermission('ai.team.use'), async (req: Request, res: Response) => {
  try {
    const r = await query<{ id: string }>(
      `UPDATE ai_team_tasks
          SET status='approved', completed_at=COALESCE(completed_at, NOW()), updated_at=NOW()
        WHERE id=$1 AND status='awaiting_approval'
        RETURNING id`,
      [req.params.id]
    );
    if (r.rows.length === 0) { res.status(409).json({ error: 'Task is not awaiting approval' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('[ai-team] approve error:', err);
    res.status(500).json({ error: 'Failed to approve' });
  }
});

// ─── POST /tasks/:id/reject ────────────────────────────────────────────
router.post('/tasks/:id/reject', requireAuth, requirePermission('ai.team.use'), async (req: Request, res: Response) => {
  try {
    const r = await query<{ id: string }>(
      `UPDATE ai_team_tasks
          SET status='rejected', completed_at=COALESCE(completed_at, NOW()), updated_at=NOW()
        WHERE id=$1
        RETURNING id`,
      [req.params.id]
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('[ai-team] reject error:', err);
    res.status(500).json({ error: 'Failed to reject' });
  }
});

// ─── PATCH /tasks/:id/output ───────────────────────────────────────────
router.patch('/tasks/:id/output', requireAuth, requirePermission('ai.team.use'), async (req: Request, res: Response) => {
  const parse = editOutputSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error' }); return; }
  try {
    const r = await query(
      `UPDATE ai_team_tasks
          SET final_output=$1, updated_at=NOW()
        WHERE id=$2 AND status IN ('awaiting_approval', 'rejected')
        RETURNING id`,
      [parse.data.final_output, req.params.id]
    );
    if (r.rows.length === 0) { res.status(409).json({ error: 'Task is not editable' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('[ai-team] edit output error:', err);
    res.status(500).json({ error: 'Failed to edit output' });
  }
});

// ─── DELETE /tasks/:id ─────────────────────────────────────────────────
router.delete('/tasks/:id', requireAuth, requirePermission('ai.team.use'), async (req: Request, res: Response) => {
  try {
    await query(`DELETE FROM ai_team_tasks WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[ai-team] delete error:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// ─── POST /tasks/:id/artifacts/:aid/applied ────────────────────────────
//
// User confirms they actioned a recommended artifact. The frontend
// optionally passes `applied_ref` (e.g. the id of the row it just created
// from the artifact payload) so a future re-render can de-dupe.
router.post('/tasks/:id/artifacts/:aid/applied', requireAuth, requirePermission('ai.team.use'), async (req: Request, res: Response) => {
  const { id, aid } = req.params;
  const ref = (req.body?.applied_ref ?? null) as string | null;
  try {
    const r = await query(
      `UPDATE ai_team_artifacts
          SET applied=TRUE, applied_at=NOW(), applied_ref=$1
        WHERE id=$2 AND task_id=$3
        RETURNING id`,
      [ref, aid, id]
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'Artifact not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('[ai-team] mark applied error:', err);
    res.status(500).json({ error: 'Failed to mark artifact applied' });
  }
});

export default router;
