import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, getAuth } from '../middleware/auth';
import { pool } from '../db/client';

/**
 * Phase 2.6 — Compliance courses (training content modules).
 *
 * A course bundles training content (markdown body + optional video) with
 * an optional attestation and/or quiz. They're added to bundles via
 * comp_bundle_items.item_type = 'course' alongside existing policies,
 * documents, exams, and checklists.
 *
 * Completion is tracked per user in comp_course_completions so My
 * Compliance reports show progress on training.
 */

const router = Router();

const courseSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional().nullable(),
  content_markdown: z.string().max(200000).optional().nullable(),
  // Accept '' from forms where the user cleared the field. Normalize empty
  // to null below so the DB doesn't store an empty string.
  video_url: z.union([z.string().url().max(1000), z.literal('')]).optional().nullable(),
  estimated_minutes: z.number().int().min(0).max(600).optional().nullable(),
  quiz_exam_id: z.string().uuid().optional().nullable(),
  pass_threshold: z.number().min(0).max(100).optional().nullable(),
  require_attestation: z.boolean().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  cat1_id: z.string().uuid().optional().nullable(),
  cat2_id: z.string().uuid().optional().nullable(),
  cat3_id: z.string().uuid().optional().nullable(),
  applicable_roles: z.array(z.string().max(50)).optional().default([]),
});

// ─── GET / — list courses ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { status, cat1_id } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (status)  { conditions.push(`c.status = $${idx++}`); params.push(status); }
  if (cat1_id) { conditions.push(`c.cat1_id = $${idx++}`); params.push(cat1_id); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const result = await pool.query(
      `SELECT c.*,
              e.title AS quiz_title,
              (SELECT COUNT(*)::INT FROM comp_course_completions cc
                 WHERE cc.course_id = c.id AND cc.completed_at IS NOT NULL
              ) AS completions_count
       FROM comp_courses c
       LEFT JOIN comp_exams e ON c.quiz_exam_id = e.id
       ${where}
       ORDER BY c.title ASC`,
      params
    );
    res.json({ courses: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ courses: [] }); return; }
    console.error('GET /courses error:', err);
    res.status(500).json({ error: `Failed to fetch courses: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ─── GET /:id — single course with completion count ──────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      // comp_exams uses `passing_score` (INT 0-100), not `pass_threshold`.
      // Expose under the alias quiz_pass_threshold so the frontend type
      // stays consistent with how the course-level pass_threshold column
      // is named.
      `SELECT c.*, e.title AS quiz_title, e.passing_score AS quiz_pass_threshold
       FROM comp_courses c
       LEFT JOIN comp_exams e ON c.quiz_exam_id = e.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Course not found' }); return; }
    res.json({ course: result.rows[0] });
  } catch (err: any) {
    console.error('GET /courses/:id error:', err);
    res.status(500).json({ error: `Failed to fetch course: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ─── POST / — create course ──────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const auth = getAuth(req);
  try {
    const result = await pool.query(
      `INSERT INTO comp_courses
         (title, description, content_markdown, video_url, estimated_minutes,
          quiz_exam_id, pass_threshold, require_attestation, status,
          cat1_id, cat2_id, cat3_id, applicable_roles, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        d.title,
        // Normalize empty strings to null — form fields submit '' when cleared
        d.description?.trim() || null,
        d.content_markdown?.trim() || null,
        d.video_url?.trim() || null,
        d.estimated_minutes ?? null,
        d.quiz_exam_id || null,  // '' → null via || fallthrough
        d.pass_threshold ?? null,
        d.require_attestation ?? true, d.status ?? 'draft',
        d.cat1_id || null, d.cat2_id || null, d.cat3_id || null,
        d.applicable_roles ?? [], auth?.userId ?? null,
      ]
    );
    res.status(201).json({ course: result.rows[0] });
  } catch (err: any) {
    console.error('POST /courses error:', err);
    res.status(500).json({ error: `Failed to create course: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ─── PUT /:id — update ───────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const parsed = courseSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() }); return; }
  // Normalize empty strings to null for nullable text columns so PUT with
  // a cleared field doesn't store '' (and doesn't get rejected by URL
  // validators that forbid empty strings).
  const NORMALIZE_EMPTY: ReadonlySet<string> = new Set([
    'description', 'content_markdown', 'video_url',
    'quiz_exam_id', 'cat1_id', 'cat2_id', 'cat3_id',
  ]);
  const entries = Object.entries(parsed.data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (NORMALIZE_EMPTY.has(k) && typeof v === 'string' && v.trim() === '') {
        return [k, null] as const;
      }
      return [k, v] as const;
    });
  if (entries.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const setClause = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values: unknown[] = [req.params.id, ...entries.map(([, v]) => v)];
  try {
    const result = await pool.query(
      `UPDATE comp_courses SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Course not found' }); return; }
    res.json({ course: result.rows[0] });
  } catch (err: any) {
    console.error('PUT /courses/:id error:', err);
    res.status(500).json({ error: `Failed to update course: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ─── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`DELETE FROM comp_courses WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Course not found' }); return; }
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /courses/:id error:', err);
    res.status(500).json({ error: `Failed to delete course: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ─── POST /:id/start — user starts a course ─────────────────────────────────
router.post('/:id/start', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const result = await pool.query(
      `INSERT INTO comp_course_completions (course_id, user_clerk_id, started_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (course_id, user_clerk_id) DO UPDATE
         SET started_at = COALESCE(comp_course_completions.started_at, EXCLUDED.started_at)
       RETURNING *`,
      [req.params.id, auth.userId]
    );
    res.json({ completion: result.rows[0] });
  } catch (err: any) {
    console.error('POST /courses/:id/start error:', err);
    res.status(500).json({ error: `Failed to start course: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ─── POST /:id/complete — user finishes a course ────────────────────────────
// Body: { duration_seconds, attestation_signed, signer_name, quiz_score }
router.post('/:id/complete', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { duration_seconds, attestation_signed, signer_name, quiz_score, quiz_attempt_id } = req.body as {
    duration_seconds?: number;
    attestation_signed?: boolean;
    signer_name?: string;
    quiz_score?: number;
    quiz_attempt_id?: string | null;
  };

  try {
    // Look up the course to know pass threshold + require_attestation
    const courseRes = await pool.query(
      `SELECT require_attestation, pass_threshold FROM comp_courses WHERE id = $1`,
      [req.params.id]
    );
    if (courseRes.rows.length === 0) { res.status(404).json({ error: 'Course not found' }); return; }
    const course = courseRes.rows[0];

    // Require attestation if course says so
    if (course.require_attestation && !attestation_signed) {
      res.status(400).json({ error: 'Attestation required to complete this course.' });
      return;
    }

    // Pass/fail calc if quiz provided
    const passed = quiz_score != null && course.pass_threshold != null
      ? Number(quiz_score) >= Number(course.pass_threshold)
      : course.require_attestation ? !!attestation_signed : null;

    const result = await pool.query(
      `INSERT INTO comp_course_completions
         (course_id, user_clerk_id, started_at, completed_at, duration_seconds,
          attestation_signed, attestation_signed_at, attestation_signer_name,
          quiz_attempt_id, quiz_score, passed)
       VALUES ($1, $2, NOW(), NOW(), $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (course_id, user_clerk_id) DO UPDATE
         SET completed_at = EXCLUDED.completed_at,
             duration_seconds = EXCLUDED.duration_seconds,
             attestation_signed = EXCLUDED.attestation_signed,
             attestation_signed_at = EXCLUDED.attestation_signed_at,
             attestation_signer_name = EXCLUDED.attestation_signer_name,
             quiz_attempt_id = EXCLUDED.quiz_attempt_id,
             quiz_score = EXCLUDED.quiz_score,
             passed = EXCLUDED.passed,
             updated_at = NOW()
       RETURNING *`,
      [
        req.params.id, auth.userId, duration_seconds ?? 0,
        !!attestation_signed, attestation_signed ? new Date() : null, signer_name ?? null,
        quiz_attempt_id ?? null, quiz_score ?? null, passed,
      ]
    );

    res.json({ completion: result.rows[0] });
  } catch (err: any) {
    console.error('POST /courses/:id/complete error:', err);
    res.status(500).json({ error: `Failed to complete course: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ─── GET /:id/my-progress — get current user's completion record ────────────
router.get('/:id/my-progress', requireAuth, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const result = await pool.query(
      `SELECT * FROM comp_course_completions
       WHERE course_id = $1 AND user_clerk_id = $2`,
      [req.params.id, auth.userId]
    );
    res.json({ completion: result.rows[0] ?? null });
  } catch (err: any) {
    console.error('GET /courses/:id/my-progress error:', err);
    res.status(500).json({ error: `Failed to fetch progress: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

export default router;
