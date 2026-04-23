import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';
import { generateDailySummary, SummaryPeriod, SummaryScope } from '../services/intelligenceEngine';

const router = Router();

const VALID_PERIODS: SummaryPeriod[] = ['day', 'week', 'month'];
const VALID_SCOPES:  SummaryScope[]  = ['all', 'recruiting', 'hr', 'credentialing', 'bd', 'ceo'];

function parsePeriod(v: unknown): SummaryPeriod {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return (VALID_PERIODS as string[]).includes(s) ? (s as SummaryPeriod) : 'day';
}
function parseScope(v: unknown): SummaryScope {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return (VALID_SCOPES as string[]).includes(s) ? (s as SummaryScope) : 'all';
}

// ---------------------------------------------------------------------------
// GET / â€” list recent summaries (last 90 days). Optional filters:
//   ?period=day|week|month
//   ?scope=all|recruiting|hr|credentialing|bd|ceo
// ---------------------------------------------------------------------------
router.get('/', requireAuth, requirePermission('reports_view'), async (req: Request, res: Response) => {
  const params: unknown[] = [];
  let where = `WHERE summary_date >= CURRENT_DATE - INTERVAL '90 days'`;
  if (typeof req.query.period === 'string' && (VALID_PERIODS as string[]).includes(req.query.period)) {
    params.push(req.query.period);
    where += ` AND period = $${params.length}`;
  }
  if (typeof req.query.scope === 'string' && (VALID_SCOPES as string[]).includes(req.query.scope)) {
    params.push(req.query.scope);
    where += ` AND scope = $${params.length}`;
  }
  try {
    const result = await query(
      `SELECT id, summary_date, period, scope, headline, status,
              suggestions_generated, questions_generated,
              reviewed_by, reviewed_at, generated_at
         FROM daily_summaries
         ${where}
         ORDER BY summary_date DESC, period ASC, scope ASC`,
      params
    );
    res.json({ summaries: result.rows });
  } catch (err) {
    console.error('Daily summaries list error:', err);
    const e = err as { message?: string };
    res.status(500).json({ error: `Failed to fetch summaries: ${e.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ---------------------------------------------------------------------------
// GET /today â€” get or generate today's summary for the requested (period, scope).
// ---------------------------------------------------------------------------
router.get('/today', requireAuth, requirePermission('reports_view'), async (req: Request, res: Response) => {
  const today = new Date().toISOString().split('T')[0];
  const period = parsePeriod(req.query.period);
  const scope  = parseScope(req.query.scope);

  try {
    const existing = await query(
      `SELECT * FROM daily_summaries WHERE summary_date = $1 AND period = $2 AND scope = $3`,
      [today, period, scope]
    );
    if (existing.rows.length > 0 && existing.rows[0].status !== 'pending') {
      res.json(existing.rows[0]);
      return;
    }

    await generateDailySummary(today, period, scope);

    const fresh = await query(
      `SELECT * FROM daily_summaries WHERE summary_date = $1 AND period = $2 AND scope = $3`,
      [today, period, scope]
    );
    if (fresh.rows.length === 0) {
      res.status(500).json({ error: 'Summary generation failed' });
      return;
    }
    res.json(fresh.rows[0]);
  } catch (err) {
    console.error('Get today summary error:', err);
    const e = err as { message?: string };
    res.status(500).json({ error: `Failed to get/generate ${period}/${scope} summary: ${e.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ---------------------------------------------------------------------------
// POST /generate â€” force regenerate.
// Body: { period?: 'day'|'week'|'month', scope?: ..., date?: 'YYYY-MM-DD' }
// ---------------------------------------------------------------------------
router.post('/generate', requireAuth, requirePermission('reports_view'), async (req: AuthenticatedRequest, res: Response) => {
  const today = new Date().toISOString().split('T')[0];
  const period = parsePeriod(req.body?.period);
  const scope  = parseScope(req.body?.scope);
  const date = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
    ? req.body.date : today;
  const auth = getAuth(req);

  try {
    await generateDailySummary(date, period, scope);

    const result = await query(
      `SELECT * FROM daily_summaries WHERE summary_date = $1 AND period = $2 AND scope = $3`,
      [date, period, scope]
    );
    if (result.rows.length === 0) {
      res.status(500).json({ error: 'Summary generation failed' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'dailySummary.generate', `${date}/${period}/${scope}`,
      { date, period, scope }, (req.ip ?? 'unknown'));
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Force generate summary error:', err);
    const e = err as { message?: string };
    res.status(500).json({ error: `Failed to generate ${period}/${scope} summary: ${e.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ---------------------------------------------------------------------------
// GET /:date â€” get summary for a specific date + optional ?period=, ?scope=
// ---------------------------------------------------------------------------
router.get('/:date', requireAuth, requirePermission('reports_view'), async (req: Request, res: Response) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
    return;
  }
  const period = parsePeriod(req.query.period);
  const scope  = parseScope(req.query.scope);

  try {
    const result = await query(
      `SELECT * FROM daily_summaries WHERE summary_date = $1 AND period = $2 AND scope = $3`,
      [date, period, scope]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: `No ${period}/${scope} summary found for ${date}` });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get summary by date error:', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id/review â€” mark summary as reviewed
// ---------------------------------------------------------------------------
router.patch('/:id/review', requireAuth, requirePermission('reports_view'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE daily_summaries SET
         status      = 'reviewed',
         reviewed_by = (SELECT id FROM users WHERE clerk_user_id = $1 LIMIT 1),
         reviewed_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [auth?.userId ?? null, id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Summary not found' });
      return;
    }
    await logAudit(null, auth?.userId ?? 'unknown', 'dailySummary.review', id,
      { summary_date: result.rows[0].summary_date, period: result.rows[0].period, scope: result.rows[0].scope },
      (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Review summary error:', err);
    res.status(500).json({ error: 'Failed to mark summary as reviewed' });
  }
});

export default router;
