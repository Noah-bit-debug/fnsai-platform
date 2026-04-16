import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';
import { generateDailySummary } from '../services/intelligenceEngine';

const router = Router();

// ---------------------------------------------------------------------------
// GET / — list recent daily summaries (last 30 days)
// ---------------------------------------------------------------------------
router.get('/', requireAuth, requirePermission('reports_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, summary_date, headline, status,
              suggestions_generated, questions_generated,
              reviewed_by, reviewed_at, generated_at
       FROM daily_summaries
       WHERE summary_date >= CURRENT_DATE - INTERVAL '30 days'
       ORDER BY summary_date DESC`
    );
    res.json({ summaries: result.rows });
  } catch (err) {
    console.error('Daily summaries list error:', err);
    res.status(500).json({ error: 'Failed to fetch daily summaries' });
  }
});

// ---------------------------------------------------------------------------
// GET /today — get or generate today's summary
// ---------------------------------------------------------------------------
router.get('/today', requireAuth, requirePermission('reports_view'), async (req: Request, res: Response) => {
  const today = new Date().toISOString().split('T')[0];

  try {
    const existing = await query(
      `SELECT * FROM daily_summaries WHERE summary_date = $1`,
      [today]
    );

    // Return existing if found and not in pending state
    if (existing.rows.length > 0 && existing.rows[0].status !== 'pending') {
      res.json(existing.rows[0]);
      return;
    }

    // Not found or still pending — generate now
    await generateDailySummary(today);

    const fresh = await query(
      `SELECT * FROM daily_summaries WHERE summary_date = $1`,
      [today]
    );

    if (fresh.rows.length === 0) {
      res.status(500).json({ error: 'Summary generation failed' });
      return;
    }

    res.json(fresh.rows[0]);
  } catch (err) {
    console.error('Get today summary error:', err);
    res.status(500).json({ error: 'Failed to get or generate today\'s summary' });
  }
});

// ---------------------------------------------------------------------------
// POST /generate — force regenerate today's summary
// ---------------------------------------------------------------------------
router.post('/generate', requireAuth, requirePermission('reports_view'), async (req: AuthenticatedRequest, res: Response) => {
  const today = new Date().toISOString().split('T')[0];
  const auth = getAuth(req);

  try {
    await generateDailySummary(today);

    const result = await query(
      `SELECT * FROM daily_summaries WHERE summary_date = $1`,
      [today]
    );

    if (result.rows.length === 0) {
      res.status(500).json({ error: 'Summary generation failed' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'dailySummary.generate', today,
      { date: today }, (req.ip ?? 'unknown'));
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Force generate summary error:', err);
    res.status(500).json({ error: 'Failed to generate daily summary' });
  }
});

// ---------------------------------------------------------------------------
// GET /:date — get summary for a specific date (YYYY-MM-DD)
// ---------------------------------------------------------------------------
router.get('/:date', requireAuth, requirePermission('reports_view'), async (req: Request, res: Response) => {
  const { date } = req.params;

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
    return;
  }

  try {
    const result = await query(
      `SELECT * FROM daily_summaries WHERE summary_date = $1`,
      [date]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: `No summary found for ${date}` });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get summary by date error:', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id/review — mark summary as reviewed
// ---------------------------------------------------------------------------
router.patch('/:id/review', requireAuth, requirePermission('reports_view'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE daily_summaries SET
         status      = 'reviewed',
         reviewed_by = (SELECT id FROM users WHERE clerk_user_id = $1 LIMIT 1),
         reviewed_at = NOW(),
         updated_at  = NOW()
       WHERE id = $2
       RETURNING *`,
      [auth?.userId ?? null, id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Summary not found' });
      return;
    }
    await logAudit(null, auth?.userId ?? 'unknown', 'dailySummary.review', id,
      { summary_date: result.rows[0].summary_date }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Review summary error:', err);
    res.status(500).json({ error: 'Failed to mark summary as reviewed' });
  }
});

export default router;
