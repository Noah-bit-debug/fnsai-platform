import { Router, Request, Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, requirePermission, logAudit, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db/client';
import { getAuth } from '@clerk/express';

const router = Router();

const MODEL = 'claude-3-5-sonnet-20241022';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SUPPORTED_TYPES = [
  'reminder', 'email', 'sms', 'onboarding_task',
  'compliance_request', 'follow_up', 'welcome', 'document_request',
] as const;

const SUPPORTED_CATEGORIES = [
  'hr', 'recruiting', 'credentialing', 'onboarding', 'compliance', 'general',
] as const;

const templateSchema = z.object({
  name:         z.string().min(1).max(300),
  type:         z.enum(SUPPORTED_TYPES),
  category:     z.enum(SUPPORTED_CATEGORIES),
  subject:      z.string().min(1).max(500),
  content:      z.string().min(1).max(10000),
  variables:    z.array(z.string()).optional().default([]),
  tags:         z.array(z.string()).optional().default([]),
  ai_generated: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// Default seed templates — extracted so they can be called on-demand from GET /
// ---------------------------------------------------------------------------
const SEED_TEMPLATES = [
    {
      name: 'Missing Credentials Reminder',
      type: 'reminder',
      category: 'credentialing',
      subject: 'Action Required: Missing Credentials – {{candidate_name}}',
      content: `Hi {{candidate_name}},\n\nOur credentialing team has flagged that the following required credentials are still outstanding on your file:\n\n{{missing_credentials_list}}\n\nPlease upload or submit these documents as soon as possible to avoid delays in your placement. If you have already submitted them, please reply to this message so we can update our records.\n\nFor questions, contact us at {{coordinator_email}}.\n\nThank you,\n{{agency_name}} Credentialing Team`,
      variables: ['candidate_name', 'missing_credentials_list', 'coordinator_email', 'agency_name'],
      tags: ['credentialing', 'compliance', 'missing-docs'],
    },
    {
      name: 'New Candidate Welcome',
      type: 'welcome',
      category: 'recruiting',
      subject: 'Welcome to {{agency_name}}, {{candidate_name}}!',
      content: `Dear {{candidate_name}},\n\nWelcome to {{agency_name}}! We're excited to have you join our talent network.\n\nYour recruiter, {{recruiter_name}}, will be reaching out within 1–2 business days to discuss suitable opportunities that match your skills and availability.\n\nIn the meantime, please log in to our portal at {{portal_url}} to complete your profile and upload any relevant credentials.\n\nIf you have any questions, don't hesitate to reach out to us at {{recruiter_email}}.\n\nWarm regards,\n{{agency_name}} Recruiting Team`,
      variables: ['candidate_name', 'agency_name', 'recruiter_name', 'portal_url', 'recruiter_email'],
      tags: ['welcome', 'new-candidate', 'recruiting'],
    },
    {
      name: 'Onboarding Task Assignment',
      type: 'onboarding_task',
      category: 'onboarding',
      subject: 'New Onboarding Task: {{task_name}}',
      content: `Hi {{candidate_name}},\n\nYou have been assigned a new onboarding task that must be completed before your start date of {{start_date}}.\n\nTask: {{task_name}}\nDescription: {{task_description}}\nDue Date: {{due_date}}\n\nPlease log in to your onboarding portal at {{portal_url}} to complete this task.\n\nIf you need assistance or have questions about this task, please contact {{coordinator_name}} at {{coordinator_email}}.\n\nThank you,\n{{agency_name}} Onboarding Team`,
      variables: ['candidate_name', 'task_name', 'task_description', 'start_date', 'due_date', 'portal_url', 'coordinator_name', 'coordinator_email', 'agency_name'],
      tags: ['onboarding', 'task', 'pre-start'],
    },
    {
      name: 'CPR Certification Expiry Alert',
      type: 'compliance_request',
      category: 'compliance',
      subject: 'Urgent: Your CPR Certification Expires on {{expiry_date}}',
      content: `Dear {{candidate_name}},\n\nThis is an important compliance notice regarding your CPR certification.\n\nYour current CPR certification is scheduled to expire on {{expiry_date}}. As a healthcare professional placed through {{agency_name}}, maintaining a valid CPR certification is a mandatory compliance requirement.\n\nPlease take one of the following actions before {{expiry_date}}:\n1. Renew your CPR certification through an AHA-approved provider\n2. Upload your renewed certificate to your profile at {{portal_url}}\n\nFailure to renew your certification by the expiry date may result in suspension of your placement until compliance is restored.\n\nIf you have already renewed, please upload your new certificate so we can update our records immediately.\n\nFor assistance finding a renewal course, contact {{coordinator_name}} at {{coordinator_email}}.\n\nRegards,\n{{agency_name}} Compliance Team`,
      variables: ['candidate_name', 'expiry_date', 'agency_name', 'portal_url', 'coordinator_name', 'coordinator_email'],
      tags: ['compliance', 'cpr', 'expiry', 'certification'],
    },
    {
      name: 'Placement Follow-up',
      type: 'follow_up',
      category: 'recruiting',
      subject: 'Checking In: How Is Your Placement Going at {{facility_name}}?',
      content: `Hi {{candidate_name}},\n\nI hope your placement at {{facility_name}} is going well! It's been {{days_placed}} days since you started, and I wanted to check in to see how things are going.\n\nA few quick questions:\n- How are you settling in with the team at {{facility_name}}?\n- Is the schedule working well for you?\n- Is there anything we can do to better support you?\n\nYour satisfaction is very important to us, and we want to ensure this placement continues to be a positive experience.\n\nPlease feel free to reply to this email or call me directly at {{recruiter_phone}}.\n\nWarm regards,\n{{recruiter_name}}\n{{agency_name}}`,
      variables: ['candidate_name', 'facility_name', 'days_placed', 'recruiter_name', 'recruiter_phone', 'agency_name'],
      tags: ['follow-up', 'retention', 'placement', 'recruiter'],
    },
    // ── HR / Onboarding Document Templates ───────────────────────────────────
    {
      name: 'Offer Letter',
      type: 'document_request',
      category: 'hr',
      subject: 'Your Offer Letter – {{position_title}} at {{agency_name}}',
      content: `Dear {{candidate_name}},\n\nWe are pleased to offer you the position of {{position_title}} with {{agency_name}}, effective {{start_date}}.\n\nPosition Details:\n- Title: {{position_title}}\n- Start Date: {{start_date}}\n- Pay Rate: \${{pay_rate}} per {{pay_period}}\n- Assignment Location: {{facility_name}}\n- Shift: {{shift_type}}\n\nThis offer is contingent upon successful completion of your background check, drug screening, and verification of all required credentials.\n\nPlease sign and return this offer letter by {{response_deadline}} to confirm your acceptance.\n\nWe look forward to having you on our team.\n\nSincerely,\n{{recruiter_name}}\n{{agency_name}}`,
      variables: ['candidate_name', 'position_title', 'start_date', 'agency_name', 'pay_rate', 'pay_period', 'facility_name', 'shift_type', 'response_deadline', 'recruiter_name'],
      tags: ['offer', 'hr', 'onboarding', 'document'],
    },
    {
      name: 'I-9 Employment Eligibility Verification Request',
      type: 'document_request',
      category: 'onboarding',
      subject: 'Action Required: Complete Your I-9 Verification – {{candidate_name}}',
      content: `Dear {{candidate_name}},\n\nAs part of your onboarding with {{agency_name}}, federal law requires all new employees to complete Form I-9 (Employment Eligibility Verification).\n\nYou must bring original documents from List A, OR a combination of documents from List B AND List C to your scheduled appointment on {{appointment_date}} at {{appointment_location}}.\n\nCommon acceptable documents:\n• List A: U.S. Passport, Permanent Resident Card, Employment Authorization Document\n• List B + C: Driver's License + Social Security Card (or Birth Certificate)\n\nPlease complete Section 1 of the I-9 form before your appointment by accessing the link below:\n{{portal_url}}\n\nIf you have questions, contact {{coordinator_name}} at {{coordinator_email}}.\n\nThank you,\n{{agency_name}} HR Team`,
      variables: ['candidate_name', 'agency_name', 'appointment_date', 'appointment_location', 'portal_url', 'coordinator_name', 'coordinator_email'],
      tags: ['i-9', 'onboarding', 'compliance', 'federal', 'document'],
    },
    {
      name: 'W-4 Federal Tax Withholding Request',
      type: 'document_request',
      category: 'onboarding',
      subject: 'Complete Your W-4 Federal Tax Form – {{candidate_name}}',
      content: `Dear {{candidate_name}},\n\nTo ensure accurate federal income tax withholding from your paychecks, please complete the IRS Form W-4 (Employee's Withholding Certificate).\n\nSteps to complete:\n1. Visit: {{portal_url}}\n2. Navigate to "Documents" → "W-4"\n3. Complete all required fields\n4. Submit by {{due_date}}\n\nIf you have questions about how to fill out the W-4, we recommend visiting the IRS Tax Withholding Estimator at https://www.irs.gov/individuals/tax-withholding-estimator.\n\nFor HR questions, contact {{coordinator_name}} at {{coordinator_email}}.\n\n{{agency_name}} Payroll Team`,
      variables: ['candidate_name', 'portal_url', 'due_date', 'agency_name', 'coordinator_name', 'coordinator_email'],
      tags: ['w-4', 'tax', 'payroll', 'onboarding', 'document'],
    },
    {
      name: 'Direct Deposit Authorization',
      type: 'document_request',
      category: 'hr',
      subject: 'Set Up Direct Deposit for Your Paychecks – {{candidate_name}}',
      content: `Dear {{candidate_name}},\n\nTo receive your paychecks via direct deposit, please complete the Direct Deposit Authorization form.\n\nYou will need:\n• Your bank routing number (9-digit number on your checks)\n• Your account number\n• Account type (checking or savings)\n\nTo complete the form:\n1. Log in to the payroll portal at: {{portal_url}}\n2. Navigate to "Payment Settings" → "Direct Deposit"\n3. Enter your banking information\n4. Submit before {{due_date}} to ensure your first paycheck is deposited directly\n\nNote: Initial setup may take 1–2 pay cycles to activate. Paper checks will be issued during this transition period.\n\nFor assistance, contact {{coordinator_name}} at {{coordinator_email}}.\n\n{{agency_name}} Payroll Team`,
      variables: ['candidate_name', 'portal_url', 'due_date', 'agency_name', 'coordinator_name', 'coordinator_email'],
      tags: ['direct-deposit', 'payroll', 'banking', 'hr'],
    },
    {
      name: 'BLS Certification Renewal Reminder',
      type: 'compliance_request',
      category: 'credentialing',
      subject: 'BLS Certification Renewal Required – Expires {{expiry_date}}',
      content: `Dear {{candidate_name}},\n\nThis is a reminder that your Basic Life Support (BLS) certification is set to expire on {{expiry_date}}.\n\nBLS certification is a mandatory requirement for your role as {{position_title}}. Failure to renew before the expiration date will result in an automatic compliance hold on your placement.\n\nTo renew:\n1. Complete an AHA-approved BLS for Healthcare Providers course\n2. Ensure the course covers adult, child, and infant CPR plus AED use\n3. Upload your updated certification card to your profile at {{portal_url}} immediately upon completion\n\nCourse options near you can be found at: https://www.heart.org/en/cpr/find-a-course\n\nRenewal Deadline: {{expiry_date}}\n\nFor questions, contact {{coordinator_name}} at {{coordinator_email}}.\n\n{{agency_name}} Credentialing Team`,
      variables: ['candidate_name', 'expiry_date', 'position_title', 'portal_url', 'coordinator_name', 'coordinator_email', 'agency_name'],
      tags: ['bls', 'cpr', 'certification', 'credentialing', 'compliance'],
    },
    {
      name: 'TB Test Requirement Notice',
      type: 'compliance_request',
      category: 'credentialing',
      subject: 'TB Test Required for Placement – {{candidate_name}}',
      content: `Dear {{candidate_name}},\n\nAs a condition of your healthcare placement through {{agency_name}}, you are required to provide documentation of a current tuberculosis (TB) test or screening.\n\nAcceptable forms of TB documentation:\n• Negative 2-step PPD tuberculin skin test (within the past 12 months)\n• Negative QuantiFERON-TB Gold blood test (within the past 12 months)\n• Documented history of positive TB test with negative chest X-ray (within the past 5 years)\n\nYour current TB documentation {{tb_status}}.\n\nPlease complete your TB test and upload results to {{portal_url}} no later than {{due_date}}.\n\nIf you have questions about testing locations, contact {{coordinator_name}} at {{coordinator_email}}.\n\n{{agency_name}} Credentialing Team`,
      variables: ['candidate_name', 'tb_status', 'due_date', 'portal_url', 'coordinator_name', 'coordinator_email', 'agency_name'],
      tags: ['tb-test', 'tuberculosis', 'credentialing', 'compliance', 'health-screening'],
    },
    {
      name: 'Background Check Authorization',
      type: 'document_request',
      category: 'onboarding',
      subject: 'Authorization Required: Background Check – {{candidate_name}}',
      content: `Dear {{candidate_name}},\n\nAs part of the pre-employment process with {{agency_name}}, we are required to conduct a background screening. This check is standard for all healthcare professionals.\n\nThe background check will include:\n• Criminal history (national, state, and county)\n• Sex offender registry check\n• OIG/SAM exclusion list verification\n• Employment history verification\n• License and credential verification\n\nTo authorize and initiate the background check:\n1. Visit: {{background_check_url}}\n2. Enter your access code: {{access_code}}\n3. Complete the authorization form\n4. Submit by {{due_date}}\n\nResults are typically available within 3–5 business days.\n\nFor questions, contact {{coordinator_name}} at {{coordinator_email}}.\n\n{{agency_name}} HR Team`,
      variables: ['candidate_name', 'agency_name', 'background_check_url', 'access_code', 'due_date', 'coordinator_name', 'coordinator_email'],
      tags: ['background-check', 'onboarding', 'hr', 'compliance', 'pre-employment'],
    },
    {
      name: 'Employee Handbook Acknowledgment',
      type: 'document_request',
      category: 'onboarding',
      subject: 'Please Review and Sign the Employee Handbook – {{candidate_name}}',
      content: `Dear {{candidate_name}},\n\nWelcome to {{agency_name}}! As part of your onboarding, please review our Employee Handbook, which outlines company policies, procedures, and your rights and responsibilities as a team member.\n\nThe handbook covers:\n• Code of conduct and professional standards\n• Attendance and punctuality policies\n• Time reporting and payroll procedures\n• HIPAA compliance and patient confidentiality\n• Incident reporting procedures\n• Dress code and facility policies\n• Grievance and complaint procedures\n\nTo access and sign the handbook:\n1. Visit: {{portal_url}}\n2. Navigate to "Documents" → "Employee Handbook"\n3. Read the complete handbook\n4. Sign the acknowledgment form\n5. Submit by {{due_date}}\n\nFor questions, contact {{coordinator_name}} at {{coordinator_email}}.\n\n{{agency_name}} HR Team`,
      variables: ['candidate_name', 'agency_name', 'portal_url', 'due_date', 'coordinator_name', 'coordinator_email'],
      tags: ['handbook', 'onboarding', 'policy', 'acknowledgment', 'hr'],
    },
    {
      name: 'Incident Report Notification',
      type: 'compliance_request',
      category: 'compliance',
      subject: 'Incident Report Filed – {{incident_date}} – {{candidate_name}}',
      content: `Dear {{candidate_name}},\n\nThis message confirms that an incident report has been filed regarding an event that occurred on {{incident_date}} at {{facility_name}}.\n\nIncident Reference #: {{incident_id}}\nDate of Incident: {{incident_date}}\nLocation: {{facility_name}}\nReported By: {{reporter_name}}\n\nNext Steps:\n1. Please review the incident report on file at {{portal_url}}\n2. Provide your written account of the events within {{response_deadline}} business days\n3. A member of our HR/Compliance team will follow up with you at {{coordinator_email}}\n\nAll incident reports are handled confidentially in accordance with {{agency_name}} policy and applicable regulations.\n\nFor questions or concerns, contact {{coordinator_name}} at {{coordinator_email}}.\n\n{{agency_name}} Compliance Team`,
      variables: ['candidate_name', 'incident_date', 'facility_name', 'incident_id', 'reporter_name', 'portal_url', 'response_deadline', 'coordinator_name', 'coordinator_email', 'agency_name'],
      tags: ['incident', 'compliance', 'hr', 'report'],
    },
    {
      name: 'Annual Performance Review Notice',
      type: 'document_request',
      category: 'hr',
      subject: 'Annual Performance Review – {{review_period}} – {{candidate_name}}',
      content: `Dear {{candidate_name}},\n\nIt is time for your annual performance review for the period of {{review_period}}.\n\nYour review is scheduled for:\nDate: {{review_date}}\nTime: {{review_time}}\nFormat: {{review_format}}\nWith: {{reviewer_name}}, {{reviewer_title}}\n\nTo prepare for your review, please complete the self-evaluation form by {{self_eval_deadline}}:\n{{portal_url}}\n\nThe self-evaluation covers:\n• Performance against goals set at the beginning of the review period\n• Clinical competencies and professional development\n• Communication and teamwork\n• Areas for growth and development goals for the coming year\n\nAnnual reviews directly inform compensation adjustments and advancement opportunities.\n\nFor questions, contact {{reviewer_name}} at {{coordinator_email}}.\n\n{{agency_name}} HR Team`,
      variables: ['candidate_name', 'review_period', 'review_date', 'review_time', 'review_format', 'reviewer_name', 'reviewer_title', 'self_eval_deadline', 'portal_url', 'coordinator_email', 'agency_name'],
      tags: ['annual-review', 'performance', 'hr', 'evaluation'],
    },
];

async function runSeedTemplates(): Promise<void> {
  for (const seed of SEED_TEMPLATES) {
    try {
      // Check existence first to avoid type-ambiguity with SELECT...WHERE NOT EXISTS
      const exists = await query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM templates WHERE name = $1',
        [seed.name]
      );
      if (Number(exists.rows[0].count) > 0) continue;

      await query(
        `INSERT INTO templates (name, type, category, subject, content, variables, tags, ai_generated, is_active, version, use_count)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, false, true, 1, 0)`,
        [
          seed.name,
          seed.type,
          seed.category,
          seed.subject,
          seed.content,
          JSON.stringify(seed.variables),
          JSON.stringify(seed.tags),
        ]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('does not exist') && !msg.includes('relation')) {
        console.error('[templates] Seed error for', seed.name, err);
      }
    }
  }
}

// Try seeding at startup (best effort — table may not exist yet)
runSeedTemplates().catch(() => { /* silently skip if table missing */ });

// ---------------------------------------------------------------------------
// GET /types/list — must be defined before /:id to avoid route conflict
// ---------------------------------------------------------------------------
router.get('/types/list', requireAuth, async (_req: Request, res: Response) => {
  res.json({
    types: [...SUPPORTED_TYPES],
    categories: [...SUPPORTED_CATEGORIES],
  });
});

// ---------------------------------------------------------------------------
// GET /suggest — AI template suggestion
// ---------------------------------------------------------------------------
router.get('/suggest', requireAuth, requirePermission('templates_view'), async (req: Request, res: Response) => {
  const { context } = req.query;
  if (!context || typeof context !== 'string') {
    res.status(400).json({ error: 'Query param "context" is required' });
    return;
  }

  try {
    // Search existing templates first (ILIKE on name and content)
    const existing = await query(
      `SELECT id, name, type, category, subject, content, variables, tags, use_count
       FROM templates
       WHERE is_active = true
         AND (name ILIKE $1 OR content ILIKE $1 OR subject ILIKE $1)
       ORDER BY use_count DESC
       LIMIT 3`,
      [`%${context}%`]
    );

    if (existing.rows.length > 0) {
      res.json({ source: 'existing', suggestions: existing.rows });
      return;
    }

    // No matches — ask Claude which template type would work best
    const prompt = `You are an operations assistant for a healthcare staffing agency.

A user needs a template for the following context:
"${context}"

Available template types: ${SUPPORTED_TYPES.join(', ')}
Available template categories: ${SUPPORTED_CATEGORIES.join(', ')}

Based on the context, suggest the most appropriate template type and category, and explain why.
Return ONLY a valid JSON object — no prose, no markdown fences.

REQUIRED FORMAT:
{
  "recommended_type": "<type from the list above>",
  "recommended_category": "<category from the list above>",
  "reason": "Short explanation of why this type/category fits (1–2 sentences)"
}`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected Claude response type');

    const stripped = block.text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object in Claude response');
    const suggestion = JSON.parse(match[0]);

    res.json({ source: 'ai', suggestion });
  } catch (err) {
    console.error('Template suggest error:', err);
    res.status(500).json({ error: 'Failed to generate template suggestion' });
  }
});

// ---------------------------------------------------------------------------
// GET / — list templates
// ---------------------------------------------------------------------------
router.get('/', requireAuth, requirePermission('templates_view'), async (req: Request, res: Response) => {
  const { type, category, is_active } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  // Default is_active to true unless explicitly set to 'false'
  const activeFilter = is_active === 'false' ? false : true;
  conditions.push(`is_active = $${idx++}`);
  params.push(activeFilter);

  if (type)     { conditions.push(`type = $${idx++}`);     params.push(type); }
  if (category) { conditions.push(`category = $${idx++}`); params.push(category); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    // Check total count first (without filters) to detect if seeding is needed
    const countCheck = await query('SELECT COUNT(*) FROM templates');
    const totalCount = Number(countCheck.rows[0].count);

    if (totalCount === 0) {
      // Table exists but is empty — seed defaults now
      console.log('[templates] Table empty, seeding defaults…');
      await runSeedTemplates();
      console.log('[templates] Seeding complete.');
    }

    const result = await query(
      `SELECT id, name, type, category, subject, variables, tags,
              ai_generated, is_active, version, use_count, created_at, updated_at
       FROM templates
       ${where}
       ORDER BY category, name`,
      params
    );
    res.json({ templates: result.rows });
  } catch (err: any) {
    if (err?.code === '42P01') { res.json({ templates: [] }); return; }
    console.error('Templates list error:', err);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// ---------------------------------------------------------------------------
// POST / — create template
// ---------------------------------------------------------------------------
router.post('/', requireAuth, requirePermission('templates_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const parse = templateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.flatten() });
    return;
  }
  const auth = getAuth(req);
  const d = parse.data;

  try {
    const result = await query(
      `INSERT INTO templates (name, type, category, subject, content, variables, tags,
         ai_generated, is_active, version, use_count,
         created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 1, 0,
               (SELECT id FROM users WHERE clerk_user_id = $9 LIMIT 1))
       RETURNING *`,
      [
        d.name, d.type, d.category, d.subject, d.content,
        JSON.stringify(d.variables), JSON.stringify(d.tags),
        d.ai_generated, auth?.userId ?? null,
      ]
    );
    const template = result.rows[0];

    // Save initial version snapshot
    try {
      await query(
        `INSERT INTO template_versions (template_id, version, subject, content, variables, saved_by)
         VALUES ($1, 1, $2, $3, $4,
                 (SELECT id FROM users WHERE clerk_user_id = $5 LIMIT 1))`,
        [template.id, d.subject, d.content, JSON.stringify(d.variables), auth?.userId ?? null]
      );
    } catch (vErr) {
      console.error('[templates] Version snapshot error:', vErr);
    }

    await logAudit(null, auth?.userId ?? 'unknown', 'template.create', String(template.id),
      { name: d.name, type: d.type }, (req.ip ?? 'unknown'));
    res.status(201).json(template);
  } catch (err) {
    console.error('Create template error:', err);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id — get one template + version history
// ---------------------------------------------------------------------------
router.get('/:id', requireAuth, requirePermission('templates_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const templateResult = await query(`SELECT * FROM templates WHERE id = $1`, [id]);
    if (templateResult.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    let versions: unknown[] = [];
    try {
      const vResult = await query(
        `SELECT * FROM template_versions WHERE template_id = $1 ORDER BY version DESC`,
        [id]
      );
      versions = vResult.rows;
    } catch { /* template_versions table may not exist yet */ }

    res.json({ template: templateResult.rows[0], versions });
  } catch (err) {
    console.error('Get template error:', err);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:id — update template (saves old version first)
// ---------------------------------------------------------------------------
router.put('/:id', requireAuth, requirePermission('templates_manage'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  const { name, type, category, subject, content, variables, tags, ai_generated } = req.body;

  try {
    const existing = await query(`SELECT * FROM templates WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const current = existing.rows[0] as Record<string, unknown>;
    const nextVersion = (Number(current.version) || 1) + 1;

    // Snapshot the current version before overwriting
    try {
      await query(
        `INSERT INTO template_versions (template_id, version, subject, content, variables, saved_by)
         VALUES ($1, $2, $3, $4, $5,
                 (SELECT id FROM users WHERE clerk_user_id = $6 LIMIT 1))`,
        [
          id, current.version, current.subject, current.content,
          current.variables, auth?.userId ?? null,
        ]
      );
    } catch (vErr) {
      console.error('[templates] Version snapshot error on update:', vErr);
    }

    const result = await query(
      `UPDATE templates SET
         name         = COALESCE($1, name),
         type         = COALESCE($2, type),
         category     = COALESCE($3, category),
         subject      = COALESCE($4, subject),
         content      = COALESCE($5, content),
         variables    = COALESCE($6, variables),
         tags         = COALESCE($7, tags),
         ai_generated = COALESCE($8, ai_generated),
         version      = $9,
         updated_at   = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        name || null, type || null, category || null,
        subject || null, content || null,
        variables ? JSON.stringify(variables) : null,
        tags ? JSON.stringify(tags) : null,
        ai_generated ?? null,
        nextVersion, id,
      ]
    );

    await logAudit(null, auth?.userId ?? 'unknown', 'template.update', id,
      { version: nextVersion }, (req.ip ?? 'unknown'));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update template error:', err);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id — soft delete
// ---------------------------------------------------------------------------
router.delete('/:id', requireAuth, requirePermission('templates_manage'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const auth = getAuth(req);
  try {
    const result = await query(
      `UPDATE templates SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    await logAudit(null, auth?.userId ?? 'unknown', 'template.delete', id, {}, (req.ip ?? 'unknown'));
    res.json({ success: true });
  } catch (err) {
    console.error('Delete template error:', err);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/use — increment use_count
// ---------------------------------------------------------------------------
router.post('/:id/use', requireAuth, requirePermission('templates_view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(
      `UPDATE templates SET use_count = COALESCE(use_count, 0) + 1, updated_at = NOW()
       WHERE id = $1 RETURNING id, use_count`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json({ success: true, use_count: result.rows[0].use_count });
  } catch (err) {
    console.error('Template use error:', err);
    res.status(500).json({ error: 'Failed to increment use count' });
  }
});

export default router;
