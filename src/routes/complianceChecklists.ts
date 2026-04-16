import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '@clerk/express';
import { pool } from '../db/client';

const router = Router();

// ─── GET / — list checklists ──────────────────────────────────────────────────
router.get('/', requireAuth(), async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT cl.*,
        c1.name AS cat1_name,
        c2.name AS cat2_name,
        c3.name AS cat3_name
       FROM comp_checklists cl
       LEFT JOIN comp_categories c1 ON cl.cat1_id = c1.id
       LEFT JOIN comp_categories c2 ON cl.cat2_id = c2.id
       LEFT JOIN comp_categories c3 ON cl.cat3_id = c3.id
       WHERE cl.status != 'archived'
       ORDER BY cl.created_at DESC`
    );
    res.json({ checklists: result.rows });
  } catch (err) {
    console.error('GET /compliance/checklists error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /stats ───────────────────────────────────────────────────────────────
router.get('/stats', requireAuth(), async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status != 'archived') AS total,
        COUNT(*) FILTER (WHERE status = 'published') AS published,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft
      FROM comp_checklists
    `);
    const submissionsResult = await pool.query(
      `SELECT COUNT(*) AS total_submissions FROM comp_checklist_submissions`
    );
    res.json({
      total: parseInt(result.rows[0].total, 10),
      published: parseInt(result.rows[0].published, 10),
      draft: parseInt(result.rows[0].draft, 10),
      total_submissions: parseInt(submissionsResult.rows[0].total_submissions, 10),
    });
  } catch (err) {
    console.error('GET /compliance/checklists/stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST / — create checklist ────────────────────────────────────────────────
router.post('/', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const {
      title, description, mode, status,
      cat1_id, cat2_id, cat3_id, applicable_roles,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO comp_checklists
        (title, description, mode, status, cat1_id, cat2_id, cat3_id, applicable_roles, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        title, description ?? null, mode ?? 'skills', status ?? 'draft',
        cat1_id ?? null, cat2_id ?? null, cat3_id ?? null,
        applicable_roles ?? [], userId,
      ]
    );
    res.status(201).json({ checklist: result.rows[0] });
  } catch (err) {
    console.error('POST /compliance/checklists error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id — get checklist with sections and skills ────────────────────────
router.get('/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const checklistResult = await pool.query(
      'SELECT * FROM comp_checklists WHERE id = $1',
      [id]
    );
    if (checklistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist not found' });
    }

    const sectionsResult = await pool.query(
      `SELECT * FROM comp_checklist_sections WHERE checklist_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [id]
    );
    const sections = sectionsResult.rows;

    if (sections.length > 0) {
      const sectionIds = sections.map(s => s.id);
      const skillsResult = await pool.query(
        `SELECT * FROM comp_checklist_skills WHERE section_id = ANY($1) ORDER BY sort_order ASC, created_at ASC`,
        [sectionIds]
      );

      const skillsMap: Record<string, typeof skillsResult.rows> = {};
      for (const skill of skillsResult.rows) {
        if (!skillsMap[skill.section_id]) skillsMap[skill.section_id] = [];
        skillsMap[skill.section_id].push(skill);
      }

      for (const section of sections) {
        (section as Record<string, unknown>).skills = skillsMap[section.id] ?? [];
      }
    }

    res.json({ checklist: checklistResult.rows[0], sections });
  } catch (err) {
    console.error('GET /compliance/checklists/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id — update checklist ──────────────────────────────────────────────
router.put('/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      title, description, mode, status,
      cat1_id, cat2_id, cat3_id, applicable_roles,
    } = req.body;

    const result = await pool.query(
      `UPDATE comp_checklists SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        mode = COALESCE($3, mode),
        status = COALESCE($4, status),
        cat1_id = COALESCE($5, cat1_id),
        cat2_id = COALESCE($6, cat2_id),
        cat3_id = COALESCE($7, cat3_id),
        applicable_roles = COALESCE($8, applicable_roles),
        updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        title ?? null, description ?? null, mode ?? null, status ?? null,
        cat1_id ?? null, cat2_id ?? null, cat3_id ?? null,
        applicable_roles ?? null, id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist not found' });
    }
    res.json({ checklist: result.rows[0] });
  } catch (err) {
    console.error('PUT /compliance/checklists/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id — archive checklist ─────────────────────────────────────────
router.delete('/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE comp_checklists SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /compliance/checklists/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/sections ───────────────────────────────────────────────────────
router.post('/:id/sections', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, sort_order } = req.body;

    const result = await pool.query(
      `INSERT INTO comp_checklist_sections (checklist_id, title, sort_order)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, title, sort_order ?? 0]
    );
    res.status(201).json({ section: result.rows[0] });
  } catch (err) {
    console.error('POST /compliance/checklists/:id/sections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id/sections/:sid ───────────────────────────────────────────────────
router.put('/:id/sections/:sid', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { sid } = req.params;
    const { title, sort_order } = req.body;

    const result = await pool.query(
      `UPDATE comp_checklist_sections SET
        title = COALESCE($1, title),
        sort_order = COALESCE($2, sort_order)
       WHERE id = $3
       RETURNING *`,
      [title ?? null, sort_order ?? null, sid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    res.json({ section: result.rows[0] });
  } catch (err) {
    console.error('PUT /compliance/checklists/:id/sections/:sid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id/sections/:sid ────────────────────────────────────────────────
router.delete('/:id/sections/:sid', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { sid } = req.params;
    await pool.query('DELETE FROM comp_checklist_sections WHERE id = $1', [sid]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /compliance/checklists/:id/sections/:sid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/sections/:sid/skills ──────────────────────────────────────────
router.post('/:id/sections/:sid/skills', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { sid } = req.params;
    const { skill_name, description, exclude_from_score, sort_order } = req.body;

    const result = await pool.query(
      `INSERT INTO comp_checklist_skills
        (section_id, skill_name, description, exclude_from_score, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sid, skill_name, description ?? null, exclude_from_score ?? false, sort_order ?? 0]
    );
    res.status(201).json({ skill: result.rows[0] });
  } catch (err) {
    console.error('POST /compliance/checklists/:id/sections/:sid/skills error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id/sections/:sid/skills/:kid ──────────────────────────────────────
router.put('/:id/sections/:sid/skills/:kid', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { kid } = req.params;
    const { skill_name, description, exclude_from_score, sort_order } = req.body;

    const result = await pool.query(
      `UPDATE comp_checklist_skills SET
        skill_name = COALESCE($1, skill_name),
        description = COALESCE($2, description),
        exclude_from_score = COALESCE($3, exclude_from_score),
        sort_order = COALESCE($4, sort_order)
       WHERE id = $5
       RETURNING *`,
      [skill_name ?? null, description ?? null, exclude_from_score ?? null, sort_order ?? null, kid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json({ skill: result.rows[0] });
  } catch (err) {
    console.error('PUT /compliance/checklists/:id/sections/:sid/skills/:kid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id/sections/:sid/skills/:kid ────────────────────────────────────
router.delete('/:id/sections/:sid/skills/:kid', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { kid } = req.params;
    await pool.query('DELETE FROM comp_checklist_skills WHERE id = $1', [kid]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /compliance/checklists/:id/sections/:sid/skills/:kid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/submit — submit checklist ─────────────────────────────────────
router.post('/:id/submit', requireAuth(), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;
    const { ratings } = req.body as {
      ratings: { skill_id: string; rating: number; notes?: string }[];
    };

    const checklistResult = await client.query(
      'SELECT * FROM comp_checklists WHERE id = $1',
      [id]
    );
    if (checklistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist not found' });
    }
    const checklist = checklistResult.rows[0];

    await client.query('BEGIN');

    // 1. Get or create competency record
    let compRecordResult = await client.query(
      `SELECT * FROM comp_competency_records
       WHERE item_id = $1 AND item_type = 'checklist' AND user_clerk_id = $2`,
      [id, userId]
    );

    let compRecord;
    if (compRecordResult.rows.length === 0) {
      const insertRecord = await client.query(
        `INSERT INTO comp_competency_records
          (item_id, item_type, item_title, user_clerk_id, status, attempts_used)
         VALUES ($1, 'checklist', $2, $3, 'in_progress', 0)
         RETURNING *`,
        [id, checklist.title, userId]
      );
      compRecord = insertRecord.rows[0];
    } else {
      compRecord = compRecordResult.rows[0];
    }

    // 2. Insert submission
    const submissionResult = await client.query(
      `INSERT INTO comp_checklist_submissions
        (checklist_id, competency_record_id, user_clerk_id, status, submitted_at)
       VALUES ($1, $2, $3, 'submitted', NOW())
       RETURNING *`,
      [id, compRecord.id, userId]
    );
    const submission = submissionResult.rows[0];

    // 3. Insert skill ratings
    for (const r of ratings) {
      await client.query(
        `INSERT INTO comp_checklist_skill_ratings (submission_id, skill_id, rating, notes)
         VALUES ($1, $2, $3, $4)`,
        [submission.id, r.skill_id, r.rating, r.notes ?? null]
      );
    }

    // 4. Calculate overall_score: avg rating of non-excluded skills * 25
    const skillIds = ratings.map(r => r.skill_id);
    const nonExcludedResult = await client.query(
      `SELECT id FROM comp_checklist_skills
       WHERE id = ANY($1) AND exclude_from_score = false`,
      [skillIds]
    );
    const nonExcludedIds = new Set(nonExcludedResult.rows.map(r => r.id));
    const nonExcludedRatings = ratings.filter(r => nonExcludedIds.has(r.skill_id));

    let overallScore = 0;
    if (nonExcludedRatings.length > 0) {
      const avgRating =
        nonExcludedRatings.reduce((sum, r) => sum + r.rating, 0) / nonExcludedRatings.length;
      overallScore = avgRating * 25;
    }

    // 5. Update submission with overall_score
    await client.query(
      `UPDATE comp_checklist_submissions SET overall_score = $1 WHERE id = $2`,
      [overallScore, submission.id]
    );

    // 6. Update competency record
    await client.query(
      `UPDATE comp_competency_records
       SET status = 'completed',
           completed_date = NOW(),
           score = $1
       WHERE id = $2`,
      [overallScore, compRecord.id]
    );

    await client.query('COMMIT');

    res.json({
      submission_id: submission.id,
      overall_score: Math.round(overallScore * 100) / 100,
      message: 'Checklist submitted successfully.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /compliance/checklists/:id/submit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ─── GET /:id/my-submission — get my latest submission ───────────────────────
router.get('/:id/my-submission', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;

    const submissionResult = await pool.query(
      `SELECT * FROM comp_checklist_submissions
       WHERE checklist_id = $1 AND user_clerk_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [id, userId]
    );
    if (submissionResult.rows.length === 0) {
      return res.json({ submission: null, ratings: [] });
    }

    const submission = submissionResult.rows[0];
    const ratingsResult = await pool.query(
      `SELECT skill_id, rating, notes FROM comp_checklist_skill_ratings
       WHERE submission_id = $1`,
      [submission.id]
    );

    res.json({ submission, ratings: ratingsResult.rows });
  } catch (err) {
    console.error('GET /compliance/checklists/:id/my-submission error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id/submissions — all submissions (admin) ───────────────────────────
router.get('/:id/submissions', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM comp_checklist_submissions
       WHERE checklist_id = $1
       ORDER BY created_at DESC`,
      [id]
    );
    res.json({ submissions: result.rows });
  } catch (err) {
    console.error('GET /compliance/checklists/:id/submissions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
