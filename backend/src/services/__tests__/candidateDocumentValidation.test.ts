/**
 * Tests for the candidate-document mutation validators extracted from
 * the route handler. Pins QA Phase 4 #17 (notes maxLength) and the
 * `force` override convention shared with the candidate-create dup
 * guard.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateAddDocumentBody, isForceOverride } from '../candidateDocumentValidation';

describe('validateAddDocumentBody', () => {
  test('valid input returns ok with trimmed values', () => {
    const r = validateAddDocumentBody({
      document_type: '  rn_license ',
      label: '  TX RN License #12345  ',
      notes: 'Issued 2023',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.document_type, 'rn_license');
      assert.equal(r.label, 'TX RN License #12345');
      assert.equal(r.notes, 'Issued 2023');
    }
  });

  test('missing document_type rejects', () => {
    const r = validateAddDocumentBody({ label: 'whatever' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.field, 'document_type');
  });

  test('blank-string document_type rejects', () => {
    const r = validateAddDocumentBody({ document_type: '   ', label: 'x' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.field, 'document_type');
  });

  test('missing label rejects', () => {
    const r = validateAddDocumentBody({ document_type: 'rn_license' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.field, 'label');
  });

  test('label > 200 chars rejects', () => {
    const r = validateAddDocumentBody({
      document_type: 'rn_license',
      label: 'x'.repeat(201),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.field, 'label');
      assert.ok(r.message.includes('200'));
    }
  });

  test('label exactly 200 chars accepts', () => {
    const r = validateAddDocumentBody({
      document_type: 'rn_license',
      label: 'x'.repeat(200),
    });
    assert.equal(r.ok, true);
  });

  test('notes > 5000 chars rejects (QA Phase 4 #17)', () => {
    const r = validateAddDocumentBody({
      document_type: 'rn_license',
      label: 'fine',
      notes: 'x'.repeat(5001),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.field, 'notes');
      assert.ok(r.message.includes('5000'));
    }
  });

  test('notes exactly 5000 chars accepts', () => {
    const r = validateAddDocumentBody({
      document_type: 'rn_license',
      label: 'fine',
      notes: 'x'.repeat(5000),
    });
    assert.equal(r.ok, true);
  });

  test('null notes accepts (optional field)', () => {
    const r = validateAddDocumentBody({
      document_type: 'rn_license',
      label: 'fine',
      notes: null,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.notes, null);
  });

  test('omitted notes accepts as null', () => {
    const r = validateAddDocumentBody({
      document_type: 'rn_license',
      label: 'fine',
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.notes, null);
  });

  test('non-string notes rejects', () => {
    const r = validateAddDocumentBody({
      document_type: 'rn_license',
      label: 'fine',
      notes: 123 as unknown as string,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.field, 'notes');
  });

  test('XSS payload in label is accepted as data (rendering layer escapes — see audit)', () => {
    // Server-side validation only enforces shape & length; per QA Phase 4
    // #17, rendering safely escapes XSS. We do NOT scrub here because
    // doing so silently would mask the user's input and complicate
    // legitimate uses (e.g. quoted credential names with HTML chars).
    const r = validateAddDocumentBody({
      document_type: 'rn_license',
      label: '<script>alert(1)</script>',
    });
    assert.equal(r.ok, true);
  });
});

describe('isForceOverride', () => {
  test('?force=1 → true', () => {
    assert.equal(isForceOverride({ force: '1' }, {}), true);
  });
  test('?force=true → true', () => {
    assert.equal(isForceOverride({ force: 'true' }, {}), true);
  });
  test('body.force=true → true', () => {
    assert.equal(isForceOverride({}, { force: true }), true);
  });
  test('?force=0 → false', () => {
    assert.equal(isForceOverride({ force: '0' }, {}), false);
  });
  test('?force=yes → false (only "1" or "true" are accepted)', () => {
    assert.equal(isForceOverride({ force: 'yes' }, {}), false);
  });
  test('body.force="true" string → false (only boolean true)', () => {
    // Stricter on body side because JSON has real booleans — accepting
    // a string would let the frontend accidentally force-override by
    // serializing wrong.
    assert.equal(isForceOverride({}, { force: 'true' }), false);
  });
  test('null inputs → false', () => {
    assert.equal(isForceOverride(null, null), false);
  });
  test('undefined inputs → false', () => {
    assert.equal(isForceOverride(undefined, undefined), false);
  });
});
