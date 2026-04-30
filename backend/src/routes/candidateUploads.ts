/**
 * Public candidate upload endpoints.
 *
 * Mounted at /api/v1/uploads — no auth middleware. The token in the
 * URL IS the auth, exactly like the eSign signing endpoints. Hitting
 * a wrong/expired/revoked token returns 404 with a friendly message
 * the public upload page can show without leaking which case it is.
 *
 * Files go straight into PostgreSQL (candidate_document_blobs) so
 * Railway's ephemeral container filesystem can't drop them on a
 * deploy.
 *
 * Recruiter-facing endpoints for generating + revoking links live in
 * routes/candidates.ts so they share the auth middleware and audit
 * helpers already wired up there.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { pool } from '../db/client';
import {
  checkUploadLink,
  isUploadLinkInvalid,
  recordUploadLinkUse,
  saveCandidateDocumentBlob,
} from '../services/candidateUploadLinks';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  // 25 MB per file — generous for IDs, vaccination cards, certs.
  // Bigger than our ATS resume limit (10 MB) because candidates
  // upload phone-camera scans which can be larger.
  limits: { fileSize: 25 * 1024 * 1024 },
});

const ALLOWED_MIMETYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// GET /api/v1/uploads/:token — public landing page metadata.
// Reveals only the candidate's first name so the candidate can
// confirm they got the right link, without exposing PII to anyone
// who finds the URL.
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const v = await checkUploadLink(req.params.token);
    if (isUploadLinkInvalid(v)) return res.status(404).json({ error: v.message });

    const { rows } = await pool.query<{ first_name: string }>(
      `SELECT first_name FROM candidates WHERE id = $1`,
      [v.link.candidate_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'This upload link is invalid.' });

    res.json({
      first_name: rows[0].first_name,
      label: v.link.label,
      expires_at: v.link.expires_at,
      max_uses: v.link.max_uses,
      uses_remaining: v.link.max_uses == null ? null : Math.max(0, v.link.max_uses - v.link.used_count),
    });
  } catch (err) {
    console.error('GET /uploads/:token error:', err);
    res.status(500).json({ error: 'Failed to load upload link.' });
  }
});

// POST /api/v1/uploads/:token — accept a file from the public upload
// page. Re-validates the token before doing anything, so a link that
// expires between the GET and the POST still gets rejected.
router.post('/:token', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const v = await checkUploadLink(req.params.token);
    if (isUploadLinkInvalid(v)) return res.status(404).json({ error: v.message });

    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!req.file.buffer || req.file.buffer.length === 0) {
      return res.status(422).json({ error: 'File is empty.' });
    }
    if (!ALLOWED_MIMETYPES.has(req.file.mimetype)) {
      return res.status(415).json({
        error: 'Unsupported file type. Please upload PDF, JPG, PNG, HEIC, or DOC.',
      });
    }

    const docType = (req.body.document_type as string | undefined)?.trim() || 'uploaded_via_link';
    const label   = (req.body.label as string | undefined)?.trim()
                  || req.file.originalname
                  || 'Uploaded document';

    // Create a candidate_documents row in 'received' status — the
    // recruiter reviews and either approves or rejects from there.
    // required=false because this is candidate-driven, not a
    // checklist item the office demanded.
    const { rows: [doc] } = await pool.query(
      `INSERT INTO candidate_documents
         (candidate_id, document_type, label, status, required, uploaded_at)
       VALUES ($1, $2, $3, 'received', false, NOW())
       RETURNING id`,
      [v.link.candidate_id, docType, label]
    );

    await saveCandidateDocumentBlob(
      doc.id,
      req.file.originalname,
      req.file.mimetype,
      req.file.buffer,
    );

    // Bump used_count last so a failed blob save doesn't burn a use.
    await recordUploadLinkUse(v.link.id);

    res.status(201).json({
      ok: true,
      document_id: doc.id,
      filename: req.file.originalname,
      size: req.file.size,
    });
  } catch (err: any) {
    console.error('POST /uploads/:token error:', err);
    res.status(500).json({ error: err?.message ?? 'Upload failed.' });
  }
});

export default router;
