/**
 * eSign file store — durable BYTEA-backed storage for uploaded PDFs.
 *
 * Why this exists: Railway's container filesystem is ephemeral.
 * Anything written to /uploads/esign/<file>.pdf disappears on the
 * next deploy, which orphaned every previously-uploaded document
 * and produced "File not found on disk. Original upload may have
 * been wiped by an ephemeral filesystem reset" errors in the field
 * editor. PostgreSQL data IS durable, so we store the bytes there.
 *
 * Stored in a separate table (esign_file_blobs) rather than as a
 * column on esign_documents/esign_templates so the megabyte-sized
 * BYTEA never accidentally rides along on a `RETURNING *` or a
 * generic SELECT used by the list/detail routes.
 *
 * Each blob is keyed by `(owner_kind, owner_id, variant)`:
 *   - owner_kind: 'document' | 'template'
 *   - owner_id:   the row id
 *   - variant:    'original' (uploaded PDF) | 'signed' (post-sign PDF)
 *
 * Upserts replace the bytes — a re-upload simply overwrites the
 * previous blob without leaving the old bytes around.
 */
import { pool } from '../db/client';

export type BlobOwnerKind = 'document' | 'template';
export type BlobVariant   = 'original' | 'signed';

export interface BlobMeta {
  mime: string;
  bytes: Buffer;
  size: number;
}

let initialized = false;

/** Idempotent — safe to call from initEsignTables(). */
export async function initEsignFileStore(): Promise<void> {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS esign_file_blobs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_kind  VARCHAR(20)  NOT NULL CHECK (owner_kind IN ('document', 'template')),
      owner_id    UUID         NOT NULL,
      variant     VARCHAR(20)  NOT NULL DEFAULT 'original',
      mime        VARCHAR(100) NOT NULL,
      size_bytes  INT          NOT NULL,
      bytes       BYTEA        NOT NULL,
      created_at  TIMESTAMPTZ  DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  DEFAULT NOW(),
      UNIQUE (owner_kind, owner_id, variant)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_esign_blobs_lookup
      ON esign_file_blobs(owner_kind, owner_id, variant);
  `);
  initialized = true;
}

/**
 * Persist a file blob, replacing any existing blob for the same
 * (kind, id, variant) tuple. Returns size in bytes for audit logging.
 */
export async function saveBlob(
  kind:    BlobOwnerKind,
  id:      string,
  variant: BlobVariant,
  mime:    string,
  bytes:   Buffer,
): Promise<number> {
  if (!bytes || bytes.length === 0) {
    throw new Error('saveBlob: refusing to save empty buffer');
  }
  await pool.query(
    `INSERT INTO esign_file_blobs (owner_kind, owner_id, variant, mime, size_bytes, bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (owner_kind, owner_id, variant)
     DO UPDATE SET mime = EXCLUDED.mime,
                   size_bytes = EXCLUDED.size_bytes,
                   bytes = EXCLUDED.bytes,
                   updated_at = NOW()`,
    [kind, id, variant, mime, bytes.length, bytes]
  );
  return bytes.length;
}

/** Returns null when no blob exists. */
export async function loadBlob(
  kind:    BlobOwnerKind,
  id:      string,
  variant: BlobVariant = 'original',
): Promise<BlobMeta | null> {
  const { rows } = await pool.query<{ mime: string; bytes: Buffer; size_bytes: number }>(
    `SELECT mime, bytes, size_bytes
       FROM esign_file_blobs
      WHERE owner_kind = $1 AND owner_id = $2 AND variant = $3`,
    [kind, id, variant]
  );
  if (!rows[0]) return null;
  return { mime: rows[0].mime, bytes: rows[0].bytes, size: rows[0].size_bytes };
}

/** True iff a blob exists for the given key. Cheap (no bytes pulled). */
export async function hasBlob(
  kind:    BlobOwnerKind,
  id:      string,
  variant: BlobVariant = 'original',
): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM esign_file_blobs
        WHERE owner_kind = $1 AND owner_id = $2 AND variant = $3
     ) AS exists`,
    [kind, id, variant]
  );
  return !!rows[0]?.exists;
}

/** Remove all blobs for an owner (useful when a doc/template is deleted). */
export async function deleteOwnerBlobs(
  kind: BlobOwnerKind,
  id:   string,
): Promise<void> {
  await pool.query(
    `DELETE FROM esign_file_blobs WHERE owner_kind = $1 AND owner_id = $2`,
    [kind, id]
  );
}
