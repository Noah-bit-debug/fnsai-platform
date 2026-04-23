import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';
import { analyzeDocument } from '../services/ai';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const qaAnswerSchema = z.object({
  answer: z.string().min(1).max(5000),
  answer_scope: z.enum(['always', 'facility_specific', 'staff_type', 'optional', 'one_time']),
});

// POST /upload - multipart file upload + AI check
router.post(
  '/upload',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const auth = getAuth(req);
    const {
      document_type,
      staff_id,
      facility_id,
      placement_id,
    } = req.body as {
      document_type?: string;
      staff_id?: string;
      facility_id?: string;
      placement_id?: string;
    };

    if (!document_type) {
      res.status(400).json({ error: 'document_type is required' });
      return;
    }

    try {
      // Store document record
      const docResult = await query(
        `INSERT INTO documents (name, type, staff_id, facility_id, placement_id, status)
         VALUES ($1, $2, $3, $4, $5, 'checking')
         RETURNING *`,
        [
          req.file.originalname,
          document_type,
          staff_id ?? null,
          facility_id ?? null,
          placement_id ?? null,
        ]
      );

      const doc = docResult.rows[0];

      // Fetch active rules
      const rulesResult = await query<{ rule_text: string }>(
        'SELECT rule_text FROM ai_rules WHERE is_active = true'
      );
      const rules = rulesResult.rows.map((r) => r.rule_text);

      // Convert buffer to text for analysis
      const documentText = req.file.buffer.toString('utf-8').slice(0, 50000);

      const aiResult = await analyzeDocument(documentText, document_type, rules);

      const newStatus =
        aiResult.overall_status === 'passed'
          ? 'passed'
          : aiResult.overall_status === 'needs_review'
            ? 'issues_found'
            : 'issues_found';

      // Update document with AI result
      await query(
        `UPDATE documents SET status = $1, ai_review_result = $2 WHERE id = $3`,
        [newStatus, JSON.stringify(aiResult), doc.id]
      );

      // Create QA records for questions
      for (const q of aiResult.questions) {
        await query(
          `INSERT INTO document_qa (document_id, document_type, question, context)
           VALUES ($1, $2, $3, $4)`,
          [doc.id, document_type, q.question, q.context]
        );
      }

      // If AI found patterns that could become rules, auto-create them
      for (const issue of aiResult.issues) {
        if (issue.severity === 'error') {
          await query(
            `INSERT INTO ai_rules (rule_text, scope, source)
             VALUES ($1, 'document', 'document_qa')
             ON CONFLICT DO NOTHING`,
            [`${document_type}: ${issue.message}`]
          );
        }
      }

      await logAudit(
        null,
        auth?.userId ?? 'unknown',
        'document.upload',
        doc.id as string,
        { type: document_type, status: newStatus },
        (req.ip ?? 'unknown')
      );

      res.status(201).json({
        document: { ...doc, status: newStatus, ai_review_result: aiResult },
        qaQuestions: aiResult.questions.length,
      });
    } catch (err) {
      console.error('Document upload error:', err);
      res.status(500).json({ error: 'Failed to process document' });
    }
  }
);

// GET / - list documents
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { staff_id, facility_id, status } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (staff_id) {
    conditions.push(`d.staff_id = $${paramIndex++}`);
    params.push(staff_id);
  }
  if (facility_id) {
    conditions.push(`d.facility_id = $${paramIndex++}`);
    params.push(facility_id);
  }
  if (status) {
    conditions.push(`d.status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT d.*,
              s.first_name, s.last_name,
              f.name AS facility_name
       FROM documents d
       LEFT JOIN staff s ON d.staff_id = s.id
       LEFT JOIN facilities f ON d.facility_id = f.id
       ${whereClause}
       ORDER BY d.created_at DESC`,
      params
    );

    res.json({ documents: result.rows });
  } catch (err) {
    console.error('Document list error:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// GET /:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT d.*,
              s.first_name, s.last_name,
              f.name AS facility_name
       FROM documents d
       LEFT JOIN staff s ON d.staff_id = s.id
       LEFT JOIN facilities f ON d.facility_id = f.id
       WHERE d.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const qaResult = await query(
      'SELECT * FROM document_qa WHERE document_id = $1 ORDER BY created_at ASC',
      [id]
    );

    res.json({ ...result.rows[0], qa: qaResult.rows });
  } catch (err) {
    console.error('Document get error:', err);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// GET /qa/pending - list unanswered QA questions
router.get('/qa/pending', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT dq.*, d.name AS document_name, d.type AS document_type_ref
       FROM document_qa dq
       JOIN documents d ON dq.document_id = d.id
       WHERE dq.answer IS NULL
       ORDER BY dq.created_at ASC`
    );

    res.json({ questions: result.rows });
  } catch (err) {
    console.error('QA pending error:', err);
    res.status(500).json({ error: 'Failed to fetch pending QA' });
  }
});

// POST /qa/:id/answer
router.post('/qa/:id/answer', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = qaAnswerSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const { answer, answer_scope } = parse.data;

  try {
    const result = await query(
      `UPDATE document_qa
       SET answer = $1, answer_scope = $2, answered_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [answer, answer_scope, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'QA item not found' });
      return;
    }

    // If scope is 'always', create a new AI rule
    if (answer_scope === 'always') {
      const qa = result.rows[0];
      await query(
        `INSERT INTO ai_rules (rule_text, scope, source)
         VALUES ($1, 'document', 'document_qa')`,
        [`Q: ${qa.question as string} A: ${answer}`]
      );
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'document.qa.answer', id, { answer_scope }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('QA answer error:', err);
    res.status(500).json({ error: 'Failed to save answer' });
  }
});

export default router;
