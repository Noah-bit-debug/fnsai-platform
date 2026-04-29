/**
 * Tests for the candidate-document approval-trail invariant.
 *
 * Pins QA-audit finding C2: a partial PUT (e.g. updating just `notes`
 * or `expiry_date`) on an approved document used to wipe `approved_at`
 * and `approved_by`, destroying the regulator-readable answer to "who
 * approved this credential and when". The fix re-keys those fields on
 * "is the incoming status NULL?" rather than "is the incoming status
 * not 'approved'?".
 *
 * These tests are pure SQL-CASE logic — we model the route's CASE
 * expressions in JS so they're exercised without a live database.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

// Mirror the SQL CASE expressions in
// backend/src/routes/candidates.ts:560-572. Keeping a JS twin is the
// cheapest way to test the behavior without spinning up Postgres for
// every CI run; a follow-up integration test against a real DB would
// also be welcome but isn't blocking this fix.
function nextApprovalAudit(
  incomingStatus: string | null,
  approver: string | null,
  current: { approved_at: Date | null; approved_by: string | null },
): { approved_at: Date | null; approved_by: string | null } {
  // SQL: CASE WHEN $1 IS NULL THEN approved_at WHEN $1='approved' THEN NOW() ELSE NULL END
  const approved_at: Date | null =
    incomingStatus === null     ? current.approved_at :
    incomingStatus === 'approved' ? new Date()
                                  : null;
  const approved_by: string | null =
    incomingStatus === null     ? current.approved_by :
    incomingStatus === 'approved' ? approver
                                  : null;
  return { approved_at, approved_by };
}

describe('candidate document approval audit-trail (C2)', () => {
  const stamp = new Date('2026-04-01T12:00:00Z');
  const approver = 'user-uuid-001';
  const current = { approved_at: stamp, approved_by: approver };

  test('partial update preserves approved_at and approved_by when status not provided', () => {
    // The QA-audit bug: editing notes on an approved doc wiped these.
    const next = nextApprovalAudit(null, null, current);
    assert.equal(next.approved_at, stamp);
    assert.equal(next.approved_by, approver);
  });

  test('explicit re-approval refreshes both approved_at and approved_by', () => {
    const beforeCall = Date.now();
    const next = nextApprovalAudit('approved', 'user-uuid-002', current);
    const afterCall = Date.now();
    assert.ok(next.approved_at != null);
    assert.ok(next.approved_at!.getTime() >= beforeCall);
    assert.ok(next.approved_at!.getTime() <= afterCall);
    assert.equal(next.approved_by, 'user-uuid-002');
  });

  test('rejection clears approved_at and approved_by', () => {
    const next = nextApprovalAudit('rejected', null, current);
    assert.equal(next.approved_at, null);
    assert.equal(next.approved_by, null);
  });

  test('expired status clears approved_at and approved_by', () => {
    const next = nextApprovalAudit('expired', null, current);
    assert.equal(next.approved_at, null);
    assert.equal(next.approved_by, null);
  });

  test('approve → reject → re-approve produces a new approver stamp', () => {
    const original = nextApprovalAudit('approved', 'user-A', { approved_at: null, approved_by: null });
    const rejected = nextApprovalAudit('rejected', null, original);
    const reApproved = nextApprovalAudit('approved', 'user-B', rejected);
    assert.ok(reApproved.approved_at != null);
    assert.equal(reApproved.approved_by, 'user-B');
  });

  test('partial update on a never-approved doc still preserves NULLs', () => {
    const neverApproved = { approved_at: null, approved_by: null };
    const next = nextApprovalAudit(null, null, neverApproved);
    assert.equal(next.approved_at, null);
    assert.equal(next.approved_by, null);
  });
});
