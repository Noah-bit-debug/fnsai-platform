/**
 * Tests for the unified compliance summary builder.
 *
 * Pins the QA fix from the Jordan-Testwell report: a manually-uploaded,
 * approved required document (e.g. a CNA license) now counts toward
 * compliance metrics. Earlier the summary read only competency records,
 * so an approved license never moved the dashboard off "Total: 0".
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildComplianceSummary } from '../compliance/summary';

describe('buildComplianceSummary', () => {
  test('empty inputs yield zeroed summary', () => {
    const s = buildComplianceSummary([], []);
    assert.equal(s.total, 0);
    assert.equal(s.completed, 0);
    assert.equal(s.completion_rate, 0);
  });

  test('approved required document counts as completed', () => {
    const s = buildComplianceSummary(
      [],
      [{ status: 'approved', required: true }],
    );
    assert.equal(s.total, 1);
    assert.equal(s.completed, 1);
    assert.equal(s.completion_rate, 100);
  });

  test('pending / received / missing required docs count as pending', () => {
    const s = buildComplianceSummary(
      [],
      [
        { status: 'pending',  required: true },
        { status: 'received', required: true },
        { status: 'missing',  required: true },
      ],
    );
    assert.equal(s.pending, 3);
    assert.equal(s.completed, 0);
  });

  test('expired and rejected required docs land in correct buckets', () => {
    const s = buildComplianceSummary(
      [],
      [
        { status: 'expired',  required: true },
        { status: 'rejected', required: true },
      ],
    );
    assert.equal(s.expired, 1);
    assert.equal(s.failed, 1);
    assert.equal(s.completion_rate, 0);
  });

  test('non-required documents are excluded entirely', () => {
    const s = buildComplianceSummary(
      [],
      [
        { status: 'approved', required: true  },
        { status: 'approved', required: false },
        { status: 'pending',  required: false },
      ],
    );
    assert.equal(s.total, 1);
    assert.equal(s.completed, 1);
  });

  test('competency records and documents combine additively', () => {
    const s = buildComplianceSummary(
      [
        { status: 'completed' },
        { status: 'in_progress' },
        { status: 'expired' },
      ],
      [
        { status: 'approved', required: true },
        { status: 'pending',  required: true },
      ],
    );
    assert.equal(s.total, 5);
    assert.equal(s.completed, 2);   // 1 completed record + 1 approved doc
    assert.equal(s.pending, 2);     // 1 in_progress record + 1 pending doc
    assert.equal(s.expired, 1);
    assert.equal(s.completion_rate, 40);
  });

  test('approved CNA license reflected when no competency records exist (Jordan Testwell repro)', () => {
    // Reproduces the exact QA scenario: only a manually-added approved
    // CNA license, no competency records. Pre-fix this returned all zeros.
    const s = buildComplianceSummary(
      [],
      [{ status: 'approved', required: true }],
    );
    assert.equal(s.total, 1);
    assert.equal(s.completed, 1);
    assert.equal(s.completion_rate, 100);
  });

  test('signed and read records map to completed', () => {
    const s = buildComplianceSummary(
      [{ status: 'signed' }, { status: 'read' }],
      [],
    );
    assert.equal(s.completed, 2);
  });

  test('failed records count as failed', () => {
    const s = buildComplianceSummary([{ status: 'failed' }], []);
    assert.equal(s.failed, 1);
    assert.equal(s.completion_rate, 0);
  });
});
