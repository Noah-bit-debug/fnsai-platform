import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { query } from '../db/client';

const router = Router();

const stageSchema = z.object({
  key: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Keys must be lowercase snake_case'),
  label: z.string().min(1).max(100),
  sort_order: z.number().int().min(0),
  color: z.string().max(20).optional().nullable(),
  is_terminal: z.boolean().optional(),
  stale_after_days: z.number().int().min(0).optional().nullable(),
  active: z.boolean().optional(),
  description: z.string().max(1000).optional().nullable(),
});

// GET / — list all stages for the default tenant
router.get('/', requireAuth, requirePermission('candidates_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM pipeline_stages WHERE tenant_id = 'default' ORDER BY sort_order ASC`
    );
    res.json({ stages: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ stages: [] }); return; }
    console.error('Stages list error:', err);
    res.status(500).json({ error: 'Failed to fetch stages' });
  }
});

// POST / — create a new stage
router.post('/', requireAuth, requirePermission('system_settings'), async (req: Request, res: Response) => {
  const parsed = stageSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  try {
    const result = await query(
      `INSERT INTO pipeline_stages (tenant_id, key, label, sort_order, color, is_terminal, stale_after_days, active, description)
       VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [d.key, d.label, d.sort_order, d.color ?? null, d.is_terminal ?? false, d.stale_after_days ?? null, d.active ?? true, d.description ?? null]
    );
    res.status(201).json({ stage: result.rows[0] });
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: 'Stage key already exists' }); return; }
    console.error('Stage create error:', err);
    res.status(500).json({ error: 'Failed to create stage' });
  }
});

// PUT /:key — update a stage (keyed by the slug, not id, since clients will know the key)
router.put('/:key', requireAuth, requirePermission('system_settings'), async (req: Request, res: Response) => {
  const parsed = stageSchema.partial().omit({ key: true }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  const setParts = entries.map(([k], i) => `${k} = $${i + 1}`);
  const values: unknown[] = entries.map(([, v]) => v);
  values.push(req.params.key);

  try {
    const result = await query(
      `UPDATE pipeline_stages SET ${setParts.join(', ')}, updated_at = NOW()
       WHERE tenant_id = 'default' AND key = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Stage not found' }); return; }
    res.json({ stage: result.rows[0] });
  } catch (err) {
    console.error('Stage update error:', err);
    res.status(500).json({ error: 'Failed to update stage' });
  }
});

// DELETE /:key — disable a stage (soft-delete via active=false to preserve audit history)
router.delete('/:key', requireAuth, requirePermission('system_settings'), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE pipeline_stages SET active = FALSE, updated_at = NOW()
       WHERE tenant_id = 'default' AND key = $1 RETURNING *`,
      [req.params.key]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Stage not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Stage disable error:', err);
    res.status(500).json({ error: 'Failed to disable stage' });
  }
});

export default router;
