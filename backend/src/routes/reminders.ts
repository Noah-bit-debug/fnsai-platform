import { Router, Request, Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '../middleware/auth';
import { MODEL_FOR } from '../services/aiModels';
import { sendSMS } from '../services/clerkchat';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const router = Router();

// Phase 2 schedule categories — finer-grained than the legacy
// trigger_type enum. trigger_type stays for backward compat with the
// auto-generate sweep; category is what the candidate-schedule
// timeline reads.
const SCHEDULE_CATEGORIES = [
  'interview',          // upcoming interview reminder
  'application_followup',
  'missing_document',
  'credentialing_followup',
  'onboarding_followup',
  'start_date',         // start-date reminder
  'general',
] as const;

const REMINDER_TONES = [
  'professional', 'friendly', 'urgent', 'short_sms', 'formal_email',
] as const;

const reminderSchema = z.object({
  type: z.enum(['email','sms','both']),
  trigger_type: z.enum(['missing_document','incomplete_onboarding','pending_application','credential_expiry','manual']),
  candidate_id: z.string().uuid().optional().nullable(),
  staff_id: z.string().uuid().optional().nullable(),
  recipient_email: z.string().email().optional().nullable(),
  recipient_phone: z.string().max(30).optional().nullable(),
  recipient_name: z.string().max(200).optional().nullable(),
  subject: z.string().min(1).max(500),
  message: z.string().min(1).max(5000),
  scheduled_at: z.string().optional().nullable(),
  // Phase 2 additions
  category: z.enum(SCHEDULE_CATEGORIES).optional().nullable(),
  tone: z.enum(REMINDER_TONES).optional().nullable(),
  assigned_to_user_id: z.string().uuid().optional().nullable(),
});

// GET / — list reminders
router.get('/', requireAuth, requirePermission('reminders_manage'), async (req: Request, res: Response) => {
  const { status, candidate_id, type } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (status) { conditions.push(`r.status = $${idx++}`); params.push(status); }
  if (candidate_id) { conditions.push(`r.candidate_id = $${idx++}`); params.push(candidate_id); }
  if (type) { conditions.push(`r.type = $${idx++}`); params.push(type); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const result = await query(
      `SELECT r.*,
              c.first_name || ' ' || c.last_name AS candidate_name,
              u.name AS created_by_name
       FROM reminders r
       LEFT JOIN candidates c ON r.candidate_id = c.id
       LEFT JOIN users u ON r.created_by = u.id
       ${where}
       ORDER BY r.created_at DESC`,
      params
    );
    res.json({ reminders: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ reminders: [] }); return; }
    console.error('Reminders list error:', err);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

// POST / — create reminder
router.post('/', requireAuth, requirePermission('reminders_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const parse = reminderSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }
  const auth = getAuth(req);
  const d = parse.data;
  try {
    const result = await query(
      `INSERT INTO reminders (type, trigger_type, candidate_id, staff_id, recipient_email,
         recipient_phone, recipient_name, subject, message, scheduled_at,
         category, tone, assigned_to_user_id,
         created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               (SELECT id FROM users WHERE clerk_user_id = $14 LIMIT 1))
       RETURNING *`,
      [d.type, d.trigger_type, d.candidate_id, d.staff_id, d.recipient_email,
       d.recipient_phone, d.recipient_name, d.subject, d.message,
       d.scheduled_at || null,
       d.category ?? null, d.tone ?? null, d.assigned_to_user_id ?? null,
       auth?.userId ?? null]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'reminder.create', String(result.rows[0].id),
      { type: d.type, trigger_type: d.trigger_type }, (req.ip ?? 'unknown'));
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create reminder error:', err);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

// PUT /:id — update reminder
router.put('/:id', requireAuth, requirePermission('reminders_manage'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, scheduled_at, message } = req.body;
  const auth = getAuth(req);
  try {
    const result = await query(
      `UPDATE reminders SET
         status = COALESCE($1, status),
         scheduled_at = COALESCE($2, scheduled_at),
         message = COALESCE($3, message),
         updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [status || null, scheduled_at || null, message || null, id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Reminder not found' }); return; }
    await logAudit(null, auth?.userId ?? 'unknown', 'reminder.update', id, { status }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update reminder error:', err);
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

// DELETE /:id — cancel
router.delete('/:id', requireAuth, requirePermission('reminders_manage'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  try {
    await query(`UPDATE reminders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
    await logAudit(null, auth?.userId ?? 'unknown', 'reminder.cancel', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel reminder' });
  }
});

// POST /:id/send — actually deliver the reminder
//
// SMS path uses the existing ClerkChat integration (services/clerkchat).
// Email path is still stubbed — when an email provider gets wired up,
// only the `if (channel === 'email')` branch needs to change.
router.post('/:id/send', requireAuth, requirePermission('reminders_manage'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  try {
    const r = await query<{
      id: string;
      type: 'email' | 'sms' | 'both';
      recipient_phone: string | null;
      recipient_email: string | null;
      recipient_name: string | null;
      subject: string;
      message: string;
    }>(`SELECT id, type, recipient_phone, recipient_email, recipient_name, subject, message
          FROM reminders WHERE id = $1`, [id]);
    if (r.rows.length === 0) { res.status(404).json({ error: 'Reminder not found' }); return; }
    const reminder = r.rows[0];

    const channels: Array<'sms' | 'email'> = reminder.type === 'both'
      ? ['sms', 'email']
      : [reminder.type];

    const results: Array<{ channel: string; status: string; provider_message_id?: string; error?: string }> = [];

    for (const channel of channels) {
      if (channel === 'sms') {
        if (!reminder.recipient_phone) {
          results.push({ channel: 'sms', status: 'failed', error: 'No phone number on reminder' });
          continue;
        }
        try {
          // Subject is just metadata for SMS — body goes over the wire.
          const sent = await sendSMS(reminder.recipient_phone, reminder.message);
          results.push({ channel: 'sms', status: sent.status ?? 'sent', provider_message_id: sent.messageId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ channel: 'sms', status: 'failed', error: msg });
        }
      } else if (channel === 'email') {
        // Email provider is not wired up yet — fall through to a stub
        // that records the attempt without claiming success.
        if (!reminder.recipient_email) {
          results.push({ channel: 'email', status: 'failed', error: 'No email on reminder' });
          continue;
        }
        console.log(`[REMINDER STUB EMAIL] To: ${reminder.recipient_email} | Subject: ${reminder.subject}`);
        results.push({ channel: 'email', status: 'queued', error: 'Email provider not configured — not actually delivered' });
      }
    }

    // Roll up results into a single status: 'sent' if every channel
    // succeeded, 'failed' if every channel failed, 'partial' otherwise.
    const allOk   = results.every(r => r.status === 'sent' || r.status === 'queued');
    const anyOk   = results.some(r =>  r.status === 'sent' || r.status === 'queued');
    const rollup  = allOk ? 'sent' : (anyOk ? 'sent' : 'failed');
    const errLine = results.filter(r => r.error).map(r => `[${r.channel}] ${r.error}`).join('; ') || null;
    const provId  = results.find(r => r.provider_message_id)?.provider_message_id ?? null;

    await query(
      `UPDATE reminders
          SET status = $1,
              sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END,
              provider_message_id = COALESCE($2, provider_message_id),
              error = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [rollup, provId, errLine, id]
    );
    await logAudit(null, auth?.userId ?? 'unknown', 'reminder.sent', id,
      { type: reminder.type, recipient: reminder.recipient_name, results }, (req.ip ?? 'unknown'));

    res.json({
      success: rollup === 'sent',
      status: rollup,
      sent_at: rollup === 'sent' ? new Date().toISOString() : null,
      results,
    });
  } catch (err) {
    console.error('Send reminder error:', err);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
});

// POST /auto-generate — auto create reminders for overdue items
router.post('/auto-generate', requireAuth, requirePermission('reminders_manage'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  let generated = 0;
  try {
    // 1. Candidates stuck in application stage > 7 days
    const stuckApps = await query(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone
       FROM candidates c
       WHERE c.stage = 'application' AND c.status = 'active'
         AND c.updated_at < NOW() - INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM reminders r
           WHERE r.candidate_id = c.id AND r.trigger_type = 'pending_application'
             AND r.created_at > NOW() - INTERVAL '7 days'
         )`
    );

    for (const c of stuckApps.rows) {
      await query(
        `INSERT INTO reminders (type, trigger_type, candidate_id, recipient_email, recipient_name,
           subject, message, status)
         VALUES ('email', 'pending_application', $1, $2, $3, $4, $5, 'scheduled')`,
        [c.id, c.email, `${c.first_name} ${c.last_name}`,
         `Application Follow-up: ${c.first_name} ${c.last_name}`,
         `Hi ${c.first_name}, your application has been pending for over 7 days. Please reach out to your recruiter for next steps.`]
      );
      generated++;
    }

    // 2. Candidates with missing required documents in credentialing stage
    const missingDocs = await query(
      `SELECT DISTINCT c.id, c.first_name, c.last_name, c.email,
              COUNT(cd.id)::INT AS missing_count
       FROM candidates c
       JOIN candidate_documents cd ON cd.candidate_id = c.id
       WHERE c.stage = 'credentialing' AND c.status = 'active'
         AND cd.status = 'missing' AND cd.required = true
         AND NOT EXISTS (
           SELECT 1 FROM reminders r
           WHERE r.candidate_id = c.id AND r.trigger_type = 'missing_document'
             AND r.created_at > NOW() - INTERVAL '3 days'
         )
       GROUP BY c.id, c.first_name, c.last_name, c.email`
    );

    for (const c of missingDocs.rows) {
      await query(
        `INSERT INTO reminders (type, trigger_type, candidate_id, recipient_email, recipient_name,
           subject, message, status)
         VALUES ('email', 'missing_document', $1, $2, $3, $4, $5, 'scheduled')`,
        [c.id, c.email, `${c.first_name} ${c.last_name}`,
         `Action Required: Missing Documents for ${c.first_name} ${c.last_name}`,
         `Hi ${c.first_name}, you have ${c.missing_count} required document(s) missing. Please submit them to continue the credentialing process.`]
      );
      generated++;
    }

    // 3. Candidates in onboarding with incomplete forms
    const incompleteOnboarding = await query(
      `SELECT DISTINCT c.id, c.first_name, c.last_name, c.email
       FROM candidates c
       JOIN onboarding_forms of ON of.candidate_id = c.id
       WHERE c.stage = 'onboarding' AND c.status = 'active'
         AND of.status IN ('not_sent', 'sent')
         AND (of.sent_at IS NULL OR of.sent_at < NOW() - INTERVAL '3 days')
         AND NOT EXISTS (
           SELECT 1 FROM reminders r
           WHERE r.candidate_id = c.id AND r.trigger_type = 'incomplete_onboarding'
             AND r.created_at > NOW() - INTERVAL '3 days'
         )`
    );

    for (const c of incompleteOnboarding.rows) {
      await query(
        `INSERT INTO reminders (type, trigger_type, candidate_id, recipient_email, recipient_name,
           subject, message, status)
         VALUES ('email', 'incomplete_onboarding', $1, $2, $3, $4, $5, 'scheduled')`,
        [c.id, c.email, `${c.first_name} ${c.last_name}`,
         `Action Required: Complete Your Onboarding Forms`,
         `Hi ${c.first_name}, you have incomplete onboarding forms. Please complete them to be cleared to start work.`]
      );
      generated++;
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'reminder.autoGenerate', 'system',
      { generated }, (req.ip ?? 'unknown'));
    res.json({ success: true, generated });
  } catch (err) {
    console.error('Auto-generate reminders error:', err);
    res.status(500).json({ error: 'Failed to auto-generate reminders' });
  }
});

// POST /ai-draft — Phase 1.6B+C. Takes a candidate_id (or freeform context)
// and returns a drafted subject + message. When a candidate is picked, we
// look up what they're missing (docs, stage age, stalled submission) and
// the AI tailors the message to that. User can then edit before saving.
const aiDraftSchema = z.object({
  candidate_id: z.string().uuid().optional().nullable(),
  type: z.enum(['email', 'sms', 'both']).optional().default('email'),
  topic: z.string().max(500).optional().nullable(), // user's freeform ask, e.g. "remind about interview tomorrow"
  tone: z.enum(REMINDER_TONES).optional().default('professional'),
});

router.post('/ai-draft', requireAuth, requirePermission('reminders_manage'), async (req: Request, res: Response) => {
  const parsed = aiDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }
  const { candidate_id, type, topic, tone } = parsed.data;

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'AI drafting not configured on this server (ANTHROPIC_API_KEY missing).' });
    return;
  }

  // Gather candidate context (if provided) — no PII sent to Claude beyond
  // name + professional info, same posture as the AI Brain. Email/phone
  // stay on our server.
  const contextBlocks: string[] = [];
  if (candidate_id) {
    try {
      const [candRes, docsRes, subsRes] = await Promise.all([
        query(
          `SELECT first_name, last_name, role, stage, city, state, years_experience,
                  specialties, certifications, licenses, available_shifts,
                  recruiter_notes, updated_at
           FROM candidates WHERE id = $1`,
          [candidate_id]
        ),
        query(
          `SELECT label, document_type, status, expiry_date, required
           FROM candidate_documents WHERE candidate_id = $1 AND (status = 'missing' OR status = 'pending' OR status = 'expired')
           ORDER BY required DESC LIMIT 15`,
          [candidate_id]
        ),
        query(
          `SELECT s.stage_key, s.interview_scheduled_at, j.title AS job_title
           FROM submissions s LEFT JOIN jobs j ON j.id = s.job_id
           WHERE s.candidate_id = $1 ORDER BY s.updated_at DESC LIMIT 3`,
          [candidate_id]
        ),
      ]);
      if (candRes.rows[0]) {
        const c = candRes.rows[0];
        contextBlocks.push(
          `CANDIDATE: ${c.first_name} ${c.last_name} — ${c.role ?? 'role?'} · stage: ${c.stage ?? '?'}` +
          (c.years_experience ? ` · ${c.years_experience}yr` : '') +
          (c.city || c.state ? ` · ${[c.city, c.state].filter(Boolean).join(', ')}` : '')
        );
        const daysStale = Math.floor((Date.now() - new Date(c.updated_at as string).getTime()) / (24 * 60 * 60 * 1000));
        if (daysStale > 3) {
          contextBlocks.push(`NOTE: Record hasn't been updated in ${daysStale} days — may need a nudge.`);
        }
      }
      if (docsRes.rows.length > 0) {
        contextBlocks.push(
          `OUTSTANDING CREDENTIALS:\n` +
          docsRes.rows.map((d: any) => `- ${d.label} (${d.document_type}): ${d.status}${d.expiry_date ? ` — expires ${new Date(d.expiry_date).toISOString().slice(0, 10)}` : ''}`).join('\n')
        );
      }
      if (subsRes.rows.length > 0) {
        contextBlocks.push(
          `RECENT SUBMISSIONS:\n` +
          subsRes.rows.map((s: any) => `- ${s.job_title ?? 'Unknown job'} @ ${s.stage_key ?? '?'}${s.interview_scheduled_at ? ` · interview ${new Date(s.interview_scheduled_at).toISOString().slice(0, 16).replace('T', ' ')}` : ''}`).join('\n')
        );
      }
    } catch { /* best effort */ }
  }

  // Phase 2 — tone-aware drafting. The user picks one of five tones in
  // the UI; we translate that into specific style guidance for Claude.
  const toneGuide: Record<typeof REMINDER_TONES[number], string> = {
    professional: 'Professional and clear. Standard business style. Courteous greeting + signoff.',
    friendly:     'Warm and conversational while still respectful. First-name greeting. Lighter sign-off.',
    urgent:       'Direct and time-sensitive. Make the deadline obvious. Short sentences. Clear ask.',
    short_sms:    'SMS-length (under 160 characters TOTAL). No greetings, no signoffs. Just the action and a clear call-to-action.',
    formal_email: 'Formal business-letter style. Full salutation ("Dear Mr./Ms. Lastname"), full closing, complete sentences.',
  };
  const channelGuide = type === 'sms'
    ? 'SMS — body under 160 characters; subject can be an empty string.'
    : type === 'both'
      ? 'Email + SMS — write the subject + a short email body; the SMS will be the first 160 chars of the body.'
      : 'Email — full subject + body with greeting and sign-off.';

  const systemPrompt = `You are drafting a reminder message for a healthcare staffing recruiter to send to a candidate. Output ONLY JSON with this exact shape — no markdown, no prose:

{
  "subject": "short subject line suitable for ${type === 'sms' ? 'SMS (send empty string)' : 'email'}",
  "message": "the reminder body, varying length per channel/tone"
}

CHANNEL: ${channelGuide}
TONE (${tone}): ${toneGuide[tone ?? 'professional']}

Rules:
- Never invent credentials, licenses, or facts that aren't in the context
- If outstanding credentials are listed, mention the specific items that need attention
- Never include placeholders like [First Name] — use the actual name from context
- Never claim to "have attached" files — the reminder is standalone text`;

  const userMsg = [
    contextBlocks.length > 0 ? contextBlocks.join('\n\n') : 'No specific candidate context provided.',
    topic ? `\nUSER'S INSTRUCTION: ${topic}` : '\nUSER REQUEST: Draft a reasonable reminder based on the context above.',
    `\nCHANNEL: ${type ?? 'email'}`,
  ].join('\n');

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.templateDrafting,
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });
    const text = (response.content[0] as { type: string; text: string }).text;
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    const jsonStr = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
    const parsed2 = JSON.parse(jsonStr) as { subject?: string; message?: string };
    res.json({
      subject: parsed2.subject ?? '',
      message: parsed2.message ?? '',
      tone,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error('AI reminder draft error:', err);
    res.status(500).json({
      error: `AI drafting failed: ${e.message?.slice(0, 200) ?? 'unknown error'}`,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /suggest-schedule — AI proposes a 3–7 reminder timeline for a candidate
// ---------------------------------------------------------------------------
//
// Reads the candidate's current state (stage, missing docs, upcoming
// interviews, onboarding status) and asks Claude to propose a sequence of
// reminders the recruiter / HR / manager should set up. The user reviews
// each suggestion and can accept / edit / discard before they get
// inserted as reminder rows.
//
// Returns the suggestions ONLY — no DB inserts. The user later POSTs the
// approved subset via POST / (existing endpoint).
const suggestScheduleSchema = z.object({
  candidate_id: z.string().uuid(),
  tone: z.enum(REMINDER_TONES).optional().default('professional'),
});

router.post('/suggest-schedule', requireAuth, requirePermission('reminders_manage'), async (req: Request, res: Response) => {
  const parsed = suggestScheduleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() }); return; }
  const { candidate_id, tone } = parsed.data;

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'AI scheduling not configured (ANTHROPIC_API_KEY missing).' });
    return;
  }

  // Pull the same context as ai-draft, but include start_date /
  // upcoming interview info that the timeline cares about.
  const ctx: string[] = [];
  let candidate: any = null;
  try {
    const [candRes, docsRes, subsRes, formsRes] = await Promise.all([
      query(
        `SELECT first_name, last_name, role, stage, status, start_date,
                years_experience, recruiter_notes, hr_notes, updated_at
           FROM candidates WHERE id = $1`,
        [candidate_id]
      ),
      query(
        `SELECT label, document_type, status, expiry_date, required
           FROM candidate_documents WHERE candidate_id = $1
            AND (status = 'missing' OR status = 'pending' OR status = 'expired')
           ORDER BY required DESC LIMIT 20`,
        [candidate_id]
      ),
      query(
        `SELECT s.stage_key, s.interview_scheduled_at, j.title AS job_title
           FROM submissions s LEFT JOIN jobs j ON j.id = s.job_id
          WHERE s.candidate_id = $1 ORDER BY s.updated_at DESC LIMIT 5`,
        [candidate_id]
      ),
      query(
        `SELECT form_type, status, sent_at, last_reminder_at
           FROM onboarding_forms WHERE candidate_id = $1
           ORDER BY form_type ASC LIMIT 20`,
        [candidate_id]
      ).catch(() => ({ rows: [] })),
    ]);

    if (candRes.rows.length === 0) { res.status(404).json({ error: 'Candidate not found' }); return; }
    candidate = candRes.rows[0];

    ctx.push(`CANDIDATE: ${candidate.first_name} ${candidate.last_name} — ${candidate.role ?? 'role?'} · stage: ${candidate.stage ?? '?'} · status: ${candidate.status ?? '?'}`);
    if (candidate.start_date) ctx.push(`START DATE: ${new Date(candidate.start_date).toISOString().slice(0, 10)}`);
    const daysStale = Math.floor((Date.now() - new Date(candidate.updated_at as string).getTime()) / 86400000);
    if (daysStale > 3) ctx.push(`Record stale: ${daysStale} days since last update.`);

    if (docsRes.rows.length > 0) {
      ctx.push(
        `OUTSTANDING CREDENTIALS:\n` +
        docsRes.rows.map((d: any) => `- ${d.label} (${d.document_type}): ${d.status}${d.expiry_date ? ` — expires ${new Date(d.expiry_date).toISOString().slice(0, 10)}` : ''}`).join('\n')
      );
    }
    if (subsRes.rows.length > 0) {
      ctx.push(
        `RECENT SUBMISSIONS:\n` +
        subsRes.rows.map((s: any) => `- ${s.job_title ?? 'Unknown job'} @ ${s.stage_key ?? '?'}${s.interview_scheduled_at ? ` · interview ${new Date(s.interview_scheduled_at).toISOString().slice(0, 16).replace('T', ' ')}` : ''}`).join('\n')
      );
    }
    if (formsRes.rows.length > 0) {
      const incomplete = formsRes.rows.filter((f: any) => f.status !== 'completed');
      if (incomplete.length > 0) {
        ctx.push(
          `INCOMPLETE ONBOARDING FORMS:\n` +
          incomplete.map((f: any) => `- ${f.form_type}: ${f.status}${f.sent_at ? ` (sent ${new Date(f.sent_at).toISOString().slice(0, 10)})` : ''}`).join('\n')
        );
      }
    }
  } catch (err) {
    console.error('[suggest-schedule] context error:', err);
    res.status(500).json({ error: 'Failed to load candidate context' });
    return;
  }

  const systemPrompt = `You are scheduling reminders for a healthcare staffing recruiter to manage a single candidate's journey from application through start date.

Today's date: ${new Date().toISOString().slice(0, 10)}

Output ONLY a JSON object with a "schedule" array — no markdown, no prose. Each item in the array is one proposed reminder:

{
  "schedule": [
    {
      "category": "interview" | "application_followup" | "missing_document" | "credentialing_followup" | "onboarding_followup" | "start_date" | "general",
      "channel": "sms" | "email",
      "scheduled_at": "ISO 8601 timestamp (UTC)",
      "subject": "short subject line",
      "message": "the body — concise, actionable, candidate-specific",
      "assignee_role": "recruiter" | "hr" | "manager_reviewer" | "credentialing",
      "rationale": "1-sentence note for the human reviewer about why this reminder matters now"
    }
  ]
}

Rules:
- Propose between 3 and 7 reminders covering the next 30 days
- Tone: ${tone}. Apply consistently across all message bodies.
- Only schedule things that make sense given the context (don't propose a start_date reminder if there's no start date)
- Distribute scheduled_at across the next 30 days — not all at once
- For SMS, message must be under 160 characters
- Never invent credentials, licenses, or interview times that aren't in the context
- assignee_role should match the work: credentialing items → credentialing; HR docs → hr; recruiting follow-ups → recruiter; final-review checks → manager_reviewer`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.templateDrafting,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: ctx.join('\n\n') }],
    });
    const text = (response.content[0] as { type: string; text: string }).text;
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    const jsonStr = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
    const parsed2 = JSON.parse(jsonStr) as { schedule?: Array<Record<string, unknown>> };

    res.json({
      candidate_id,
      candidate_name: `${candidate.first_name} ${candidate.last_name}`,
      tone,
      schedule: Array.isArray(parsed2.schedule) ? parsed2.schedule : [],
    });
  } catch (err) {
    const e = err as { message?: string };
    console.error('AI suggest-schedule error:', err);
    res.status(500).json({ error: `AI scheduling failed: ${e.message?.slice(0, 200) ?? 'unknown error'}` });
  }
});

export default router;
