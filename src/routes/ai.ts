import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { chatCompletion, analyzeDocument, categorizeEmail } from '../services/ai';
import { getAuth } from '@clerk/express';
import { query } from '../db/client';

const router = Router();

const chatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(50000),
    })
  ).min(1),
  userContext: z.string().max(5000).optional(),
});

const analyzeDocumentSchema = z.object({
  documentText: z.string().min(1).max(100000),
  documentType: z.string().min(1).max(100),
  staffId: z.string().uuid().optional(),
});

const categorizeEmailSchema = z.object({
  subject: z.string().max(500),
  body: z.string().max(50000),
  from: z.string().max(255),
});

// POST /ai/chat
router.post('/chat', requireAuth, async (req: Request, res: Response) => {
  const parse = chatSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const { messages, userContext } = parse.data;
  const auth = getAuth(req);

  try {
    const response = await chatCompletion(messages as any, userContext);

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'ai.chat',
      'AI Assistant',
      { messageCount: messages.length },
      req.ip
    );

    res.json({ response, model: 'claude-sonnet-4-20250514' });
  } catch (err) {
    console.error('Chat route error:', err);
    res.status(500).json({ error: 'AI service error' });
  }
});

// POST /ai/analyze-document
router.post('/analyze-document', requireAuth, async (req: Request, res: Response) => {
  const parse = analyzeDocumentSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const { documentText, documentType, staffId } = parse.data;
  const auth = getAuth(req);

  try {
    // Fetch active AI rules
    const rulesResult = await query<{ rule_text: string }>(
      'SELECT rule_text FROM ai_rules WHERE is_active = true ORDER BY created_at ASC'
    );
    const rules = rulesResult.rows.map((r) => r.rule_text);

    const result = await analyzeDocument(documentText, documentType, rules);

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'ai.analyzeDocument',
      documentType,
      { staffId, ruleCount: rules.length },
      req.ip
    );

    res.json(result);
  } catch (err) {
    console.error('Analyze document route error:', err);
    res.status(500).json({ error: 'Document analysis failed' });
  }
});

// POST /ai/categorize-email
router.post('/categorize-email', requireAuth, async (req: Request, res: Response) => {
  const parse = categorizeEmailSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const { subject, body, from } = parse.data;

  try {
    const result = await categorizeEmail(subject, body, from);
    res.json(result);
  } catch (err) {
    console.error('Categorize email route error:', err);
    res.status(500).json({ error: 'Email categorization failed' });
  }
});

export default router;
