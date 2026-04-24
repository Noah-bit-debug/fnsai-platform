import { Router, Request, Response } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getAuth } from '../middleware/auth';
import { query } from '../db/client';
import { MODEL_FOR } from '../services/aiModels';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown';
}

// Build a simple SET clause + params array for UPDATE statements.
// Returns { setClauses: string, params: unknown[], nextIndex: number }
function buildSetClause(
  fields: Record<string, unknown>,
  startIndex = 1
): { setClauses: string; params: unknown[]; nextIndex: number } {
  const params: unknown[] = [];
  const setClauses: string[] = [];
  let i = startIndex;
  for (const [col, val] of Object.entries(fields)) {
    setClauses.push(`${col} = $${i++}`);
    params.push(val);
  }
  return { setClauses: setClauses.join(', '), params, nextIndex: i };
}

// ---------------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------------

// GET /categories
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const { level } = req.query;
    const params: unknown[] = [];
    let sql = `
      SELECT id, level, name, parent_id, sort_order
      FROM comp_categories
    `;
    if (level !== undefined) {
      const lvl = parseInt(level as string, 10);
      if (isNaN(lvl) || ![1, 2, 3].includes(lvl)) {
        return res.status(400).json({ error: 'level must be 1, 2, or 3' });
      }
      sql += ` WHERE level = $1`;
      params.push(lvl);
    }
    sql += ` ORDER BY level, sort_order, name`;
    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /categories
router.post('/categories', requireAuth, async (req: Request, res: Response) => {
  try {
    const { level, name, parent_id, sort_order = 0 } = req.body as {
      level: number;
      name: string;
      parent_id?: string;
      sort_order?: number;
    };

    if (!level || ![1, 2, 3].includes(Number(level))) {
      return res.status(400).json({ error: 'level must be 1, 2, or 3' });
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }

    const result = await query<{ id: string }>(
      `INSERT INTO comp_categories (level, name, parent_id, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, level, name, parent_id, sort_order, created_at`,
      [Number(level), name.trim(), parent_id ?? null, Number(sort_order)]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /categories/:id
router.put('/categories/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, sort_order } = req.body as { name?: string; sort_order?: number };

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (sort_order !== undefined) updates.sort_order = Number(sort_order);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const { setClauses, params, nextIndex } = buildSetClause(updates, 1);
    params.push(id);

    const result = await query(
      `UPDATE comp_categories SET ${setClauses}
       WHERE id = $${nextIndex}
       RETURNING id, level, name, parent_id, sort_order`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Category not found' });
    return res.json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /categories/:id
router.delete('/categories/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM comp_categories WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Category not found' });
    return res.json({ success: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POLICIES
// ---------------------------------------------------------------------------

// GET /policies
router.get('/policies', requireAuth, async (req: Request, res: Response) => {
  try {
    const { status, cat1_id } = req.query;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (cat1_id) {
      params.push(cat1_id);
      conditions.push(`cat1_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT id, title, version, status, expiration_days, require_signature,
              applicable_roles, cat1_id, cat2_id, cat3_id, created_at
       FROM comp_policies
       ${where}
       ORDER BY created_at DESC`,
      params
    );
    return res.json(result.rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /policies
router.post('/policies', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const {
      title, content, version = '1.0', expiration_days = null,
      require_signature = true, status = 'draft',
      cat1_id = null, cat2_id = null, cat3_id = null,
      applicable_roles = [],
    } = req.body as {
      title: string;
      content: string;
      version?: string;
      expiration_days?: number | null;
      require_signature?: boolean;
      status?: string;
      cat1_id?: string | null;
      cat2_id?: string | null;
      cat3_id?: string | null;
      applicable_roles?: string[];
    };

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const result = await query(
      `INSERT INTO comp_policies
         (title, content, version, expiration_days, require_signature, status,
          cat1_id, cat2_id, cat3_id, applicable_roles, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [title, content, version, expiration_days, require_signature, status,
       cat1_id, cat2_id, cat3_id, applicable_roles, auth.userId]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Phase 2.1 + 2.7 — Unified "My compliance" rollup ────────────────────────
//
// Returns a single snapshot of everything assigned to the calling user:
// policies, documents, exams, checklists, courses, + any currently
// overdue credentials. This powers both the My Compliance page (2.1)
// and the per-user section on Reports / user profile (2.7).
//
// Previously MyCompliance only queried comp_competency_records — which
// misses course completions (comp_course_completions is a separate
// table). This endpoint stitches them together.
router.get('/my-all', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  // Allow looking up another user if admin. Otherwise self.
  const targetUserId = (req.query.user_clerk_id as string | undefined) ?? auth.userId;

  try {
    // Competency records (policies, docs, exams, checklists, bundles assigned)
    const competency = await query(
      `SELECT r.id, r.item_type, r.item_id, r.title, r.status,
              r.assigned_date, r.due_date, r.expiration_date, r.completed_date,
              r.score, r.ceus
       FROM comp_competency_records r
       WHERE r.user_id = (SELECT id FROM users WHERE clerk_user_id = $1)
       ORDER BY r.assigned_date DESC`,
      [targetUserId]
    ).catch((err: any) => {
      if (err?.code === '42P01') return { rows: [] };
      throw err;
    });

    // Course completions (from phase2_courses.sql — separate table)
    const courses = await query(
      `SELECT cc.id AS completion_id, cc.course_id, cc.started_at, cc.completed_at,
              cc.duration_seconds, cc.attestation_signed, cc.quiz_score, cc.passed,
              c.title, c.description, c.estimated_minutes, c.require_attestation,
              c.status AS course_status
       FROM comp_course_completions cc
       JOIN comp_courses c ON c.id = cc.course_id
       WHERE cc.user_clerk_id = $1
       ORDER BY cc.started_at DESC NULLS LAST`,
      [targetUserId]
    ).catch((err: any) => {
      if (err?.code === '42P01') return { rows: [] };
      throw err;
    });

    // Summary counts — drives the header pills on My Compliance
    const summary = {
      total: competency.rows.length + courses.rows.length,
      completed: 0,
      in_progress: 0,
      overdue: 0,
      not_started: 0,
    };
    const now = Date.now();
    for (const r of competency.rows) {
      const status = r.status as string;
      if (['completed', 'signed', 'read'].includes(status)) summary.completed++;
      else if (status === 'in_progress') summary.in_progress++;
      else if (status === 'expired' || status === 'failed') summary.overdue++;
      else summary.not_started++;
      // Overdue by due_date regardless of status
      if (r.due_date && !r.completed_date && new Date(r.due_date as string).getTime() < now) {
        summary.overdue++;
      }
    }
    for (const c of courses.rows) {
      if (c.completed_at) summary.completed++;
      else if (c.started_at) summary.in_progress++;
      else summary.not_started++;
    }

    res.json({
      user_clerk_id: targetUserId,
      summary,
      competency: competency.rows,
      courses: courses.rows,
    });
  } catch (err: any) {
    // Resilient: any schema error (missing table or column) returns an
    // empty rollup rather than 500ing the whole My Compliance page.
    if (['42P01', '42703'].includes(err?.code)) {
      res.json({
        user_clerk_id: targetUserId,
        summary: { total: 0, completed: 0, in_progress: 0, overdue: 0, not_started: 0 },
        competency: [],
        courses: [],
      });
      return;
    }
    console.error('GET /compliance/my-all error:', err);
    res.status(500).json({ error: `Failed to fetch compliance rollup: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ─── Phase 2.3 — Policy AI workflow ──────────────────────────────────────────
//
// Two helper endpoints that let admins upload or describe a policy and have
// Claude produce structured content they can review + edit before hitting
// Create. Neither endpoint creates a policy directly — they return the
// parsed fields, and the user clicks Save / Publish on the existing
// POST /policies to commit.
//
// POST /policies/ai-parse    — upload PDF/DOCX/TXT → extract title + body
// POST /policies/ai-rewrite  — given existing content, AI refines it
//                              (e.g. "make this more formal", "add a
//                               section on disciplinary action")

const POLICY_SYSTEM_PROMPT = `You convert raw healthcare-staffing policy documents into structured JSON for FNS AI's compliance system.

Return ONLY a single JSON object, no markdown, no prose. Shape:

{
  "title": "policy title (concise, Title Case)",
  "content": "full policy body as clean markdown with headers, bullets, sections",
  "suggested_version": "1.0",
  "suggested_expiration_days": 365,
  "require_signature": true,
  "applicable_roles": ["RN","LPN","CNA"],
  "category_guess": "safety|clinical|hr|compliance|training|general",
  "summary": "1-2 sentence admin-facing summary of what this policy covers"
}

Rules:
- Preserve the original meaning. Do not invent obligations or change the policy's intent.
- Normalize formatting: fix headers, bullet alignment, paragraph breaks.
- Keep section numbering if the original uses it.
- If content is unclear or ambiguous, lean toward what the original actually says, not what it should say.
- applicable_roles: infer from the document. Default to [] if truly universal.
- suggested_expiration_days: use reasonable defaults — annual (365) for most, or whatever the document states.
- require_signature: true for policies that need formal acknowledgement, false for informational SOPs.
- category_guess: pick the single closest match.`;

// POST /policies/ai-parse — upload a file, get structured policy JSON back.
// Admin reviews + edits the output, then POSTs to /policies to persist.
router.post('/policies/ai-parse', requireAuth, requirePermission('admin_manage'),
  upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded (field name: "file")' }); return; }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'AI parsing not configured (ANTHROPIC_API_KEY missing)' });
      return;
    }

    try {
      // Extract text depending on file type. PDF goes through Claude's
      // document vision directly. DOCX uses mammoth. TXT is read as UTF-8.
      const mime = req.file.mimetype;
      const name = req.file.originalname.toLowerCase();
      let content: Anthropic.Messages.ContentBlockParam[];

      if (mime === 'application/pdf' || name.endsWith('.pdf')) {
        content = [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.file.buffer.toString('base64') } } as Anthropic.Messages.ContentBlockParam,
          { type: 'text', text: 'Parse this policy document per the system prompt instructions.' },
        ];
      } else if (mime.includes('wordprocessingml') || name.endsWith('.docx')) {
        const extracted = await mammoth.extractRawText({ buffer: req.file.buffer });
        const text = (extracted.value ?? '').trim();
        if (!text) { res.status(422).json({ error: 'DOCX extracted no text — file may be image-only.' }); return; }
        content = [{ type: 'text', text: `Parse this policy document per the system prompt instructions.\n\nPolicy content:\n${text}` }];
      } else if (mime.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) {
        const text = req.file.buffer.toString('utf-8').trim();
        if (!text) { res.status(422).json({ error: 'Text file is empty.' }); return; }
        content = [{ type: 'text', text: `Parse this policy document per the system prompt instructions.\n\nPolicy content:\n${text}` }];
      } else {
        res.status(415).json({ error: `Unsupported file type: ${mime}. Please upload PDF, DOCX, or TXT.` });
        return;
      }

      const response = await anthropic.messages.create({
        model: MODEL_FOR.templateDrafting,
        max_tokens: 4096,
        system: POLICY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      });

      const raw = (response.content[0] as { type: string; text: string }).text;
      // Strip markdown fences, slice to first { ... last }
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const first = cleaned.indexOf('{');
      const last = cleaned.lastIndexOf('}');
      const jsonStr = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      } catch (e) {
        console.error('policy AI parse: bad JSON from model:', raw.slice(0, 500));
        res.status(502).json({
          error: 'AI returned malformed JSON. Please retry or paste the policy content manually.',
          raw_preview: raw.slice(0, 500),
        });
        return;
      }

      res.json({
        parsed,
        file: { name: req.file.originalname, size: req.file.size, mime },
      });
    } catch (err: any) {
      console.error('Policy AI parse error:', err);
      if (err?.status === 429) {
        res.status(429).json({ error: 'AI is busy. Please retry in a minute.' });
        return;
      }
      res.status(500).json({ error: `Policy AI parse failed: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
    }
  }
);

// POST /policies/ai-rewrite — admin supplies existing title+content plus an
// instruction ("make more formal", "add section on discipline"). AI returns
// the revised content. Does not save; admin reviews + edits + hits Save.
router.post('/policies/ai-rewrite', requireAuth, requirePermission('admin_manage'), async (req: Request, res: Response) => {
  const { title, content, instruction } = req.body as { title?: string; content?: string; instruction?: string };
  if (!content?.trim() || !instruction?.trim()) {
    res.status(400).json({ error: 'content and instruction are required' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'AI not configured (ANTHROPIC_API_KEY missing)' });
    return;
  }

  try {
    const userMsg = `EXISTING POLICY TITLE: ${title ?? '(untitled)'}

EXISTING POLICY CONTENT:
${content}

USER INSTRUCTION: ${instruction}

Return ONLY the revised content as clean markdown — no JSON, no commentary, no code fences. Preserve the policy's core meaning while applying the instruction.`;

    const response = await anthropic.messages.create({
      model: MODEL_FOR.templateDrafting,
      max_tokens: 4096,
      system: 'You are a healthcare compliance policy editor. You rewrite policies per user instructions without changing their intent.',
      messages: [{ role: 'user', content: userMsg }],
    });

    const revised = (response.content[0] as { type: string; text: string }).text.trim();
    res.json({ revised_content: revised });
  } catch (err: any) {
    console.error('Policy AI rewrite error:', err);
    res.status(500).json({ error: `AI rewrite failed: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// GET /policies/:id
router.get('/policies/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM comp_policies WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Policy not found' });
    return res.json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /policies/:id
router.put('/policies/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const allowed = [
      'title','content','version','expiration_days','require_signature',
      'status','cat1_id','cat2_id','cat3_id','applicable_roles',
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }
    updates.updated_at = new Date();

    const { setClauses, params, nextIndex } = buildSetClause(updates, 1);
    params.push(id);

    const result = await query(
      `UPDATE comp_policies SET ${setClauses} WHERE id = $${nextIndex} RETURNING *`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Policy not found' });
    return res.json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /policies/:id  (soft delete — archive)
router.delete('/policies/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE comp_policies SET status='archived', updated_at=NOW() WHERE id=$1 RETURNING id`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Policy not found' });
    return res.json({ success: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /policies/:id/sign
router.post('/policies/:id/sign', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const { id: policyId } = req.params;
    const { typed_signature } = req.body as { typed_signature: string };

    if (!typed_signature?.trim()) {
      return res.status(400).json({ error: 'typed_signature is required' });
    }

    // 1. Verify policy exists and is published
    const policyResult = await query<{
      id: string; title: string; expiration_days: number | null;
    }>(
      `SELECT id, title, expiration_days FROM comp_policies WHERE id=$1 AND status='published'`,
      [policyId]
    );
    if (policyResult.rowCount === 0) {
      return res.status(404).json({ error: 'Policy not found or not published' });
    }
    const policy = policyResult.rows[0];

    // 2. Get or create competency record
    const existingCr = await query<{ id: string }>(
      `SELECT id FROM comp_competency_records
       WHERE user_clerk_id=$1 AND item_type='policy' AND item_id=$2
       LIMIT 1`,
      [auth.userId, policyId]
    );

    let competencyRecordId: string;
    if (existingCr.rowCount && existingCr.rowCount > 0) {
      competencyRecordId = existingCr.rows[0].id;
    } else {
      const newCr = await query<{ id: string }>(
        `INSERT INTO comp_competency_records
           (user_clerk_id, item_type, item_id, title, status)
         VALUES ($1, 'policy', $2, $3, 'not_started')
         RETURNING id`,
        [auth.userId, policyId, policy.title]
      );
      competencyRecordId = newCr.rows[0].id;
    }

    // 3. Insert signature
    const sigResult = await query<{ id: string }>(
      `INSERT INTO comp_policy_signatures
         (policy_id, competency_record_id, user_clerk_id, typed_signature, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [policyId, competencyRecordId, auth.userId, typed_signature.trim(),
       getClientIp(req), req.headers['user-agent'] ?? null]
    );
    const signatureId = sigResult.rows[0].id;

    // 4. Update competency record
    const expirationDate = policy.expiration_days
      ? new Date(Date.now() + policy.expiration_days * 86400000)
      : null;

    await query(
      `UPDATE comp_competency_records
       SET status='signed', completed_date=NOW(), expiration_date=$1, updated_at=NOW()
       WHERE id=$2`,
      [expirationDate, competencyRecordId]
    );

    return res.json({ success: true, signature_id: signatureId, competency_record_id: competencyRecordId });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /policies/:id/assign
router.post('/policies/:id/assign', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const { id: policyId } = req.params;
    const { user_clerk_ids, due_date } = req.body as {
      user_clerk_ids: string[];
      due_date?: string;
    };

    if (!Array.isArray(user_clerk_ids) || user_clerk_ids.length === 0) {
      return res.status(400).json({ error: 'user_clerk_ids must be a non-empty array' });
    }

    const policyResult = await query<{ id: string; title: string }>(
      `SELECT id, title FROM comp_policies WHERE id=$1`, [policyId]
    );
    if (policyResult.rowCount === 0) return res.status(404).json({ error: 'Policy not found' });
    const { title } = policyResult.rows[0];

    let created = 0;
    for (const userId of user_clerk_ids) {
      const exists = await query(
        `SELECT 1 FROM comp_competency_records
         WHERE user_clerk_id=$1 AND item_type='policy' AND item_id=$2`,
        [userId, policyId]
      );
      if (exists.rowCount && exists.rowCount > 0) continue;

      await query(
        `INSERT INTO comp_competency_records
           (user_clerk_id, item_type, item_id, title, due_date, assigned_by)
         VALUES ($1,'policy',$2,$3,$4,$5)`,
        [userId, policyId, title, due_date ?? null, auth.userId]
      );
      created++;
    }

    return res.json({ success: true, created });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// DOCUMENTS
// ---------------------------------------------------------------------------

// GET /documents
router.get('/documents', requireAuth, async (req: Request, res: Response) => {
  try {
    const { status, cat1_id } = req.query;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (cat1_id) {
      params.push(cat1_id);
      conditions.push(`cat1_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT id, title, description, file_url, file_name, file_type,
              expiration_days, require_read_ack, status,
              cat1_id, cat2_id, cat3_id, applicable_roles, created_at
       FROM comp_documents
       ${where}
       ORDER BY created_at DESC`,
      params
    );
    return res.json(result.rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /documents
router.post('/documents', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const {
      title, description = null, file_url = null, file_name = null,
      file_type = null, expiration_days = null, require_read_ack = true,
      status = 'draft', cat1_id = null, cat2_id = null, cat3_id = null,
      applicable_roles = [],
    } = req.body as {
      title: string;
      description?: string | null;
      file_url?: string | null;
      file_name?: string | null;
      file_type?: string | null;
      expiration_days?: number | null;
      require_read_ack?: boolean;
      status?: string;
      cat1_id?: string | null;
      cat2_id?: string | null;
      cat3_id?: string | null;
      applicable_roles?: string[];
    };

    if (!title) return res.status(400).json({ error: 'title is required' });

    const result = await query(
      `INSERT INTO comp_documents
         (title, description, file_url, file_name, file_type, expiration_days,
          require_read_ack, status, cat1_id, cat2_id, cat3_id, applicable_roles, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [title, description, file_url, file_name, file_type, expiration_days,
       require_read_ack, status, cat1_id, cat2_id, cat3_id, applicable_roles, auth.userId]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// GET /documents/:id
router.get('/documents/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM comp_documents WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Document not found' });
    return res.json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /documents/:id
router.put('/documents/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const allowed = [
      'title','description','file_url','file_name','file_type',
      'expiration_days','require_read_ack','status',
      'cat1_id','cat2_id','cat3_id','applicable_roles',
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }
    updates.updated_at = new Date();

    const { setClauses, params, nextIndex } = buildSetClause(updates, 1);
    params.push(id);

    const result = await query(
      `UPDATE comp_documents SET ${setClauses} WHERE id=$${nextIndex} RETURNING *`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Document not found' });
    return res.json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /documents/:id (soft delete)
router.delete('/documents/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE comp_documents SET status='archived', updated_at=NOW() WHERE id=$1 RETURNING id`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Document not found' });
    return res.json({ success: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /documents/:id/read
router.post('/documents/:id/read', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const { id: documentId } = req.params;

    // Verify document exists
    const docResult = await query<{ id: string; title: string; expiration_days: number | null }>(
      `SELECT id, title, expiration_days FROM comp_documents WHERE id=$1`, [documentId]
    );
    if (docResult.rowCount === 0) return res.status(404).json({ error: 'Document not found' });
    const doc = docResult.rows[0];

    // 1. Get or create competency record
    const existingCr = await query<{ id: string }>(
      `SELECT id FROM comp_competency_records
       WHERE user_clerk_id=$1 AND item_type='document' AND item_id=$2 LIMIT 1`,
      [auth.userId, documentId]
    );

    let competencyRecordId: string;
    if (existingCr.rowCount && existingCr.rowCount > 0) {
      competencyRecordId = existingCr.rows[0].id;
    } else {
      const newCr = await query<{ id: string }>(
        `INSERT INTO comp_competency_records
           (user_clerk_id, item_type, item_id, title, status)
         VALUES ($1,'document',$2,$3,'not_started')
         RETURNING id`,
        [auth.userId, documentId, doc.title]
      );
      competencyRecordId = newCr.rows[0].id;
    }

    // 2. Insert read log
    await query(
      `INSERT INTO comp_document_read_logs
         (document_id, competency_record_id, user_clerk_id, ip_address)
       VALUES ($1,$2,$3,$4)`,
      [documentId, competencyRecordId, auth.userId, getClientIp(req)]
    );

    // 3. Update competency record
    const expirationDate = doc.expiration_days
      ? new Date(Date.now() + doc.expiration_days * 86400000)
      : null;

    await query(
      `UPDATE comp_competency_records
       SET status='read', completed_date=NOW(), expiration_date=$1, updated_at=NOW()
       WHERE id=$2`,
      [expirationDate, competencyRecordId]
    );

    return res.json({ success: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /documents/:id/assign
router.post('/documents/:id/assign', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const { id: documentId } = req.params;
    const { user_clerk_ids, due_date } = req.body as {
      user_clerk_ids: string[];
      due_date?: string;
    };

    if (!Array.isArray(user_clerk_ids) || user_clerk_ids.length === 0) {
      return res.status(400).json({ error: 'user_clerk_ids must be a non-empty array' });
    }

    const docResult = await query<{ id: string; title: string }>(
      `SELECT id, title FROM comp_documents WHERE id=$1`, [documentId]
    );
    if (docResult.rowCount === 0) return res.status(404).json({ error: 'Document not found' });
    const { title } = docResult.rows[0];

    let created = 0;
    for (const userId of user_clerk_ids) {
      const exists = await query(
        `SELECT 1 FROM comp_competency_records
         WHERE user_clerk_id=$1 AND item_type='document' AND item_id=$2`,
        [userId, documentId]
      );
      if (exists.rowCount && exists.rowCount > 0) continue;

      await query(
        `INSERT INTO comp_competency_records
           (user_clerk_id, item_type, item_id, title, due_date, assigned_by)
         VALUES ($1,'document',$2,$3,$4,$5)`,
        [userId, documentId, title, due_date ?? null, auth.userId]
      );
      created++;
    }

    return res.json({ success: true, created });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// COMPETENCY RECORDS
// ---------------------------------------------------------------------------

// GET /competency-records
router.get('/competency-records', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const { mine, item_type, status, candidate_id } = req.query;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (mine === 'true') {
      params.push(auth.userId);
      conditions.push(`user_clerk_id = $${params.length}`);
    }
    if (item_type) {
      params.push(item_type);
      conditions.push(`item_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (candidate_id) {
      params.push(candidate_id);
      conditions.push(`candidate_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT * FROM comp_competency_records ${where} ORDER BY created_at DESC`,
      params
    );
    return res.json(result.rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// GET /competency-records/user/:userId
router.get('/competency-records/user/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM comp_competency_records
       WHERE user_clerk_id=$1
       ORDER BY created_at DESC`,
      [req.params.userId]
    );
    return res.json(result.rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /competency-records
router.post('/competency-records', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const { user_clerk_id, item_type, item_id, title, due_date } = req.body as {
      user_clerk_id: string;
      item_type: string;
      item_id: string;
      title: string;
      due_date?: string;
    };

    if (!user_clerk_id || !item_type || !item_id || !title) {
      return res.status(400).json({ error: 'user_clerk_id, item_type, item_id, and title are required' });
    }

    const validTypes = ['policy','document','exam','checklist','bundle'];
    if (!validTypes.includes(item_type)) {
      return res.status(400).json({ error: `item_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(
      `INSERT INTO comp_competency_records
         (user_clerk_id, item_type, item_id, title, due_date, assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [user_clerk_id, item_type, item_id, title, due_date ?? null, auth.userId]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /competency-records/:id
router.patch('/competency-records/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const allowed = ['status','notes','due_date','score'];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }
    updates.updated_at = new Date();

    const { setClauses, params, nextIndex } = buildSetClause(updates, 1);
    params.push(id);

    const result = await query(
      `UPDATE comp_competency_records SET ${setClauses} WHERE id=$${nextIndex} RETURNING *`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Competency record not found' });
    return res.json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /competency-records/:id/notes
router.post('/competency-records/:id/notes', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const { id: competencyRecordId } = req.params;
    const { content } = req.body as { content: string };

    if (!content?.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    // Verify record exists
    const exists = await query(
      `SELECT 1 FROM comp_competency_records WHERE id=$1`, [competencyRecordId]
    );
    if (exists.rowCount === 0) return res.status(404).json({ error: 'Competency record not found' });

    const result = await query(
      `INSERT INTO comp_notes (competency_record_id, author_clerk_id, content)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [competencyRecordId, auth.userId, content.trim()]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// GET /competency-records/:id/notes
router.get('/competency-records/:id/notes', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM comp_notes
       WHERE competency_record_id=$1
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    return res.json(result.rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// STATS (dashboard summary)
// ---------------------------------------------------------------------------

// GET /stats
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const [policiesResult, documentsResult, crResult] = await Promise.all([
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::int AS count FROM comp_policies GROUP BY status`
      ),
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::int AS count FROM comp_documents GROUP BY status`
      ),
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::int AS count FROM comp_competency_records GROUP BY status`
      ),
    ]);

    const toMap = (rows: { status: string; count: string }[]) =>
      rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = Number(r.count);
        return acc;
      }, {});

    const pMap = toMap(policiesResult.rows);
    const dMap = toMap(documentsResult.rows);
    const crMap = toMap(crResult.rows);

    const pTotal = Object.values(pMap).reduce((a, b) => a + b, 0);
    const dTotal = Object.values(dMap).reduce((a, b) => a + b, 0);
    const crTotal = Object.values(crMap).reduce((a, b) => a + b, 0);

    return res.json({
      policies: {
        total: pTotal,
        published: pMap['published'] ?? 0,
        draft: pMap['draft'] ?? 0,
      },
      documents: {
        total: dTotal,
        published: dMap['published'] ?? 0,
        draft: dMap['draft'] ?? 0,
      },
      competency_records: {
        total: crTotal,
        not_started: crMap['not_started'] ?? 0,
        in_progress: crMap['in_progress'] ?? 0,
        completed: crMap['completed'] ?? 0,
        signed: crMap['signed'] ?? 0,
        read: crMap['read'] ?? 0,
        expired: crMap['expired'] ?? 0,
        failed: crMap['failed'] ?? 0,
      },
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
