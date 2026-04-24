import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getAuth } from '../middleware/auth';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';

const router = Router();

const taskSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional().nullable(),
  task_type: z.enum(['call', 'meeting', 'todo', 'follow_up', 'email', 'sms', 'other']).optional().nullable(),
  due_at: z.string().optional().nullable(),
  timezone: z.string().max(50).optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  escalate_to: z.string().uuid().optional().nullable(),
  reminder_minutes_before: z.number().int().min(0).optional().nullable(),
  recurrence: z.string().max(200).optional().nullable(),
  notify_email: z.boolean().optional(),
  notify_sms: z.boolean().optional(),
  candidate_id: z.string().uuid().optional().nullable(),
  job_id: z.string().uuid().optional().nullable(),
  submission_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
});

// GET / — list with overdue flag computed in SELECT
router.get('/', requireAuth, requirePermission('candidates_view'), async (req: Request, res: Response) => {
  const { assigned_to, candidate_id, job_id, submission_id, client_id, status, overdue, due_today } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (assigned_to) { conditions.push(`t.assigned_to = $${idx++}`); params.push(assigned_to); }
  if (candidate_id) { conditions.push(`t.candidate_id = $${idx++}`); params.push(candidate_id); }
  if (job_id) { conditions.push(`t.job_id = $${idx++}`); params.push(job_id); }
  if (submission_id) { conditions.push(`t.submission_id = $${idx++}`); params.push(submission_id); }
  if (client_id) { conditions.push(`t.client_id = $${idx++}`); params.push(client_id); }
  if (status) { conditions.push(`t.status = $${idx++}`); params.push(status); }
  if (overdue === 'true') { conditions.push(`t.status = 'open' AND t.due_at < NOW()`); }
  if (due_today === 'true') { conditions.push(`t.status = 'open' AND t.due_at::date = CURRENT_DATE`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT t.*,
              (t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at < NOW()) AS is_overdue,
              u_assign.name AS assigned_to_name,
              u_create.name AS created_by_name,
              (c.first_name || ' ' || c.last_name) AS candidate_name,
              j.title AS job_title,
              cl.name AS client_name
       FROM recruiter_tasks t
       LEFT JOIN users u_assign ON t.assigned_to = u_assign.id
       LEFT JOIN users u_create ON t.created_by = u_create.id
       LEFT JOIN candidates c ON t.candidate_id = c.id
       LEFT JOIN jobs j ON t.job_id = j.id
       LEFT JOIN clients cl ON t.client_id = cl.id
       ${where}
       ORDER BY
         CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
         t.due_at ASC NULLS LAST,
         t.created_at DESC
       LIMIT 500`,
      params
    );
    res.json({ tasks: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ tasks: [] }); return; }
    console.error('Tasks list error:', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// POST / — create
router.post('/', requireAuth, requirePermission('reminders_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const d = parsed.data;

  try {
    const result = await query(
      `INSERT INTO recruiter_tasks (
         title, description, task_type, due_at, timezone,
         assigned_to, escalate_to, reminder_minutes_before, recurrence,
         notify_email, notify_sms,
         candidate_id, job_id, submission_id, client_id,
         created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       ) RETURNING *`,
      [
        d.title, d.description ?? null, d.task_type ?? 'todo', d.due_at ?? null, d.timezone ?? null,
        d.assigned_to ?? null, d.escalate_to ?? null, d.reminder_minutes_before ?? null, d.recurrence ?? null,
        d.notify_email ?? true, d.notify_sms ?? false,
        d.candidate_id ?? null, d.job_id ?? null, d.submission_id ?? null, d.client_id ?? null,
        req.userRecord?.id ?? null,
      ]
    );
    await logAudit(req.userRecord?.id ?? null, getAuth(req).userId ?? 'system', 'task.create', result.rows[0].id as string);
    res.status(201).json({ task: result.rows[0] });
  } catch (err) {
    console.error('Task create error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /:id
router.put('/:id', requireAuth, requirePermission('reminders_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = taskSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  const setParts = entries.map(([k], i) => `${k} = $${i + 1}`);
  const values: unknown[] = entries.map(([, v]) => v);
  values.push(req.params.id);

  try {
    const result = await query(
      `UPDATE recruiter_tasks SET ${setParts.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ task: result.rows[0] });
  } catch (err) {
    console.error('Task update error:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// POST /:id/complete
router.post('/:id/complete', requireAuth, requirePermission('reminders_manage'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `UPDATE recruiter_tasks
       SET status = 'done', completed_at = NOW(), completed_by = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [req.userRecord?.id ?? null, req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ task: result.rows[0] });
  } catch (err) {
    console.error('Task complete error:', err);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// DELETE /:id — cancel
router.delete('/:id', requireAuth, requirePermission('reminders_manage'), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE recruiter_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Task cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel task' });
  }
});

export default router;
