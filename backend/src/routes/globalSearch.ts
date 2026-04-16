import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { query } from '../db/client';

const router = Router();

// Unified search across the entities a recruiter most-often needs to find:
// candidates, jobs, submissions (via candidate + job join), clients, facilities, staff.
// Returns a flat list of results with `type`, `id`, `label`, `sublabel`, `nav`.
// Each sub-query is wrapped in try/catch so a single missing table doesn't
// blank the whole response — important because not every tenant has the
// ATS tables migrated yet.
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }
  const like = `%${q}%`;
  const limit = 5; // per bucket

  const safeQuery = async <T>(sql: string, params: unknown[]): Promise<T[]> => {
    try {
      const r = await query<T>(sql, params);
      return r.rows as T[];
    } catch (err: unknown) {
      // 42P01 = undefined_table — expected when a migration hasn't run yet
      const e = err as { code?: string };
      if (e.code !== '42P01') {
        console.error('Global search subquery error:', err);
      }
      return [];
    }
  };

  const [cands, jobs, subs, clients, facs, staff] = await Promise.all([
    safeQuery<{ id: string; first_name: string; last_name: string; email?: string; role?: string; stage?: string }>(
      `SELECT id, first_name, last_name, email, role, stage
       FROM candidates
       WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1
       ORDER BY updated_at DESC LIMIT $2`,
      [like, limit]
    ),
    safeQuery<{ id: string; title: string; job_code?: string; profession?: string; city?: string; state?: string }>(
      `SELECT id, title, job_code, profession, city, state
       FROM jobs
       WHERE title ILIKE $1 OR job_code ILIKE $1 OR city ILIKE $1
       ORDER BY updated_at DESC LIMIT $2`,
      [like, limit]
    ),
    safeQuery<{ id: string; candidate_name: string; job_title: string; stage_key?: string }>(
      `SELECT s.id,
              (c.first_name || ' ' || c.last_name) AS candidate_name,
              j.title AS job_title,
              s.stage_key
       FROM submissions s
       JOIN candidates c ON s.candidate_id = c.id
       JOIN jobs j ON s.job_id = j.id
       WHERE c.first_name ILIKE $1 OR c.last_name ILIKE $1 OR j.title ILIKE $1
       ORDER BY s.updated_at DESC LIMIT $2`,
      [like, limit]
    ),
    safeQuery<{ id: string; name: string; website?: string }>(
      `SELECT id, name, website FROM clients
       WHERE name ILIKE $1 OR website ILIKE $1
       ORDER BY updated_at DESC LIMIT $2`,
      [like, limit]
    ),
    safeQuery<{ id: string; name: string; type?: string; address?: string }>(
      `SELECT id, name, type, address FROM facilities
       WHERE name ILIKE $1 OR address ILIKE $1 OR contact_name ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      [like, limit]
    ),
    safeQuery<{ id: string; first_name: string; last_name: string; email?: string; role?: string }>(
      `SELECT id, first_name, last_name, email, role FROM staff
       WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1
       ORDER BY updated_at DESC LIMIT $2`,
      [like, limit]
    ),
  ]);

  const results = [
    ...cands.map((c) => ({
      type: 'candidate' as const,
      id: c.id,
      label: `${c.first_name} ${c.last_name}`,
      sublabel: [c.role, c.email, c.stage].filter(Boolean).join(' · '),
      nav: `/candidates/${c.id}`,
    })),
    ...jobs.map((j) => ({
      type: 'job' as const,
      id: j.id,
      label: j.title,
      sublabel: [j.job_code, j.profession, [j.city, j.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
      nav: `/jobs/${j.id}`,
    })),
    ...subs.map((s) => ({
      type: 'submission' as const,
      id: s.id,
      label: `${s.candidate_name} → ${s.job_title}`,
      sublabel: s.stage_key ? `Stage: ${s.stage_key.replace(/_/g, ' ')}` : undefined,
      nav: `/submissions/${s.id}`,
    })),
    ...clients.map((c) => ({
      type: 'client' as const,
      id: c.id,
      label: c.name,
      sublabel: c.website,
      nav: `/clients-orgs/${c.id}`,
    })),
    ...facs.map((f) => ({
      type: 'facility' as const,
      id: f.id,
      label: f.name,
      sublabel: [f.type, f.address].filter(Boolean).join(' · '),
      nav: `/clients`,
    })),
    ...staff.map((s) => ({
      type: 'staff' as const,
      id: s.id,
      label: `${s.first_name} ${s.last_name}`,
      sublabel: [s.role, s.email].filter(Boolean).join(' · '),
      nav: `/staff/${s.id}`,
    })),
  ];

  res.json({ results });
});

export default router;
