import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';
import { generateDailySuggestions } from '../services/intelligenceEngine';

const router = Router();

// ---------------------------------------------------------------------------
// GET / â€” list suggestions
// ---------------------------------------------------------------------------
router.get('/', requireAuth, requirePermission('suggestions_view'), async (req: Request, res: Response) => {
  const { status, type, priority } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  // Default status to 'pending' unless explicitly overridden
  const statusFilter = (status as string) || 'pending';
  conditions.push(`status = $${idx++}`);
  params.push(statusFilter);

  if (type)     { conditions.push(`type = $${idx++}`);     params.push(type); }
  if (priority) { conditions.push(`priority = $${idx++}`); params.push(priority); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT s.*,
              u.name AS reviewed_by_name
       FROM suggestions s
       LEFT JOIN users u ON s.reviewed_by = u.id
       ${where}
       ORDER BY
         CASE s.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         s.generated_at DESC`,
      params
    );
    res.json({ suggestions: result.rows });
  } catch (err) {
    console.error('Suggestions list error:', err);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// ---------------------------------------------------------------------------
// POST /generate â€” generate new AI suggestions
// ---------------------------------------------------------------------------
router.post('/generate', requireAuth, requirePermission('suggestions_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const auth = getAuth(req);
  const userId = auth?.userId ?? 'unknown';

  try {
    await generateDailySuggestions(userId);

    // Return the newly generated suggestions (generated in last 2 minutes)
    const result = await query(
      `SELECT * FROM suggestions
       WHERE generated_at >= NOW() - INTERVAL '2 minutes'
       ORDER BY generated_at DESC`
    );

    await logAudit(null, userId, 'suggestions.generate', 'system',
      { count: result.rowCount }, (req.ip ?? 'unknown'));
    res.status(201).json({ suggestions: result.rows, generated: result.rowCount });
  } catch (err) {
    console.error('Generate suggestions error:', err);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

// ---------------------------------------------------------------------------
// GET /daily â€” today's pending suggestions (dashboard widget)
// ---------------------------------------------------------------------------
router.get('/daily', requireAuth, requirePermission('suggestions_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, type, title, description, reason, priority, status, generated_at
       FROM suggestions
       WHERE status = 'pending'
         AND DATE(generated_at) = CURRENT_DATE
       ORDER BY
         CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         generated_at DESC`
    );
    res.json({ suggestions: result.rows, date: new Date().toISOString().split('T')[0] });
  } catch (err) {
    console.error('Daily suggestions error:', err);
    res.status(500).json({ error: 'Failed to fetch daily suggestions' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id â€” get one suggestion
// ---------------------------------------------------------------------------
router.get('/:id', requireAuth, requirePermission('suggestions_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT s.*, u.name AS reviewed_by_name
       FROM suggestions s
       LEFT JOIN users u ON s.reviewed_by = u.id
       WHERE s.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get suggestion error:', err);
    res.status(500).json({ error: 'Failed to fetch suggestion' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id/approve â€” approve suggestion
// ---------------------------------------------------------------------------
router.patch('/:id/approve', requireAuth, requirePermission('suggestions_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { notes, edited_content } = req.body;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE suggestions SET
         status         = 'approved',
         notes          = COALESCE($1, notes),
         edited_content = COALESCE($2, edited_content),
         reviewed_by    = (SELECT id FROM users WHERE clerk_user_id = $3 LIMIT 1),
         reviewed_at    = NOW(),
         updated_at     = NOW()
       WHERE id = $4
       RETURNING *`,
      [notes || null, edited_content || null, auth?.userId ?? null, id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    await logAudit(null, auth?.userId ?? 'unknown', 'suggestion.approve', id,
      { notes: notes || null }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Approve suggestion error:', err);
    res.status(500).json({ error: 'Failed to approve suggestion' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id/reject â€” reject suggestion
// ---------------------------------------------------------------------------
router.patch('/:id/reject', requireAuth, requirePermission('suggestions_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { notes } = req.body;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE suggestions SET
         status      = 'rejected',
         notes       = COALESCE($1, notes),
         reviewed_by = (SELECT id FROM users WHERE clerk_user_id = $2 LIMIT 1),
         reviewed_at = NOW(),
         updated_at  = NOW()
       WHERE id = $3
       RETURNING *`,
      [notes || null, auth?.userId ?? null, id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    await logAudit(null, auth?.userId ?? 'unknown', 'suggestion.reject', id,
      { notes: notes || null }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Reject suggestion error:', err);
    res.status(500).json({ error: 'Failed to reject suggestion' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id/save â€” save for later
// ---------------------------------------------------------------------------
router.patch('/:id/save', requireAuth, requirePermission('suggestions_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE suggestions SET
         status     = 'saved',
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    await logAudit(null, auth?.userId ?? 'unknown', 'suggestion.save', id, {}, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Save suggestion error:', err);
    res.status(500).json({ error: 'Failed to save suggestion' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id â€” delete suggestion
// ---------------------------------------------------------------------------
router.delete('/:id', requireAuth, requirePermission('suggestions_manage'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      `DELETE FROM suggestions WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    await logAudit(null, auth?.userId ?? 'unknown', 'suggestion.delete', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true });
  } catch (err) {
    console.error('Delete suggestion error:', err);
    res.status(500).json({ error: 'Failed to delete suggestion' });
  }
});

export default router;
