import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import mammoth from 'mammoth';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, logAudit } from '../middleware/auth';
import { chatCompletion, analyzeDocument, categorizeEmail, SYSTEM_PROMPT } from '../services/ai';
import { MODEL_FOR } from '../services/aiModels';
import { getAuth } from '../middleware/auth';
import { query } from '../db/client';

const router = Router();

// Phase 6.6 QA diagnostic â€” unauthenticated GET /api/v1/ai/_diag
// so we can verify this router is actually live on the deployed
// backend. If a client reports 404 on /ai/suggest-actions, have them
// hit _diag first. If _diag works but suggest-actions 404s, the bug
// is specifically in the suggest-actions handler. If _diag also
// 404s, the whole aiRouter isn't wired up on the running process
// (stale deploy, crash on startup, etc.).
router.get('/_diag', (_req, res) => {
  res.json({
    ok: true,
    routes: ['chat', 'chat-with-file', 'analyze-document', 'categorize-email', 'resolve-entity', 'suggest-actions'],
    built_at: new Date().toISOString(),
  });
});

// Phase 5.3d â€” in-memory file upload for AI chat. We don't persist
// these; they only live in the chat context. 20 MB cap is plenty for
// the image/PDF attachments this is meant for.
const chatFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Shared guard â€” returns `true` if the request has been short-circuited
// because the AI backend is unconfigured. Prevents 500s with obscure
// Anthropic errors when ANTHROPIC_API_KEY is missing.
function aiUnavailable(res: Response): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !key.trim()) {
    res.status(503).json({
      error: 'ai_unavailable',
      message: 'AI Assistant is not configured. Set ANTHROPIC_API_KEY on the backend to enable.',
    });
    return true;
  }
  return false;
}

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
  if (aiUnavailable(res)) return;

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

    res.json({ response, model: MODEL_FOR.brainChat });
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

// POST /ai/chat-with-file â€” Phase 5.3d
// multipart/form-data with: file (required), messages (JSON string),
// userContext (optional string). Server extracts text (PDF/DOCX/TXT)
// or sends the image inline to Claude's vision endpoint.
router.post('/chat-with-file', requireAuth, chatFileUpload.single('file'), async (req: Request, res: Response) => {
  if (aiUnavailable(res)) return;
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  let messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  try {
    messages = JSON.parse(req.body?.messages ?? '[]');
    if (!Array.isArray(messages) || messages.length === 0) throw new Error();
  } catch {
    res.status(400).json({ error: 'messages must be a non-empty JSON array' });
    return;
  }

  const userContext = typeof req.body?.userContext === 'string' ? req.body.userContext : undefined;
  const systemWithContext = userContext
    ? `${SYSTEM_PROMPT}\n\nCURRENT USER CONTEXT:\n${userContext}`
    : SYSTEM_PROMPT;

  const mime = req.file.mimetype;
  const buffer = req.file.buffer;
  const filename = req.file.originalname;
  const isImage = mime.startsWith('image/');

  try {
    // Build the user-turn content. For images: include as a vision block.
    // For PDFs/DOCX/TXT: extract text and include as a second text block.
    const lastUser = messages[messages.length - 1];
    const priorMessages = messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

    // Extract text (non-image) or prepare image base64
    let attachmentBlock: any = null;
    if (isImage) {
      const base64 = buffer.toString('base64');
      // Anthropic supports jpeg/png/gif/webp in the source.media_type field
      attachmentBlock = {
        type: 'image',
        source: { type: 'base64', media_type: mime, data: base64 },
      };
    } else {
      let text = '';
      if (mime === 'text/plain') {
        text = buffer.toString('utf8').slice(0, 60000);
      } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              || mime === 'application/msword') {
        const r = await mammoth.extractRawText({ buffer });
        text = r.value.slice(0, 60000);
      } else if (mime === 'application/pdf') {
        try {
          const mod = await import('pdf-parse' as string).catch(() => null);
          if (mod) {
            const data = await (mod as any).default(buffer);
            text = String(data.text ?? '').slice(0, 60000);
          }
        } catch { /* best effort */ }
      }
      if (!text || text.length < 10) {
        res.status(400).json({ error: `Couldn't extract text from ${filename}. Paste the content into chat instead or upload an image.` });
        return;
      }
      attachmentBlock = { type: 'text', text: `[Attached file: ${filename}]\n\n${text}` };
    }

    const userContentBlocks = [
      attachmentBlock,
      { type: 'text', text: lastUser.content || `Please review the attached ${isImage ? 'image' : 'document'}.` },
    ];

    const response = await anthropicClient.messages.create({
      model: MODEL_FOR.brainChat,
      max_tokens: 4096,
      system: systemWithContext,
      messages: [
        ...priorMessages,
        { role: 'user', content: userContentBlocks },
      ] as any,
    });

    const block = response.content[0];
    const text = block.type === 'text' ? block.text : 'Unable to generate response.';

    await logAudit(null, getAuth(req)?.userId ?? 'unknown', 'ai.chat_with_file', filename, { mime, size: buffer.length }, req.ip);
    res.json({ response: text, attached: { filename, mime, size: buffer.length } });
  } catch (err: any) {
    console.error('chat-with-file error:', err);
    res.status(500).json({ error: `AI service error: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// GET /ai/resolve-entity?type=candidate&q=noah
// Phase 5.3c â€” name disambiguation. When an AI response contains a
// [[link:candidate:Noah]] tag and the user clicks it, the frontend
// hits this endpoint. If one match is returned, navigate there. If
// multiple are returned, show the picker. If none, show "not found".
router.get('/resolve-entity', requireAuth, async (req: Request, res: Response) => {
  const type = String(req.query.type ?? '').toLowerCase();
  const q = String(req.query.q ?? '').trim();
  if (!q) { res.json({ matches: [] }); return; }
  const fuzzy = `%${q}%`;

  try {
    switch (type) {
      case 'candidate': {
        const r = await query(
          `SELECT id, first_name, last_name, email, phone, current_role AS role, stage
             FROM candidates
            WHERE (first_name || ' ' || last_name) ILIKE $1
               OR first_name ILIKE $1 OR last_name ILIKE $1
               OR email ILIKE $1
            ORDER BY created_at DESC
            LIMIT 10`,
          [fuzzy]
        );
        res.json({ type, matches: r.rows });
        return;
      }
      case 'staff': {
        const r = await query(
          `SELECT id, first_name, last_name, email, role, status
             FROM staff
            WHERE (first_name || ' ' || last_name) ILIKE $1
               OR first_name ILIKE $1 OR last_name ILIKE $1
               OR email ILIKE $1
            ORDER BY last_name ASC
            LIMIT 10`,
          [fuzzy]
        );
        res.json({ type, matches: r.rows });
        return;
      }
      case 'job': {
        const r = await query(
          `SELECT id, title, facility_id, status
             FROM jobs WHERE title ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
          [fuzzy]
        );
        res.json({ type, matches: r.rows });
        return;
      }
      case 'facility': {
        const r = await query(
          `SELECT id, name, city, state FROM facilities WHERE name ILIKE $1 ORDER BY name LIMIT 10`,
          [fuzzy]
        );
        res.json({ type, matches: r.rows });
        return;
      }
      case 'policy': {
        const r = await query(
          `SELECT id, title, version, status FROM comp_policies WHERE title ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
          [fuzzy]
        );
        res.json({ type, matches: r.rows });
        return;
      }
      default:
        res.status(400).json({ error: `Unknown entity type: ${type}` });
    }
  } catch (err) {
    console.error('resolve-entity error:', err);
    res.status(500).json({ error: 'Resolve failed' });
  }
});

// POST /ai/suggest-actions â€” Phase 6.6
// Context-aware action suggestions for a workflow page.
// Request body: { subject: string, context: object }
// Response: { suggestions: string } where the string uses the same
// [[link:...]] / [[action:...]] tag grammar as chat responses.
// The frontend uses the shared TaggedText renderer to display them.
router.post('/suggest-actions', requireAuth, async (req: Request, res: Response) => {
  if (aiUnavailable(res)) return;

  const schema = z.object({
    subject: z.string().min(1).max(200),
    // Arbitrary JSON context â€” whatever the caller thinks is relevant.
    // Serialized to Claude as-is.
    context: z.record(z.string(), z.unknown()),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation error', details: parse.error.flatten() }); return; }
  const { subject, context } = parse.data;

  const sys = `You are FNS AI suggesting 3-6 concrete next actions for a healthcare staffing ops user looking at a workflow page. Return ONLY a short markdown list (3-6 items) of suggested actions. Each item should be 1-2 sentences.

Use the inline tag grammar defined in the main SYSTEM_PROMPT wherever relevant:
  [[link:<type>:<value>]]              â€” inline entity link
  [[action:create_task|<goal>]]        â€” create a task button
  [[action:send_esign|<recipient>]]    â€” send eSign button
  [[action:draft_email|<prompt>]]      â€” draft email button

Rules:
- Prioritize time-sensitive or unblocking actions first.
- Use [[action:...]] tags liberally when the user can act directly.
- Use [[link:...]] tags for any entity the user will need to click through to.
- Do not fabricate names that aren't in the context.
- No preamble, no closing â€” just the bulleted list.`;

  const userMsg = `Subject: ${subject}\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nSuggest the next 3-6 actions the user should take.`;

  try {
    const response = await anthropicClient.messages.create({
      model: MODEL_FOR.brainChat,
      max_tokens: 1024,
      system: `${SYSTEM_PROMPT}\n\n${sys}`,
      messages: [{ role: 'user', content: userMsg }],
    });
    const block = response.content[0];
    const text = block.type === 'text' ? block.text : '';
    res.json({ suggestions: text });
  } catch (err: any) {
    console.error('suggest-actions error:', err);
    if (err?.status === 429) { res.status(429).json({ error: 'AI is busy. Please retry.' }); return; }
    if (err?.status === 529) { res.status(503).json({ error: 'Claude is over capacity. Retry in ~30s.', retry_after_seconds: 30 }); return; }
    res.status(500).json({ error: `AI service error: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

export default router;
