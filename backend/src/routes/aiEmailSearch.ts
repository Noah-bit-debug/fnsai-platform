import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getAuth } from '../middleware/auth';
import { pool } from '../db/client';
import Anthropic from '@anthropic-ai/sdk';
import { searchEmails, getEmailWithAttachments } from '../services/graph';
import { MODEL_FOR } from '../services/aiModels';
import { requirePermission } from '../services/permissions/permissionService';
import { guardAIRequest } from '../services/permissions/aiGuard';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── POST /api/v1/ai-email/search ───────────────────────────────────────
// Requires ai.search.email (high-risk) permission.
// Only searches the user's OWN Outlook mailbox — never another user's.
router.post('/search', requireAuth, requirePermission('ai.search.email'), async (req: Request, res: Response) => {
  const { sender, keyword, subject, date_from, date_to, has_attachments, top = 20, user_id } = req.body as {
    sender?: string; keyword?: string; subject?: string; date_from?: string; date_to?: string;
    has_attachments?: boolean; top?: number; user_id?: string;
  };
  const auth = getAuth(req);

  // Security: ignore any caller-supplied user_id — always use the
  // authenticated user's Azure oid. Prevents "search as someone else".
  const safeUserId = auth?.userId;
  if (user_id && user_id !== safeUserId) {
    console.warn(`[ai-email] user_id override ignored: caller ${safeUserId} tried to search as ${user_id}`);
  }

  try {
    const emails = await searchEmails({
      sender, keyword, subject,
      dateFrom: date_from, dateTo: date_to,
      hasAttachments: has_attachments,
      top: Math.min(top, 50),
      userId: safeUserId,
    });
    await pool.query(
      `INSERT INTO ai_brain_audit (user_clerk_id, action_type, source, details, ip_address) VALUES ($1, 'email_search', 'outlook', $2, $3)`,
      [auth?.userId ?? 'unknown', JSON.stringify({ sender, keyword, subject, has_attachments, count: emails.length }), req.ip ?? 'unknown']
    ).catch(() => {});
    res.json({ emails, total: emails.length });
  } catch (err: any) {
    res.json({ emails: [], total: 0, error: err.message ?? 'Email search unavailable — Microsoft Graph not configured' });
  }
});

// ─── POST /api/v1/ai-email/summarize ────────────────────────────────────
// Runs emails through Claude for summarization. Requires ai.search.email
// (to even GET the emails) + ai.chat.use. AI guard runs on the question
// text to catch injection attempts embedded in the user's prompt.
router.post('/summarize', requireAuth, requirePermission('ai.search.email'), async (req: Request, res: Response) => {
  const { emails, question } = req.body as {
    emails: Array<{ subject: string; from: string; receivedDateTime: string; bodyPreview: string }>;
    question?: string;
  };
  if (!emails || emails.length === 0) { res.status(400).json({ error: 'emails array is required' }); return; }

  // Guard the user's free-text question — topic detection, injection block.
  const guard = await guardAIRequest({
    req,
    tool: 'ai_email_search',
    toolPermission: 'ai.chat.use',
    additionalRequired: ['ai.search.email'],
    prompt: question ?? 'Summarize recent emails',
  });
  if (!guard.allowed) {
    res.json({ summary: guard.denialMessage ?? 'I can\'t help with that.', guard: { denied: true } });
    return;
  }

  const auth = getAuth(req);
  try {
    const emailText = emails.slice(0, 20).map((e, i) =>
      `Email ${i + 1}:\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.receivedDateTime}\nPreview: ${(e.bodyPreview ?? '').slice(0, 300)}`
    ).join('\n\n---\n\n');
    const prompt = question
      ? `Based on these ${emails.length} emails, answer: "${question}"\n\nEmails:\n${emailText}`
      : `Summarize these ${emails.length} emails for a healthcare staffing coordinator. Identify key action items, important contacts, and anything time-sensitive.\n\nEmails:\n${emailText}`;
    const response = await anthropic.messages.create({
      model: MODEL_FOR.searchSynthesis,
      max_tokens: 2048,
      system: `${guard.systemPromptGuard}You are FNS AI Brain, analyzing emails for Frontline Healthcare Staffing. Be concise and operational. Focus on: credentials, placements, candidates, compliance, facility requests.`,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content[0];
    const summary = block.type === 'text' ? block.text : 'Unable to summarize.';
    await pool.query(
      `INSERT INTO ai_brain_audit (user_clerk_id, action_type, source, details, ip_address) VALUES ($1, 'email_summarize', 'outlook', $2, $3)`,
      [auth?.userId ?? 'unknown', JSON.stringify({ email_count: emails.length, question: (question ?? '').slice(0, 200) }), req.ip ?? 'unknown']
    ).catch(() => {});
    res.json({ summary });
  } catch (err) {
    console.error('Email summarize error:', err);
    res.status(500).json({ error: 'Summarization failed' });
  }
});

// ─── GET /api/v1/ai-email/recent ────────────────────────────────────────
router.get('/recent', requireAuth, requirePermission('ai.search.email'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const top = Math.min(parseInt(req.query.top as string) || 20, 50);
  // Security: always use caller's own mailbox.
  const safeUserId = auth?.userId;
  try {
    const emails = await searchEmails({ top, userId: safeUserId });
    res.json({ emails, total: emails.length });
  } catch (err: any) {
    res.json({ emails: [], total: 0, error: err.message ?? 'Email service unavailable' });
  }
});

// ─── GET /api/v1/ai-email/:id/attachments ──────────────────────────────
router.get('/:id/attachments', requireAuth, requirePermission('ai.search.email'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  const safeUserId = auth?.userId;
  try {
    const result = await getEmailWithAttachments(id, safeUserId);
    res.json(result);
  } catch (err: any) {
    res.json({ attachments: [], error: err.message ?? 'Could not fetch attachments' });
  }
});

export default router;
