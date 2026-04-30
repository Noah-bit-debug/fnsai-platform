import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/client';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { SYSTEM_TEMPLATES, generateSignedPDF } from '../services/esignService';
import { sendEmail } from '../services/graph';
import {
  DEFAULT_TEMPLATE_ROLES,
  validateRoles,
  isRolesValidationErr,
  isSigningOrder,
  SIGNING_ORDER_VALUES,
  type TemplateRole,
} from '../services/templateRoles';

const router = Router();

// ─── Multer file upload config ────────────────────────────────────────────────
// Uploads go to ESIGN_UPLOAD_DIR if set (pointing at a Railway volume mount
// or similar persistent storage) — otherwise fall back to cwd/uploads which
// is ephemeral on Railway and wipes on every deploy.
// Set ESIGN_UPLOAD_DIR=/app/persistent/esign on Railway after creating a
// volume mounted at /app/persistent to keep uploaded PDFs between deploys.
const uploadRootOverride = process.env.ESIGN_UPLOAD_DIR;
const uploadDir = uploadRootOverride
  ? path.join(uploadRootOverride, 'originals')
  : path.join(process.cwd(), 'uploads', 'esign');
const signedDir = uploadRootOverride
  ? path.join(uploadRootOverride, 'signed')
  : path.join(process.cwd(), 'uploads', 'esign', 'signed');
[uploadDir, signedDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
console.log(`[esign] Upload dir: ${uploadDir}${uploadRootOverride ? ' (persistent)' : ' (EPHEMERAL — files wipe on deploy. Set ESIGN_UPLOAD_DIR env var to use persistent storage.)'}`);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED_MIMETYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`File type not allowed: ${file.mimetype}`));
  },
});

// ─── DB Init ──────────────────────────────────────────────────────────────────
async function initEsignTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS esign_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100),
      description TEXT,
      content TEXT NOT NULL DEFAULT '',
      fields JSONB DEFAULT '[]',
      is_system BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      created_by VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS esign_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id VARCHAR(255),
      title VARCHAR(255) NOT NULL,
      field_values JSONB DEFAULT '{}',
      status VARCHAR(50) DEFAULT 'draft',
      staff_id UUID,
      created_by VARCHAR(255),
      file_path VARCHAR(500),
      processed_file_path VARCHAR(500),
      signed_file_path VARCHAR(500),
      signing_order VARCHAR(50) DEFAULT 'parallel',
      message TEXT,
      expires_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      voided_at TIMESTAMPTZ,
      void_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS esign_signers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES esign_documents(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      role VARCHAR(100) DEFAULT 'signer',
      order_index INTEGER DEFAULT 0,
      group_id VARCHAR(255),
      token VARCHAR(255) UNIQUE NOT NULL,
      auth_method VARCHAR(50) DEFAULT 'email_link',
      status VARCHAR(50) DEFAULT 'pending',
      viewed_at TIMESTAMPTZ,
      signed_at TIMESTAMPTZ,
      declined_at TIMESTAMPTZ,
      decline_reason TEXT,
      ip_address VARCHAR(50),
      user_agent TEXT,
      signature_data TEXT,
      signature_type VARCHAR(50),
      typed_name VARCHAR(255),
      reminder_count INTEGER DEFAULT 0,
      last_reminder_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS esign_fields (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES esign_documents(id) ON DELETE CASCADE,
      signer_id UUID REFERENCES esign_signers(id) ON DELETE SET NULL,
      field_type VARCHAR(100) NOT NULL,
      page INTEGER DEFAULT 1,
      x FLOAT DEFAULT 0,
      y FLOAT DEFAULT 0,
      width FLOAT DEFAULT 200,
      height FLOAT DEFAULT 40,
      label VARCHAR(255),
      placeholder VARCHAR(255),
      instructions TEXT,
      required BOOLEAN DEFAULT true,
      read_only BOOLEAN DEFAULT false,
      value TEXT,
      options JSONB,
      validation JSONB,
      conditional_logic JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS esign_audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID,
      signer_id UUID,
      action VARCHAR(100) NOT NULL,
      actor VARCHAR(255),
      ip_address VARCHAR(50),
      details JSONB,
      previous_event_hash VARCHAR(64),
      event_hash VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS esign_online_forms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR(255),
      created_by VARCHAR(255),
      title VARCHAR(255) NOT NULL,
      template_id VARCHAR(255),
      share_token VARCHAR(255) UNIQUE NOT NULL,
      kiosk_mode BOOLEAN DEFAULT false,
      requires_password BOOLEAN DEFAULT false,
      password_hash VARCHAR(255),
      expires_at TIMESTAMPTZ,
      max_submissions INTEGER,
      submission_count INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS esign_form_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      form_id UUID REFERENCES esign_online_forms(id) ON DELETE CASCADE,
      submitter_email VARCHAR(255),
      submitter_name VARCHAR(255),
      field_values JSONB DEFAULT '{}',
      generated_document_id VARCHAR(255),
      ip_address VARCHAR(50),
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Add new columns to esign_documents if upgrading from older schema
  const alterQueries = [
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS file_path VARCHAR(500)`,
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS processed_file_path VARCHAR(500)`,
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS signed_file_path VARCHAR(500)`,
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS signing_order VARCHAR(50) DEFAULT 'parallel'`,
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS message TEXT`,
    `ALTER TABLE esign_audit_log ADD COLUMN IF NOT EXISTS previous_event_hash VARCHAR(64)`,
    `ALTER TABLE esign_audit_log ADD COLUMN IF NOT EXISTS event_hash VARCHAR(64)`,
    `ALTER TABLE esign_signers ADD COLUMN IF NOT EXISTS group_id VARCHAR(255)`,
    `ALTER TABLE esign_signers ADD COLUMN IF NOT EXISTS auth_method VARCHAR(50) DEFAULT 'email_link'`,
    `ALTER TABLE esign_signers ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ`,
    `ALTER TABLE esign_signers ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ`,
    `ALTER TABLE esign_signers ADD COLUMN IF NOT EXISTS decline_reason TEXT`,
    `ALTER TABLE esign_signers ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0`,
    `ALTER TABLE esign_signers ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ`,
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS file_type VARCHAR(100)`,
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ`,
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS void_reason TEXT`,
    `ALTER TABLE esign_templates ADD COLUMN IF NOT EXISTS content TEXT DEFAULT ''`,
    `ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS correction_reason TEXT`,
    // Phase: template-roles rework. Templates now own a PDF (file_path)
    // so every document built from a template starts visually identical.
    // Roles is a JSON array of {key, label, order} — used to ask for
    // one signer per role at send time instead of one signer per
    // document. signing_order on the template is the default for any
    // document built from it.
    `ALTER TABLE esign_templates ADD COLUMN IF NOT EXISTS file_path VARCHAR(500)`,
    `ALTER TABLE esign_templates ADD COLUMN IF NOT EXISTS roles JSONB DEFAULT '[]'`,
    `ALTER TABLE esign_templates ADD COLUMN IF NOT EXISTS signing_order VARCHAR(50) DEFAULT 'parallel'`,
  ];
  for (const q of alterQueries) {
    try { await pool.query(q); } catch (_) { /* column already exists */ }
  }
}
initEsignTables().catch(console.error);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    (req.ip ?? 'unknown') ??
    'unknown'
  );
}

function generateSigningToken(): string {
  return uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
}

/**
 * Compute SHA-256 hash chained audit event and insert into audit log.
 * Hash = SHA-256(previousHash + documentId + action + actor + ISO timestamp)
 */
async function auditLog(
  documentId: string,
  action: string,
  actor: string,
  ip?: string,
  signerId?: string | null,
  details?: object
): Promise<void> {
  // Fetch last event hash for this document (for chain)
  const { rows: lastRows } = await pool.query(
    `SELECT event_hash FROM esign_audit_log WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [documentId]
  );
  const prevHash = lastRows[0]?.event_hash ?? '';
  const timestamp = new Date().toISOString();
  const eventHash = crypto
    .createHash('sha256')
    .update(`${prevHash}${documentId}${action}${actor}${timestamp}`)
    .digest('hex');

  await pool.query(
    `INSERT INTO esign_audit_log
       (document_id, signer_id, action, actor, ip_address, details, previous_event_hash, event_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      documentId,
      signerId ?? null,
      action,
      actor,
      ip ?? null,
      details ? JSON.stringify(details) : null,
      prevHash || null,
      eventHash,
    ]
  );
}

async function getTemplateContent(templateId: string): Promise<string> {
  const sys = SYSTEM_TEMPLATES.find((t) => t.id === templateId);
  if (sys) return sys.content;
  const { rows } = await pool.query(`SELECT content FROM esign_templates WHERE id = $1`, [templateId]);
  return rows[0]?.content ?? '';
}

function fillContent(content: string, fieldValues: Record<string, string>): string {
  let filled = content;
  for (const [key, value] of Object.entries(fieldValues)) {
    filled = filled.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value ?? ''));
    if (key === 'facility_name' && value) {
      filled = filled.replace(/\{facility_name_line\}/g, ` at ${value}`);
    }
  }
  filled = filled.replace(/\{facility_name_line\}/g, '');
  filled = filled.replace(/\{[^}]+\}/g, ''); // remove any unfilled placeholders
  return filled;
}

function getUserId(req: Request): string {
  return (req as any).auth?.userId ?? 'unknown';
}

function buildSigningUrl(token: string): string {
  const base = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  return `${base}/sign/${token}`;
}

// Email a signing invitation. Best-effort — returns true on success, false
// on any failure (missing email, Graph misconfigured, network error). The
// caller decides how to surface partial failures; we never throw because a
// failed email must not block a "document sent" status update.
async function emailSigningInvitation(
  signer: { name: string; email: string | null; token: string },
  doc: { title: string; message?: string | null },
  kind: 'invite' | 'reminder' = 'invite',
): Promise<boolean> {
  if (!signer.email) return false;
  const url = buildSigningUrl(signer.token);
  const subject = kind === 'reminder'
    ? `Reminder: please sign "${doc.title}"`
    : `Action required: sign "${doc.title}"`;
  const intro = kind === 'reminder'
    ? `This is a friendly reminder to sign <strong>${doc.title}</strong>.`
    : `You have been requested to sign <strong>${doc.title}</strong>.`;
  const message = doc.message ? `<p style="font-style:italic;color:#555">"${doc.message}"</p>` : '';
  const body = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:560px">
      <p>Hi ${signer.name},</p>
      <p>${intro}</p>
      ${message}
      <p style="margin:24px 0">
        <a href="${url}" style="background:#1565c0;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Open &amp; Sign</a>
      </p>
      <p style="font-size:12px;color:#666">If the button doesn't work, copy this link into your browser:<br/><a href="${url}">${url}</a></p>
      <p style="font-size:11px;color:#888;margin-top:24px">This signing link is unique to you. Do not forward.</p>
    </div>
  `;
  try {
    await sendEmail(signer.email, subject, body);
    return true;
  } catch (err) {
    console.error(`[esign] Failed to email signer ${signer.email}:`, err);
    return false;
  }
}

// ─── TEMPLATES ────────────────────────────────────────────────────────────────

// GET /esign/templates — list all (system + custom from DB)
router.get('/templates', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows: customTemplates } = await pool.query(
      `SELECT id, name, category, description, fields, is_system, is_active, created_by,
              file_path, roles, signing_order, created_at, updated_at
       FROM esign_templates WHERE is_active = true ORDER BY category, name`
    );

    const systemList = SYSTEM_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      fields: t.fields,
      // Roles are part of the system-template definition (see
      // services/esignService.ts). Default to the org-wide DEFAULT
      // for any system template that hasn't been migrated yet.
      roles: (t as any).roles ?? DEFAULT_TEMPLATE_ROLES,
      signing_order: (t as any).signing_order ?? 'parallel',
      file_path: null,
      is_system: true,
      is_active: true,
      created_by: null,
      created_at: null,
      updated_at: null,
    }));

    res.json({ templates: [...systemList, ...customTemplates] });
  } catch (err: any) {
    console.error('GET /templates error:', err);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

// GET /esign/templates/:id — get single with content
router.get('/templates/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const sys = SYSTEM_TEMPLATES.find((t) => t.id === id);
    if (sys) {
      return res.json({
        template: {
          ...sys,
          is_system: true,
          roles: (sys as any).roles ?? DEFAULT_TEMPLATE_ROLES,
          signing_order: (sys as any).signing_order ?? 'parallel',
          file_path: null,
        },
      });
    }

    const { rows } = await pool.query(`SELECT * FROM esign_templates WHERE id = $1 AND is_active = true`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err: any) {
    console.error('GET /templates/:id error:', err);
    res.status(500).json({ error: 'Failed to load template' });
  }
});

// POST /esign/templates — create custom template
router.post('/templates', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, category, description, content, fields, roles, signing_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const userId = getUserId(req);

    // Validate roles up front. New templates default to the org-wide
    // role set ([HR, Candidate]) if the caller didn't pass any —
    // matches the editor's "starts with the defaults" UX.
    const rolesIn = roles === undefined ? DEFAULT_TEMPLATE_ROLES : roles;
    const rolesV = validateRoles(rolesIn);
    if (isRolesValidationErr(rolesV)) return res.status(400).json({ error: rolesV.message });
    const so = signing_order ?? 'parallel';
    if (!isSigningOrder(so)) return res.status(400).json({ error: `signing_order must be one of: ${SIGNING_ORDER_VALUES.join(', ')}` });

    const { rows } = await pool.query(
      `INSERT INTO esign_templates
         (name, category, description, content, fields, is_system, created_by, roles, signing_order)
       VALUES ($1, $2, $3, $4, $5, false, $6, $7::jsonb, $8) RETURNING *`,
      [name, category ?? 'Custom', description ?? '', content ?? '',
       JSON.stringify(fields ?? []), userId,
       JSON.stringify(rolesV.roles), so]
    );
    res.status(201).json({ template: rows[0] });
  } catch (err: any) {
    console.error('POST /templates error:', err);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT /esign/templates/:id — update custom (block system)
router.put('/templates/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (SYSTEM_TEMPLATES.find((t) => t.id === id)) {
      return res.status(400).json({ error: 'Cannot edit system templates. Duplicate it first.' });
    }
    const { name, category, description, content, fields, is_active, roles, signing_order } = req.body;

    let rolesJson: string | null = null;
    if (roles !== undefined) {
      const rolesV = validateRoles(roles);
      if (isRolesValidationErr(rolesV)) return res.status(400).json({ error: rolesV.message });
      rolesJson = JSON.stringify(rolesV.roles);
    }
    if (signing_order !== undefined && !isSigningOrder(signing_order)) {
      return res.status(400).json({ error: `signing_order must be one of: ${SIGNING_ORDER_VALUES.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE esign_templates
       SET name=COALESCE($1,name), category=COALESCE($2,category), description=COALESCE($3,description),
           content=COALESCE($4,content), fields=COALESCE($5,fields),
           is_active=COALESCE($6,is_active),
           roles=COALESCE($8::jsonb, roles),
           signing_order=COALESCE($9, signing_order),
           updated_at=NOW()
       WHERE id=$7 AND is_active=true RETURNING *`,
      [name, category, description, content,
       fields ? JSON.stringify(fields) : null, is_active, id,
       rolesJson, signing_order ?? null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err: any) {
    console.error('PUT /templates/:id error:', err);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// DELETE /esign/templates/:id — soft delete custom
router.delete('/templates/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (SYSTEM_TEMPLATES.find((t) => t.id === id)) {
      return res.status(400).json({ error: 'Cannot delete system templates.' });
    }
    const { rowCount } = await pool.query(
      `UPDATE esign_templates SET is_active=false, updated_at=NOW() WHERE id=$1`,
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /templates/:id error:', err);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// POST /esign/templates/:id/duplicate — clone a template
router.post('/templates/:id/duplicate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    let tmpl: any = SYSTEM_TEMPLATES.find((t) => t.id === id);
    if (!tmpl) {
      const { rows } = await pool.query(`SELECT * FROM esign_templates WHERE id=$1 AND is_active=true`, [id]);
      tmpl = rows[0];
    }
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });

    const dupRoles = (tmpl as any).roles ?? DEFAULT_TEMPLATE_ROLES;
    const dupSigningOrder = (tmpl as any).signing_order ?? 'parallel';

    const { rows } = await pool.query(
      `INSERT INTO esign_templates (name, category, description, content, fields, is_system, created_by, roles, signing_order)
       VALUES ($1, $2, $3, $4, $5, false, $6, $7::jsonb, $8) RETURNING *`,
      [
        `${tmpl.name} (Copy)`,
        tmpl.category,
        tmpl.description ?? '',
        tmpl.content ?? '',
        JSON.stringify(tmpl.fields ?? []),
        userId,
        JSON.stringify(dupRoles),
        dupSigningOrder,
      ]
    );
    res.status(201).json({ template: rows[0] });
  } catch (err: any) {
    console.error('POST /templates/:id/duplicate error:', err);
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

// POST /esign/templates/:id/upload-file — attach a PDF to a custom template.
//
// Templates that bundle a PDF mean the visual field-placement
// experience (stage 2) starts from the same canvas every time a
// document is built. The PDF is stored next to docs in
// ESIGN_UPLOAD_DIR; subsequent doc creations either copy it or
// reference it depending on the workflow.
//
// System templates remain content-text only — they're managed in
// code (services/esignService.ts) and shouldn't accept user uploads.
router.post('/templates/:id/upload-file', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    if (SYSTEM_TEMPLATES.find((t) => t.id === id)) {
      // Reject and clean up the temp upload — system templates are
      // code-defined and don't accept user uploads.
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch { /* best effort */ }
      }
      return res.status(400).json({ error: 'Cannot upload a file to a system template. Duplicate it first.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (multipart field name: "file")' });
    if (req.file.size === 0) {
      try { fs.unlinkSync(req.file.path); } catch { /* */ }
      return res.status(422).json({ error: 'File is empty (0 bytes). Please re-upload.' });
    }

    // Resolve to a stable path the file-serve endpoint can find.
    const stored = path.relative(process.cwd(), req.file.path);
    const { rows } = await pool.query(
      `UPDATE esign_templates
         SET file_path = $1, updated_at = NOW()
       WHERE id = $2 AND is_active = true
       RETURNING *`,
      [stored, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err: any) {
    console.error('POST /templates/:id/upload-file error:', err);
    res.status(500).json({ error: 'Failed to attach file to template' });
  }
});

// GET /esign/templates/:id/file — serve the PDF attached to a template.
// Mirrors GET /documents/:id/file's path-resolution heuristics so a move
// from ephemeral cwd/uploads to ESIGN_UPLOAD_DIR doesn't orphan stored
// templates.
router.get('/templates/:id/file', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (SYSTEM_TEMPLATES.find((t) => t.id === id)) {
      return res.status(404).json({ error: 'System templates do not have an attached PDF.' });
    }
    const { rows } = await pool.query(
      `SELECT name, file_path FROM esign_templates WHERE id=$1 AND is_active=true`,
      [id]
    );
    const tmpl = rows[0];
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });
    if (!tmpl.file_path) return res.status(404).json({ error: 'No file uploaded for this template' });

    const filename = path.basename(tmpl.file_path);
    const candidates = [
      path.isAbsolute(tmpl.file_path) ? tmpl.file_path : null,
      path.join(process.cwd(), tmpl.file_path.replace(/^\//, '')),
      path.join(uploadDir, filename),
    ].filter((p): p is string => !!p);
    const absPath = candidates.find((p) => fs.existsSync(p));
    if (!absPath) {
      return res.status(404).json({
        error: `Template file not found on disk. (tried: ${candidates.join(', ')})`,
      });
    }
    const ext = path.extname(tmpl.file_path) || '.pdf';
    const safeName = (tmpl.name ?? 'template').replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}${ext}"`);
    res.sendFile(absPath);
  } catch (err: any) {
    console.error('GET /templates/:id/file error:', err);
    res.status(500).json({ error: 'Failed to serve template file' });
  }
});

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────

// POST /esign/documents/upload — upload file, create draft document record
// NOTE: must be defined BEFORE /documents/:id to avoid route conflict
router.post(
  '/documents/upload',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const userId = getUserId(req);
      const { title } = req.body;
      const filePath = `/uploads/esign/${req.file.filename}`;

      const { rows: [doc] } = await pool.query(
        `INSERT INTO esign_documents (title, file_path, status, created_by)
         VALUES ($1, $2, 'draft', $3) RETURNING *`,
        [title ?? req.file.originalname, filePath, userId]
      );

      await auditLog(doc.id, 'document_uploaded', userId, getClientIp(req), null, {
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });

      res.status(201).json({
        document: doc,
        file: {
          originalName: req.file.originalname,
          path: filePath,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (err: any) {
      console.error('POST /documents/upload error:', err);
      res.status(500).json({ error: err.message ?? 'Upload failed' });
    }
  }
);

// GET /esign/documents — list with signers joined (filter: status, staff_id, search)
router.get('/documents', requireAuth, async (req: Request, res: Response) => {
  try {
    const { status, staff_id, search } = req.query;
    const params: any[] = [];
    let where = 'WHERE 1=1';
    if (status) { params.push(status); where += ` AND d.status = $${params.length}`; }
    if (staff_id) { params.push(staff_id); where += ` AND d.staff_id = $${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (d.title ILIKE $${params.length} OR d.created_by ILIKE $${params.length})`;
    }

    const { rows } = await pool.query(
      `SELECT d.id, d.title, d.template_id, d.status, d.created_by, d.staff_id,
              d.signing_order, d.message, d.file_path, d.signed_file_path,
              d.created_at, d.updated_at, d.completed_at, d.expires_at, d.voided_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', s.id, 'name', s.name, 'email', s.email, 'role', s.role,
                    'status', s.status, 'order_index', s.order_index,
                    'signed_at', s.signed_at, 'viewed_at', s.viewed_at, 'token', s.token
                  ) ORDER BY s.order_index
                ) FILTER (WHERE s.id IS NOT NULL), '[]'
              ) AS signers
       FROM esign_documents d
       LEFT JOIN esign_signers s ON s.document_id = d.id
       ${where}
       GROUP BY d.id ORDER BY d.created_at DESC`,
      params
    );
    res.json({ documents: rows });
  } catch (err: any) {
    console.error('GET /documents error:', err);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

// POST /esign/documents — create document (with signers array, fields optional).
//
// Accepts EITHER:
//   - `signers: [{ name, email, role, ... }]` — legacy direct list,
//     used by ad-hoc uploads where there are no role definitions.
//   - `role_signers: { hr: { name, email, auth_method }, candidate: {...} }`
//     — new role-mapping mode used when the template defines roles.
//     The backend resolves the template's roles, sorts them by
//     role.order, and creates one esign_signers row per role with
//     order_index inherited from the role. signing_order on the doc
//     defaults to the template's signing_order if not specified.
router.post('/documents', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      template_id, title, field_values, signers, role_signers, fields,
      staff_id, expires_days, signing_order, message,
    } = req.body as Record<string, any>;

    if (!title) return res.status(400).json({ error: 'title is required' });
    const userId = getUserId(req);

    // Validate template if provided AND grab its roles + signing_order
    // for the role-mapping mode below.
    let templateRoles: TemplateRole[] = [];
    let templateSigningOrder: string | null = null;
    if (template_id) {
      const sys = SYSTEM_TEMPLATES.find((t) => t.id === template_id);
      if (sys) {
        templateRoles = ((sys as any).roles ?? DEFAULT_TEMPLATE_ROLES) as TemplateRole[];
        templateSigningOrder = (sys as any).signing_order ?? 'parallel';
      } else {
        const { rows } = await pool.query<{ id: string; roles: TemplateRole[] | null; signing_order: string | null }>(
          `SELECT id, roles, signing_order FROM esign_templates WHERE id=$1 AND is_active=true`,
          [template_id]
        );
        if (!rows[0]) return res.status(400).json({ error: 'Template not found' });
        templateRoles = Array.isArray(rows[0].roles) ? rows[0].roles : [];
        templateSigningOrder = rows[0].signing_order;
      }
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (Number(expires_days) || 30));

    // Doc-level signing_order falls back to the template's, then to
    // 'parallel' if neither is set.
    const effSigningOrder = signing_order ?? templateSigningOrder ?? 'parallel';

    const { rows: [doc] } = await pool.query(
      `INSERT INTO esign_documents
         (template_id, title, field_values, status, staff_id, created_by, signing_order, message, expires_at)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8) RETURNING *`,
      [
        template_id ?? null,
        title,
        JSON.stringify(field_values ?? {}),
        staff_id ?? null,
        userId,
        effSigningOrder,
        message ?? null,
        expiresAt,
      ]
    );

    await auditLog(doc.id, 'document_created', userId, getClientIp(req));

    // Create signers — role-mapping path takes precedence when available.
    const createdSigners: any[] = [];

    if (role_signers && typeof role_signers === 'object' && templateRoles.length > 0) {
      // Role-based path: one signer per template role, ordered by role.order.
      const sortedRoles = [...templateRoles].sort((a, b) => a.order - b.order);
      const missing: string[] = [];
      for (const role of sortedRoles) {
        const m = role_signers[role.key];
        if (!m || typeof m !== 'object' || !m.name) {
          missing.push(role.label);
          continue;
        }
        const token = generateSigningToken();
        const { rows: [s] } = await pool.query(
          `INSERT INTO esign_signers
             (document_id, name, email, role, order_index, group_id, token, auth_method)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            doc.id, m.name, m.email ?? null,
            role.key,                 // store role.key in the signer.role column
            role.order,               // sequential ordering inherited from role
            null, token,
            m.auth_method ?? 'email_link',
          ]
        );
        createdSigners.push(s);
      }
      if (missing.length > 0) {
        // Roll back the doc — we won't ship a half-mapped document.
        await pool.query(`DELETE FROM esign_documents WHERE id=$1`, [doc.id]);
        return res.status(400).json({
          error: 'incomplete_role_mapping',
          message: `Missing signer(s) for role(s): ${missing.join(', ')}.`,
          missing_roles: missing,
        });
      }
    } else {
      // Legacy direct-signers path.
      for (let i = 0; i < (signers ?? []).length; i++) {
        const signer = signers[i];
        if (!signer.name) continue;
        const token = generateSigningToken();
        const { rows: [s] } = await pool.query(
          `INSERT INTO esign_signers
             (document_id, name, email, role, order_index, group_id, token, auth_method)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            doc.id, signer.name, signer.email ?? null,
            signer.role ?? 'signer', signer.order_index ?? i,
            signer.group_id ?? null, token, signer.auth_method ?? 'email_link',
          ]
        );
        createdSigners.push(s);
      }
    }

    // Create fields if provided
    const createdFields: any[] = [];
    if (Array.isArray(fields) && fields.length > 0) {
      for (const f of fields) {
        const matchedSigner = createdSigners.find(
          (s) => s.email === f.signer_email || s.name === f.signer_name
        );
        const { rows: [field] } = await pool.query(
          `INSERT INTO esign_fields
             (document_id, signer_id, field_type, page, x, y, width, height,
              label, placeholder, instructions, required, read_only, value, options, validation, conditional_logic)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
          [
            doc.id, matchedSigner?.id ?? null, f.field_type ?? 'signature',
            f.page ?? 1, f.x ?? 0, f.y ?? 0, f.width ?? 200, f.height ?? 40,
            f.label ?? null, f.placeholder ?? null, f.instructions ?? null,
            f.required !== false, f.read_only ?? false, f.value ?? null,
            f.options ? JSON.stringify(f.options) : null,
            f.validation ? JSON.stringify(f.validation) : null,
            f.conditional_logic ? JSON.stringify(f.conditional_logic) : null,
          ]
        );
        createdFields.push(field);
      }
    }

    const signersWithUrls = createdSigners.map((s) => ({
      ...s,
      signing_url: buildSigningUrl(s.token),
    }));

    res.status(201).json({ document: doc, signers: signersWithUrls, fields: createdFields });
  } catch (err: any) {
    console.error('POST /documents error:', err);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

// GET /esign/documents/:id — get single with signers + fields + audit (last 20)
router.get('/documents/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rows: [doc] } = await pool.query(
      `SELECT d.*,
              COALESCE(
                json_agg(DISTINCT jsonb_build_object(
                  'id', s.id, 'name', s.name, 'email', s.email, 'role', s.role,
                  'status', s.status, 'order_index', s.order_index, 'group_id', s.group_id,
                  'auth_method', s.auth_method, 'signed_at', s.signed_at, 'viewed_at', s.viewed_at,
                  'declined_at', s.declined_at, 'decline_reason', s.decline_reason,
                  'reminder_count', s.reminder_count, 'last_reminder_at', s.last_reminder_at,
                  'token', s.token
                )) FILTER (WHERE s.id IS NOT NULL), '[]'
              ) AS signers
       FROM esign_documents d
       LEFT JOIN esign_signers s ON s.document_id = d.id
       WHERE d.id=$1 GROUP BY d.id`,
      [id]
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const { rows: fields } = await pool.query(
      `SELECT * FROM esign_fields WHERE document_id=$1 ORDER BY page, y, x`,
      [id]
    );
    const { rows: auditRows } = await pool.query(
      `SELECT id, action, actor, ip_address, details, event_hash, previous_event_hash, created_at
       FROM esign_audit_log WHERE document_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [id]
    );

    res.json({ document: doc, fields, auditLog: auditRows.reverse() });
  } catch (err: any) {
    console.error('GET /documents/:id error:', err);
    res.status(500).json({ error: 'Failed to load document' });
  }
});

// PUT /esign/documents/:id — update title/message/expires/status/correction_reason
router.put('/documents/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, message, expires_at, signing_order, field_values, status, correction_reason } = req.body;
    const userId = getUserId(req);

    const { rows } = await pool.query(
      `UPDATE esign_documents
       SET title=COALESCE($1,title), message=COALESCE($2,message),
           expires_at=COALESCE($3,expires_at), signing_order=COALESCE($4,signing_order),
           field_values=COALESCE($5,field_values),
           status=COALESCE($6,status),
           correction_reason=COALESCE($7,correction_reason),
           updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [
        title ?? null,
        message ?? null,
        expires_at ?? null,
        signing_order ?? null,
        field_values ? JSON.stringify(field_values) : null,
        status ?? null,
        correction_reason ?? null,
        id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Document not found' });

    // Write audit trail for status transitions
    if (status === 'approved') {
      await auditLog(id, 'document_approved', userId, getClientIp(req), null, {
        approved_by: userId,
      });
    } else if (status === 'needs_correction') {
      await auditLog(id, 'sent_back_for_correction', userId, getClientIp(req), null, {
        reason: correction_reason ?? '',
        sent_back_by: userId,
      });
    }

    res.json({ document: rows[0] });
  } catch (err: any) {
    console.error('PUT /documents/:id error:', err);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// POST /esign/documents/:id/send — change status to 'sent', return signing URLs
router.post('/documents/:id/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    const { rows: [doc] } = await pool.query(
      `UPDATE esign_documents SET status='sent', updated_at=NOW() WHERE id=$1 AND status='draft' RETURNING *`,
      [id]
    );
    if (!doc) {
      return res.status(400).json({ error: 'Document not found or is not in draft status' });
    }

    const { rows: signers } = await pool.query(
      `SELECT * FROM esign_signers WHERE document_id=$1 ORDER BY order_index`,
      [id]
    );

    await auditLog(id, 'document_sent', userId, getClientIp(req), null, {
      signerCount: signers.length,
      signing_order: doc.signing_order,
    });

    // Email signers with their signing link. For sequential signing, only
    // notify the first signer — the rest are notified as each prior signer
    // completes (handled in the signature submission flow). For parallel
    // signing, notify everyone immediately.
    const sequential = doc.signing_order === 'sequential';
    const toNotify = sequential ? signers.slice(0, 1) : signers;
    const emailResults = await Promise.all(
      toNotify.map((s) =>
        emailSigningInvitation(
          { name: s.name, email: s.email, token: s.token },
          { title: doc.title, message: doc.message },
          'invite',
        ).then((ok) => ({ id: s.id, email: s.email, sent: ok }))
      )
    );
    const emailsSent = emailResults.filter((r) => r.sent).length;
    const emailsFailed = emailResults.length - emailsSent;
    if (emailsSent > 0) {
      await auditLog(id, 'invitation_emailed', userId, getClientIp(req), null, {
        sent: emailsSent, failed: emailsFailed,
      });
    }

    const signersWithUrls = signers.map((s) => ({
      ...s,
      signing_url: buildSigningUrl(s.token),
    }));

    res.json({
      document: doc,
      signers: signersWithUrls,
      emails_sent: emailsSent,
      emails_failed: emailsFailed,
      message: emailsFailed > 0
        ? `Document sent. ${emailsSent} of ${emailResults.length} invitation emails delivered; share the links below for the rest.`
        : `Document sent and ${emailsSent} invitation${emailsSent === 1 ? '' : 's'} emailed.`,
    });
  } catch (err: any) {
    console.error('POST /documents/:id/send error:', err);
    res.status(500).json({ error: 'Failed to send document' });
  }
});

// POST /esign/documents/:id/void — void with reason
router.post('/documents/:id/void', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = getUserId(req);

    const { rows: [doc] } = await pool.query(
      `UPDATE esign_documents
       SET status='voided', voided_at=NOW(), void_reason=$1, updated_at=NOW()
       WHERE id=$2 AND status NOT IN ('completed','voided') RETURNING *`,
      [reason ?? 'Voided by administrator', id]
    );
    if (!doc) {
      return res.status(400).json({ error: 'Document not found or cannot be voided' });
    }
    await auditLog(id, 'document_voided', userId, getClientIp(req), null, { reason: reason ?? 'Voided by administrator' });
    res.json({ success: true, document: doc });
  } catch (err: any) {
    console.error('POST /documents/:id/void error:', err);
    res.status(500).json({ error: 'Failed to void document' });
  }
});

// POST /esign/documents/:id/remind-all — return signing URLs for all pending signers
router.post('/documents/:id/remind-all', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    const { rows: signers } = await pool.query(
      `SELECT id, name, email, token, order_index FROM esign_signers
       WHERE document_id=$1 AND status IN ('pending','viewed') ORDER BY order_index`,
      [id]
    );

    if (signers.length === 0) {
      return res.json({ pendingSigners: [], emails_sent: 0, message: 'No pending signers found' });
    }

    // Bump reminder count
    await pool.query(
      `UPDATE esign_signers SET reminder_count=reminder_count+1, last_reminder_at=NOW()
       WHERE document_id=$1 AND status IN ('pending','viewed')`,
      [id]
    );

    // Look up the document title/message so the reminder email has context.
    const { rows: [docRow] } = await pool.query(
      `SELECT title, message FROM esign_documents WHERE id=$1`,
      [id]
    );
    const docInfo = { title: docRow?.title ?? 'Document', message: docRow?.message ?? null };

    const emailResults = await Promise.all(
      signers.map((s) =>
        emailSigningInvitation(
          { name: s.name, email: s.email, token: s.token },
          docInfo,
          'reminder',
        ).then((ok) => ({ id: s.id, sent: ok }))
      )
    );
    const emailsSent = emailResults.filter((r) => r.sent).length;

    await auditLog(id, 'reminder_sent', userId, getClientIp(req), null, {
      count: signers.length,
      emails_sent: emailsSent,
    });

    const pendingSigners = signers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      order_index: s.order_index,
      signing_url: buildSigningUrl(s.token),
    }));

    // Return as both `signers` and `pendingSigners` for frontend compatibility
    res.json({
      signers: pendingSigners,
      pendingSigners,
      emails_sent: emailsSent,
      message: emailsSent > 0
        ? `Reminders emailed to ${emailsSent} of ${signers.length} pending signers.`
        : 'Share these signing links with pending signers',
    });
  } catch (err: any) {
    console.error('POST /documents/:id/remind-all error:', err);
    res.status(500).json({ error: 'Failed to get signing links' });
  }
});

// GET /esign/documents/:id/audit — full audit trail
router.get('/documents/:id/audit', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, s.name as signer_name
       FROM esign_audit_log a
       LEFT JOIN esign_signers s ON s.id = a.signer_id
       WHERE a.document_id=$1 ORDER BY a.created_at ASC`,
      [req.params.id]
    );
    res.json({ auditLog: rows });
  } catch (err: any) {
    console.error('GET /documents/:id/audit error:', err);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});

// GET /esign/documents/:id/download — download signed PDF
router.get('/documents/:id/download', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows: [doc] } = await pool.query(
      `SELECT title, signed_file_path FROM esign_documents WHERE id=$1`,
      [req.params.id]
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.signed_file_path) return res.status(404).json({ error: 'Signed PDF not yet available' });

    const absPath = path.join(process.cwd(), doc.signed_file_path.replace(/^\//, ''));
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Signed file not found on disk' });

    const safeName = (doc.title ?? 'document').replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_signed.pdf"`);
    res.sendFile(absPath);
  } catch (err: any) {
    console.error('GET /documents/:id/download error:', err);
    res.status(500).json({ error: 'Failed to download document' });
  }
});

// GET /esign/documents/:id/file — serve original uploaded file (for field editor)
router.get('/documents/:id/file', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows: [doc] } = await pool.query(
      `SELECT title, file_path FROM esign_documents WHERE id=$1`,
      [req.params.id]
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.file_path) return res.status(404).json({ error: 'No file uploaded for this document' });

    // Try multiple candidate paths so moving from ephemeral cwd/uploads
    // to a persistent ESIGN_UPLOAD_DIR doesn't orphan every existing doc.
    // Also accepts the stored path directly if it's already absolute.
    const filename = path.basename(doc.file_path);
    const candidates = [
      path.isAbsolute(doc.file_path) ? doc.file_path : null,
      path.join(process.cwd(), doc.file_path.replace(/^\//, '')),
      path.join(uploadDir, filename),
    ].filter((p): p is string => !!p);

    const absPath = candidates.find((p) => fs.existsSync(p));
    if (!absPath) {
      return res.status(404).json({
        error: `File not found on disk. Original upload may have been wiped by an ephemeral filesystem reset. Re-upload the PDF via + New Document. (tried: ${candidates.join(', ')})`,
      });
    }

    const extMimeMap: Record<string, string> = {
      '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    };
    const mime = extMimeMap[path.extname(doc.file_path).toLowerCase()] ?? 'application/octet-stream';
    const safeName = (doc.title ?? 'document').replace(/[^a-z0-9]/gi, '_');
    const ext = path.extname(doc.file_path) || '.pdf';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}${ext}"`);
    res.sendFile(absPath);
  } catch (err: any) {
    console.error('GET /documents/:id/file error:', err);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// POST /esign/documents/:id/fields — bulk replace all fields
router.post('/documents/:id/fields', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { fields } = req.body;
    if (!Array.isArray(fields)) return res.status(400).json({ error: 'fields must be an array' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM esign_fields WHERE document_id=$1`, [id]);

      const created: any[] = [];
      for (const f of fields) {
        // Accept both naming conventions: page_number/x_percent (from field editor) and page/x (legacy)
        const pageVal    = f.page_number   ?? f.page   ?? 1;
        const xVal       = f.x_percent     ?? f.x      ?? 0;
        const yVal       = f.y_percent     ?? f.y      ?? 0;
        const widthVal   = f.width_percent ?? f.width  ?? 20;
        const heightVal  = f.height_percent ?? f.height ?? 5;

        const { rows: [field] } = await client.query(
          `INSERT INTO esign_fields
             (document_id, signer_id, field_type, page, x, y, width, height,
              label, placeholder, instructions, required, read_only, value, options, validation, conditional_logic)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
          [
            id, f.signer_id ?? null, f.field_type ?? 'signature',
            pageVal, xVal, yVal, widthVal, heightVal,
            f.label ?? null, f.placeholder ?? null, f.instructions ?? null,
            f.required !== false, f.read_only ?? false, f.value ?? null,
            f.options ? JSON.stringify(f.options) : null,
            f.validation ? JSON.stringify(f.validation) : null,
            f.conditional_logic ? JSON.stringify(f.conditional_logic) : null,
          ]
        );
        // Return with percent-named aliases so frontend can read them back
        created.push({ ...field, page_number: field.page, x_percent: field.x, y_percent: field.y, width_percent: field.width, height_percent: field.height });
      }
      await client.query('COMMIT');
      res.json({ fields: created });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('POST /documents/:id/fields error:', err);
    res.status(500).json({ error: 'Failed to update fields' });
  }
});

// GET /esign/documents/:id/fields — get all fields
router.get('/documents/:id/fields', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, s.name as signer_name, s.email as signer_email
       FROM esign_fields f
       LEFT JOIN esign_signers s ON s.id = f.signer_id
       WHERE f.document_id=$1 ORDER BY f.page, f.y, f.x`,
      [req.params.id]
    );
    // Return with percent-named aliases so frontend field editor can read them
    const fields = rows.map(f => ({
      ...f,
      page_number: f.page,
      x_percent: f.x,
      y_percent: f.y,
      width_percent: f.width,
      height_percent: f.height,
    }));
    res.json({ fields });
  } catch (err: any) {
    console.error('GET /documents/:id/fields error:', err);
    res.status(500).json({ error: 'Failed to load fields' });
  }
});

// ─── SIGNERS ──────────────────────────────────────────────────────────────────

// POST /esign/documents/:id/signers — add signer
router.post('/documents/:id/signers', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, role, order_index, group_id, auth_method } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const token = generateSigningToken();
    const { rows: [signer] } = await pool.query(
      `INSERT INTO esign_signers
         (document_id, name, email, role, order_index, group_id, token, auth_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, name, email ?? null, role ?? 'signer', order_index ?? 0, group_id ?? null, token, auth_method ?? 'email_link']
    );

    await auditLog(id, 'signer_added', getUserId(req), getClientIp(req), signer.id, { name, email });

    res.status(201).json({ signer: { ...signer, signing_url: buildSigningUrl(token) } });
  } catch (err: any) {
    console.error('POST /documents/:id/signers error:', err);
    res.status(500).json({ error: 'Failed to add signer' });
  }
});

// PUT /esign/documents/:id/signers/:sid — update signer
router.put('/documents/:id/signers/:sid', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id, sid } = req.params;
    const { name, email, role, order_index, group_id } = req.body;
    const { rows } = await pool.query(
      `UPDATE esign_signers
       SET name=COALESCE($1,name), email=COALESCE($2,email), role=COALESCE($3,role),
           order_index=COALESCE($4,order_index), group_id=COALESCE($5,group_id)
       WHERE id=$6 AND document_id=$7 RETURNING *`,
      [name, email, role, order_index, group_id, sid, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Signer not found' });
    res.json({ signer: rows[0] });
  } catch (err: any) {
    console.error('PUT /documents/:id/signers/:sid error:', err);
    res.status(500).json({ error: 'Failed to update signer' });
  }
});

// DELETE /esign/documents/:id/signers/:sid — remove signer (only if not signed)
router.delete('/documents/:id/signers/:sid', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id, sid } = req.params;
    const { rows: [signer] } = await pool.query(
      `SELECT status FROM esign_signers WHERE id=$1 AND document_id=$2`,
      [sid, id]
    );
    if (!signer) return res.status(404).json({ error: 'Signer not found' });
    if (signer.status === 'signed') {
      return res.status(400).json({ error: 'Cannot remove a signer who has already signed' });
    }
    await pool.query(`DELETE FROM esign_signers WHERE id=$1 AND document_id=$2`, [sid, id]);
    await auditLog(id, 'signer_removed', getUserId(req), getClientIp(req), null, { signer_id: sid });
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /documents/:id/signers/:sid error:', err);
    res.status(500).json({ error: 'Failed to remove signer' });
  }
});

// POST /esign/documents/:id/signers/:sid/remind — return signing link for specific signer
router.post('/documents/:id/signers/:sid/remind', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id, sid } = req.params;
    const userId = getUserId(req);

    const { rows: [signer] } = await pool.query(
      `SELECT id, name, email, token, status FROM esign_signers WHERE id=$1 AND document_id=$2`,
      [sid, id]
    );
    if (!signer) return res.status(404).json({ error: 'Signer not found' });
    if (signer.status === 'signed') {
      return res.status(400).json({ error: 'Signer has already signed' });
    }

    await pool.query(
      `UPDATE esign_signers SET reminder_count=reminder_count+1, last_reminder_at=NOW() WHERE id=$1`,
      [sid]
    );
    await auditLog(id, 'reminder_sent', userId, getClientIp(req), sid, { signer_name: signer.name });

    res.json({
      signer: { id: signer.id, name: signer.name, email: signer.email },
      signing_url: buildSigningUrl(signer.token),
    });
  } catch (err: any) {
    console.error('POST /documents/:id/signers/:sid/remind error:', err);
    res.status(500).json({ error: 'Failed to get signing link' });
  }
});

// ─── DOCUMENT FINALIZATION ────────────────────────────────────────────────────

async function finalizeDocument(docId: string, lastSignerId: string, ip: string): Promise<void> {
  const { rows: [doc] } = await pool.query(
    `SELECT * FROM esign_documents WHERE id=$1`,
    [docId]
  );
  if (!doc) return;

  const { rows: allSigners } = await pool.query(
    `SELECT * FROM esign_signers WHERE document_id=$1 ORDER BY order_index`,
    [docId]
  );

  const { rows: auditRows } = await pool.query(
    `SELECT action, actor, created_at FROM esign_audit_log WHERE document_id=$1 ORDER BY created_at ASC`,
    [docId]
  );

  const lastSigner = allSigners.find((s) => s.id === lastSignerId);
  const content = await getTemplateContent(doc.template_id ?? '');

  let signedFilePath: string | null = null;
  try {
    const pdfBytes = await generateSignedPDF({
      title: doc.title,
      content: fillContent(content, doc.field_values ?? {}),
      fieldValues: doc.field_values ?? {},
      signerName: lastSigner?.name ?? 'Unknown',
      signedAt: new Date().toISOString(),
      ipAddress: ip,
      signatureData: lastSigner?.signature_data ?? '',
      signatureType: lastSigner?.signature_type ?? 'draw',
      auditEntries: auditRows.map((r) => ({
        action: r.action,
        actor: r.actor,
        timestamp: new Date(r.created_at).toLocaleString(),
      })),
    });

    const signedFileName = `signed_${docId}_${Date.now()}.pdf`;
    const signedFileFsPath = path.join(signedDir, signedFileName);
    fs.writeFileSync(signedFileFsPath, Buffer.from(pdfBytes));
    signedFilePath = `/uploads/esign/signed/${signedFileName}`;
  } catch (err) {
    console.error('PDF generation failed for document', docId, err);
    // Continue with finalization even if PDF generation fails
  }

  await pool.query(
    `UPDATE esign_documents
     SET status='completed', completed_at=NOW(), signed_file_path=$1, updated_at=NOW()
     WHERE id=$2`,
    [signedFilePath, docId]
  );

  await auditLog(docId, 'document_completed', 'system', ip, null, {
    total_signers: allSigners.length,
    signed_file_path: signedFilePath,
  });
}

// ─── PUBLIC SIGNING ENDPOINTS (no requireAuth) ────────────────────────────────

// GET /esign/sign/:token — get signing page data
router.get('/sign/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const { rows: [signer] } = await pool.query(
      `SELECT s.*, d.id as doc_id, d.title, d.template_id, d.field_values,
              d.status as doc_status, d.expires_at, d.signing_order, d.message
       FROM esign_signers s
       JOIN esign_documents d ON d.id = s.document_id
       WHERE s.token=$1`,
      [token]
    );

    if (!signer) return res.status(404).json({ error: 'signing_link_not_found', message: 'This signing link does not exist or has expired.' });
    if (signer.status === 'signed') return res.status(400).json({ error: 'already_signed', message: 'You have already signed this document.' });
    if (signer.status === 'declined') return res.status(400).json({ error: 'declined', message: 'You have declined this document.' });
    if (signer.doc_status === 'voided') return res.status(400).json({ error: 'voided', message: 'This document has been voided.' });
    if (signer.doc_status === 'completed') return res.status(400).json({ error: 'completed', message: 'This document has already been completed.' });
    if (signer.doc_status !== 'sent') return res.status(400).json({ error: 'not_sent', message: 'This document is not ready for signing.' });
    if (signer.expires_at && new Date(signer.expires_at) < new Date()) {
      return res.status(400).json({ error: 'expired', message: 'This signing link has expired.' });
    }

    // Sequential signing check: only the current turn's signer can sign
    if (signer.signing_order === 'sequential') {
      const { rows: allSigners } = await pool.query(
        `SELECT id, order_index, status FROM esign_signers WHERE document_id=$1 ORDER BY order_index`,
        [signer.doc_id]
      );
      const myIndex = signer.order_index;
      const pendingBefore = allSigners.some(
        (s) => s.order_index < myIndex && s.status !== 'signed'
      );
      if (pendingBefore) {
        return res.json({ waiting_for_previous: true, message: 'Waiting for previous signers to complete.' });
      }
    }

    // Get template content and fields
    const content = await getTemplateContent(signer.template_id ?? '');
    const filledContent = fillContent(content, signer.field_values ?? {});

    const { rows: fields } = await pool.query(
      `SELECT f.* FROM esign_fields f
       WHERE f.document_id=$1 AND (f.signer_id=$2 OR f.signer_id IS NULL)
       ORDER BY f.page, f.y, f.x`,
      [signer.doc_id, signer.id]
    );

    // Mark as viewed if first time
    if (!signer.viewed_at) {
      await pool.query(
        `UPDATE esign_signers SET status='viewed', viewed_at=NOW() WHERE id=$1 AND status='pending'`,
        [signer.id]
      );
      await auditLog(signer.doc_id, 'document_viewed', signer.name, getClientIp(req), signer.id);
    }

    res.json({
      signer: { id: signer.id, name: signer.name, email: signer.email, role: signer.role },
      document: {
        id: signer.doc_id,
        title: signer.title,
        content: filledContent,
        message: signer.message,
        expires_at: signer.expires_at,
      },
      fields,
    });
  } catch (err: any) {
    console.error('GET /sign/:token error:', err);
    res.status(500).json({ error: 'Failed to load signing page' });
  }
});

// POST /esign/sign/:token/consent — record consent accepted
router.post('/sign/:token/consent', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { rows: [signer] } = await pool.query(
      `SELECT s.*, d.id as doc_id FROM esign_signers s
       JOIN esign_documents d ON d.id = s.document_id WHERE s.token=$1`,
      [token]
    );
    if (!signer) return res.status(404).json({ error: 'Invalid signing link' });
    if (signer.status === 'signed') return res.status(400).json({ error: 'Already signed' });

    await auditLog(signer.doc_id, 'consent_accepted', signer.name, getClientIp(req), signer.id, {
      user_agent: req.headers['user-agent'],
    });
    res.json({ success: true, message: 'Consent recorded' });
  } catch (err: any) {
    console.error('POST /sign/:token/consent error:', err);
    res.status(500).json({ error: 'Failed to record consent' });
  }
});

// POST /esign/sign/:token/field/:fieldId — save field value (incremental)
router.post('/sign/:token/field/:fieldId', async (req: Request, res: Response) => {
  try {
    const { token, fieldId } = req.params;
    const { value } = req.body;

    const { rows: [signer] } = await pool.query(
      `SELECT s.id, s.doc_id, s.status FROM esign_signers s
       JOIN esign_documents d ON d.id = s.document_id WHERE s.token=$1`,
      [token]
    );
    if (!signer) return res.status(404).json({ error: 'Invalid signing link' });
    if (signer.status === 'signed') return res.status(400).json({ error: 'Document already signed' });

    // Only allow updating fields belonging to this signer or unassigned fields
    const { rows: [field] } = await pool.query(
      `SELECT id FROM esign_fields WHERE id=$1 AND document_id=$2 AND (signer_id=$3 OR signer_id IS NULL)`,
      [fieldId, signer.doc_id, signer.id]
    );
    if (!field) return res.status(403).json({ error: 'Field not found or not assigned to you' });

    await pool.query(
      `UPDATE esign_fields SET value=$1, updated_at=NOW() WHERE id=$2`,
      [value ?? null, fieldId]
    );

    res.json({ success: true, fieldId });
  } catch (err: any) {
    console.error('POST /sign/:token/field/:fieldId error:', err);
    res.status(500).json({ error: 'Failed to save field value' });
  }
});

// POST /esign/sign/:token/sign — submit all signatures, finalize if last signer
router.post('/sign/:token/sign', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { signature_data, signature_type, typed_name } = req.body;

    if (!signature_data && !typed_name) {
      return res.status(400).json({ error: 'Signature data or typed name is required' });
    }

    const { rows: [signer] } = await pool.query(
      `SELECT s.*, d.id as doc_id, d.title, d.template_id, d.field_values,
              d.status as doc_status, d.expires_at, d.signing_order
       FROM esign_signers s
       JOIN esign_documents d ON d.id = s.document_id WHERE s.token=$1`,
      [token]
    );

    if (!signer) return res.status(404).json({ error: 'Invalid signing link' });
    if (signer.status === 'signed') return res.status(400).json({ error: 'Already signed' });
    if (signer.doc_status === 'voided') return res.status(400).json({ error: 'Document has been voided' });
    if (signer.doc_status !== 'sent') return res.status(400).json({ error: 'Document is not ready for signing' });
    if (signer.expires_at && new Date(signer.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Signing link has expired' });
    }

    // Sequential check
    if (signer.signing_order === 'sequential') {
      const { rows: allSigners } = await pool.query(
        `SELECT order_index, status FROM esign_signers WHERE document_id=$1 ORDER BY order_index`,
        [signer.doc_id]
      );
      const pendingBefore = allSigners.some(
        (s) => s.order_index < signer.order_index && s.status !== 'signed'
      );
      if (pendingBefore) {
        return res.status(400).json({ error: 'waiting_for_previous', message: 'It is not your turn to sign yet.' });
      }
    }

    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] ?? '';

    await pool.query(
      `UPDATE esign_signers
       SET status='signed', signed_at=NOW(), ip_address=$1, user_agent=$2,
           signature_data=$3, signature_type=$4, typed_name=$5
       WHERE id=$6`,
      [ip, ua, signature_data ?? null, signature_type ?? 'draw', typed_name ?? null, signer.id]
    );

    await auditLog(signer.doc_id, 'document_signed', signer.name, ip, signer.id, {
      signature_type: signature_type ?? 'draw',
    });

    // Check if all signers have signed
    const { rows: remaining } = await pool.query(
      `SELECT id FROM esign_signers WHERE document_id=$1 AND status != 'signed'`,
      [signer.doc_id]
    );

    let allSigned = remaining.length === 0;
    if (allSigned) {
      await finalizeDocument(signer.doc_id, signer.id, ip);
    } else if (signer.signing_order === 'sequential') {
      // For sequential signing, the next pending signer wasn't notified at
      // /send time — email them now that it's their turn.
      const { rows: [next] } = await pool.query(
        `SELECT id, name, email, token FROM esign_signers
         WHERE document_id=$1 AND status IN ('pending','viewed')
         ORDER BY order_index ASC LIMIT 1`,
        [signer.doc_id]
      );
      if (next) {
        const { rows: [docRow] } = await pool.query(
          `SELECT title, message FROM esign_documents WHERE id=$1`,
          [signer.doc_id]
        );
        await emailSigningInvitation(
          { name: next.name, email: next.email, token: next.token },
          { title: docRow?.title ?? 'Document', message: docRow?.message ?? null },
          'invite',
        );
      }
    }

    res.json({ success: true, message: 'Document signed successfully. Thank you!', allSigned });
  } catch (err: any) {
    console.error('POST /sign/:token/sign error:', err);
    res.status(500).json({ error: 'Failed to submit signature' });
  }
});

// POST /esign/sign/:token/decline — decline with reason
router.post('/sign/:token/decline', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { reason } = req.body;

    const { rows: [signer] } = await pool.query(
      `SELECT s.*, d.id as doc_id, d.status as doc_status
       FROM esign_signers s
       JOIN esign_documents d ON d.id = s.document_id WHERE s.token=$1`,
      [token]
    );

    if (!signer) return res.status(404).json({ error: 'Invalid signing link' });
    if (signer.status === 'signed') return res.status(400).json({ error: 'Already signed — cannot decline' });
    if (signer.status === 'declined') return res.status(400).json({ error: 'Already declined' });
    if (signer.doc_status === 'voided') return res.status(400).json({ error: 'Document has been voided' });

    const ip = getClientIp(req);
    await pool.query(
      `UPDATE esign_signers SET status='declined', declined_at=NOW(), decline_reason=$1 WHERE id=$2`,
      [reason ?? 'Declined by signer', signer.id]
    );

    await auditLog(signer.doc_id, 'signer_declined', signer.name, ip, signer.id, {
      reason: reason ?? 'Declined by signer',
    });

    // Void the document when a signer declines
    await pool.query(
      `UPDATE esign_documents SET status='voided', voided_at=NOW(), void_reason=$1, updated_at=NOW() WHERE id=$2`,
      [`Declined by ${signer.name}: ${reason ?? 'No reason provided'}`, signer.doc_id]
    );
    await auditLog(signer.doc_id, 'document_voided', 'system', ip, null, {
      reason: `Auto-voided: signer ${signer.name} declined`,
    });

    res.json({ success: true, message: 'You have declined this document.' });
  } catch (err: any) {
    console.error('POST /sign/:token/decline error:', err);
    res.status(500).json({ error: 'Failed to decline document' });
  }
});

// ─── ONLINE FORMS ─────────────────────────────────────────────────────────────

// GET /esign/forms — list company forms
router.get('/forms', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { rows } = await pool.query(
      `SELECT f.*, COUNT(s.id)::int as submission_count_live
       FROM esign_online_forms f
       LEFT JOIN esign_form_submissions s ON s.form_id = f.id
       WHERE f.created_by=$1 OR f.company_id=$1
       GROUP BY f.id ORDER BY f.created_at DESC`,
      [userId]
    );
    res.json({ forms: rows });
  } catch (err: any) {
    console.error('GET /forms error:', err);
    res.status(500).json({ error: 'Failed to load forms' });
  }
});

// POST /esign/forms — create form
router.post('/forms', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      title, template_id, company_id, kiosk_mode,
      requires_password, password, expires_at, max_submissions,
    } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const userId = getUserId(req);

    const shareToken = uuidv4().replace(/-/g, '');
    let passwordHash: string | null = null;
    if (requires_password && password) {
      passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    }

    const { rows: [form] } = await pool.query(
      `INSERT INTO esign_online_forms
         (company_id, created_by, title, template_id, share_token, kiosk_mode,
          requires_password, password_hash, expires_at, max_submissions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        company_id ?? userId, userId, title, template_id ?? null, shareToken,
        kiosk_mode ?? false, requires_password ?? false, passwordHash,
        expires_at ?? null, max_submissions ?? null,
      ]
    );

    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    res.status(201).json({ form: { ...form, share_url: `${baseUrl}/f/${shareToken}` } });
  } catch (err: any) {
    console.error('POST /forms error:', err);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// GET /esign/forms/:id — get form
router.get('/forms/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows: [form] } = await pool.query(
      `SELECT * FROM esign_online_forms WHERE id=$1`,
      [req.params.id]
    );
    if (!form) return res.status(404).json({ error: 'Form not found' });
    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    res.json({ form: { ...form, share_url: `${baseUrl}/f/${form.share_token}` } });
  } catch (err: any) {
    console.error('GET /forms/:id error:', err);
    res.status(500).json({ error: 'Failed to load form' });
  }
});

// PUT /esign/forms/:id — update form
router.put('/forms/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, kiosk_mode, requires_password, expires_at, max_submissions, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE esign_online_forms
       SET title=COALESCE($1,title), kiosk_mode=COALESCE($2,kiosk_mode),
           requires_password=COALESCE($3,requires_password), expires_at=COALESCE($4,expires_at),
           max_submissions=COALESCE($5,max_submissions), is_active=COALESCE($6,is_active), updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [title, kiosk_mode, requires_password, expires_at, max_submissions, is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Form not found' });
    res.json({ form: rows[0] });
  } catch (err: any) {
    console.error('PUT /forms/:id error:', err);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// GET /esign/forms/:id/submissions — list submissions
router.get('/forms/:id/submissions', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM esign_form_submissions WHERE form_id=$1 ORDER BY submitted_at DESC`,
      [req.params.id]
    );
    res.json({ submissions: rows });
  } catch (err: any) {
    console.error('GET /forms/:id/submissions error:', err);
    res.status(500).json({ error: 'Failed to load submissions' });
  }
});

// GET /esign/f/:shareToken — public: get form fields (no auth)
router.get('/f/:shareToken', async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const { password } = req.query;

    const { rows: [form] } = await pool.query(
      `SELECT f.*, t.fields as template_fields, t.content as template_content
       FROM esign_online_forms f
       LEFT JOIN esign_templates t ON t.id::text = f.template_id
       WHERE f.share_token=$1 AND f.is_active=true`,
      [shareToken]
    );

    if (!form) return res.status(404).json({ error: 'Form not found or is no longer active' });
    if (form.expires_at && new Date(form.expires_at) < new Date()) {
      return res.status(400).json({ error: 'expired', message: 'This form has expired.' });
    }
    if (form.max_submissions && form.submission_count >= form.max_submissions) {
      return res.status(400).json({ error: 'full', message: 'This form has reached its maximum submissions.' });
    }
    if (form.requires_password) {
      if (!password) return res.status(401).json({ error: 'password_required', message: 'This form requires a password.' });
      const hash = crypto.createHash('sha256').update(String(password)).digest('hex');
      if (hash !== form.password_hash) {
        return res.status(401).json({ error: 'invalid_password', message: 'Incorrect password.' });
      }
    }

    // Get fields from template or custom fields for this form
    let fields = form.template_fields ?? [];
    // Also check system templates
    if (!fields.length && form.template_id) {
      const sys = SYSTEM_TEMPLATES.find((t) => t.id === form.template_id);
      if (sys) fields = sys.fields;
    }

    res.json({
      form: {
        id: form.id,
        title: form.title,
        kiosk_mode: form.kiosk_mode,
        expires_at: form.expires_at,
      },
      fields,
    });
  } catch (err: any) {
    console.error('GET /f/:shareToken error:', err);
    res.status(500).json({ error: 'Failed to load form' });
  }
});

// POST /esign/f/:shareToken — public: submit form (no auth)
router.post('/f/:shareToken', async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const { submitter_name, submitter_email, field_values, password } = req.body;

    const { rows: [form] } = await pool.query(
      `SELECT * FROM esign_online_forms WHERE share_token=$1 AND is_active=true`,
      [shareToken]
    );

    if (!form) return res.status(404).json({ error: 'Form not found or is no longer active' });
    if (form.expires_at && new Date(form.expires_at) < new Date()) {
      return res.status(400).json({ error: 'expired', message: 'This form has expired.' });
    }
    if (form.max_submissions && form.submission_count >= form.max_submissions) {
      return res.status(400).json({ error: 'full', message: 'This form has reached its maximum submissions.' });
    }
    if (form.requires_password) {
      const hash = crypto.createHash('sha256').update(String(password ?? '')).digest('hex');
      if (hash !== form.password_hash) {
        return res.status(401).json({ error: 'invalid_password', message: 'Incorrect password.' });
      }
    }

    const ip = getClientIp(req);

    // Create a document record for this submission if form has template
    let generatedDocId: string | null = null;
    if (form.template_id) {
      const token = generateSigningToken();
      const { rows: [doc] } = await pool.query(
        `INSERT INTO esign_documents (template_id, title, field_values, status, created_by, signing_order)
         VALUES ($1, $2, $3, 'draft', $4, 'parallel') RETURNING *`,
        [form.template_id, `${form.title} — ${submitter_name ?? 'Anonymous'}`, JSON.stringify(field_values ?? {}), `form:${form.id}`]
      );
      generatedDocId = doc.id;
      // Add submitter as signer
      await pool.query(
        `INSERT INTO esign_signers (document_id, name, email, token) VALUES ($1,$2,$3,$4)`,
        [doc.id, submitter_name ?? 'Anonymous', submitter_email ?? null, token]
      );
      await auditLog(doc.id, 'document_created', `form:${form.id}`, ip, null, {
        source: 'online_form',
        form_id: form.id,
      });
    }

    const { rows: [submission] } = await pool.query(
      `INSERT INTO esign_form_submissions
         (form_id, submitter_name, submitter_email, field_values, generated_document_id, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [form.id, submitter_name ?? null, submitter_email ?? null, JSON.stringify(field_values ?? {}), generatedDocId, ip]
    );

    await pool.query(
      `UPDATE esign_online_forms SET submission_count=submission_count+1, updated_at=NOW() WHERE id=$1`,
      [form.id]
    );

    res.status(201).json({ success: true, submission_id: submission.id, generated_document_id: generatedDocId });
  } catch (err: any) {
    console.error('POST /f/:shareToken error:', err);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

// ─── ANALYTICS ────────────────────────────────────────────────────────────────

// GET /esign/analytics — combined analytics (overview + daily + top templates + slowest)
router.get('/analytics', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Overview — field names match frontend expectations
    const { rows: [ov] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('sent','partially_signed','completed','voided','declined')) as total_sent,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status IN ('sent','partially_signed')) as awaiting,
        COUNT(*) FILTER (WHERE status = 'declined') as declined,
        COUNT(*) FILTER (WHERE status = 'voided') as voided,
        COUNT(*) FILTER (WHERE status = 'draft') as drafts,
        COUNT(*) as total,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'completed')
          / NULLIF(COUNT(*) FILTER (WHERE status IN ('sent','partially_signed','completed','voided','declined')), 0),
          1
        ) as completion_rate,
        ROUND(
          AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)
            FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL),
          1
        ) as avg_hours
      FROM esign_documents
    `);

    // Daily — last 30 days
    const { rows: daily } = await pool.query(`
      WITH days AS (
        SELECT generate_series(
          NOW()::date - INTERVAL '29 days', NOW()::date, '1 day'::interval
        )::date as date
      )
      SELECT
        d.date::text,
        COUNT(DISTINCT doc.id) FILTER (WHERE doc.status IN ('sent','partially_signed','completed','voided')) as sent,
        COUNT(DISTINCT doc.id) FILTER (WHERE doc.status = 'completed') as completed
      FROM days d
      LEFT JOIN esign_documents doc ON doc.created_at::date = d.date
      GROUP BY d.date ORDER BY d.date
    `);

    // Top templates
    const { rows: topTemplates } = await pool.query(`
      SELECT
        template_id,
        COUNT(*) as usage_count,
        ROUND(
          AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)
            FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL), 1
        ) as avg_hours
      FROM esign_documents
      WHERE template_id IS NOT NULL
      GROUP BY template_id ORDER BY usage_count DESC LIMIT 10
    `);

    // Slowest awaiting docs
    const { rows: slowestDocuments } = await pool.query(`
      SELECT id, title,
        ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400) as days_pending
      FROM esign_documents
      WHERE status IN ('sent','partially_signed')
      ORDER BY created_at ASC LIMIT 8
    `);

    res.json({
      overview: ov,
      daily,
      topTemplates,
      slowestDocuments,
    });
  } catch (err: any) {
    console.error('GET /analytics error:', err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// GET /esign/analytics/documents — daily docs sent vs completed (last 30 days)
router.get('/analytics/documents', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      WITH days AS (
        SELECT generate_series(
          NOW()::date - INTERVAL '29 days',
          NOW()::date,
          '1 day'::interval
        )::date as day
      )
      SELECT
        d.day::text,
        COUNT(DISTINCT doc.id) FILTER (WHERE doc.status IN ('sent','completed','voided')) as sent,
        COUNT(DISTINCT doc.id) FILTER (WHERE doc.status = 'completed') as completed
      FROM days d
      LEFT JOIN esign_documents doc ON doc.created_at::date = d.day
      GROUP BY d.day ORDER BY d.day
    `);
    res.json({ daily: rows });
  } catch (err: any) {
    console.error('GET /analytics/documents error:', err);
    res.status(500).json({ error: 'Failed to load document analytics' });
  }
});

// GET /esign/analytics/templates — top templates by usage
router.get('/analytics/templates', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        template_id,
        COUNT(*) as total_uses,
        COUNT(*) FILTER (WHERE status = 'completed') as completions,
        COUNT(*) FILTER (WHERE status = 'voided') as voids,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'completed') / NULLIF(COUNT(*), 0),
          1
        ) as completion_rate
      FROM esign_documents
      WHERE template_id IS NOT NULL
      GROUP BY template_id ORDER BY total_uses DESC LIMIT 20
    `);

    // Enrich with template names
    const enriched = rows.map((r) => {
      const sys = SYSTEM_TEMPLATES.find((t) => t.id === r.template_id);
      return { ...r, template_name: sys?.name ?? r.template_id };
    });

    res.json({ templates: enriched });
  } catch (err: any) {
    console.error('GET /analytics/templates error:', err);
    res.status(500).json({ error: 'Failed to load template analytics' });
  }
});

// ─── STATS ────────────────────────────────────────────────────────────────────

// GET /esign/stats — summary counts by status
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows: [docStats] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'sent') as pending,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'voided') as voided,
        COUNT(*) FILTER (WHERE status = 'draft') as drafts,
        COUNT(*) as total
      FROM esign_documents
    `);

    const { rows: [templateCount] } = await pool.query(
      `SELECT COUNT(*)::int as custom_templates FROM esign_templates WHERE is_active=true`
    );

    const { rows: [signerStats] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending_signatures,
        COUNT(*) FILTER (WHERE status = 'viewed') as viewed,
        COUNT(*) FILTER (WHERE status = 'signed') as signed,
        COUNT(*) FILTER (WHERE status = 'declined') as declined
      FROM esign_signers
    `);

    const { rows: [formStats] } = await pool.query(`
      SELECT COUNT(*)::int as total_forms, SUM(submission_count)::int as total_submissions
      FROM esign_online_forms WHERE is_active=true
    `);

    res.json({
      stats: {
        ...docStats,
        custom_templates: templateCount.custom_templates,
        system_templates: SYSTEM_TEMPLATES.length,
        ...signerStats,
        ...formStats,
      },
    });
  } catch (err: any) {
    console.error('GET /stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;
