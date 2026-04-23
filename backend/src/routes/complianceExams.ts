import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, getAuth } from '@clerk/express';
import { pool } from '../db/client';
import { MODEL_FOR } from '../services/aiModels';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── GET / — list exams ──────────────────────────────────────────────────────
router.get('/', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { status, cat1_id } = req.query;
    const params: unknown[] = [];
    const conditions: string[] = ['e.status != $1'];
    params.push('archived');

    if (status) {
      params.push(status);
      conditions.push(`e.status = $${params.length}`);
    }
    if (cat1_id) {
      params.push(cat1_id);
      conditions.push(`e.cat1_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT e.*,
        c1.name AS cat1_name,
        c2.name AS cat2_name,
        c3.name AS cat3_name
       FROM comp_exams e
       LEFT JOIN comp_categories c1 ON e.cat1_id = c1.id
       LEFT JOIN comp_categories c2 ON e.cat2_id = c2.id
       LEFT JOIN comp_categories c3 ON e.cat3_id = c3.id
       ${where}
       ORDER BY e.created_at DESC`,
      params
    );
    res.json({ exams: result.rows });
  } catch (err) {
    console.error('GET /compliance/exams error:', err);
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
      FROM comp_exams
    `);
    const attemptResult = await pool.query(`
      SELECT
        COUNT(*) AS total_attempts,
        COUNT(*) FILTER (WHERE status = 'passed') AS passed_attempts,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_attempts
      FROM comp_exam_attempts
    `);
    res.json({
      total: parseInt(result.rows[0].total, 10),
      published: parseInt(result.rows[0].published, 10),
      draft: parseInt(result.rows[0].draft, 10),
      total_attempts: parseInt(attemptResult.rows[0].total_attempts, 10),
      passed_attempts: parseInt(attemptResult.rows[0].passed_attempts, 10),
      failed_attempts: parseInt(attemptResult.rows[0].failed_attempts, 10),
    });
  } catch (err) {
    console.error('GET /compliance/exams/stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST / — create exam ─────────────────────────────────────────────────────
router.post('/', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const {
      title, description, instructions, passing_score, max_attempts,
      expiration_type, time_limit_minutes, randomize_questions, question_count,
      status, cat1_id, cat2_id, cat3_id, applicable_roles, ceus,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO comp_exams
        (title, description, instructions, passing_score, max_attempts,
         expiration_type, time_limit_minutes, randomize_questions, question_count,
         status, cat1_id, cat2_id, cat3_id, applicable_roles, ceus, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        title, description ?? null, instructions ?? null,
        passing_score ?? 80, max_attempts ?? 3,
        expiration_type ?? 'one_time', time_limit_minutes ?? null,
        randomize_questions ?? true, question_count ?? 10,
        status ?? 'draft', cat1_id ?? null, cat2_id ?? null, cat3_id ?? null,
        applicable_roles ?? [], ceus ?? 0, userId,
      ]
    );
    res.status(201).json({ exam: result.rows[0] });
  } catch (err) {
    console.error('POST /compliance/exams error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id — get exam with questions and answers ───────────────────────────
router.get('/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const examResult = await pool.query('SELECT * FROM comp_exams WHERE id = $1', [id]);
    if (examResult.rows.length === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const questionsResult = await pool.query(
      'SELECT * FROM comp_exam_questions WHERE exam_id = $1 ORDER BY sort_order ASC, created_at ASC',
      [id]
    );

    const questions = questionsResult.rows;
    if (questions.length > 0) {
      const questionIds = questions.map(q => q.id);
      const answersResult = await pool.query(
        `SELECT * FROM comp_exam_answers WHERE question_id = ANY($1) ORDER BY sort_order ASC`,
        [questionIds]
      );

      const answersMap: Record<string, typeof answersResult.rows> = {};
      for (const answer of answersResult.rows) {
        if (!answersMap[answer.question_id]) {
          answersMap[answer.question_id] = [];
        }
        answersMap[answer.question_id].push(answer);
      }

      for (const question of questions) {
        (question as Record<string, unknown>).answers = answersMap[question.id] ?? [];
      }
    }

    res.json({ exam: examResult.rows[0], questions });
  } catch (err) {
    console.error('GET /compliance/exams/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id — update exam ───────────────────────────────────────────────────
router.put('/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      title, description, instructions, passing_score, max_attempts,
      expiration_type, time_limit_minutes, randomize_questions, question_count,
      status, cat1_id, cat2_id, cat3_id, applicable_roles, ceus, outline_url,
    } = req.body;

    const result = await pool.query(
      `UPDATE comp_exams SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        instructions = COALESCE($3, instructions),
        passing_score = COALESCE($4, passing_score),
        max_attempts = COALESCE($5, max_attempts),
        expiration_type = COALESCE($6, expiration_type),
        time_limit_minutes = COALESCE($7, time_limit_minutes),
        randomize_questions = COALESCE($8, randomize_questions),
        question_count = COALESCE($9, question_count),
        status = COALESCE($10, status),
        cat1_id = COALESCE($11, cat1_id),
        cat2_id = COALESCE($12, cat2_id),
        cat3_id = COALESCE($13, cat3_id),
        applicable_roles = COALESCE($14, applicable_roles),
        ceus = COALESCE($15, ceus),
        outline_url = COALESCE($16, outline_url),
        updated_at = NOW()
       WHERE id = $17
       RETURNING *`,
      [
        title ?? null, description ?? null, instructions ?? null,
        passing_score ?? null, max_attempts ?? null,
        expiration_type ?? null, time_limit_minutes ?? null,
        randomize_questions ?? null, question_count ?? null,
        status ?? null, cat1_id ?? null, cat2_id ?? null, cat3_id ?? null,
        applicable_roles ?? null, ceus ?? null, outline_url ?? null,
        id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    res.json({ exam: result.rows[0] });
  } catch (err) {
    console.error('PUT /compliance/exams/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id — archive exam ───────────────────────────────────────────────
router.delete('/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE comp_exams SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /compliance/exams/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Phase 2.4 — POST /:id/ai-generate ──────────────────────────────────────
//
// AI-assisted exam question generation. Admin supplies a topic + count +
// difficulty; Claude returns structured questions with answers the admin
// can review and edit before saving. Does NOT persist — user reviews the
// output in the UI and hits save (which calls the existing /questions and
// /questions/:qid/answers endpoints).
router.post('/:id/ai-generate', requireAuth(), async (req: Request, res: Response) => {
  const { topic, count = 10, difficulty = 'medium', question_types = ['multiple_choice', 'true_false'] } =
    req.body as {
      topic?: string;
      count?: number;
      difficulty?: 'easy' | 'medium' | 'hard';
      question_types?: Array<'multiple_choice' | 'true_false'>;
    };

  if (!topic?.trim()) { res.status(400).json({ error: 'topic is required' }); return; }
  if (count < 1 || count > 30) { res.status(400).json({ error: 'count must be 1-30' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'AI not configured (ANTHROPIC_API_KEY missing)' });
    return;
  }

  const systemPrompt = `You generate compliance exam questions for a healthcare staffing agency. Return ONLY JSON with this shape:

{
  "questions": [
    {
      "question_text": "Clear, concise question text.",
      "question_type": "multiple_choice" or "true_false",
      "explanation": "Optional 1-sentence explanation shown after answer",
      "answers": [
        { "answer_text": "Option A", "is_correct": false },
        { "answer_text": "Option B", "is_correct": true  }
      ]
    }
  ]
}

Rules:
- multiple_choice has 3-4 answers with exactly 1 correct.
- true_false has 2 answers: "True" and "False", with 1 correct.
- Questions should actually test comprehension, not just recall of the topic name.
- Avoid trick questions. Be fair.
- Write in plain professional English.
- Do NOT include answer-letter prefixes like "A)" or "1." — the UI renders those.
- Do NOT wrap in markdown code fences.`;

  const userMsg = `Generate ${count} exam questions about: ${topic}
Difficulty: ${difficulty}
Allowed question types: ${question_types.join(', ')}`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.templateDrafting,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });

    const raw = (response.content[0] as { type: string; text: string }).text;
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    const jsonStr = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;

    let parsed: { questions?: unknown[] };
    try { parsed = JSON.parse(jsonStr) as { questions?: unknown[] }; }
    catch {
      res.status(502).json({ error: 'AI returned malformed JSON. Please retry.', raw_preview: raw.slice(0, 500) });
      return;
    }

    if (!Array.isArray(parsed.questions)) {
      res.status(502).json({ error: 'AI response missing questions array' });
      return;
    }

    res.json({ questions: parsed.questions });
  } catch (err: any) {
    console.error('AI exam generate error:', err);
    if (err?.status === 429) { res.status(429).json({ error: 'AI is busy. Please retry in a minute.' }); return; }
    if (err?.status === 529) { res.status(503).json({ error: 'Claude is over capacity. Retry in ~30s.', retry_after_seconds: 30 }); return; }
    res.status(500).json({ error: `AI generation failed: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  }
});

// ─── Phase 2.4 — POST /:id/bulk-import ──────────────────────────────────────
//
// Bulk-insert questions from a parsed Excel/CSV or AI output. Accepts:
//   { questions: [{ question_text, question_type, answers: [{ answer_text, is_correct }] }] }
// Runs in a transaction so either all succeed or none do. Returns the
// created question IDs + count. Frontend handles Excel parsing (via SheetJS)
// and POSTs the normalized JSON here.
router.post('/:id/bulk-import', requireAuth(), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { questions } = req.body as {
    questions?: Array<{
      question_text?: string;
      question_type?: 'multiple_choice' | 'true_false';
      explanation?: string | null;
      answers?: Array<{ answer_text?: string; is_correct?: boolean }>;
    }>;
  };

  if (!Array.isArray(questions) || questions.length === 0) {
    res.status(400).json({ error: 'questions array is required and must not be empty' });
    return;
  }
  if (questions.length > 100) {
    res.status(400).json({ error: 'Cannot import more than 100 questions at a time.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Current max sort_order so new rows append cleanly
    const maxRes = await client.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS max FROM comp_exam_questions WHERE exam_id = $1`,
      [id]
    );
    let nextSort = Number(maxRes.rows[0].max) + 1;

    const inserted: Array<{ id: string; question_text: string }> = [];
    const skipped: string[] = [];

    for (const q of questions) {
      const text = q.question_text?.trim();
      if (!text) { skipped.push('(blank question)'); continue; }
      const qtype = q.question_type === 'true_false' ? 'true_false' : 'multiple_choice';
      const answers = Array.isArray(q.answers) ? q.answers.filter(a => a.answer_text?.trim()) : [];
      if (answers.length < 2) { skipped.push(`"${text.slice(0, 40)}..." — needs at least 2 answers`); continue; }
      if (!answers.some(a => a.is_correct)) { skipped.push(`"${text.slice(0, 40)}..." — no correct answer marked`); continue; }

      const qRes = await client.query(
        `INSERT INTO comp_exam_questions (exam_id, question_text, question_type, sort_order, explanation)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, question_text`,
        [id, text, qtype, nextSort++, q.explanation ?? null]
      );
      const qId = qRes.rows[0].id as string;

      for (let i = 0; i < answers.length; i++) {
        const a = answers[i];
        await client.query(
          `INSERT INTO comp_exam_answers (question_id, answer_text, is_correct, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [qId, a.answer_text!.trim(), !!a.is_correct, i]
        );
      }

      inserted.push({ id: qId, question_text: qRes.rows[0].question_text });
    }

    await client.query('COMMIT');
    res.json({
      inserted_count: inserted.length,
      inserted,
      skipped_count: skipped.length,
      skipped,
    });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => { /* silent */ });
    console.error('Bulk exam import error:', err);
    res.status(500).json({ error: `Bulk import failed: ${err?.message?.slice(0, 200) ?? 'unknown'}` });
  } finally {
    client.release();
  }
});

// ─── POST /:id/questions ──────────────────────────────────────────────────────
router.post('/:id/questions', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { question_text, question_type, sort_order } = req.body;

    const result = await pool.query(
      `INSERT INTO comp_exam_questions (exam_id, question_text, question_type, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, question_text, question_type ?? 'multiple_choice', sort_order ?? 0]
    );
    res.status(201).json({ question: result.rows[0] });
  } catch (err) {
    console.error('POST /compliance/exams/:id/questions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id/questions/:qid ──────────────────────────────────────────────────
router.put('/:id/questions/:qid', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { qid } = req.params;
    const { question_text, question_type, sort_order } = req.body;

    const result = await pool.query(
      `UPDATE comp_exam_questions SET
        question_text = COALESCE($1, question_text),
        question_type = COALESCE($2, question_type),
        sort_order = COALESCE($3, sort_order)
       WHERE id = $4
       RETURNING *`,
      [question_text ?? null, question_type ?? null, sort_order ?? null, qid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json({ question: result.rows[0] });
  } catch (err) {
    console.error('PUT /compliance/exams/:id/questions/:qid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id/questions/:qid ───────────────────────────────────────────────
router.delete('/:id/questions/:qid', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { qid } = req.params;
    await pool.query('DELETE FROM comp_exam_questions WHERE id = $1', [qid]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /compliance/exams/:id/questions/:qid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/questions/:qid/answers ────────────────────────────────────────
router.post('/:id/questions/:qid/answers', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { qid } = req.params;
    const { answer_text, is_correct, sort_order } = req.body;

    const result = await pool.query(
      `INSERT INTO comp_exam_answers (question_id, answer_text, is_correct, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [qid, answer_text, is_correct ?? false, sort_order ?? 0]
    );
    res.status(201).json({ answer: result.rows[0] });
  } catch (err) {
    console.error('POST /compliance/exams/:id/questions/:qid/answers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id/questions/:qid/answers/:aid ─────────────────────────────────────
router.put('/:id/questions/:qid/answers/:aid', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { aid } = req.params;
    const { answer_text, is_correct, sort_order } = req.body;

    const result = await pool.query(
      `UPDATE comp_exam_answers SET
        answer_text = COALESCE($1, answer_text),
        is_correct = COALESCE($2, is_correct),
        sort_order = COALESCE($3, sort_order)
       WHERE id = $4
       RETURNING *`,
      [answer_text ?? null, is_correct ?? null, sort_order ?? null, aid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Answer not found' });
    }
    res.json({ answer: result.rows[0] });
  } catch (err) {
    console.error('PUT /compliance/exams/:id/questions/:qid/answers/:aid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id/questions/:qid/answers/:aid ──────────────────────────────────
router.delete('/:id/questions/:qid/answers/:aid', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { aid } = req.params;
    await pool.query('DELETE FROM comp_exam_answers WHERE id = $1', [aid]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /compliance/exams/:id/questions/:qid/answers/:aid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/start — start exam attempt ─────────────────────────────────────
router.post('/:id/start', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;

    // 1. Check exam exists and is published
    const examResult = await pool.query(
      `SELECT * FROM comp_exams WHERE id = $1 AND status = 'published'`,
      [id]
    );
    if (examResult.rows.length === 0) {
      return res.status(404).json({ error: 'Exam not found or not published' });
    }
    const exam = examResult.rows[0];

    // 2. Get or create competency record
    let compRecordResult = await pool.query(
      `SELECT * FROM comp_competency_records WHERE item_id = $1 AND item_type = 'exam' AND user_clerk_id = $2`,
      [id, userId]
    );

    let compRecord;
    if (compRecordResult.rows.length === 0) {
      const insertRecord = await pool.query(
        `INSERT INTO comp_competency_records
          (item_id, item_type, item_title, user_clerk_id, status, attempts_used)
         VALUES ($1, 'exam', $2, $3, 'in_progress', 0)
         RETURNING *`,
        [id, exam.title, userId]
      );
      compRecord = insertRecord.rows[0];
    } else {
      compRecord = compRecordResult.rows[0];
    }

    // 3. Count existing completed attempts
    const attemptCountResult = await pool.query(
      `SELECT COUNT(*) AS count FROM comp_exam_attempts
       WHERE exam_id = $1 AND user_clerk_id = $2 AND status != 'in_progress'`,
      [id, userId]
    );
    const completedCount = parseInt(attemptCountResult.rows[0].count, 10);
    if (completedCount >= exam.max_attempts) {
      return res.status(403).json({ error: 'No attempts remaining' });
    }

    // 4. Calculate attempt number (count all attempts including in_progress)
    const totalAttemptCountResult = await pool.query(
      `SELECT COUNT(*) AS count FROM comp_exam_attempts
       WHERE exam_id = $1 AND user_clerk_id = $2`,
      [id, userId]
    );
    const attemptNumber = parseInt(totalAttemptCountResult.rows[0].count, 10) + 1;

    // 5. Get questions
    const allQuestionsResult = await pool.query(
      `SELECT * FROM comp_exam_questions WHERE exam_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [id]
    );
    let questions = allQuestionsResult.rows;

    if (exam.randomize_questions) {
      // Fisher-Yates shuffle
      for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
      }
    }

    const questionCount = exam.question_count ?? 10;
    questions = questions.slice(0, questionCount);

    // Fetch answers for selected questions (without is_correct)
    const questionIds = questions.map(q => q.id);
    let answersMap: Record<string, { id: string; answer_text: string; sort_order: number }[]> = {};
    if (questionIds.length > 0) {
      const answersResult = await pool.query(
        `SELECT id, question_id, answer_text, sort_order
         FROM comp_exam_answers WHERE question_id = ANY($1) ORDER BY sort_order ASC`,
        [questionIds]
      );
      for (const a of answersResult.rows) {
        if (!answersMap[a.question_id]) answersMap[a.question_id] = [];
        answersMap[a.question_id].push({ id: a.id, answer_text: a.answer_text, sort_order: a.sort_order });
      }
    }

    const questionsWithAnswers = questions.map(q => ({
      id: q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      answers: answersMap[q.id] ?? [],
    }));

    // 6. Insert attempt
    const attemptResult = await pool.query(
      `INSERT INTO comp_exam_attempts
        (exam_id, competency_record_id, user_clerk_id, attempt_number, status)
       VALUES ($1, $2, $3, $4, 'in_progress')
       RETURNING *`,
      [id, compRecord.id, userId, attemptNumber]
    );

    // 7. Update competency record started_date if null
    await pool.query(
      `UPDATE comp_competency_records
       SET status = 'in_progress',
           started_date = COALESCE(started_date, NOW())
       WHERE id = $1`,
      [compRecord.id]
    );

    res.json({
      attempt_id: attemptResult.rows[0].id,
      attempt_number: attemptNumber,
      attempts_remaining: exam.max_attempts - attemptNumber,
      exam: {
        title: exam.title,
        passing_score: exam.passing_score,
        time_limit_minutes: exam.time_limit_minutes,
      },
      questions: questionsWithAnswers,
    });
  } catch (err) {
    console.error('POST /compliance/exams/:id/start error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/submit — submit exam attempt ───────────────────────────────────
router.post('/:id/submit', requireAuth(), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;
    const { attempt_id, answers } = req.body as {
      attempt_id: string;
      answers: { question_id: string; answer_id: string }[];
    };

    // 1. Fetch attempt — verify belongs to this user and is in_progress
    const attemptResult = await client.query(
      `SELECT a.*, e.passing_score, e.max_attempts, e.expiration_type, e.title AS exam_title
       FROM comp_exam_attempts a
       JOIN comp_exams e ON a.exam_id = e.id
       WHERE a.id = $1 AND a.user_clerk_id = $2 AND a.status = 'in_progress'`,
      [attempt_id, userId]
    );
    if (attemptResult.rows.length === 0) {
      return res.status(404).json({ error: 'Attempt not found or already completed' });
    }
    const attempt = attemptResult.rows[0];

    await client.query('BEGIN');

    // 2. Score each answer
    const questionIds = answers.map(a => a.question_id);
    const correctAnswersResult = await client.query(
      `SELECT question_id, id AS correct_answer_id
       FROM comp_exam_answers WHERE question_id = ANY($1) AND is_correct = true`,
      [questionIds]
    );
    const correctMap: Record<string, string> = {};
    for (const row of correctAnswersResult.rows) {
      correctMap[row.question_id] = row.correct_answer_id;
    }

    let correctCount = 0;
    const attemptAnswerRows: { question_id: string; selected_answer_id: string | null; is_correct: boolean }[] = [];
    for (const ans of answers) {
      const isCorrect = correctMap[ans.question_id] === ans.answer_id;
      if (isCorrect) correctCount++;
      attemptAnswerRows.push({
        question_id: ans.question_id,
        selected_answer_id: ans.answer_id ?? null,
        is_correct: isCorrect,
      });
    }

    // 3. Insert attempt answers
    for (const row of attemptAnswerRows) {
      await client.query(
        `INSERT INTO comp_exam_attempt_answers (attempt_id, question_id, selected_answer_id, is_correct)
         VALUES ($1, $2, $3, $4)`,
        [attempt_id, row.question_id, row.selected_answer_id, row.is_correct]
      );
    }

    // 4. Calculate score
    const totalQuestions = answers.length;
    const score = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

    // 5. Determine pass/fail
    const passed = score >= attempt.passing_score;
    const newAttemptStatus = passed ? 'passed' : 'failed';

    // 6. Update attempt
    await client.query(
      `UPDATE comp_exam_attempts
       SET status = $1, score = $2, completed_at = NOW()
       WHERE id = $3`,
      [newAttemptStatus, score, attempt_id]
    );

    // 7. Update competency record
    const compRecordResult = await client.query(
      `SELECT * FROM comp_competency_records
       WHERE item_id = $1 AND item_type = 'exam' AND user_clerk_id = $2`,
      [id, userId]
    );
    const compRecord = compRecordResult.rows[0];
    const attemptsUsed = (compRecord?.attempts_used ?? 0) + 1;

    let newCompStatus = 'in_progress';
    let expirationDate: Date | null = null;

    if (passed) {
      newCompStatus = 'completed';
      if (attempt.expiration_type === 'yearly') {
        expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 365);
      } else if (attempt.expiration_type === 'bi_annual') {
        expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 730);
      }
    } else if (attemptsUsed >= attempt.max_attempts) {
      newCompStatus = 'failed';
    }

    if (compRecord) {
      await client.query(
        `UPDATE comp_competency_records
         SET attempts_used = $1,
             status = $2,
             score = CASE WHEN $3 THEN $4 ELSE score END,
             completed_date = CASE WHEN $3 THEN NOW() ELSE completed_date END,
             expiration_date = CASE WHEN $3 THEN $5 ELSE expiration_date END
         WHERE id = $6`,
        [attemptsUsed, newCompStatus, passed, score, expirationDate, compRecord.id]
      );
    }

    // 8. If passed: insert certificate
    if (passed && compRecord) {
      await client.query(
        `INSERT INTO comp_certificates
          (competency_record_id, user_clerk_id, exam_id, title, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [compRecord.id, userId, id, attempt.exam_title, expirationDate]
      );
    }

    await client.query('COMMIT');

    res.json({
      score: Math.round(score * 100) / 100,
      passed,
      attempt_number: attempt.attempt_number,
      attempts_used: attemptsUsed,
      attempts_remaining: attempt.max_attempts - attemptsUsed,
      passing_score: attempt.passing_score,
      message: passed
        ? 'Congratulations! You passed.'
        : 'You did not pass. Please review the material and try again.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /compliance/exams/:id/submit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ─── GET /:id/attempts — my attempts ─────────────────────────────────────────
router.get('/:id/attempts', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, attempt_number, status, score, started_at, completed_at, time_taken_seconds
       FROM comp_exam_attempts
       WHERE exam_id = $1 AND user_clerk_id = $2
       ORDER BY attempt_number ASC`,
      [id, userId]
    );
    res.json({ attempts: result.rows });
  } catch (err) {
    console.error('GET /compliance/exams/:id/attempts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id/attempts/all — all attempts (admin) ─────────────────────────────
router.get('/:id/attempts/all', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, user_clerk_id, attempt_number, status, score, started_at, completed_at, time_taken_seconds
       FROM comp_exam_attempts
       WHERE exam_id = $1
       ORDER BY started_at DESC`,
      [id]
    );
    res.json({ attempts: result.rows });
  } catch (err) {
    console.error('GET /compliance/exams/:id/attempts/all error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
