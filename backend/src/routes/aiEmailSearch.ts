import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getAuth } from '@clerk/express';
import { pool } from '../db/client';
import Anthropic from '@anthropic-ai/sdk';
import { searchEmails, getEmailWithAttachments } from '../services/graph';
import { MODEL_FOR } from '../services/aiModels';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/v1/ai-email/search
router.post('/search', requireAuth, async (req: Request, res: Response) => {
  const { sender, keyword, subject, date_from, date_to, has_attachments, top = 20, user_id } = req.body as {
    sender?: string; keyword?: string; subject?: string; date_from?: string; date_to?: string;
    has_attachments?: boolean; top?: number; user_id?: string;
  };
  const auth = getAuth(req);
  try {
    const emails = await searchEmails({
      sender, keyword, subject,
      dateFrom: date_from, dateTo: date_to,
      hasAttachments: has_attachments,
      top: Math.min(top, 50), userId: user_id,
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

// POST /api/v1/ai-email/summarize
router.post('/summarize', requireAuth, async (req: Request, res: Response) => {
  const { emails, question } = req.body as {
    emails: Array<{ subject: string; from: string; receivedDateTime: string; bodyPreview: string }>;
    question?: string;
  };
  if (!emails || emails.length === 0) { res.status(400).json({ error: 'emails array is required' }); return; }
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
      system: 'You are FNS AI Brain, analyzing emails for Frontline Healthcare Staffing. Be concise and operational. Focus on: credentials, placements, candidates, compliance, facility requests.',
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

// GET /api/v1/ai-email/recent
router.get('/recent', requireAuth, async (req: Request, res: Response) => {
  const top = Math.min(parseInt(req.query.top as string) || 20, 50);
  const userId = req.query.user_id as string | undefined;
  try {
    const emails = await searchEmails({ top, userId });
    res.json({ emails, total: emails.length });
  } catch (err: any) {
    res.json({ emails: [], total: 0, error: err.message ?? 'Email service unavailable' });
  }
});

// GET /api/v1/ai-email/:id/attachments
router.get('/:id/attachments', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.query.user_id as string | undefined;
  try {
    const result = await getEmailWithAttachments(id, userId);
    res.json(result);
  } catch (err: any) {
    res.json({ attachments: [], error: err.message ?? 'Could not fetch attachments' });
  }
});

export default router;
