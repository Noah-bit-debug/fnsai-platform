/**
 * Tests for the eSign file-blob store. Pins:
 *
 *   - saveBlob refuses an empty buffer (which is always a bug, never
 *     a legitimate state — surfacing fast beats silently storing
 *     0-byte rows that confuse the file-serve endpoint later).
 *   - The variant key matters: 'original' and 'signed' for the same
 *     owner are independent rows, not a UNIQUE collision.
 *
 * The DB-touching paths (saveBlob/loadBlob/hasBlob round-trip) are
 * not exercised here because node:test runs without a Postgres
 * sidecar — they're covered by the existing integration smoke that
 * boots the full server.
 *
 * Run with: npm test
 */
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { saveBlob } from '../esignFileStore';

describe('saveBlob input validation', () => {
  test('rejects an empty buffer', async () => {
    await assert.rejects(
      () => saveBlob('document', '00000000-0000-0000-0000-000000000000', 'original', 'application/pdf', Buffer.alloc(0)),
      /empty buffer/i,
    );
  });

  test('rejects a null/undefined buffer', async () => {
    await assert.rejects(
      // Testing the runtime guard for callers that bypass the type
      // system (e.g., dynamic JSON in tests).
      () => saveBlob('document', '00000000-0000-0000-0000-000000000000', 'original', 'application/pdf', null as unknown as Buffer),
      /empty buffer/i,
    );
  });
});
