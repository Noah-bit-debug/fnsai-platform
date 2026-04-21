import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';

const router = Router();

const SUPPORTED_TYPES = ['quickbooks', 'onedrive', 'teams', 'outlook', 'sharepoint', 'custom'] as const;

// GET /health/all — must be declared before /:id to avoid route conflict
router.get('/health/all', requireAuth, requirePermission('integrations_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
         i.id,
         i.name,
         i.type,
         i.status,
         i.last_synced_at,
         COUNT(sl.id) FILTER (WHERE sl.success = false AND sl.created_at > NOW() - INTERVAL '24 hours')::INT AS error_count_24h,
         COUNT(sl.id) FILTER (WHERE sl.success = false)::INT AS total_error_count
       FROM integrations i
       LEFT JOIN integration_sync_logs sl ON sl.integration_id = i.id
       GROUP BY i.id
       ORDER BY i.name`
    );
    res.json({ integrations: result.rows });
  } catch (err) {
    console.error('Integration health error:', err);
    res.status(500).json({ error: 'Failed to fetch integration health' });
  }
});

// GET / — list all integrations
router.get('/', requireAuth, requirePermission('integrations_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT i.*,
              COUNT(sl.id)::INT AS total_syncs,
              MAX(sl.started_at) AS last_sync_attempt
       FROM integrations i
       LEFT JOIN integration_sync_logs sl ON sl.integration_id = i.id
       GROUP BY i.id
       ORDER BY i.name`
    );
    res.json({ integrations: result.rows });
  } catch (err) {
    console.error('Integrations list error:', err);
    res.status(500).json({ error: 'Failed to fetch integrations' });
  }
});

// POST / — create integration
router.post('/', requireAuth, requirePermission('integrations_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { type, name, config, sync_frequency_minutes } = req.body;
  const auth = getAuth(req);

  if (!type || !name) {
    res.status(400).json({ error: 'type and name are required' });
    return;
  }
  if (!SUPPORTED_TYPES.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${SUPPORTED_TYPES.join(', ')}` });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO integrations (type, name, config, sync_frequency_minutes, status, created_by)
       VALUES ($1, $2, $3, $4, 'disconnected',
               (SELECT id FROM users WHERE clerk_user_id = $5 LIMIT 1))
       RETURNING *`,
      [type, name, JSON.stringify(config ?? {}), sync_frequency_minutes ?? 60, auth?.userId ?? null]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'integration.create', String(result.rows[0].id),
      { type, name }, req.ip ?? 'unknown');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create integration error:', err);
    res.status(500).json({ error: 'Failed to create integration' });
  }
});
// GET /status — env-var-driven readiness pills for Settings → Integrations
router.get('/status', requireAuth, requirePermission('integrations_view'), async (_req: Request, res: Response) => {
  const has = (...keys: string[]) =>
    keys.every(k => !!(process.env[k] && process.env[k]!.trim()));

  res.json({
    integrations: [
      { key: 'anthropic',  name: 'Anthropic (Claude)',
        connected: has('ANTHROPIC_API_KEY'),
        required_env: ['ANTHROPIC_API_KEY'],
        description: 'AI features (drafting, summarization, AI Brain).' },
      { key: 'clerkchat',  name: 'ClerkChat SMS',
        connected: has('CLERKCHAT_API_KEY', 'CLERKCHAT_FROM_NUMBER'),
        required_env: ['CLERKCHAT_API_KEY', 'CLERKCHAT_FROM_NUMBER'],
        description: 'Outbound SMS & candidate messaging.' },
      { key: 'microsoft',  name: 'Microsoft Graph (Outlook / Teams / SharePoint)',
        connected: has('MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'),
        required_env: ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
        description: 'Calendar, email, Teams meetings, SharePoint docs.' },
      { key: 'azure_blob', name: 'Azure Blob Storage',
        connected: has('AZURE_STORAGE_CONNECTION_STRING'),
        required_env: ['AZURE_STORAGE_CONNECTION_STRING'],
        description: 'Attachments, signed documents, exports.' },
      { key: 'postgres',   name: 'PostgreSQL (primary DB)',
        connected: has('DATABASE_URL'),
        required_env: ['DATABASE_URL'],
        description: 'Application database.' },
      { key: 'clerk',      name: 'Clerk Auth',
        connected: has('CLERK_SECRET_KEY'),
        required_env: ['CLERK_SECRET_KEY'],
        description: 'User authentication & session management.' },
    ],
  });
});

// GET /:id — get integration details + recent sync logs
router.get('/:id', requireAuth, requirePermission('integrations_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
if (!/^\d+$/.test(id)) { res.status(404).json({ error: 'Integration not found' }); return; }
  try {
    const integration = await query(`SELECT * FROM integrations WHERE id = $1`, [id]);
    if (integration.rows.length === 0) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    const logs = await query(
      `SELECT * FROM integration_sync_logs
       WHERE integration_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [id]
    );
    res.json({ integration: integration.rows[0], recent_logs: logs.rows });
  } catch (err) {
    console.error('Get integration error:', err);
    res.status(500).json({ error: 'Failed to fetch integration' });
  }
});

// PATCH /:id — update integration config/status
router.patch('/:id', requireAuth, requirePermission('integrations_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { name, config, status, sync_frequency_minutes } = req.body;
  const auth = getAuth(req);

  if (status && !['connected', 'disconnected', 'error', 'paused'].includes(status)) {
    res.status(400).json({ error: 'Invalid status value' });
    return;
  }

  try {
    const result = await query(
      `UPDATE integrations SET
         name                  = COALESCE($1, name),
         config                = COALESCE($2, config),
         status                = COALESCE($3, status),
         sync_frequency_minutes = COALESCE($4, sync_frequency_minutes),
         updated_at            = NOW()
       WHERE id = $5
       RETURNING *`,
      [name ?? null, config ? JSON.stringify(config) : null, status ?? null, sync_frequency_minutes ?? null, id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    await logAudit(null, auth?.userId ?? 'unknown', 'integration.update', id,
      { name, status }, req.ip ?? 'unknown');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update integration error:', err);
    res.status(500).json({ error: 'Failed to update integration' });
  }
});

// DELETE /:id — remove integration
router.delete('/:id', requireAuth, requirePermission('integrations_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  try {
    const existing = await query(`SELECT id, name FROM integrations WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    await query(`DELETE FROM integration_sync_logs WHERE integration_id = $1`, [id]);
    await query(`DELETE FROM integrations WHERE id = $1`, [id]);
    await logAudit(null, auth?.userId ?? 'unknown', 'integration.delete', id,
      { name: existing.rows[0].name }, req.ip ?? 'unknown');
    res.json({ success: true });
  } catch (err) {
    console.error('Delete integration error:', err);
    res.status(500).json({ error: 'Failed to delete integration' });
  }
});

// POST /:id/sync — trigger manual sync
router.post('/:id/sync', requireAuth, requirePermission('integrations_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  try {
    const existing = await query(`SELECT * FROM integrations WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    const integration = existing.rows[0];

    // Set status to 'syncing'
    await query(
      `UPDATE integrations SET status = 'syncing', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    // Insert sync log entry
    const logResult = await query(
      `INSERT INTO integration_sync_logs (integration_id, success, message, records_synced, triggered_by)
       VALUES ($1, true, 'Manual sync initiated', 0,
               (SELECT id FROM users WHERE clerk_user_id = $2 LIMIT 1))
       RETURNING *`,
      [id, auth?.userId ?? null]
    );

    // Simulate async sync completion: restore to 'connected' after 500ms
    setTimeout(async () => {
      try {
        await query(
          `UPDATE integrations SET status = 'connected', last_synced_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [id]
        );
        await query(
          `UPDATE integration_sync_logs SET message = 'Sync completed successfully', updated_at = NOW() WHERE id = $1`,
          [logResult.rows[0].id]
        );
      } catch (innerErr) {
        console.error('Sync completion error:', innerErr);
      }
    }, 500);

    await logAudit(null, auth?.userId ?? 'unknown', 'integration.sync', id,
      { name: integration.name }, req.ip ?? 'unknown');
    res.json({ success: true, message: 'Sync initiated', sync_log_id: logResult.rows[0].id });
  } catch (err) {
    console.error('Sync integration error:', err);
    res.status(500).json({ error: 'Failed to initiate sync' });
  }
});

// GET /:id/logs — get sync logs for integration
router.get('/:id/logs', requireAuth, requirePermission('integrations_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  try {
    const exists = await query(`SELECT id FROM integrations WHERE id = $1`, [id]);
    if (exists.rows.length === 0) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    const result = await query(
      `SELECT sl.*,
              u.name AS triggered_by_name
       FROM integration_sync_logs sl
       LEFT JOIN users u ON sl.triggered_by = u.id
       WHERE sl.integration_id = $1
       ORDER BY sl.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );
    const total = await query(
      `SELECT COUNT(*)::INT AS count FROM integration_sync_logs WHERE integration_id = $1`,
      [id]
    );
    res.json({ logs: result.rows, total: total.rows[0].count, limit, offset });
  } catch (err) {
    console.error('Get sync logs error:', err);
    res.status(500).json({ error: 'Failed to fetch sync logs' });
  }
});

export default router;
