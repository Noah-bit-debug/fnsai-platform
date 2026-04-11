import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, logAudit } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';

const router = Router();

const manualKnowledgeSchema = z.object({
  content: z.string().min(1).max(10000),
  source: z.enum(['sharepoint', 'outlook', 'manual', 'document_qa', 'correction', 'website', 'training_video']).default('manual'),
  source_url: z.string().url().optional().nullable(),
  facility_id: z.string().uuid().optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
});

// GET /corrections - list AI corrections (3-strike items)
router.get('/corrections', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT r.*,
              COUNT(c.id) AS strike_count,
              json_agg(json_build_object(
                'id', c.id,
                'correction_text', c.correction_text,
                'is_exception', c.is_exception,
                'exception_details', c.exception_details,
                'created_at', c.created_at
              ) ORDER BY c.created_at DESC) FILTER (WHERE c.id IS NOT NULL) AS corrections
       FROM ai_rules r
       LEFT JOIN ai_corrections c ON c.rule_id = r.id
       WHERE r.is_active = true
       GROUP BY r.id
       ORDER BY r.correction_count DESC, r.created_at DESC`
    );

    res.json({ rules: result.rows });
  } catch (err) {
    console.error('Corrections list error:', err);
    res.status(500).json({ error: 'Failed to fetch corrections' });
  }
});

// POST /corrections/:id/strike - add a strike
router.post('/corrections/:id/strike', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { correction_text, is_exception = false, exception_details } = req.body as {
    correction_text?: string;
    is_exception?: boolean;
    exception_details?: string;
  };

  if (!correction_text) {
    res.status(400).json({ error: 'correction_text is required' });
    return;
  }

  const auth = getAuth(req);

  try {
    // Insert correction
    await query(
      `INSERT INTO ai_corrections (rule_id, correction_text, is_exception, exception_details)
       VALUES ($1, $2, $3, $4)`,
      [id, correction_text, is_exception, exception_details ?? null]
    );

    // Increment correction count
    const updateResult = await query(
      `UPDATE ai_rules SET correction_count = correction_count + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING id, rule_text, correction_count`,
      [id]
    );

    if (updateResult.rows.length === 0) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    const rule = updateResult.rows[0];

    // Auto-deactivate at 3 strikes (unless exception)
    if ((rule.correction_count as number) >= 3 && !is_exception) {
      await query(
        `UPDATE ai_rules SET is_active = false, updated_at = NOW(), source = 'three_strike' WHERE id = $1`,
        [id]
      );
    }

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'ai.strike',
      id,
      { correction_text, strike: rule.correction_count },
      (req.ip ?? 'unknown')
    );

    res.json({
      success: true,
      ruleId: id,
      strikeCount: rule.correction_count,
      deactivated: (rule.correction_count as number) >= 3 && !is_exception,
    });
  } catch (err) {
    console.error('Strike error:', err);
    res.status(500).json({ error: 'Failed to add strike' });
  }
});

// POST /corrections/:id/defend - confirm AI rule is correct
router.post('/corrections/:id/defend', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE ai_rules SET correction_count = 0, is_active = true, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'ai.defendRule', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true, rule: result.rows[0] });
  } catch (err) {
    console.error('Defend error:', err);
    res.status(500).json({ error: 'Failed to defend rule' });
  }
});

// POST /manual - add manual knowledge item
router.post('/manual', requireAuth, async (req: Request, res: Response) => {
  const parse = manualKnowledgeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }

  const auth = getAuth(req);
  const data = parse.data;

  try {
    const result = await query(
      `INSERT INTO knowledge_items (content, source, source_url, facility_id, tags)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.content, data.source, data.source_url ?? null, data.facility_id ?? null, data.tags]
    );

    // Also create an AI rule from manual knowledge
    await query(
      `INSERT INTO ai_rules (rule_text, scope, source) VALUES ($1, 'general', 'manual')`,
      [data.content.slice(0, 1000)]
    );

    await logAudit(
      null,
      auth?.userId ?? 'unknown',
      'knowledge.add',
      result.rows[0].id as string,
      { source: data.source },
      (req.ip ?? 'unknown')
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Manual knowledge error:', err);
    res.status(500).json({ error: 'Failed to add knowledge item' });
  }
});

// GET /rules - list all active AI rules
router.get('/rules', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT r.*,
              f.name AS facility_name
       FROM ai_rules r
       LEFT JOIN facilities f ON r.facility_id = f.id
       ORDER BY r.is_active DESC, r.created_at DESC`
    );

    res.json({ rules: result.rows });
  } catch (err) {
    console.error('Rules list error:', err);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

export default router;
