import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '../middleware/auth';
import { pool } from '../db/client';
import { buildComplianceSummary as buildSummary } from '../services/compliance/summary';

const router = Router();

// ---------------------------------------------------------------------------
// Staff Integration
// ---------------------------------------------------------------------------

// GET /staff/:staffId/compliance
router.get('/staff/:staffId/compliance', requireAuth, async (req: Request, res: Response) => {
  try {
    const { staffId } = req.params;
    const client = await pool.connect();
    try {
      const staffResult = await client.query(
        `SELECT id, first_name, last_name, email, clerk_user_id FROM staff WHERE id = $1`,
        [staffId]
      );
      if (staffResult.rowCount === 0) {
        return res.status(404).json({ error: 'Staff member not found' });
      }
      const staff = staffResult.rows[0];

      if (!staff.clerk_user_id) {
        return res.json({
          linked: false,
          staff: { id: staff.id, first_name: staff.first_name, last_name: staff.last_name },
          message: 'Link a user account to see compliance data.',
        });
      }

      const [recordsResult, expiringSoonResult, credentialsResult] = await Promise.all([
        client.query(
          `SELECT * FROM comp_competency_records WHERE user_clerk_id = $1 ORDER BY assigned_date DESC`,
          [staff.clerk_user_id]
        ),
        client.query(
          `SELECT * FROM comp_competency_records
           WHERE user_clerk_id = $1 AND expiration_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
           AND status IN ('completed','signed','read')
           ORDER BY expiration_date ASC LIMIT 5`,
          [staff.clerk_user_id]
        ),
        // Pull staff credentials (RN/LPN licenses, BLS, etc.) from the
        // `credentials` table so they count toward compliance metrics —
        // not just competency records. Map the credential status vocab
        // to the document-status vocab buildSummary expects.
        client.query(
          `SELECT id, type AS document_type, type AS label,
                  CASE
                    WHEN status IN ('valid','expiring','expiring_soon') THEN 'approved'
                    WHEN status = 'pending' THEN 'pending'
                    WHEN status = 'missing' THEN 'missing'
                    WHEN status = 'expired' THEN 'expired'
                    ELSE 'pending'
                  END AS status,
                  TRUE AS required, expiry_date
           FROM credentials WHERE staff_id = $1`,
          [staff.id]
        ).catch(() => ({ rows: [] as any[] })),
      ]);

      const records = recordsResult.rows;
      const expiring_soon = expiringSoonResult.rows;
      const credentialDocs = credentialsResult.rows;

      return res.json({
        linked: true,
        staff: {
          id: staff.id,
          first_name: staff.first_name,
          last_name: staff.last_name,
          clerk_user_id: staff.clerk_user_id,
        },
        summary: buildSummary(records, credentialDocs),
        records,
        documents: credentialDocs,
        expiring_soon,
      });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /staff/:staffId/link-user
router.post('/staff/:staffId/link-user', requireAuth, async (req: Request, res: Response) => {
  try {
    const { staffId } = req.params;
    const { clerk_user_id } = req.body as { clerk_user_id: string };

    if (!clerk_user_id || !clerk_user_id.trim()) {
      return res.status(400).json({ error: 'clerk_user_id is required' });
    }

    const client = await pool.connect();
    try {
      const result = await client.query(
        `UPDATE staff SET clerk_user_id = $1, updated_at = NOW() WHERE id = $2
         RETURNING id, first_name, last_name, clerk_user_id`,
        [clerk_user_id.trim(), staffId]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Staff member not found' });
      }
      return res.json({ success: true, staff: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /staff/:staffId/unlink-user
router.post('/staff/:staffId/unlink-user', requireAuth, async (req: Request, res: Response) => {
  try {
    const { staffId } = req.params;
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE staff SET clerk_user_id = NULL, updated_at = NOW() WHERE id = $1`,
        [staffId]
      );
      return res.json({ success: true });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Candidate Integration
// ---------------------------------------------------------------------------

// GET /candidate/:candidateId/compliance
router.get('/candidate/:candidateId/compliance', requireAuth, async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const client = await pool.connect();
    try {
      // Fetch competency records, candidate documents, and assigned bundles
      // in parallel. The docs query may fail on instances that haven't run
      // candidates_migration.sql yet — fall back to empty so the endpoint
      // still returns rather than 500'ing.
      const [recordsResult, documentsResult, assignmentsResult] = await Promise.all([
        client.query(
          `SELECT * FROM comp_competency_records WHERE candidate_id = $1 ORDER BY assigned_date DESC`,
          [candidateId]
        ),
        client.query(
          `SELECT id, document_type, label, status, required, expiry_date, approved_at
           FROM candidate_documents WHERE candidate_id = $1 ORDER BY created_at DESC`,
          [candidateId]
        ).catch(() => ({ rows: [] as any[] })),
        client.query(
          `SELECT oa.*, b.title as bundle_title, b.description as bundle_description,
             (SELECT COUNT(*) FROM comp_bundle_items WHERE bundle_id = oa.bundle_id) as item_count
           FROM comp_onboarding_assignments oa
           JOIN comp_bundles b ON b.id = oa.bundle_id
           WHERE oa.candidate_id = $1`,
          [candidateId]
        ),
      ]);

      const records = recordsResult.rows;
      const documents = documentsResult.rows;
      return res.json({
        // Frontend expects `linked` to decide whether to render the
        // dashboard — candidate compliance is always linkable, so true.
        linked: true,
        summary: buildSummary(records, documents),
        records,
        documents,
        assigned_bundles: assignmentsResult.rows,
      });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /candidate/:candidateId/assign-bundle
router.post('/candidate/:candidateId/assign-bundle', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const { candidateId } = req.params;
    const { bundle_id, due_date } = req.body as { bundle_id: string; due_date?: string };

    if (!bundle_id) {
      return res.status(400).json({ error: 'bundle_id is required' });
    }

    const client = await pool.connect();
    try {
      // Fetch bundle items
      const itemsResult = await client.query(
        `SELECT * FROM comp_bundle_items WHERE bundle_id = $1 ORDER BY sort_order`,
        [bundle_id]
      );
      if (itemsResult.rowCount === 0) {
        return res.status(400).json({ error: 'Bundle has no items' });
      }

      // Fetch candidate
      const candidateResult = await client.query(
        `SELECT first_name, last_name FROM candidates WHERE id = $1`,
        [candidateId]
      );

      // Fetch bundle title
      const bundleResult = await client.query(
        `SELECT title FROM comp_bundles WHERE id = $1`,
        [bundle_id]
      );
      const bundle_title = bundleResult.rows[0]?.title ?? bundle_id;

      // Insert onboarding assignment if not already present
      await client.query(
        `INSERT INTO comp_onboarding_assignments (candidate_id, bundle_id, assigned_by, trigger_type)
         SELECT $1, $2, $3, 'manual'
         WHERE NOT EXISTS (
           SELECT 1 FROM comp_onboarding_assignments
           WHERE candidate_id = $1 AND bundle_id = $2
         )`,
        [candidateId, bundle_id, auth.userId]
      );

      // For each bundle item, create competency record if not already
      // present. The QA report's "Assign Bundle button does nothing"
      // bug came from this INSERT: comp_competency_records.user_clerk_id
      // is VARCHAR(255) NOT NULL with no default, but the previous INSERT
      // omitted it, so every assign-bundle call 500'd with a NOT-NULL
      // constraint violation. The frontend's alert() error path was
      // silently blocked by the QA's browser-automation tool, which
      // produced the visible "modal stays open, no feedback" symptom.
      //
      // user_clerk_id is required by the comp_competency_records schema
      // but candidates aren't IdP-linked yet (the candidates table has
      // no clerk_user_id column — they get one only when promoted to
      // staff). Use a synthetic identifier so the not-null constraint
      // is satisfied without putting a real IdP id we don't have. The
      // `candidate:<uuid>` shape makes the dependency explicit when
      // reviewing the table later.
      const candidateClerkId = `candidate:${candidateId}`;

      let created = 0;
      let skipped = 0;
      for (const item of itemsResult.rows) {
        const insertResult = await client.query(
          `INSERT INTO comp_competency_records
             (user_clerk_id, candidate_id, item_type, item_id, title, status, due_date, assigned_by)
           SELECT $1, $2, $3, $4, $5, 'not_started', $6, $7
           WHERE NOT EXISTS (
             SELECT 1 FROM comp_competency_records
             WHERE candidate_id = $2 AND item_type = $3 AND item_id = $4
           )`,
          [candidateClerkId, candidateId, item.item_type, item.item_id, item.title, due_date ?? null, auth.userId]
        );
        if (insertResult.rowCount && insertResult.rowCount > 0) {
          created++;
        } else {
          skipped++;
        }
      }

      return res.json({ success: true, bundle_title, created, skipped });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /candidate/:candidateId/stage-hook
router.post('/candidate/:candidateId/stage-hook', requireAuth, async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const { candidateId } = req.params;
    const { stage } = req.body as { stage: string };

    if (stage !== 'onboarding') {
      return res.json({ triggered: false });
    }

    const client = await pool.connect();
    try {
      // Look up auto-assignment rules for onboarding_stage
      const rulesResult = await client.query(
        `SELECT ar.bundle_id, b.title FROM comp_assignment_rules ar
         JOIN comp_bundles b ON b.id = ar.bundle_id
         WHERE ar.rule_type = 'onboarding_stage' AND ar.onboarding_stage = 'onboarding' AND ar.active = true
         AND b.status = 'published'`
      );

      if (rulesResult.rowCount === 0) {
        return res.json({ triggered: true, bundles_assigned: 0 });
      }

      // Fetch bundle items and assign for each matching bundle
      let bundles_assigned = 0;
      for (const rule of rulesResult.rows) {
        const bundle_id = rule.bundle_id;

        const itemsResult = await client.query(
          `SELECT * FROM comp_bundle_items WHERE bundle_id = $1 ORDER BY sort_order`,
          [bundle_id]
        );
        if (!itemsResult.rowCount || itemsResult.rowCount === 0) continue;

        // Insert onboarding assignment if not already present
        await client.query(
          `INSERT INTO comp_onboarding_assignments (candidate_id, bundle_id, assigned_by, trigger_type)
           SELECT $1, $2, $3, 'auto_rule'
           WHERE NOT EXISTS (
             SELECT 1 FROM comp_onboarding_assignments
             WHERE candidate_id = $1 AND bundle_id = $2
           )`,
          [candidateId, bundle_id, auth.userId]
        );

        // Insert competency records for each item
        for (const item of itemsResult.rows) {
          await client.query(
            `INSERT INTO comp_competency_records
               (candidate_id, item_type, item_id, title, status, assigned_by)
             SELECT $1, $2, $3, $4, 'not_started', $5
             WHERE NOT EXISTS (
               SELECT 1 FROM comp_competency_records
               WHERE candidate_id = $1 AND item_type = $2 AND item_id = $3
             )`,
            [candidateId, item.item_type, item.item_id, item.title, auth.userId]
          );
        }

        bundles_assigned++;
      }

      return res.json({ triggered: true, bundles_assigned });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Questionnaire Checklists
// ---------------------------------------------------------------------------

// GET /questionnaire-checklists
router.get('/questionnaire-checklists', requireAuth, async (req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, title, description, mode, cat1_id, cat2_id, cat3_id, applicable_roles
         FROM comp_checklists
         WHERE mode = 'questionnaire' AND status = 'published'
         ORDER BY title`
      );
      return res.json({ checklists: result.rows });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /incident/:incidentId/assign-questionnaire
router.post('/incident/:incidentId/assign-questionnaire', requireAuth, async (req: Request, res: Response) => {
  try {
    const { incidentId } = req.params;
    const { checklist_id, user_clerk_id } = req.body as {
      checklist_id: string;
      user_clerk_id: string;
    };

    if (!checklist_id || !user_clerk_id) {
      return res.status(400).json({ error: 'checklist_id and user_clerk_id are required' });
    }

    const client = await pool.connect();
    try {
      // Fetch checklist title
      const checklistResult = await client.query(
        `SELECT title FROM comp_checklists WHERE id = $1`,
        [checklist_id]
      );
      if (checklistResult.rowCount === 0) {
        return res.status(404).json({ error: 'Checklist not found' });
      }
      const { title } = checklistResult.rows[0];

      // Create or find competency record
      const insertResult = await client.query(
        `INSERT INTO comp_competency_records (user_clerk_id, item_type, item_id, title, notes)
         SELECT $1, 'checklist', $2, $3, 'Assigned via Incident #' || $4
         WHERE NOT EXISTS (
           SELECT 1 FROM comp_competency_records
           WHERE user_clerk_id = $1 AND item_type = 'checklist' AND item_id = $2
         )
         RETURNING id`,
        [user_clerk_id, checklist_id, title, incidentId]
      );

      let competency_record_id: string;
      if (insertResult.rowCount && insertResult.rowCount > 0) {
        competency_record_id = insertResult.rows[0].id;
      } else {
        // Fetch existing record id
        const existingResult = await client.query(
          `SELECT id FROM comp_competency_records
           WHERE user_clerk_id = $1 AND item_type = 'checklist' AND item_id = $2
           LIMIT 1`,
          [user_clerk_id, checklist_id]
        );
        competency_record_id = existingResult.rows[0].id;
      }

      return res.json({
        success: true,
        competency_record_id,
        message: 'Questionnaire assigned to user.',
      });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Compliance Overview for Integrations
// ---------------------------------------------------------------------------

// GET /overview-badge
router.get('/overview-badge', requireAuth, async (req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status IN ('completed','signed','read')) as completed,
           COUNT(*) FILTER (WHERE status = 'expired') as expired,
           COUNT(*) FILTER (WHERE due_date < NOW() AND status IN ('not_started','in_progress')) as overdue
         FROM comp_competency_records`
      );
      const row = result.rows[0];
      const total = Number(row.total);
      const completed = Number(row.completed);
      const completion_rate = total > 0 ? Math.round((completed / total) * 100) : 0;

      return res.json({
        total,
        completed,
        expired: Number(row.expired),
        overdue: Number(row.overdue),
        completion_rate,
      });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
