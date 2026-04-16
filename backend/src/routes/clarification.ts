import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';
import { generateClarificationQuestions } from '../services/intelligenceEngine';

const router = Router();

// GET /pending/count — count of pending questions (must be before /:id)
router.get('/pending/count', requireAuth, requirePermission('clarification_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT COUNT(*)::INT AS count FROM clarification_questions WHERE status = 'pending'`
    );
    res.json({ count: result.rows[0].count });
  } catch (err) {
    console.error('Pending clarification count error:', err);
    res.status(500).json({ error: 'Failed to fetch pending count' });
  }
});

// GET / — list clarification questions (filter by status, default: pending)
router.get('/', requireAuth, requirePermission('clarification_view'), async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'pending';

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status !== 'all') {
    conditions.push(`cq.status = $${idx++}`);
    params.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT cq.*,
              u_answered.name AS answered_by_name
       FROM clarification_questions cq
       LEFT JOIN users u_answered ON cq.answered_by = u_answered.id
       ${where}
       ORDER BY
         CASE cq.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         cq.created_at DESC`,
      params
    );
    res.json({ questions: result.rows, status_filter: status });
  } catch (err) {
    console.error('Clarification list error:', err);
    res.status(500).json({ error: 'Failed to fetch clarification questions' });
  }
});

// POST / — create a question manually
router.post('/', requireAuth, requirePermission('clarification_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { question, why_asked, priority, options, context } = req.body;
  const auth = getAuth(req);

  if (!question) {
    res.status(400).json({ error: 'question is required' });
    return;
  }

  const validPriorities = ['high', 'medium', 'low'];
  if (priority && !validPriorities.includes(priority)) {
    res.status(400).json({ error: 'priority must be high, medium, or low' });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO clarification_questions
         (question, why_asked, priority, options, context, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'pending',
               (SELECT id FROM users WHERE clerk_user_id = $6 LIMIT 1))
       RETURNING *`,
      [
        question,
        why_asked ?? null,
        priority ?? 'medium',
        options ? JSON.stringify(options) : null,
        context ?? null,
        auth?.userId ?? null,
      ]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'clarification.create', String(result.rows[0].id),
      { question: question.substring(0, 100) }, req.ip ?? 'unknown');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create clarification question error:', err);
    res.status(500).json({ error: 'Failed to create clarification question' });
  }
});

// POST /generate — AI generates questions for a context
router.post('/generate', requireAuth, requirePermission('clarification_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { context, contextData } = req.body;
  const auth = getAuth(req);

  if (!context) {
    res.status(400).json({ error: 'context is required' });
    return;
  }

  try {
    // generateClarificationQuestions inserts directly to the DB via intelligenceEngine
    await generateClarificationQuestions(context, contextData ?? {});

    // Fetch what was just inserted for this context so we can return them
    const result = await query(
      `SELECT * FROM clarification_questions
       WHERE context = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 10`,
      [context]
    );

    await logAudit(null, auth?.userId ?? 'unknown', 'clarification.generate', 'system',
      { context, generated: result.rows.length }, req.ip ?? 'unknown');

    res.status(201).json({ generated: result.rows.length, questions: result.rows });
  } catch (err) {
    console.error('Generate clarification questions error:', err);
    res.status(500).json({ error: 'Failed to generate clarification questions' });
  }
});

// GET /:id — get one question
router.get('/:id', requireAuth, requirePermission('clarification_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT cq.*,
              u_answered.name AS answered_by_name
       FROM clarification_questions cq
       LEFT JOIN users u_answered ON cq.answered_by = u_answered.id
       WHERE cq.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Clarification question not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get clarification question error:', err);
    res.status(500).json({ error: 'Failed to fetch clarification question' });
  }
});

// PATCH /:id/answer — answer a question
router.patch('/:id/answer', requireAuth, requirePermission('clarification_view'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { answer, notes } = req.body;
  const auth = getAuth(req);

  if (!answer || typeof answer !== 'string' || answer.trim().length === 0) {
    res.status(400).json({ error: 'answer is required' });
    return;
  }

  try {
    const existing = await query(`SELECT * FROM clarification_questions WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Clarification question not found' });
      return;
    }
    if (existing.rows[0].status === 'dismissed') {
      res.status(409).json({ error: 'Cannot answer a dismissed question' });
      return;
    }

    const result = await query(
      `UPDATE clarification_questions SET
         status      = 'answered',
         answer      = $1,
         notes       = COALESCE($2, notes),
         answered_by = (SELECT id FROM users WHERE clerk_user_id = $3 LIMIT 1),
         answered_at = NOW(),
         updated_at  = NOW()
       WHERE id = $4
       RETURNING *`,
      [answer.trim(), notes ?? null, auth?.userId ?? null, id]
    );

    await logAudit(null, auth?.userId ?? 'unknown', 'clarification.answered', id,
      { question_preview: String(existing.rows[0].question).substring(0, 100) }, req.ip ?? 'unknown');

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Answer clarification question error:', err);
    res.status(500).json({ error: 'Failed to answer clarification question' });
  }
});

// PATCH /:id/dismiss — dismiss a question
router.patch('/:id/dismiss', requireAuth, requirePermission('clarification_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const auth = getAuth(req);
  try {
    const existing = await query(`SELECT id, status FROM clarification_questions WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Clarification question not found' });
      return;
    }
    if (existing.rows[0].status === 'answered') {
      res.status(409).json({ error: 'Cannot dismiss an already-answered question' });
      return;
    }

    const result = await query(
      `UPDATE clarification_questions SET
         status     = 'dismissed',
         notes      = COALESCE($1, notes),
         updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [reason ?? null, id]
    );

    await logAudit(null, auth?.userId ?? 'unknown', 'clarification.dismissed', id,
      { reason: reason ?? null }, req.ip ?? 'unknown');

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Dismiss clarification question error:', err);
    res.status(500).json({ error: 'Failed to dismiss clarification question' });
  }
});

// DELETE /:id — delete a question
router.delete('/:id', requireAuth, requirePermission('clarification_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  try {
    const existing = await query(`SELECT id FROM clarification_questions WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Clarification question not found' });
      return;
    }
    await query(`DELETE FROM clarification_questions WHERE id = $1`, [id]);
    await logAudit(null, auth?.userId ?? 'unknown', 'clarification.delete', id,
      {}, req.ip ?? 'unknown');
    res.json({ success: true });
  } catch (err) {
    console.error('Delete clarification question error:', err);
    res.status(500).json({ error: 'Failed to delete clarification question' });
  }
});

export default router;
