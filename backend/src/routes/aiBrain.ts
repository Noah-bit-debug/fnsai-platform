import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getAuth } from '../middleware/auth';
import { pool } from '../db/client';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL_FOR } from '../services/aiModels';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// When the user is looking at a specific record (candidate, job, client,
// placement, submission), pull that record's full shape + its related
// records and inject them into the prompt. This is what "AI knows what
// you're looking at" actually means — instead of the AI asking "which
// candidate?", the AI already has the candidate's name, role, skills,
// compliance status, submissions, etc.
async function buildEntityContext(
  entityType?: string,
  entityId?: string,
): Promise<string | null> {
  if (!entityType || !entityId) return null;
  const sections: string[] = [];

  try {
    switch (entityType) {
      case 'candidate': {
        // PII redaction: we deliberately DO NOT select email, phone, street
        // address, or zip. Names, professional info, and operational status
        // only. If the user needs contact details, they view the candidate
        // profile in-app — those details never leave our server for Anthropic.
        const c = await pool.query(
          `SELECT id, first_name, last_name, role, specialties, skills,
                  certifications, licenses, years_experience, stage, status,
                  desired_pay_rate, offered_pay_rate, availability_start,
                  availability_type, available_shifts, source, city, state,
                  recruiter_notes, created_at, updated_at
           FROM candidates WHERE id = $1`,
          [entityId]
        );
        if (c.rows[0]) {
          const r = c.rows[0];
          sections.push(
            `CURRENT CANDIDATE (the user is viewing this record):\n` +
            `- Name: ${r.first_name} ${r.last_name}\n` +
            `- Role: ${r.role ?? 'unknown'} | Stage: ${r.stage ?? 'unknown'} | Status: ${r.status ?? 'unknown'}\n` +
            `- Location: ${[r.city, r.state].filter(Boolean).join(', ') || 'unknown'}\n` +
            `- Specialties: ${(r.specialties ?? []).join(', ') || 'none'}\n` +
            `- Skills: ${(r.skills ?? []).slice(0, 15).join(', ') || 'none'}\n` +
            `- Certifications: ${(r.certifications ?? []).join(', ') || 'none'}\n` +
            `- Licenses: ${(r.licenses ?? []).join(', ') || 'none'}\n` +
            `- Years experience: ${r.years_experience ?? 'unknown'}\n` +
            `- Desired pay: ${r.desired_pay_rate ? `$${r.desired_pay_rate}` : '—'} | Offered: ${r.offered_pay_rate ? `$${r.offered_pay_rate}` : '—'}\n` +
            `- Available start: ${r.availability_start ?? '?'} (${r.availability_type ?? 'any'})\n` +
            `- Available shifts: ${(r.available_shifts ?? []).join(', ') || 'not specified'}\n` +
            `- Recruiter notes: ${(r.recruiter_notes ?? '').slice(0, 400) || '(none)'}\n` +
            `- Source: ${r.source ?? 'unknown'} | Added: ${new Date(r.created_at).toLocaleDateString()} | Updated: ${new Date(r.updated_at ?? r.created_at).toLocaleDateString()}\n` +
            `- [Contact info (email/phone/street address) redacted — visible only in the app]`
          );

          // Credentialing checklist: every doc row with type, status, expiry.
          // This is how the AI can say "BLS expired 2024-03-15" instead of
          // "I don't have visibility into BLS status". Scope-capped to avoid
          // flooding the prompt if a candidate has dozens of documents.
          try {
            const docs = await pool.query(
              `SELECT document_type, label, status, expiry_date, required, uploaded_at
               FROM candidate_documents WHERE candidate_id = $1
               ORDER BY required DESC, status ASC LIMIT 20`,
              [entityId]
            );
            if (docs.rows.length > 0) {
              sections.push(
                `CANDIDATE CREDENTIALING CHECKLIST:\n` +
                docs.rows.map(d => {
                  const expiry = d.expiry_date ? ` exp:${new Date(d.expiry_date).toISOString().slice(0, 10)}` : '';
                  const uploaded = d.uploaded_at ? ' (uploaded)' : '';
                  const req = d.required ? '[required]' : '[optional]';
                  return `- ${d.label} (${d.document_type}) — ${d.status}${expiry}${uploaded} ${req}`;
                }).join('\n')
              );
            }
          } catch { /* table may not exist yet */ }

          // Submissions this candidate is in — include interview notes,
          // schedule, gate status, and AI summary so the assistant can
          // answer "how did her Mercy interview go?" without asking.
          const subs = await pool.query(
            `SELECT s.stage_key, s.ai_score, s.ai_fit_label, s.ai_summary,
                    s.gate_status, s.interview_scheduled_at, s.interview_notes,
                    s.bill_rate, s.pay_rate,
                    j.title AS job_title, j.job_code, j.city AS job_city, j.state AS job_state
             FROM submissions s LEFT JOIN jobs j ON j.id = s.job_id
             WHERE s.candidate_id = $1 ORDER BY s.updated_at DESC LIMIT 5`,
            [entityId]
          );
          if (subs.rows.length > 0) {
            sections.push(
              `CANDIDATE SUBMISSIONS:\n` +
              subs.rows.map(s => {
                const header = `- ${s.job_title ?? 'Unknown job'} (${s.job_code ?? '—'}) @ ${s.stage_key ?? 'no stage'}${s.ai_score ? ` · AI fit: ${s.ai_fit_label ?? s.ai_score}` : ''}${s.gate_status ? ` · gate:${s.gate_status}` : ''}`;
                const loc = s.job_city || s.job_state ? `\n    location: ${[s.job_city, s.job_state].filter(Boolean).join(', ')}` : '';
                const interview = s.interview_scheduled_at
                  ? `\n    interview: ${new Date(s.interview_scheduled_at).toISOString().slice(0, 16).replace('T', ' ')}`
                  : '';
                const notes = s.interview_notes
                  ? `\n    interview notes: ${String(s.interview_notes).slice(0, 300)}`
                  : '';
                const summary = s.ai_summary ? `\n    AI summary: ${String(s.ai_summary).slice(0, 200)}` : '';
                return header + loc + interview + notes + summary;
              }).join('\n')
            );
          }
        }
        break;
      }
      case 'job': {
        const j = await pool.query(
          `SELECT id, job_code, title, profession, specialty, city, state, job_type,
                  shift, hours_per_week, pay_rate, bill_rate, positions, status, priority,
                  description, created_at
           FROM jobs WHERE id = $1`,
          [entityId]
        );
        if (j.rows[0]) {
          const r = j.rows[0];
          sections.push(
            `CURRENT JOB (the user is viewing this requisition):\n` +
            `- ${r.title} (${r.job_code}) — ${r.status} · priority: ${r.priority}\n` +
            `- Profession: ${r.profession} | Specialty: ${r.specialty ?? '—'}\n` +
            `- Location: ${r.city ?? '?'}, ${r.state ?? '?'}\n` +
            `- Type: ${r.job_type ?? '?'} | Shift: ${r.shift ?? '?'} | Hours/wk: ${r.hours_per_week ?? '?'}\n` +
            `- Pay rate: ${r.pay_rate ? `$${r.pay_rate}` : '?'} | Bill rate: ${r.bill_rate ? `$${r.bill_rate}` : '?'}\n` +
            `- Positions open: ${r.positions}\n` +
            `- Description: ${(r.description ?? '').slice(0, 400)}`
          );

          const subs = await pool.query(
            `SELECT s.stage_key, s.ai_score, s.ai_fit_label, c.first_name, c.last_name, c.role
             FROM submissions s LEFT JOIN candidates c ON c.id = s.candidate_id
             WHERE s.job_id = $1 ORDER BY s.ai_score DESC NULLS LAST LIMIT 8`,
            [entityId]
          );
          if (subs.rows.length > 0) {
            sections.push(
              `EXISTING SUBMISSIONS FOR THIS JOB:\n` +
              subs.rows.map(s => `- ${s.first_name} ${s.last_name} (${s.role ?? '?'}) @ ${s.stage_key ?? '?'}${s.ai_score ? ` · AI: ${s.ai_fit_label ?? s.ai_score}` : ''}`).join('\n')
            );
          }
        }
        break;
      }
      case 'client': {
        const cl = await pool.query(
          `SELECT id, name, website, business_unit, offerings, primary_contact_name,
                  primary_contact_email, status, notes
           FROM clients WHERE id = $1`,
          [entityId]
        );
        if (cl.rows[0]) {
          const r = cl.rows[0];
          sections.push(
            `CURRENT CLIENT (the user is viewing this organization):\n` +
            `- Name: ${r.name} | Status: ${r.status}\n` +
            `- Business unit: ${r.business_unit ?? '?'}\n` +
            `- Website: ${r.website ?? '?'}\n` +
            `- Primary contact: ${r.primary_contact_name ?? '?'} (${r.primary_contact_email ?? '?'})\n` +
            `- Offerings: ${(r.offerings ?? []).join(', ') || '?'}\n` +
            `- Notes: ${(r.notes ?? '').slice(0, 300)}`
          );

          const jobs = await pool.query(
            `SELECT title, job_code, status, profession FROM jobs WHERE client_id = $1 ORDER BY created_at DESC LIMIT 8`,
            [entityId]
          );
          if (jobs.rows.length > 0) {
            sections.push(
              `CLIENT'S JOBS:\n` +
              jobs.rows.map(j => `- ${j.title} (${j.job_code}) — ${j.profession} · ${j.status}`).join('\n')
            );
          }
        }
        break;
      }
      case 'placement': {
        const p = await pool.query(
          `SELECT p.id, p.start_date, p.end_date, p.status, p.pay_rate, p.bill_rate,
                  s.first_name, s.last_name, s.role, f.name AS facility_name
           FROM placements p
           LEFT JOIN staff s ON s.id = p.staff_id
           LEFT JOIN facilities f ON f.id = p.facility_id
           WHERE p.id = $1`,
          [entityId]
        );
        if (p.rows[0]) {
          const r = p.rows[0];
          sections.push(
            `CURRENT PLACEMENT (the user is viewing this record):\n` +
            `- Staff: ${r.first_name} ${r.last_name} (${r.role ?? '?'})\n` +
            `- Facility: ${r.facility_name ?? '?'}\n` +
            `- Dates: ${r.start_date ?? '?'} to ${r.end_date ?? '?'} | Status: ${r.status}\n` +
            `- Pay: ${r.pay_rate ? `$${r.pay_rate}` : '?'} | Bill: ${r.bill_rate ? `$${r.bill_rate}` : '?'}`
          );
        }
        break;
      }
      case 'submission': {
        const s = await pool.query(
          `SELECT s.*, c.first_name, c.last_name, c.role, j.title AS job_title, j.job_code
           FROM submissions s
           LEFT JOIN candidates c ON c.id = s.candidate_id
           LEFT JOIN jobs j ON j.id = s.job_id
           WHERE s.id = $1`,
          [entityId]
        );
        if (s.rows[0]) {
          const r = s.rows[0];
          sections.push(
            `CURRENT SUBMISSION (the user is viewing this):\n` +
            `- Candidate: ${r.first_name} ${r.last_name} (${r.role ?? '?'})\n` +
            `- Job: ${r.job_title ?? '?'} (${r.job_code ?? '?'})\n` +
            `- Stage: ${r.stage_key ?? '?'}\n` +
            `- AI score: ${r.ai_score ?? '?'} (${r.ai_fit_label ?? '?'})\n` +
            `- Gate status: ${r.gate_status ?? '?'}\n` +
            `- Notes: ${(r.notes ?? '').slice(0, 400)}`
          );
        }
        break;
      }
    }
  } catch (err) {
    console.error('[aiBrain] buildEntityContext error:', err);
    return null;
  }

  return sections.length > 0 ? sections.join('\n\n') : null;
}

async function buildCompanyContext(userQuery: string): Promise<string> {
  const sections: string[] = [];

  try {
    const cs = await pool.query(`
      SELECT
        COUNT(*)::INT as total,
        COUNT(*) FILTER (WHERE status = 'expired')::INT as expired,
        COUNT(*) FILTER (WHERE status = 'not_started')::INT as not_started,
        COUNT(*) FILTER (WHERE status IN ('not_started','in_progress') AND due_date IS NOT NULL AND due_date < NOW() + INTERVAL '7 days')::INT as due_soon
      FROM comp_competency_records
    `);
    const r = cs.rows[0];
    sections.push(`LIVE COMPLIANCE STATUS: ${r.total} total assignments | ${r.expired} expired | ${r.due_soon} due within 7 days | ${r.not_started} not started`);
  } catch { /* table may not exist */ }

  try {
    const ss = await pool.query(`SELECT COUNT(*)::INT as total FROM staff`);
    sections.push(`WORKFORCE: ${ss.rows[0].total} staff records in database`);
  } catch {}

  try {
    const ps = await pool.query(`SELECT COUNT(*)::INT as total FROM placements WHERE status = 'active'`);
    sections.push(`ACTIVE PLACEMENTS: ${ps.rows[0].total}`);
  } catch {}

  try {
    const cands = await pool.query(`SELECT COUNT(*)::INT as total FROM candidates`);
    sections.push(`CANDIDATES IN SYSTEM: ${cands.rows[0].total}`);
  } catch {}

  // Candidate directory — names + role + stage only, no PII. Gives the AI
  // enough info to answer "what's Belinda looking like?" by recognizing
  // names in the query without us having to ship every candidate's email,
  // phone, or address to Anthropic.
  try {
    // If the user's query mentions a name-looking token (capitalized word
    // ≥3 chars), pull that candidate with fuzzy match. Otherwise include
    // the 30 most-recently-updated for general awareness.
    const nameTokens = userQuery.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
    let cands: { rows: Array<Record<string, unknown>> } = { rows: [] };
    if (nameTokens.length > 0) {
      const likeParams = nameTokens.map(t => `%${t}%`);
      const whereClauses = nameTokens
        .map((_, i) => `(first_name ILIKE $${i + 1} OR last_name ILIKE $${i + 1})`)
        .join(' OR ');
      cands = await pool.query(
        `SELECT id, first_name, last_name, role, stage, years_experience,
                (SELECT array_agg(DISTINCT cert) FROM unnest(certifications) cert) AS certs
         FROM candidates
         WHERE ${whereClauses}
         ORDER BY updated_at DESC LIMIT 10`,
        likeParams
      );
    }
    if (cands.rows.length === 0) {
      cands = await pool.query(
        `SELECT id, first_name, last_name, role, stage, years_experience
         FROM candidates
         ORDER BY updated_at DESC NULLS LAST LIMIT 30`,
        []
      );
    }
    if (cands.rows.length > 0) {
      sections.push(
        `CANDIDATE DIRECTORY (${nameTokens.length > 0 ? 'name-matched' : 'top 30 most recent'} — no PII):\n` +
        cands.rows.map(r =>
          `- ${r.first_name} ${r.last_name} · ${r.role ?? 'role?'} · stage: ${r.stage ?? '?'}${r.years_experience ? ` · ${r.years_experience}yr` : ''}${(r as any).certs?.length ? ` · certs: ${(r as any).certs.join(',')}` : ''}`
        ).join('\n')
      );
    }
  } catch {}

  try {
    const keywords = userQuery.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3).slice(0, 4);
    if (keywords.length > 0) {
      const conditions = keywords.map((_: string, i: number) => `(title ILIKE $${i + 1} OR content_preview ILIKE $${i + 1})`).join(' OR ');
      const params = keywords.map((k: string) => `%${k}%`);
      const ki = await pool.query(
        `SELECT title, content_preview FROM knowledge_items WHERE ${conditions} ORDER BY updated_at DESC LIMIT 8`,
        params
      );
      if (ki.rows.length > 0) {
        sections.push(`RELEVANT KNOWLEDGE BASE ITEMS:\n${ki.rows.map((r: any) => `• ${r.title}: ${(r.content_preview ?? '').slice(0, 200)}`).join('\n')}`);
      }
    }
  } catch {}

  try {
    const approved = await pool.query(`
      SELECT question, answer FROM ai_brain_clarifications
      WHERE status = 'answered' AND approved_as_rule = TRUE
      ORDER BY answered_at DESC LIMIT 10
    `);
    if (approved.rows.length > 0) {
      sections.push(`COMPANY-APPROVED POLICIES:\n${approved.rows.map((r: any) => `Q: ${r.question}\nA: ${r.answer}`).join('\n---\n')}`);
    }
  } catch {}

  try {
    const expiring = await pool.query(`
      SELECT s.full_name, c.credential_type, c.expiration_date
      FROM credentials c
      JOIN staff s ON s.id = c.staff_id
      WHERE c.expiration_date IS NOT NULL AND c.expiration_date < NOW() + INTERVAL '30 days' AND c.expiration_date > NOW()
      ORDER BY c.expiration_date ASC LIMIT 5
    `);
    if (expiring.rows.length > 0) {
      sections.push(`CREDENTIALS EXPIRING WITHIN 30 DAYS:\n${expiring.rows.map((r: any) => `• ${r.full_name} — ${r.credential_type} expires ${new Date(r.expiration_date).toLocaleDateString()}`).join('\n')}`);
    }
  } catch {}

  return sections.length > 0 ? sections.join('\n\n') : 'No live context available.';
}

const BRAIN_SYSTEM_PROMPT = `You are the FNS AI Brain — an internal operational intelligence assistant for Frontline Healthcare Staffing (FNS), a healthcare staffing agency in Texas.

You are NOT a generic AI. You are specifically trained on FNS operations, workflows, and company knowledge.

COMPANY PROFILE:
- FNS places nurses, CNAs, LPNs, RTs, and other healthcare workers at hospitals, SNFs, ALFs, LTACHs, and home health agencies across Texas
- Key clients include Harris Health, Valley Clinic, Mercy Hospital
- FNS uses Microsoft 365 (Outlook, OneDrive, Teams)
- Joint Commission accreditation is a priority

ONEDRIVE FOLDER STRUCTURE:
- /Joint Commission — JC policies, audit documents, accreditation files
- /Candidate Credentials — individual clinician credential files
- /Onboarding Documents — new hire paperwork
- /Compliance Files — compliance records
- /Credentialing — license verifications, background checks
- /BLS & Certifications — BLS cards, ACLS, PALS certificates
- /Policies & Procedures — company policies, SOPs
- /HR Documents — employment agreements, tax forms
- /Facility Contracts — client facility agreements
- /Training Materials — training content
- /Incident Reports — workplace incidents

CREDENTIAL REQUIREMENTS BY ROLE:
- RN: State license, BLS (AHA/ARC), TB test, background check, drug screen
- LPN/LVN: State license, BLS, TB test, background check
- CNA: State certification, BLS, TB test, background check
- RT: State license, BLS, ACLS recommended
- ICU/ER roles: ACLS required, min 2 years acute care

BEHAVIORAL RULES:
1. Always answer based on live company context provided
2. If unsure about company-specific policies, say: "I need clarification — [your question]"
3. When you detect a clarification is needed, end your response with JSON: {"needs_clarification": true, "clarification_question": "...", "source_type": "policy|workflow|file_routing|email"}
4. Be direct, specific, and operational
5. Format with headers and bullet points
6. Proactively mention urgent items

PRIVACY RULES (STRICT):
- Candidate and staff contact details (email, phone, address) are INTENTIONALLY
  redacted from the context you receive. If the user asks for someone's email
  or phone, tell them to view the profile page in the app — do NOT invent or
  guess values. Never claim to have seen a value that wasn't in the context.
- You may reference names, roles, stages, skills, certifications, licenses,
  years of experience, and general location (city/state). That's it.
- If a question would require PII to answer (e.g. "email this candidate a
  template"), respond by drafting the message and instruct the user to send
  it from the in-app messaging tools where contact details live.`;

router.post('/chat', requireAuth, async (req: Request, res: Response) => {
  const { messages, sources, pageContext } = req.body as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    sources?: string[];
    // pageContext: {page: "/candidates/abc", entityType: "candidate", entityId: "abc"}
    // Sent by the global AI sidebar so the assistant knows what the user is
    // currently looking at without having to be told in natural language.
    pageContext?: { page?: string; entityType?: string; entityId?: string };
  };
  const auth = getAuth(req);

  if (!messages || messages.length === 0) {
    res.status(400).json({ error: 'messages are required' });
    return;
  }

  const userQuery = messages[messages.length - 1]?.content ?? '';

  try {
    const [companyContext, entityContext] = await Promise.all([
      buildCompanyContext(userQuery),
      buildEntityContext(pageContext?.entityType, pageContext?.entityId),
    ]);

    const contextBlocks: string[] = [];
    if (pageContext?.page) contextBlocks.push(`CURRENT PAGE: ${pageContext.page}`);
    if (entityContext) contextBlocks.push(entityContext);
    contextBlocks.push(`LIVE COMPANY DATA:\n${companyContext}`);

    const systemWithContext = `${BRAIN_SYSTEM_PROMPT}\n\n${contextBlocks.join('\n\n')}`;

    const response = await anthropic.messages.create({
      model: MODEL_FOR.brainChat,
      max_tokens: 4096,
      system: systemWithContext,
      messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
    });

    const block = response.content[0];
    const responseText = block.type === 'text' ? block.text : 'Unable to generate response.';

    let clarificationCreated = false;
    const clarificationMatch = responseText.match(/\{"needs_clarification":\s*true[^}]+\}/);
    if (clarificationMatch) {
      try {
        const parsed = JSON.parse(clarificationMatch[0]);
        if (parsed.clarification_question) {
          await pool.query(
            `INSERT INTO ai_brain_clarifications (question, context, source_type) VALUES ($1, $2, $3)`,
            [parsed.clarification_question, `From chat: ${userQuery.slice(0, 500)}`, parsed.source_type ?? 'general']
          );
          clarificationCreated = true;
        }
      } catch { /* ignore */ }
    }

    try {
      await pool.query(
        `INSERT INTO ai_brain_audit (user_clerk_id, action_type, source, details, ip_address) VALUES ($1, 'chat', 'ai_brain', $2, $3)`,
        [auth?.userId ?? 'unknown', JSON.stringify({ messageCount: messages.length, sources: sources ?? [] }), req.ip ?? 'unknown']
      );
    } catch {}

    res.json({
      response: responseText,
      context_used: companyContext.length > 20,
      clarification_created: clarificationCreated,
      model: MODEL_FOR.brainChat,
    });
  } catch (err) {
    // Surface Anthropic errors with their actual message + status so the
    // frontend knows whether it's an auth issue, a bad model name, a rate
    // limit, or something else. The generic "service error" hid all of it.
    const e = err as { status?: number; message?: string; error?: { type?: string; message?: string } };
    console.error('AI Brain chat error:', {
      status: e.status,
      message: e.message,
      error: e.error,
    });
    const detail = e.error?.message ?? e.message ?? 'unknown error';
    res.status(500).json({
      error: `AI Brain service error: ${detail.slice(0, 300)}`,
      status: e.status,
      type: e.error?.type,
    });
  }
});

router.get('/clarifications', requireAuth, async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'pending';
  try {
    const result = await pool.query(
      `SELECT * FROM ai_brain_clarifications WHERE status = $1 ORDER BY created_at DESC LIMIT 50`,
      [status]
    );
    res.json({ clarifications: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to fetch clarifications' });
  }
});

router.post('/clarifications', requireAuth, async (req: Request, res: Response) => {
  const { question, context, source_type } = req.body;
  if (!question) { res.status(400).json({ error: 'question is required' }); return; }
  try {
    const result = await pool.query(
      `INSERT INTO ai_brain_clarifications (question, context, source_type) VALUES ($1, $2, $3) RETURNING *`,
      [question, context ?? null, source_type ?? 'general']
    );
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to create clarification' });
  }
});

router.patch('/clarifications/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { answer, status, approved_as_rule } = req.body;
  const auth = getAuth(req);
  try {
    const result = await pool.query(
      `UPDATE ai_brain_clarifications
       SET answer = COALESCE($1, answer),
           status = COALESCE($2, status),
           approved_as_rule = COALESCE($3, approved_as_rule),
           answered_by_clerk_id = $4,
           answered_at = CASE WHEN $2 = 'answered' THEN NOW() ELSE answered_at END
       WHERE id = $5
       RETURNING *`,
      [answer ?? null, status ?? null, approved_as_rule ?? null, auth?.userId ?? null, id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to update clarification' });
  }
});

router.get('/audit', requireAuth, async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const action_type = req.query.action_type as string | undefined;
  try {
    const params: any[] = action_type ? [limit, offset, action_type] : [limit, offset];
    const result = await pool.query(
      `SELECT * FROM ai_brain_audit ${action_type ? 'WHERE action_type = $3' : ''} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params
    );
    const total = await pool.query(
      `SELECT COUNT(*)::INT as count FROM ai_brain_audit${action_type ? ' WHERE action_type = $1' : ''}`,
      action_type ? [action_type] : []
    );
    res.json({ logs: result.rows, total: total.rows[0].count, limit, offset });
  } catch {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const [clarifications, uploads, audit, knowledge] = await Promise.all([
      pool.query(`SELECT COUNT(*) FILTER (WHERE status='pending')::INT as pending, COUNT(*) FILTER (WHERE status='answered')::INT as answered FROM ai_brain_clarifications`),
      pool.query(`SELECT COUNT(*)::INT as total FROM ai_brain_uploads`),
      pool.query(`SELECT COUNT(*)::INT as total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::INT as today FROM ai_brain_audit`),
      pool.query(`SELECT COUNT(*)::INT as items, COUNT(DISTINCT source_id)::INT as sources FROM knowledge_items`),
    ]);
    res.json({
      clarifications: clarifications.rows[0],
      uploads: uploads.rows[0],
      audit: audit.rows[0],
      knowledge: knowledge.rows[0],
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.post('/smart-route', requireAuth, async (req: Request, res: Response) => {
  const { filename, context_hint } = req.body;
  if (!filename) { res.status(400).json({ error: 'filename is required' }); return; }
  const auth = getAuth(req);

  const KNOWN_FOLDERS = [
    'Joint Commission', 'Candidate Credentials', 'Onboarding Documents',
    'Compliance Files', 'Credentialing', 'BLS & Certifications',
    'Policies & Procedures', 'HR Documents', 'Facility Contracts',
    'Training Materials', 'Incident Reports', 'Unassigned',
  ];

  try {
    const prompt = `Route this file for Frontline Healthcare Staffing OneDrive.
File: "${filename}"
${context_hint ? `Context: ${context_hint}` : ''}
Available folders: ${KNOWN_FOLDERS.join(', ')}
Return ONLY valid JSON: {"folder": "folder name", "confidence": "high|medium|low", "reason": "brief reason", "alternatives": ["alt1"], "needs_clarification": false, "clarification_question": null}`;

    const response = await anthropic.messages.create({
      model: MODEL_FOR.brainChat,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('No text response');
    const match = block.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    const parsed = JSON.parse(match[0]);

    if (parsed.needs_clarification && parsed.clarification_question) {
      await pool.query(
        `INSERT INTO ai_brain_clarifications (question, context, source_type) VALUES ($1, $2, 'file_routing')`,
        [parsed.clarification_question, `File: ${filename}`]
      ).catch(() => {});
    }

    await pool.query(
      `INSERT INTO ai_brain_audit (user_clerk_id, action_type, source, details, ip_address) VALUES ($1, 'file_route_suggest', 'ai_brain', $2, $3)`,
      [auth?.userId ?? 'unknown', JSON.stringify({ filename, folder: parsed.folder, confidence: parsed.confidence }), req.ip ?? 'unknown']
    ).catch(() => {});

    res.json(parsed);
  } catch (err) {
    console.error('Smart route error:', err);
    res.status(500).json({ error: 'Smart routing failed' });
  }
});

router.get('/uploads', requireAuth, async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  try {
    const result = await pool.query(`SELECT * FROM ai_brain_uploads ORDER BY created_at DESC LIMIT $1`, [limit]);
    res.json({ uploads: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

router.post('/refresh', requireAuth, async (req: Request, res: Response) => {
  const { source_type, source_label } = req.body;
  const auth = getAuth(req);
  try {
    const result = await pool.query(
      `INSERT INTO ai_brain_refresh_log (source_type, source_label, triggered_by_clerk_id, status) VALUES ($1, $2, $3, 'running') RETURNING *`,
      [source_type ?? 'all', source_label ?? null, auth?.userId ?? null]
    );
    setTimeout(async () => {
      try {
        await pool.query(`UPDATE ai_brain_refresh_log SET status = 'completed', completed_at = NOW() WHERE id = $1`, [result.rows[0].id]);
      } catch {}
    }, 3000);
    res.json({ success: true, log_id: result.rows[0].id });
  } catch {
    res.status(500).json({ error: 'Failed to log refresh' });
  }
});

router.get('/refresh-log', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM ai_brain_refresh_log ORDER BY started_at DESC LIMIT 20`);
    res.json({ logs: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to fetch refresh log' });
  }
});

// GET /api/v1/ai-brain/suggestions — live action suggestions based on current company state
router.get('/suggestions', requireAuth, async (req: Request, res: Response) => {
  const suggestions: Array<{
    id: string; icon: string; priority: string; title: string;
    desc: string; action: string; nav_section?: string; nav_path?: string; color: string;
  }> = [];

  try {
    const c = await pool.query(`SELECT COUNT(*)::INT as n FROM ai_brain_clarifications WHERE status = 'pending'`);
    const n = c.rows[0].n;
    if (n > 0) {
      suggestions.push({
        id: 'clarifications', icon: '❓', priority: 'high',
        title: `${n} question${n > 1 ? 's' : ''} waiting in the review queue`,
        desc: 'The AI Brain has policy questions that need your answers to improve accuracy and inform future responses.',
        action: 'Review Questions', nav_section: 'clarifications', color: '#dc2626',
      });
    }
  } catch {}

  try {
    const e = await pool.query(`
      SELECT COUNT(*)::INT as expired, COUNT(*) FILTER (WHERE expiration_date BETWEEN NOW() AND NOW() + INTERVAL '14 days')::INT as soon
      FROM credentials
      WHERE expiration_date IS NOT NULL AND expiration_date > NOW() - INTERVAL '1 day'
    `);
    const expired = e.rows[0].expired ?? 0;
    const soon = e.rows[0].soon ?? 0;
    if (expired > 0) {
      suggestions.push({
        id: 'expired_creds', icon: '🚨', priority: 'high',
        title: `${expired} expired credential${expired > 1 ? 's' : ''} need immediate attention`,
        desc: 'Staff with expired credentials may not be eligible for placement. Renew to restore placement eligibility.',
        action: 'Fix Credentials', nav_path: '/credentialing', color: '#dc2626',
      });
    } else if (soon > 0) {
      suggestions.push({
        id: 'expiring_creds', icon: '⚠️', priority: 'medium',
        title: `${soon} credential${soon > 1 ? 's' : ''} expiring within 14 days`,
        desc: 'Proactively renew these credentials to avoid placement disruptions.',
        action: 'View Credentials', nav_path: '/credentialing', color: '#d97706',
      });
    }
  } catch {}

  try {
    const co = await pool.query(`
      SELECT COUNT(*)::INT as n FROM comp_competency_records
      WHERE status IN ('not_started','in_progress') AND due_date IS NOT NULL AND due_date < NOW()
    `);
    const n = co.rows[0].n;
    if (n > 0) {
      suggestions.push({
        id: 'overdue_compliance', icon: '✅', priority: 'medium',
        title: `${n} overdue compliance item${n > 1 ? 's' : ''}`,
        desc: 'Staff members have compliance assignments that are past their due date.',
        action: 'View Compliance', nav_path: '/compliance', color: '#d97706',
      });
    }
  } catch {}

  try {
    const lr = await pool.query(`SELECT MAX(started_at) as last FROM ai_brain_refresh_log WHERE status = 'completed'`);
    const last: Date | null = lr.rows[0].last;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (!last || new Date(last) < sevenDaysAgo) {
      const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
      suggestions.push({
        id: 'stale_knowledge', icon: '🔄', priority: 'low',
        title: 'Microsoft 365 knowledge sources may be stale',
        desc: last ? `Sources were last refreshed ${daysSince} days ago. Refresh to keep email and file intelligence current.` : 'Knowledge sources have never been refreshed. Refresh to enable email and OneDrive intelligence.',
        action: 'Refresh Sources', nav_section: 'knowledge', color: '#2563eb',
      });
    }
  } catch {}

  try {
    const pending = await pool.query(`SELECT COUNT(*)::INT as n FROM staff WHERE status = 'onboarding'`);
    const n = pending.rows[0].n;
    if (n > 0) {
      suggestions.push({
        id: 'onboarding_pending', icon: '🎓', priority: 'low',
        title: `${n} staff member${n > 1 ? 's' : ''} still in onboarding`,
        desc: 'Complete onboarding to make staff placement-eligible.',
        action: 'View Onboarding', nav_path: '/onboarding', color: '#2563eb',
      });
    }
  } catch {}

  res.json({ suggestions, total: suggestions.length });
});

export default router;
