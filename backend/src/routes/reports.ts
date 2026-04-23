import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';
import { generateReportNarrative } from '../services/intelligenceEngine';

const router = Router();

// ---------------------------------------------------------------------------
// Report Definitions
// ---------------------------------------------------------------------------

// GET /definitions — list report definitions
router.get('/definitions', requireAuth, requirePermission('reports_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT rd.*,
              u.name AS created_by_name,
              COUNT(rr.id)::INT AS run_count
       FROM report_definitions rd
       LEFT JOIN users u ON rd.created_by = u.id
       LEFT JOIN report_runs rr ON rr.definition_id = rd.id
       GROUP BY rd.id, u.name
       ORDER BY rd.created_at DESC`
    );
    res.json({ definitions: result.rows });
  } catch (err) {
    console.error('Report definitions list error:', err);
    res.status(500).json({ error: 'Failed to fetch report definitions' });
  }
});

// POST /definitions — create report definition
router.post('/definitions', requireAuth, requirePermission('reports_create'), async (req: AuthenticatedRequest, res: Response) => {
  const { name, description, report_type, default_filters, schedule_cron } = req.body;
  const auth = getAuth(req);

  if (!name || !report_type) {
    res.status(400).json({ error: 'name and report_type are required' });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO report_definitions (name, description, report_type, default_filters, schedule_cron, created_by)
       VALUES ($1, $2, $3, $4, $5,
               (SELECT id FROM users WHERE clerk_user_id = $6 LIMIT 1))
       RETURNING *`,
      [name, description ?? null, report_type, JSON.stringify(default_filters ?? {}), schedule_cron ?? null, auth?.userId ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create report definition error:', err);
    res.status(500).json({ error: 'Failed to create report definition' });
  }
});

// GET /definitions/:id — get one definition
router.get('/definitions/:id', requireAuth, requirePermission('reports_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT rd.*, u.name AS created_by_name
       FROM report_definitions rd
       LEFT JOIN users u ON rd.created_by = u.id
       WHERE rd.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Report definition not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get report definition error:', err);
    res.status(500).json({ error: 'Failed to fetch report definition' });
  }
});

// DELETE /definitions/:id — delete definition
router.delete('/definitions/:id', requireAuth, requirePermission('reports_create'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const existing = await query(`SELECT id FROM report_definitions WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Report definition not found' });
      return;
    }
    await query(`DELETE FROM report_definitions WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete report definition error:', err);
    res.status(500).json({ error: 'Failed to delete report definition' });
  }
});

// ---------------------------------------------------------------------------
// Report Runs
// ---------------------------------------------------------------------------

// GET /runs — list recent report runs (last 50)
router.get('/runs', requireAuth, requirePermission('reports_view'), async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT rr.*,
              u.name AS run_by_name,
              rd.name AS definition_name
       FROM report_runs rr
       LEFT JOIN users u ON rr.run_by = u.id
       LEFT JOIN report_definitions rd ON rr.definition_id = rd.id
       ORDER BY rr.created_at DESC
       LIMIT 50`
    );
    res.json({ runs: result.rows });
  } catch (err) {
    console.error('Report runs list error:', err);
    res.status(500).json({ error: 'Failed to fetch report runs' });
  }
});

// POST /runs — generate a new report run
router.post('/runs', requireAuth, requirePermission('reports_view'), async (req: AuthenticatedRequest, res: Response) => {
  const { definition_id, run_name, report_type, filters = {} } = req.body;
  const auth = getAuth(req);

  if (!run_name || !report_type) {
    res.status(400).json({ error: 'run_name and report_type are required' });
    return;
  }

  const { date_from, date_to, team_member, client_id, stage, department } = filters;

  // Build date range conditions for queries
  const dateConditions: string[] = [];
  const dateParams: unknown[] = [];
  let idx = 1;
  if (date_from) { dateConditions.push(`created_at >= $${idx++}`); dateParams.push(date_from); }
  if (date_to)   { dateConditions.push(`created_at <= $${idx++}`); dateParams.push(date_to); }
  const dateWhere = dateConditions.length ? `WHERE ${dateConditions.join(' AND ')}` : '';

  try {
    let reportData: Record<string, unknown> = {};
    let narrative: string | null = null;

    if (report_type === 'ai_narrative') {
      // Gather real data from DB
      const [candidateCounts, placements, reminderStats] = await Promise.all([
        query(
          `SELECT stage, COUNT(*)::INT AS count
           FROM candidates
           ${stage ? 'WHERE stage = $1' : ''}
           GROUP BY stage
           ORDER BY count DESC`,
          stage ? [stage] : []
        ),
        query(
          `SELECT COUNT(*)::INT AS total,
                  COUNT(*) FILTER (WHERE status = 'active')::INT AS active,
                  COUNT(*) FILTER (WHERE status = 'completed')::INT AS completed
           FROM placements
           ${dateConditions.length ? `WHERE ${dateConditions.join(' AND ')}` : ''}`,
          dateParams
        ),
        query(
          `SELECT status, COUNT(*)::INT AS count
           FROM reminders
           ${dateConditions.length ? `WHERE ${dateConditions.join(' AND ')}` : ''}
           GROUP BY status`,
          dateParams
        ),
      ]);

      reportData = {
        candidate_pipeline: candidateCounts.rows,
        placements:         placements.rows[0],
        reminder_summary:   reminderStats.rows,
        filters,
      };

      narrative = await generateReportNarrative(report_type, reportData, filters);

    } else {
      // Standard report types: operations | recruiting | compliance | financial
      switch (report_type) {
        case 'operations': {
          const [candidates, activePlacements, openReminders] = await Promise.all([
            query(`SELECT stage, status, COUNT(*)::INT AS count FROM candidates GROUP BY stage, status ORDER BY stage`),
            query(`SELECT COUNT(*)::INT AS count FROM placements WHERE status = 'active'`),
            query(`SELECT COUNT(*)::INT AS count FROM reminders WHERE status IN ('scheduled','pending')`),
          ]);
          reportData = {
            candidate_pipeline:  candidates.rows,
            active_placements:   activePlacements.rows[0]?.count ?? 0,
            open_reminders:      openReminders.rows[0]?.count ?? 0,
          };
          break;
        }
        case 'recruiting': {
          const [stageBreakdown, recentCandidates, conversionStats] = await Promise.all([
            query(`SELECT stage, COUNT(*)::INT AS count FROM candidates GROUP BY stage ORDER BY count DESC`),
            query(
              `SELECT first_name, last_name, stage, status, created_at
               FROM candidates
               ${dateWhere}
               ORDER BY created_at DESC
               LIMIT 50`,
              dateParams
            ),
            query(
              `SELECT
                 COUNT(*) FILTER (WHERE stage = 'placed')::INT AS placed,
                 COUNT(*) FILTER (WHERE stage = 'offer')::INT AS offers,
                 COUNT(*) FILTER (WHERE stage = 'interview')::INT AS interviews,
                 COUNT(*)::INT AS total
               FROM candidates
               ${dateWhere}`,
              dateParams
            ),
          ]);
          reportData = {
            stage_breakdown:   stageBreakdown.rows,
            recent_candidates: recentCandidates.rows,
            conversion_stats:  conversionStats.rows[0],
            filters,
          };
          break;
        }
        case 'compliance': {
          const [expiring, missingDocs, credentialStatus] = await Promise.all([
            query(
              `SELECT c.first_name, c.last_name, cd.document_type, cd.expiry_date
               FROM candidate_documents cd
               JOIN candidates c ON cd.candidate_id = c.id
               WHERE cd.expiry_date IS NOT NULL AND cd.expiry_date <= NOW() + INTERVAL '30 days'
               ORDER BY cd.expiry_date`
            ),
            query(
              `SELECT c.first_name, c.last_name, COUNT(cd.id)::INT AS missing_count
               FROM candidates c
               JOIN candidate_documents cd ON cd.candidate_id = c.id
               WHERE cd.status = 'missing' AND cd.required = true
               GROUP BY c.id, c.first_name, c.last_name
               ORDER BY missing_count DESC`
            ),
            query(
              `SELECT c.stage, c.status,
                      COUNT(*)::INT AS total,
                      COUNT(*) FILTER (WHERE c.stage = 'credentialing')::INT AS in_credentialing
               FROM candidates c
               GROUP BY c.stage, c.status`
            ),
          ]);
          reportData = {
            expiring_documents:  expiring.rows,
            missing_documents:   missingDocs.rows,
            credential_status:   credentialStatus.rows,
          };
          break;
        }
        case 'financial': {
          const [placements, byDept] = await Promise.all([
            query(
              `SELECT p.*, c.first_name, c.last_name
               FROM placements p
               JOIN candidates c ON p.candidate_id = c.id
               ${dateConditions.length ? `WHERE ${dateConditions.join(' AND ').replace(/created_at/g, 'p.created_at')}` : ''}
               ORDER BY p.created_at DESC
               LIMIT 100`,
              dateParams
            ),
            department
              ? query(
                  `SELECT p.department, COUNT(*)::INT AS placements, SUM(p.bill_rate)::NUMERIC AS total_bill_rate
                   FROM placements p
                   WHERE p.department = $1
                   GROUP BY p.department`,
                  [department]
                )
              : query(
                  `SELECT p.department, COUNT(*)::INT AS placements, SUM(p.bill_rate)::NUMERIC AS total_bill_rate
                   FROM placements p
                   GROUP BY p.department
                   ORDER BY total_bill_rate DESC NULLS LAST`
                ),
          ]);
          reportData = {
            placements:      placements.rows,
            by_department:   byDept.rows,
            filters,
          };
          break;
        }
        default: {
          res.status(400).json({ error: `Unknown report_type: ${report_type}` });
          return;
        }
      }
    }

    // Insert run record
    const runResult = await query(
      `INSERT INTO report_runs (definition_id, run_name, report_type, filters, result_data, narrative, run_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               (SELECT id FROM users WHERE clerk_user_id = $7 LIMIT 1))
       RETURNING *`,
      [
        definition_id ?? null,
        run_name,
        report_type,
        JSON.stringify(filters),
        JSON.stringify(reportData),
        narrative ?? null,
        auth?.userId ?? null,
      ]
    );

    res.status(201).json(runResult.rows[0]);
  } catch (err) {
    // Phase 5.4 QA fix — QA reported "Failed to generate report" on
    // every type with no indication of WHY. The catch was swallowing
    // the specific pg error (missing column, bad JOIN, etc.). Now we
    // log the full error server-side AND return the message to the
    // client so it's visible in the modal's error banner.
    const e = err as { message?: string; code?: string; detail?: string; position?: string };
    console.error('Generate report run error:', {
      message: e.message, code: e.code, detail: e.detail, position: e.position,
      stack: (err as Error)?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    res.status(500).json({
      error: `Failed to generate report: ${e.message?.slice(0, 300) ?? 'unknown'}`,
      code: e.code,
    });
  }
});

// GET /runs/:id — get a specific run result
router.get('/runs/:id', requireAuth, requirePermission('reports_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT rr.*,
              u.name AS run_by_name,
              rd.name AS definition_name
       FROM report_runs rr
       LEFT JOIN users u ON rr.run_by = u.id
       LEFT JOIN report_definitions rd ON rr.definition_id = rd.id
       WHERE rr.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Report run not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get report run error:', err);
    res.status(500).json({ error: 'Failed to fetch report run' });
  }
});

// GET /runs/:id/export — return run data as plain text
router.get('/runs/:id/export', requireAuth, requirePermission('reports_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(`SELECT * FROM report_runs WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Report run not found' });
      return;
    }
    const run = result.rows[0] as {
      run_name: string;
      report_type: string;
      created_at: string;
      narrative?: string | null;
      result_data: unknown;
    };
    const lines: string[] = [
      `Report: ${run.run_name}`,
      `Type: ${run.report_type}`,
      `Generated: ${new Date(run.created_at).toLocaleString()}`,
      '',
    ];
    if (run.narrative) {
      lines.push('NARRATIVE SUMMARY');
      lines.push('=================');
      lines.push(run.narrative);
      lines.push('');
    }
    lines.push('DATA');
    lines.push('====');
    lines.push(JSON.stringify(run.result_data, null, 2));

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('Export report run error:', err);
    res.status(500).json({ error: 'Failed to export report run' });
  }
});

// ---------------------------------------------------------------------------
// Standard Metrics Snapshot (no AI, fast)
// ---------------------------------------------------------------------------

// GET /standard/metrics — return all key operational metrics
// Returns the KPI snapshot the Reports page renders. Flat shape so the
// frontend renders each card without extra mapping. Each metric's query is
// independently wrapped — a single missing table (e.g. jobs not yet migrated)
// returns 0 for that metric instead of 500-ing the whole endpoint.
router.get('/standard/metrics', requireAuth, requirePermission('reports_view'), async (_req: Request, res: Response) => {
  const safeNum = async (sql: string): Promise<number> => {
    try {
      const r = await query(sql);
      const v = r.rows[0] ? Number((r.rows[0] as Record<string, unknown>).n ?? 0) : 0;
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  };

  const compRates = async (): Promise<{ completed: number; total: number }> => {
    try {
      const r = await query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('completed','signed','read','approved'))::INT AS completed,
           COUNT(*)::INT AS total
         FROM comp_competency_records`
      );
      const row = r.rows[0] as { completed?: number; total?: number } | undefined;
      return { completed: row?.completed ?? 0, total: row?.total ?? 0 };
    } catch {
      return { completed: 0, total: 0 };
    }
  };

  const [
    active_placements,
    candidates_pipeline,
    comp,
    open_positions,
    avg_time_to_fill,
  ] = await Promise.all([
    safeNum(`SELECT COUNT(*)::INT AS n FROM placements WHERE status = 'active'`),
    safeNum(
      `SELECT COUNT(*)::INT AS n FROM candidates
       WHERE status = 'active'
         AND stage NOT IN ('placed','rejected','withdrawn','not_joined')`
    ),
    compRates(),
    safeNum(`SELECT COALESCE(SUM(positions), 0)::INT AS n FROM jobs WHERE status = 'open'`),
    safeNum(
      `SELECT COALESCE(ROUND(AVG(GREATEST(EXTRACT(EPOCH FROM (start_date::timestamp - created_at)) / 86400, 0))::numeric, 1), 0) AS n
       FROM placements
       WHERE start_date IS NOT NULL
         AND created_at >= NOW() - INTERVAL '90 days'
         AND status IN ('active','completed')`
    ),
  ]);

  const compliance_rate = comp.total > 0
    ? Math.round((comp.completed / comp.total) * 1000) / 10
    : 0;

  res.json({
    active_placements,
    candidates_pipeline,
    compliance_rate,
    open_positions,
    avg_time_to_fill,
    // No revenue/invoicing table yet — return 0 so the card renders "$0" instead of undefined.
    revenue_mtd: 0,
    generated_at: new Date().toISOString(),
  });
});

export default router;
