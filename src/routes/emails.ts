import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { query } from '../db/client';
import { getEmails } from '../services/graph';
import { categorizeEmail } from '../services/ai';

const router = Router();

// GET / - list scanned emails from DB
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { category, actioned, limit = '50', offset = '0' } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (category) {
    conditions.push(`ai_category = $${paramIndex++}`);
    params.push(category);
  }
  if (actioned !== undefined) {
    conditions.push(`actioned = $${paramIndex++}`);
    params.push(actioned === 'true');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT * FROM email_logs
       ${whereClause}
       ORDER BY received_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, Number(limit), Number(offset)]
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM email_logs ${whereClause}`,
      params
    );

    res.json({ emails: result.rows, total: Number(countResult.rows[0].count) });
  } catch (err) {
    console.error('Email list error:', err);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// POST /scan - trigger Microsoft Graph scan + AI categorization
router.post('/scan', requireAuth, async (req: Request, res: Response) => {
  const { userId, top = 25 } = req.body;

  try {
    const emails = await getEmails(userId as string | undefined, Number(top));
    const processed: Array<{ id: string; subject: string; category: string }> = [];

    for (const email of emails) {
      // Skip if already processed
      const existing = await query(
        'SELECT id FROM email_logs WHERE outlook_message_id = $1',
        [email.id]
      );
      if (existing.rows.length > 0) continue;

      const categorization = await categorizeEmail(
        email.subject ?? '(no subject)',
        email.body?.content ?? email.bodyPreview ?? '',
        `${email.from?.emailAddress?.name} <${email.from?.emailAddress?.address}>`
      );

      await query(
        `INSERT INTO email_logs
           (outlook_message_id, from_address, from_name, subject, received_at, ai_category, ai_summary, action_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (outlook_message_id) DO NOTHING`,
        [
          email.id,
          email.from?.emailAddress?.address,
          email.from?.emailAddress?.name,
          email.subject,
          email.receivedDateTime,
          categorization.category,
          categorization.summary,
          categorization.action_required,
        ]
      );

      processed.push({
        id: email.id,
        subject: email.subject,
        category: categorization.category,
      });
    }

    res.json({ scanned: emails.length, newEmails: processed.length, emails: processed });
  } catch (err) {
    console.error('Email scan error:', err);
    res.status(500).json({ error: 'Failed to scan emails' });
  }
});

// POST /:id/action - mark email as actioned
router.post('/:id/action', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await query(
      'UPDATE email_logs SET actioned = true WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Email log not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Email action error:', err);
    res.status(500).json({ error: 'Failed to update email' });
  }
});

// GET /stats - counts by category
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
         ai_category,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE action_required = true) AS action_required,
         COUNT(*) FILTER (WHERE actioned = false AND action_required = true) AS pending_action
       FROM email_logs
       GROUP BY ai_category`
    );

    const totalResult = await query('SELECT COUNT(*) FROM email_logs');

    res.json({
      byCategory: result.rows,
      total: Number(totalResult.rows[0].count),
    });
  } catch (err) {
    console.error('Email stats error:', err);
    res.status(500).json({ error: 'Failed to fetch email stats' });
  }
});

export default router;
