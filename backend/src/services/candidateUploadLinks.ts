/**
 * Secure candidate upload links.
 *
 * A recruiter generates a tokenised URL on a candidate's profile and
 * sends it (via SMS or email) to the candidate. The candidate hits
 * /upload/:token (no login), drops files, and the documents land
 * directly on their candidate record. This is the same trust model
 * the eSign module uses for signing tokens — the URL IS the auth.
 *
 * Two tables back this:
 *
 *   candidate_upload_links   — one row per generated link. Tracks
 *                              expiry, max_uses, used_count, revoked_at.
 *                              Cascade-deletes if the candidate is
 *                              deleted, so dangling links never linger.
 *
 *   candidate_document_blobs — bytes for files uploaded through a link.
 *                              Kept in their own table so a generic
 *                              SELECT on candidate_documents never
 *                              accidentally pulls 50MB. Cascade on
 *                              the candidate_documents.id FK.
 *
 * Bytes go straight to PostgreSQL because Railway's filesystem is
 * ephemeral (same constraint that drove esignFileStore.ts).
 */
import crypto from 'crypto';
import { pool } from '../db/client';

let initialized = false;

/** Idempotent — call from candidates router boot. */
export async function initCandidateUploadLinks(): Promise<void> {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_upload_links (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id  UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      token         VARCHAR(64) UNIQUE NOT NULL,
      label         VARCHAR(255),
      created_by    VARCHAR(255),
      expires_at    TIMESTAMPTZ,
      max_uses      INT,
      used_count    INT NOT NULL DEFAULT 0,
      revoked_at    TIMESTAMPTZ,
      last_used_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_candidate_upload_links_token
      ON candidate_upload_links(token)
      WHERE revoked_at IS NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_candidate_upload_links_candidate
      ON candidate_upload_links(candidate_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_document_blobs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES candidate_documents(id) ON DELETE CASCADE,
      filename    VARCHAR(500) NOT NULL,
      mime        VARCHAR(100) NOT NULL,
      size_bytes  INT NOT NULL,
      bytes       BYTEA NOT NULL,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_candidate_document_blobs_doc
      ON candidate_document_blobs(document_id);
  `);
  initialized = true;
}

/**
 * Generate a URL-safe random token. ~43 chars of base64url, ~256
 * bits of entropy — same shape as the eSign signing tokens.
 */
export function generateUploadToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export interface UploadLinkRow {
  id: string;
  candidate_id: string;
  token: string;
  label: string | null;
  created_by: string | null;
  expires_at: Date | null;
  max_uses: number | null;
  used_count: number;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
}

export interface UploadLinkValidity {
  ok: true;
  link: UploadLinkRow;
}
export interface UploadLinkInvalid {
  ok: false;
  reason: 'not_found' | 'revoked' | 'expired' | 'exhausted';
  message: string;
}
export type UploadLinkResult = UploadLinkValidity | UploadLinkInvalid;

// Narrowing predicate — needed because the codebase runs with
// strictNullChecks: false, so a plain `if (!v.ok)` doesn't actually
// narrow the union. Same pattern as services/templateRoles.ts.
export function isUploadLinkInvalid(v: UploadLinkResult): v is UploadLinkInvalid {
  return v.ok === false;
}

/**
 * Look up a link by token and return whether it's currently usable.
 * Centralised so the public GET /uploads/:token (info page) and
 * POST /uploads/:token (file submit) agree on validity.
 */
export async function checkUploadLink(token: string): Promise<UploadLinkResult> {
  const { rows } = await pool.query<UploadLinkRow>(
    `SELECT id, candidate_id, token, label, created_by, expires_at,
            max_uses, used_count, revoked_at, last_used_at, created_at
       FROM candidate_upload_links
      WHERE token = $1`,
    [token]
  );
  const link = rows[0];
  if (!link) return { ok: false, reason: 'not_found', message: 'This upload link is invalid.' };
  if (link.revoked_at) return { ok: false, reason: 'revoked', message: 'This upload link has been revoked.' };
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return { ok: false, reason: 'expired', message: 'This upload link has expired.' };
  }
  if (link.max_uses != null && link.used_count >= link.max_uses) {
    return { ok: false, reason: 'exhausted', message: 'This upload link has reached its use limit.' };
  }
  return { ok: true, link };
}

/**
 * Atomically increment used_count and stamp last_used_at after a
 * successful upload. Treated as best-effort metadata — failure here
 * doesn't roll back the upload itself.
 */
export async function recordUploadLinkUse(linkId: string): Promise<void> {
  await pool.query(
    `UPDATE candidate_upload_links
        SET used_count = used_count + 1,
            last_used_at = NOW()
      WHERE id = $1`,
    [linkId]
  );
}

/** Persist file bytes for a candidate_document. */
export async function saveCandidateDocumentBlob(
  documentId: string,
  filename:   string,
  mime:       string,
  bytes:      Buffer,
): Promise<void> {
  if (!bytes || bytes.length === 0) {
    throw new Error('saveCandidateDocumentBlob: refusing to save empty buffer');
  }
  await pool.query(
    `INSERT INTO candidate_document_blobs (document_id, filename, mime, size_bytes, bytes)
     VALUES ($1, $2, $3, $4, $5)`,
    [documentId, filename, mime, bytes.length, bytes]
  );
}

export interface CandidateDocumentBlob {
  filename: string;
  mime: string;
  bytes: Buffer;
}

/** Returns null when no blob exists. */
export async function loadCandidateDocumentBlob(
  documentId: string,
): Promise<CandidateDocumentBlob | null> {
  const { rows } = await pool.query<{ filename: string; mime: string; bytes: Buffer }>(
    `SELECT filename, mime, bytes
       FROM candidate_document_blobs
      WHERE document_id = $1
      ORDER BY uploaded_at DESC
      LIMIT 1`,
    [documentId]
  );
  if (!rows[0]) return null;
  return rows[0];
}
