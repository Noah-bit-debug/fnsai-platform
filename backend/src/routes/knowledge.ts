import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';

const router = Router();

// ---------------------------------------------------------------------------
// Knowledge Sources
// ---------------------------------------------------------------------------

// GET /sources — list knowledge sources.
// Resilient to missing tables (42P01) / missing columns (42703) so a
// partially-migrated deployment shows an empty KB page instead of 500.
router.get('/sources', requireAuth, requirePermission('knowledge_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT ks.*,
              u.name AS created_by_name,
              COUNT(ki.id)::INT AS item_count_actual
       FROM knowledge_sources ks
       LEFT JOIN users u ON ks.created_by = u.id
       LEFT JOIN knowledge_items ki ON ki.source_id = ks.id
       GROUP BY ks.id, u.name
       ORDER BY ks.created_at DESC`
    );
    res.json({ sources: result.rows });
  } catch (err: any) {
    if (['42P01', '42703'].includes(err?.code)) { res.json({ sources: [] }); return; }
    console.error('Knowledge sources list error:', err);
    res.status(500).json({ error: 'Failed to fetch knowledge sources', detail: err?.message?.slice(0, 200) });
  }
});

// GET /stats — aggregate counts for the AI KB header pills.
// Small calculation used by the header of AI Knowledge Base — matches the
// shape the frontend expects { total_sources, active_sources, indexed_items,
// pending_questions }. Same missing-table resilience as /sources.
router.get('/stats', requireAuth, requirePermission('knowledge_view'), async (_req: Request, res: Response) => {
  const safeCount = async (sql: string): Promise<number> => {
    try {
      const r = await query<{ count: string }>(sql);
      return parseInt(r.rows[0]?.count ?? '0', 10);
    } catch (err: any) {
      if (['42P01', '42703'].includes(err?.code)) return 0;
      throw err;
    }
  };
  try {
    const [total, active, indexed, pending] = await Promise.all([
      safeCount(`SELECT COUNT(*)::TEXT AS count FROM knowledge_sources`),
      safeCount(`SELECT COUNT(*)::TEXT AS count FROM knowledge_sources WHERE enabled = TRUE`),
      safeCount(`SELECT COUNT(*)::TEXT AS count FROM knowledge_items`),
      safeCount(`SELECT COUNT(*)::TEXT AS count FROM clarifications WHERE status = 'pending'`),
    ]);
    res.json({
      total_sources: total,
      active_sources: active,
      indexed_items: indexed,
      pending_questions: pending,
    });
  } catch (err: any) {
    console.error('Knowledge stats error:', err);
    res.json({ total_sources: 0, active_sources: 0, indexed_items: 0, pending_questions: 0 });
  }
});

// GET /items/recent — last 20 indexed items across all sources.
// Same resilience pattern: missing-table → empty list.
router.get('/items/recent', requireAuth, requirePermission('knowledge_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT ki.id, ki.title, ki.excerpt, ki.source_id, ki.url, ki.indexed_at,
              ks.name AS source_name, ks.type AS source_type
       FROM knowledge_items ki
       LEFT JOIN knowledge_sources ks ON ks.id = ki.source_id
       ORDER BY ki.indexed_at DESC NULLS LAST, ki.created_at DESC NULLS LAST
       LIMIT 20`
    );
    res.json({ items: result.rows });
  } catch (err: any) {
    if (['42P01', '42703'].includes(err?.code)) { res.json({ items: [] }); return; }
    console.error('Knowledge items/recent error:', err);
    res.status(500).json({ error: 'Failed to fetch recent items', detail: err?.message?.slice(0, 200) });
  }
});

// POST /sources — create knowledge source
router.post('/sources', requireAuth, requirePermission('knowledge_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { name, type, config, permissions } = req.body;
  const auth = getAuth(req);

  if (!name || !type) {
    res.status(400).json({ error: 'name and type are required' });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO knowledge_sources (name, type, config, permissions, status, created_by)
       VALUES ($1, $2, $3, $4, 'pending',
               (SELECT id FROM users WHERE clerk_user_id = $5 LIMIT 1))
       RETURNING *`,
      [name, type, JSON.stringify(config ?? {}), JSON.stringify(permissions ?? {}), auth?.userId ?? null]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'knowledge.source.create', String(result.rows[0].id),
      { name, type }, req.ip ?? 'unknown');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create knowledge source error:', err);
    res.status(500).json({ error: 'Failed to create knowledge source' });
  }
});

// GET /sources/:id — get source + stats
router.get('/sources/:id', requireAuth, requirePermission('knowledge_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const source = await query(
      `SELECT ks.*, u.name AS created_by_name
       FROM knowledge_sources ks
       LEFT JOIN users u ON ks.created_by = u.id
       WHERE ks.id = $1`,
      [id]
    );
    if (source.rows.length === 0) {
      res.status(404).json({ error: 'Knowledge source not found' });
      return;
    }
    const stats = await query(
      `SELECT
         COUNT(*)::INT AS total_items,
         COUNT(*) FILTER (WHERE indexed_at IS NOT NULL)::INT AS indexed_items,
         MAX(indexed_at) AS last_indexed
       FROM knowledge_items
       WHERE source_id = $1`,
      [id]
    );
    res.json({ source: source.rows[0], stats: stats.rows[0] });
  } catch (err) {
    console.error('Get knowledge source error:', err);
    res.status(500).json({ error: 'Failed to fetch knowledge source' });
  }
});

// PATCH /sources/:id — update source (toggle enabled, update config)
router.patch('/sources/:id', requireAuth, requirePermission('knowledge_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { name, config, permissions, enabled, status } = req.body;
  const auth = getAuth(req);

  try {
    const result = await query(
      `UPDATE knowledge_sources SET
         name        = COALESCE($1, name),
         config      = COALESCE($2, config),
         permissions = COALESCE($3, permissions),
         enabled     = COALESCE($4, enabled),
         status      = COALESCE($5, status),
         updated_at  = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        name ?? null,
        config ? JSON.stringify(config) : null,
        permissions ? JSON.stringify(permissions) : null,
        enabled ?? null,
        status ?? null,
        id,
      ]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Knowledge source not found' });
      return;
    }
    await logAudit(null, auth?.userId ?? 'unknown', 'knowledge.source.update', id,
      { enabled, status }, req.ip ?? 'unknown');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update knowledge source error:', err);
    res.status(500).json({ error: 'Failed to update knowledge source' });
  }
});

// DELETE /sources/:id — delete source
router.delete('/sources/:id', requireAuth, requirePermission('knowledge_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  try {
    const existing = await query(`SELECT id, name FROM knowledge_sources WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Knowledge source not found' });
      return;
    }
    // Delete items first to respect FK constraints
    await query(`DELETE FROM knowledge_items WHERE source_id = $1`, [id]);
    await query(`DELETE FROM knowledge_sources WHERE id = $1`, [id]);
    await logAudit(null, auth?.userId ?? 'unknown', 'knowledge.source.delete', id,
      { name: existing.rows[0].name }, req.ip ?? 'unknown');
    res.json({ success: true });
  } catch (err) {
    console.error('Delete knowledge source error:', err);
    res.status(500).json({ error: 'Failed to delete knowledge source' });
  }
});

// POST /sources/:id/index — trigger indexing of a source
router.post('/sources/:id/index', requireAuth, requirePermission('knowledge_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  try {
    const existing = await query(`SELECT * FROM knowledge_sources WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Knowledge source not found' });
      return;
    }

    // Set status to 'indexing'
    await query(
      `UPDATE knowledge_sources SET status = 'indexing', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    // Simulate indexing: after 2s update status to 'active' and refresh item_count
    setTimeout(async () => {
      try {
        const countResult = await query(
          `SELECT COUNT(*)::INT AS count FROM knowledge_items WHERE source_id = $1`,
          [id]
        );
        await query(
          `UPDATE knowledge_sources
           SET status = 'active', item_count = $1, last_indexed_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [countResult.rows[0].count, id]
        );
      } catch (innerErr) {
        console.error('Indexing completion error:', innerErr);
        await query(
          `UPDATE knowledge_sources SET status = 'error', updated_at = NOW() WHERE id = $1`,
          [id]
        ).catch(() => {});
      }
    }, 2000);

    await logAudit(null, auth?.userId ?? 'unknown', 'knowledge.source.index', id,
      { name: existing.rows[0].name }, req.ip ?? 'unknown');
    res.json({ success: true, message: 'Indexing initiated' });
  } catch (err) {
    console.error('Index knowledge source error:', err);
    res.status(500).json({ error: 'Failed to initiate indexing' });
  }
});

// GET /sources/:id/items — list items from a knowledge source (paginated)
router.get('/sources/:id/items', requireAuth, requirePermission('knowledge_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 50);
  const offset = parseInt(req.query.offset as string) || 0;
  try {
    const exists = await query(`SELECT id FROM knowledge_sources WHERE id = $1`, [id]);
    if (exists.rows.length === 0) {
      res.status(404).json({ error: 'Knowledge source not found' });
      return;
    }
    const result = await query(
      `SELECT * FROM knowledge_items
       WHERE source_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );
    const total = await query(
      `SELECT COUNT(*)::INT AS count FROM knowledge_items WHERE source_id = $1`,
      [id]
    );
    res.json({ items: result.rows, total: total.rows[0].count, limit, offset });
  } catch (err) {
    console.error('List knowledge items error:', err);
    res.status(500).json({ error: 'Failed to fetch knowledge items' });
  }
});

// ---------------------------------------------------------------------------
// Knowledge Items
// ---------------------------------------------------------------------------

// GET /items/search — search knowledge items
router.get('/items/search', requireAuth, requirePermission('knowledge_view'), async (req: Request, res: Response) => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q || q.length < 2) {
    res.status(400).json({ error: 'Query parameter "q" must be at least 2 characters' });
    return;
  }
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const source_id = req.query.source_id as string | undefined;

  const conditions: string[] = ['(ki.title ILIKE $1 OR ki.content_preview ILIKE $1)'];
  const params: unknown[] = [`%${q}%`];
  let idx = 2;

  if (source_id) {
    conditions.push(`ki.source_id = $${idx++}`);
    params.push(source_id);
  }

  try {
    const result = await query(
      `SELECT ki.*, ks.name AS source_name, ks.type AS source_type
       FROM knowledge_items ki
       JOIN knowledge_sources ks ON ki.source_id = ks.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ki.updated_at DESC
       LIMIT $${idx}`,
      [...params, limit]
    );
    res.json({ items: result.rows, query: q, total: result.rows.length });
  } catch (err) {
    console.error('Knowledge item search error:', err);
    res.status(500).json({ error: 'Failed to search knowledge items' });
  }
});

// DELETE /items/:id — remove a knowledge item
router.delete('/items/:id', requireAuth, requirePermission('knowledge_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  try {
    const existing = await query(`SELECT id, source_id FROM knowledge_items WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Knowledge item not found' });
      return;
    }
    await query(`DELETE FROM knowledge_items WHERE id = $1`, [id]);
    // Refresh item_count on the parent source
    await query(
      `UPDATE knowledge_sources
       SET item_count = (SELECT COUNT(*)::INT FROM knowledge_items WHERE source_id = $1), updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].source_id]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'knowledge.item.delete', id,
      { source_id: existing.rows[0].source_id }, req.ip ?? 'unknown');
    res.json({ success: true });
  } catch (err) {
    console.error('Delete knowledge item error:', err);
    res.status(500).json({ error: 'Failed to delete knowledge item' });
  }
});

export default router;
