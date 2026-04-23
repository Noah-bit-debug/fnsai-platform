import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '../middleware/auth';
import { pool } from '../db/client';

const router = Router();

// â”€â”€â”€ GET / â€” list bundles with item counts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT b.*,
        c1.name AS cat1_name,
        c2.name AS cat2_name,
        c3.name AS cat3_name,
        COUNT(bi.id) AS item_count
       FROM comp_bundles b
       LEFT JOIN comp_categories c1 ON b.cat1_id = c1.id
       LEFT JOIN comp_categories c2 ON b.cat2_id = c2.id
       LEFT JOIN comp_categories c3 ON b.cat3_id = c3.id
       LEFT JOIN comp_bundle_items bi ON b.id = bi.bundle_id
       WHERE b.status != 'archived'
       GROUP BY b.id, c1.name, c2.name, c3.name
       ORDER BY b.created_at DESC`
    );
    res.json({ bundles: result.rows });
  } catch (err) {
    console.error('GET /compliance/bundles error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ GET /stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status != 'archived') AS total,
        COUNT(*) FILTER (WHERE status = 'published') AS published,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft
      FROM comp_bundles
    `);
    // total_assignments: count of competency records tied to bundle items (via item_id in bundle_items)
    const assignResult = await pool.query(`
      SELECT COUNT(DISTINCT cr.id) AS total_assignments
      FROM comp_competency_records cr
      JOIN comp_bundle_items bi ON bi.item_id = cr.item_id AND bi.item_type = cr.item_type
    `);
    res.json({
      total: parseInt(result.rows[0].total, 10),
      published: parseInt(result.rows[0].published, 10),
      draft: parseInt(result.rows[0].draft, 10),
      total_assignments: parseInt(assignResult.rows[0].total_assignments, 10),
    });
  } catch (err) {
    console.error('GET /compliance/bundles/stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ POST / â€” create bundle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const {
      title, description, sequential, status,
      cat1_id, cat2_id, cat3_id, applicable_roles, facility_id,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO comp_bundles
        (title, description, sequential, status, cat1_id, cat2_id, cat3_id,
         applicable_roles, facility_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        title, description ?? null, sequential ?? false, status ?? 'draft',
        cat1_id ?? null, cat2_id ?? null, cat3_id ?? null,
        applicable_roles ?? [], facility_id ?? null, userId,
      ]
    );
    res.status(201).json({ bundle: result.rows[0] });
  } catch (err) {
    console.error('POST /compliance/bundles error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ GET /:id â€” get bundle with items and rules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const bundleResult = await pool.query(
      'SELECT * FROM comp_bundles WHERE id = $1',
      [id]
    );
    if (bundleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bundle not found' });
    }

    const itemsResult = await pool.query(
      `SELECT id, item_type, item_id, item_title, sort_order, required
       FROM comp_bundle_items WHERE bundle_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [id]
    );

    const rulesResult = await pool.query(
      `SELECT id, rule_type, role, specialty, onboarding_stage, priority, active
       FROM comp_assignment_rules WHERE bundle_id = $1 ORDER BY priority DESC, created_at ASC`,
      [id]
    );

    res.json({
      bundle: bundleResult.rows[0],
      items: itemsResult.rows,
      rules: rulesResult.rows,
    });
  } catch (err) {
    console.error('GET /compliance/bundles/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ PUT /:id â€” update bundle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      title, description, sequential, status,
      cat1_id, cat2_id, cat3_id, applicable_roles, facility_id,
    } = req.body;

    const result = await pool.query(
      `UPDATE comp_bundles SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        sequential = COALESCE($3, sequential),
        status = COALESCE($4, status),
        cat1_id = COALESCE($5, cat1_id),
        cat2_id = COALESCE($6, cat2_id),
        cat3_id = COALESCE($7, cat3_id),
        applicable_roles = COALESCE($8, applicable_roles),
        facility_id = COALESCE($9, facility_id),
        updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        title ?? null, description ?? null, sequential ?? null, status ?? null,
        cat1_id ?? null, cat2_id ?? null, cat3_id ?? null,
        applicable_roles ?? null, facility_id ?? null, id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bundle not found' });
    }
    res.json({ bundle: result.rows[0] });
  } catch (err) {
    console.error('PUT /compliance/bundles/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ DELETE /:id â€” archive bundle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE comp_bundles SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bundle not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /compliance/bundles/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ POST /:id/items â€” add item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/:id/items', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { item_type, item_id, item_title, sort_order, required } = req.body;

    const result = await pool.query(
      `INSERT INTO comp_bundle_items (bundle_id, item_type, item_id, item_title, sort_order, required)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, item_type, item_id, item_title, sort_order ?? 0, required ?? true]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    console.error('POST /compliance/bundles/:id/items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ PUT /:id/items/:iid â€” update item sort_order/required â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.put('/:id/items/:iid', requireAuth, async (req: Request, res: Response) => {
  try {
    const { iid } = req.params;
    const { sort_order, required } = req.body;

    const result = await pool.query(
      `UPDATE comp_bundle_items SET
        sort_order = COALESCE($1, sort_order),
        required = COALESCE($2, required)
       WHERE id = $3
       RETURNING *`,
      [sort_order ?? null, required ?? null, iid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ item: result.rows[0] });
  } catch (err) {
    console.error('PUT /compliance/bundles/:id/items/:iid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ DELETE /:id/items/:iid â€” remove item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/:id/items/:iid', requireAuth, async (req: Request, res: Response) => {
  try {
    const { iid } = req.params;
    await pool.query('DELETE FROM comp_bundle_items WHERE id = $1', [iid]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /compliance/bundles/:id/items/:iid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ POST /:id/rules â€” add assignment rule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/:id/rules', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rule_type, role, specialty, onboarding_stage, priority } = req.body;

    const result = await pool.query(
      `INSERT INTO comp_assignment_rules
        (bundle_id, rule_type, role, specialty, onboarding_stage, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, rule_type, role ?? null, specialty ?? null, onboarding_stage ?? null, priority ?? 0]
    );
    res.status(201).json({ rule: result.rows[0] });
  } catch (err) {
    console.error('POST /compliance/bundles/:id/rules error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ DELETE /:id/rules/:rid â€” delete rule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/:id/rules/:rid', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rid } = req.params;
    await pool.query('DELETE FROM comp_assignment_rules WHERE id = $1', [rid]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /compliance/bundles/:id/rules/:rid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ POST /:id/assign â€” manually assign bundle to users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/:id/assign', requireAuth, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { user_clerk_ids, due_date } = req.body as {
      user_clerk_ids: string[];
      due_date?: string;
    };

    // Fetch all bundle items
    const itemsResult = await client.query(
      `SELECT * FROM comp_bundle_items WHERE bundle_id = $1 ORDER BY sort_order ASC`,
      [id]
    );
    const items = itemsResult.rows;

    await client.query('BEGIN');

    let created = 0;
    let skipped = 0;

    for (const userId of user_clerk_ids) {
      for (const item of items) {
        // Check if record already exists
        const existsResult = await client.query(
          `SELECT id FROM comp_competency_records
           WHERE item_id = $1 AND item_type = $2 AND user_clerk_id = $3`,
          [item.item_id, item.item_type, userId]
        );

        if (existsResult.rows.length > 0) {
          skipped++;
          continue;
        }

        await client.query(
          `INSERT INTO comp_competency_records
            (item_id, item_type, item_title, user_clerk_id, status, due_date, attempts_used)
           VALUES ($1, $2, $3, $4, 'not_started', $5, 0)`,
          [
            item.item_id,
            item.item_type,
            item.item_title,
            userId,
            due_date ?? null,
          ]
        );
        created++;
      }
    }

    await client.query('COMMIT');

    res.json({ created, skipped });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /compliance/bundles/:id/assign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// â”€â”€â”€ POST /bulk-assign â€” assign bundle to many users by role/list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/bulk-assign', requireAuth, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const {
      bundle_id,
      filter,
      due_date,
    } = req.body as {
      bundle_id: string;
      filter: {
        user_clerk_ids?: string[];
        role?: string;
        specialty?: string;
      };
      due_date?: string;
    };

    if (!bundle_id) {
      return res.status(400).json({ error: 'bundle_id is required' });
    }
    if (!filter || (!filter.user_clerk_ids && !filter.role)) {
      return res.status(400).json({ error: 'filter must include user_clerk_ids or role' });
    }

    // 1. Fetch bundle items
    const itemsResult = await client.query(
      `SELECT * FROM comp_bundle_items WHERE bundle_id = $1 ORDER BY sort_order ASC`,
      [bundle_id]
    );
    const items = itemsResult.rows;

    if (items.length === 0) {
      return res.status(400).json({ error: 'Bundle has no items' });
    }

    // 2. Resolve target user_clerk_ids
    let targetClerkIds: string[] = [];

    if (filter.user_clerk_ids && filter.user_clerk_ids.length > 0) {
      targetClerkIds = filter.user_clerk_ids;
    } else if (filter.role) {
      // Fetch users from DB filtered by role. `clerk_user_id` stores the
      // Azure oid post-migration; the column name is legacy.
      const usersResult = await client.query<{ clerk_user_id: string }>(
        `SELECT clerk_user_id FROM users
          WHERE LOWER(role) = LOWER($1) AND clerk_user_id IS NOT NULL`,
        [filter.role]
      );
      let filteredIds = usersResult.rows.map((r) => r.clerk_user_id);

      if (filter.specialty) {
        // Further filter by specialty via staff table
        const staffResult = await client.query(
          `SELECT clerk_user_id FROM staff
           WHERE specialty ILIKE $1 AND clerk_user_id IS NOT NULL`,
          [`%${filter.specialty}%`]
        );
        const specialtyClerkIds = new Set(staffResult.rows.map((r: any) => r.clerk_user_id));
        filteredIds = filteredIds.filter((id) => specialtyClerkIds.has(id));
      }

      targetClerkIds = filteredIds;
    }

    if (targetClerkIds.length === 0) {
      return res.json({ bundle_id, total_users: 0, created: 0, skipped: 0 });
    }

    // 3. Assign bundle items to each user
    await client.query('BEGIN');

    let created = 0;
    let skipped = 0;

    for (const userId of targetClerkIds) {
      for (const item of items) {
        const existsResult = await client.query(
          `SELECT id FROM comp_competency_records
           WHERE item_id = $1 AND item_type = $2 AND user_clerk_id = $3`,
          [item.item_id, item.item_type, userId]
        );

        if (existsResult.rows.length > 0) {
          skipped++;
          continue;
        }

        await client.query(
          `INSERT INTO comp_competency_records
            (item_id, item_type, item_title, user_clerk_id, status, due_date, attempts_used)
           VALUES ($1, $2, $3, $4, 'not_started', $5, 0)`,
          [item.item_id, item.item_type, item.item_title, userId, due_date ?? null]
        );
        created++;
      }
    }

    await client.query('COMMIT');

    res.json({
      bundle_id,
      total_users: targetClerkIds.length,
      created,
      skipped,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /compliance/bundles/bulk-assign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;
