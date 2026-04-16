import { Router, Request, Response } from 'express';
import { requireAuth } from '@clerk/express';
import { pool } from '../db/client';

const router = Router();

// ─── Shared readiness evaluator ───────────────────────────────────────────────
async function evaluateReadiness(
  clerkUserId: string | null,
  candidateId: string | null,
  staffId: string | null
): Promise<{ is_ready: boolean; score: number; blocking_issues: string[] }> {

  if (!clerkUserId && !candidateId) {
    return { is_ready: false, score: 0, blocking_issues: ['No user account linked'] };
  }

  let records: any[] = [];

  if (candidateId) {
    const res = await pool.query(
      `SELECT status, title, item_type, due_date, expiration_date
       FROM comp_competency_records WHERE candidate_id = $1`,
      [candidateId]
    );
    records = res.rows;
  } else if (clerkUserId) {
    const res = await pool.query(
      `SELECT status, title, item_type, due_date, expiration_date
       FROM comp_competency_records WHERE user_clerk_id = $1`,
      [clerkUserId]
    );
    records = res.rows;
  }

  const total = records.length;
  const completed = records.filter(r => ['completed', 'signed', 'read'].includes(r.status)).length;
  const expired = records.filter(r => r.status === 'expired');
  const failed = records.filter(r => r.status === 'failed');
  const overdue = records.filter(r =>
    r.due_date && new Date(r.due_date) < new Date() &&
    ['not_started', 'in_progress'].includes(r.status)
  );

  const blocking_issues: string[] = [];
  if (!clerkUserId && !candidateId) blocking_issues.push('No user account linked');
  if (total === 0) blocking_issues.push('No compliance items assigned');
  expired.forEach(r => blocking_issues.push(`Expired: ${r.title}`));
  failed.forEach(r => blocking_issues.push(`Failed (all attempts used): ${r.title}`));
  overdue.slice(0, 3).forEach(r => blocking_issues.push(`Overdue: ${r.title}`));

  let score = total > 0 ? Math.round((completed / total) * 100) : 0;
  score = Math.max(0, score - expired.length * 10 - overdue.length * 5);

  const is_ready = score >= 70 && expired.length === 0 && failed.length === 0 && total > 0;

  return { is_ready, score, blocking_issues };
}

// ─── POST /evaluate/staff/:staffId ───────────────────────────────────────────
router.post('/evaluate/staff/:staffId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { staffId } = req.params;

    const staffResult = await pool.query(
      `SELECT id, first_name, last_name, clerk_user_id FROM staff WHERE id = $1`,
      [staffId]
    );
    if (staffResult.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    const staff = staffResult.rows[0];

    const { is_ready, score, blocking_issues } = await evaluateReadiness(
      staff.clerk_user_id,
      null,
      staffId
    );

    const upsertResult = await pool.query(
      `INSERT INTO comp_placement_readiness (staff_id, is_ready, readiness_score, blocking_issues, last_evaluated)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (staff_id) WHERE staff_id IS NOT NULL
       DO UPDATE SET is_ready=$2, readiness_score=$3, blocking_issues=$4, last_evaluated=NOW(), updated_at=NOW()
       RETURNING *`,
      [staffId, is_ready, score, JSON.stringify(blocking_issues)]
    );

    res.json({
      staff: {
        id: staff.id,
        first_name: staff.first_name,
        last_name: staff.last_name,
        clerk_user_id: staff.clerk_user_id,
      },
      readiness: { is_ready, score, blocking_issues },
      record: upsertResult.rows[0],
    });
  } catch (err) {
    console.error('POST /compliance/readiness/evaluate/staff/:staffId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /evaluate/candidate/:candidateId ────────────────────────────────────
router.post('/evaluate/candidate/:candidateId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;

    const candidateResult = await pool.query(
      `SELECT id, first_name, last_name FROM candidates WHERE id = $1`,
      [candidateId]
    );
    if (candidateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    const candidate = candidateResult.rows[0];

    const { is_ready, score, blocking_issues } = await evaluateReadiness(
      null,
      candidateId,
      null
    );

    const upsertResult = await pool.query(
      `INSERT INTO comp_placement_readiness (candidate_id, is_ready, readiness_score, blocking_issues, last_evaluated)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (candidate_id) WHERE candidate_id IS NOT NULL
       DO UPDATE SET is_ready=$2, readiness_score=$3, blocking_issues=$4, last_evaluated=NOW(), updated_at=NOW()
       RETURNING *`,
      [candidateId, is_ready, score, JSON.stringify(blocking_issues)]
    );

    res.json({
      candidate: {
        id: candidate.id,
        first_name: candidate.first_name,
        last_name: candidate.last_name,
      },
      readiness: { is_ready, score, blocking_issues },
      record: upsertResult.rows[0],
    });
  } catch (err) {
    console.error('POST /compliance/readiness/evaluate/candidate/:candidateId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /evaluate-all ───────────────────────────────────────────────────────
router.post('/evaluate-all', requireAuth(), async (_req: Request, res: Response) => {
  try {
    const staffResult = await pool.query(
      `SELECT id, first_name, last_name, clerk_user_id FROM staff WHERE clerk_user_id IS NOT NULL`
    );
    const allStaff = staffResult.rows;

    let staffEvaluated = 0;
    let staffReadyCount = 0;

    for (const staff of allStaff) {
      const { is_ready, score, blocking_issues } = await evaluateReadiness(
        staff.clerk_user_id,
        null,
        staff.id
      );
      await pool.query(
        `INSERT INTO comp_placement_readiness (staff_id, is_ready, readiness_score, blocking_issues, last_evaluated)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (staff_id) WHERE staff_id IS NOT NULL
         DO UPDATE SET is_ready=$2, readiness_score=$3, blocking_issues=$4, last_evaluated=NOW(), updated_at=NOW()`,
        [staff.id, is_ready, score, JSON.stringify(blocking_issues)]
      );
      staffEvaluated++;
      if (is_ready) staffReadyCount++;
    }

    const candidatesResult = await pool.query(
      `SELECT id, first_name, last_name FROM candidates`
    );
    const allCandidates = candidatesResult.rows;

    let candidatesEvaluated = 0;
    let candidatesReadyCount = 0;

    for (const candidate of allCandidates) {
      const { is_ready, score, blocking_issues } = await evaluateReadiness(
        null,
        candidate.id,
        null
      );
      await pool.query(
        `INSERT INTO comp_placement_readiness (candidate_id, is_ready, readiness_score, blocking_issues, last_evaluated)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (candidate_id) WHERE candidate_id IS NOT NULL
         DO UPDATE SET is_ready=$2, readiness_score=$3, blocking_issues=$4, last_evaluated=NOW(), updated_at=NOW()`,
        [candidate.id, is_ready, score, JSON.stringify(blocking_issues)]
      );
      candidatesEvaluated++;
      if (is_ready) candidatesReadyCount++;
    }

    res.json({
      staff_evaluated: staffEvaluated,
      candidates_evaluated: candidatesEvaluated,
      ready_count: staffReadyCount + candidatesReadyCount,
    });
  } catch (err) {
    console.error('POST /compliance/readiness/evaluate-all error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET / — list all readiness records ──────────────────────────────────────
router.get('/', requireAuth(), async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT r.*,
        s.first_name || ' ' || s.last_name as staff_name, s.role as staff_role, s.specialty,
        c.first_name || ' ' || c.last_name as candidate_name, c.stage as candidate_stage
       FROM comp_placement_readiness r
       LEFT JOIN staff s ON s.id = r.staff_id
       LEFT JOIN candidates c ON c.id = r.candidate_id
       ORDER BY r.readiness_score DESC, r.last_evaluated DESC`
    );

    const records = result.rows;
    const total = records.length;
    const ready = records.filter(r => r.is_ready).length;
    const not_ready = total - ready;
    const avg_score = total > 0
      ? Math.round(records.reduce((sum, r) => sum + (r.readiness_score || 0), 0) / total)
      : 0;

    res.json({
      records,
      summary: { total, ready, not_ready, avg_score },
    });
  } catch (err) {
    console.error('GET /compliance/readiness error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /staff/:staffId ──────────────────────────────────────────────────────
router.get('/staff/:staffId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { staffId } = req.params;
    const result = await pool.query(
      `SELECT * FROM comp_placement_readiness WHERE staff_id = $1`,
      [staffId]
    );
    res.json({ record: result.rows[0] ?? null });
  } catch (err) {
    console.error('GET /compliance/readiness/staff/:staffId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /candidate/:candidateId ─────────────────────────────────────────────
router.get('/candidate/:candidateId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const result = await pool.query(
      `SELECT * FROM comp_placement_readiness WHERE candidate_id = $1`,
      [candidateId]
    );
    res.json({ record: result.rows[0] ?? null });
  } catch (err) {
    console.error('GET /compliance/readiness/candidate/:candidateId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /staff/:staffId — manual override ─────────────────────────────────
router.patch('/staff/:staffId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { staffId } = req.params;
    const { is_ready, notes } = req.body as { is_ready?: boolean; notes?: string };

    const result = await pool.query(
      `UPDATE comp_placement_readiness
       SET
         is_ready = COALESCE($1, is_ready),
         notes = COALESCE($2, notes),
         updated_at = NOW()
       WHERE staff_id = $3
       RETURNING *`,
      [is_ready ?? null, notes ?? null, staffId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Readiness record not found. Run /evaluate/staff/:staffId first.' });
    }

    res.json({ record: result.rows[0] });
  } catch (err) {
    console.error('PATCH /compliance/readiness/staff/:staffId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
