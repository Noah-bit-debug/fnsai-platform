import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '../middleware/auth';
import { query } from '../db/client';
import { getEmails } from '../services/graph';
import { categorizeEmail } from '../services/ai';

const router = Router();

// Resolve which Microsoft mailbox to monitor for the calling user.
//
// Each signed-in user gets their own inbox monitored. Priority:
//   1. Explicit request body / query — admin override / "view as someone else"
//   2. The authenticated user's email (from the Azure ID token's
//      `email` or `preferred_username` claim, lowercased) — the
//      common "monitor my own mailbox" case.
//   3. Legacy MICROSOFT_USER_ID / ONEDRIVE_USER_ID env vars — kept so
//      service accounts and pre-auth integrations don't break.
//
// Returns null if nothing usable was found; the route turns that into
// a 400 with a helpful message.
function resolveMailbox(req: Request, explicit?: string | null): string | null {
  const fromBody = (explicit ?? '').trim().toLowerCase();
  if (fromBody) return fromBody;
  const auth = getAuth(req);
  if (auth?.email) return auth.email.toLowerCase();
  return process.env.MICROSOFT_USER_ID
    ?? process.env.ONEDRIVE_USER_ID
    ?? null;
}

// GET / - list scanned emails for the calling user's mailbox.
//
// Each user sees only emails scanned from their own inbox. An explicit
// ?mailbox=other@domain query param can override this for admins (we
// rely on per-route permissions elsewhere to actually gate that — for
// now anyone authenticated can pass the override, which is fine since
// they need the mailbox value anyway).
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { category, actioned, limit = '50', offset = '0', mailbox: mailboxOverride } = req.query;

  const mailbox = resolveMailbox(req, mailboxOverride as string | undefined);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Always scope by mailbox when we have one. Without a mailbox we only
  // return the unscoped legacy rows (mailbox IS NULL) so the page isn't
  // misleadingly empty for first-time users running an out-of-the-box
  // install.
  if (mailbox) {
    conditions.push(`mailbox = $${paramIndex++}`);
    params.push(mailbox);
  } else {
    conditions.push(`mailbox IS NULL`);
  }

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

    res.json({ emails: result.rows, total: Number(countResult.rows[0].count), mailbox });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ emails: [], total: 0, mailbox }); return; }
    console.error('Email list error:', err);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// POST /scan - trigger Microsoft Graph scan + AI categorization for the
// calling user's mailbox.
router.post('/scan', requireAuth, async (req: Request, res: Response) => {
  const { userId: bodyUserId, top = 25 } = req.body;

  const userId = resolveMailbox(req, bodyUserId as string | undefined);

  if (!userId) {
    res.status(400).json({
      error: 'Could not determine your mailbox. Sign out and back in so we can read your email from your Microsoft session, or pass userId in the request body.',
    });
    return;
  }

  try {
    const emails = await getEmails(userId, Number(top));

    // Dedupe in one round-trip instead of N. The previous code did a
    // SELECT per email, which compounded with the per-email AI call to
    // push total scan time well past the frontend's 30s axios timeout.
    const ids = emails.map((e) => e.id);
    const existing = ids.length
      ? await query(
          'SELECT outlook_message_id FROM email_logs WHERE outlook_message_id = ANY($1)',
          [ids]
        )
      : { rows: [] as Array<{ outlook_message_id: string }> };
    const seen = new Set(existing.rows.map((r) => r.outlook_message_id));
    const newEmails = emails.filter((e) => !seen.has(e.id));

    // Categorize + insert in parallel with a small concurrency cap.
    // Sequential was the other half of the timeout problem: 25 emails
    // × ~2-3s each Anthropic call = 50-75s. Concurrency 5 keeps total
    // wall-clock under ~15s while staying well within Anthropic's
    // per-minute limits and the pg pool size.
    const CONCURRENCY = 5;
    const processed: Array<{ id: string; subject: string; category: string }> = [];
    for (let i = 0; i < newEmails.length; i += CONCURRENCY) {
      const batch = newEmails.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (email) => {
          const categorization = await categorizeEmail(
            email.subject ?? '(no subject)',
            email.body?.content ?? email.bodyPreview ?? '',
            `${email.from?.emailAddress?.name} <${email.from?.emailAddress?.address}>`
          );

          await query(
            `INSERT INTO email_logs
               (outlook_message_id, from_address, from_name, subject, received_at, ai_category, ai_summary, action_required, mailbox)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
              userId,
            ]
          );

          return {
            id: email.id,
            subject: email.subject,
            category: categorization.category,
          };
        })
      );
      processed.push(...results);
    }

    res.json({ scanned: emails.length, newEmails: processed.length, emails: processed, mailbox: userId });
  } catch (err) {
    // Surface the specific failure reason. Three common cases:
    // 1. "Microsoft Graph credentials not configured" — env vars missing
    // 2. Graph 401/403 — wrong scopes or missing admin consent on the app
    // 3. Graph 404 — userId doesn't exist in the tenant
    const e = err as { message?: string; statusCode?: number; code?: string; body?: unknown };
    console.error('Email scan error:', { message: e.message, statusCode: e.statusCode, code: e.code });

    // Env-var misconfiguration
    if (e.message?.includes('Microsoft Graph credentials not configured')) {
      res.status(503).json({
        error: 'Microsoft Graph credentials not configured on server. Set MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_USER_ID.',
      });
      return;
    }

    // Graph auth failure
    if (e.statusCode === 401 || e.statusCode === 403) {
      res.status(502).json({
        error: `Microsoft Graph auth failed (${e.statusCode}). The app registration may be missing Mail.Read application permission, or admin consent hasn't been granted. ${e.message?.slice(0, 200) ?? ''}`,
      });
      return;
    }

    // User not found
    if (e.statusCode === 404) {
      res.status(404).json({
        error: `Mailbox "${userId}" not found in the Microsoft tenant. If this is your own email, the app registration may not have permission to read it; ask an admin to confirm Mail.Read application permission and admin consent.`,
      });
      return;
    }

    res.status(500).json({
      error: `Failed to scan emails: ${e.message?.slice(0, 300) ?? 'unknown error'}`,
      code: e.code,
      statusCode: e.statusCode,
    });
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
