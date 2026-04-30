/**
 * Tests for the template-role validator + helpers introduced for the
 * eSign template-roles rework. Pins the contract that:
 *
 *   - Role keys are stable & auto-derived from labels when missing.
 *   - Duplicate keys are rejected (a template can't have two "HR"s).
 *   - Sequential order numbers must be 1-99.
 *   - Roles always come back sorted by `order` so callers don't
 *     have to re-sort downstream.
 *   - DEFAULT_TEMPLATE_ROLES is the [HR, Candidate] pair the
 *     healthcare-staffing flow defaults to.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  DEFAULT_TEMPLATE_ROLES,
  validateRoles,
  isSigningOrder,
  SIGNING_ORDER_VALUES,
} from '../templateRoles';

describe('DEFAULT_TEMPLATE_ROLES', () => {
  test('is the [HR, Candidate] pair, sorted by order', () => {
    assert.equal(DEFAULT_TEMPLATE_ROLES.length, 2);
    assert.equal(DEFAULT_TEMPLATE_ROLES[0].key, 'hr');
    assert.equal(DEFAULT_TEMPLATE_ROLES[1].key, 'candidate');
    assert.equal(DEFAULT_TEMPLATE_ROLES[0].order, 1);
    assert.equal(DEFAULT_TEMPLATE_ROLES[1].order, 2);
  });
});

describe('validateRoles', () => {
  test('null/undefined input returns empty roles', () => {
    const r1 = validateRoles(null);
    assert.equal(r1.ok, true);
    if (r1.ok) assert.deepEqual(r1.roles, []);

    const r2 = validateRoles(undefined);
    assert.equal(r2.ok, true);
  });

  test('non-array input is rejected', () => {
    const r = validateRoles({ key: 'hr', label: 'HR' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /array/i);
  });

  test('missing label is rejected', () => {
    const r = validateRoles([{ key: 'hr' }]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /label/i);
  });

  test('label > 80 chars is rejected', () => {
    const r = validateRoles([{ label: 'x'.repeat(81) }]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /80 chars/i);
  });

  test('auto-derives key from label when key is missing', () => {
    const r = validateRoles([{ label: 'HR Manager' }]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.roles[0].key, 'hr_manager');
      assert.equal(r.roles[0].label, 'HR Manager');
    }
  });

  test('slugifies label with punctuation in the auto-derived key', () => {
    const r = validateRoles([{ label: "Mary's HR Lead!" }]);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.roles[0].key, 'mary_s_hr_lead');
  });

  test('falls back to label when explicit key is empty/whitespace', () => {
    const r = validateRoles([{ key: '   ', label: 'HR' }]);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.roles[0].key, 'hr');
  });

  test('duplicate keys are rejected', () => {
    const r = validateRoles([
      { key: 'hr', label: 'HR' },
      { key: 'hr', label: 'Other HR' },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /duplicate.*hr/i);
  });

  test('rejects when two labels would slugify to the same key', () => {
    // Both normalize to "hr".
    const r = validateRoles([
      { label: 'HR' },
      { label: 'hr' },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /duplicate/i);
  });

  test('order < 1 or > 99 is rejected', () => {
    assert.equal(validateRoles([{ label: 'HR', order: 0 }]).ok, false);
    assert.equal(validateRoles([{ label: 'HR', order: 100 }]).ok, false);
    assert.equal(validateRoles([{ label: 'HR', order: -1 }]).ok, false);
  });

  test('order defaults to 1-based index when not provided', () => {
    const r = validateRoles([
      { label: 'HR' },
      { label: 'Manager' },
      { label: 'Candidate' },
    ]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.roles[0].order, 1);
      assert.equal(r.roles[1].order, 2);
      assert.equal(r.roles[2].order, 3);
    }
  });

  test('result is sorted by order regardless of input order', () => {
    const r = validateRoles([
      { label: 'Candidate', order: 3 },
      { label: 'HR',        order: 1 },
      { label: 'Manager',   order: 2 },
    ]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.roles[0].label, 'HR');
      assert.equal(r.roles[1].label, 'Manager');
      assert.equal(r.roles[2].label, 'Candidate');
    }
  });

  test('healthcare default works through the validator unchanged', () => {
    const r = validateRoles(DEFAULT_TEMPLATE_ROLES);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.roles, DEFAULT_TEMPLATE_ROLES);
  });

  test('non-numeric order is replaced with index-based default', () => {
    const r = validateRoles([
      { label: 'HR',        order: 'first' as unknown as number },
      { label: 'Candidate', order: NaN },
    ]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.roles[0].order, 1);
      assert.equal(r.roles[1].order, 2);
    }
  });
});

describe('isSigningOrder', () => {
  test('accepts the two valid values', () => {
    assert.equal(isSigningOrder('parallel'), true);
    assert.equal(isSigningOrder('sequential'), true);
  });
  test('rejects everything else', () => {
    assert.equal(isSigningOrder('SEQUENTIAL'), false);
    assert.equal(isSigningOrder(''), false);
    assert.equal(isSigningOrder(null), false);
    assert.equal(isSigningOrder(undefined), false);
    assert.equal(isSigningOrder(1), false);
  });
  test('SIGNING_ORDER_VALUES is exposed and matches the predicate', () => {
    for (const v of SIGNING_ORDER_VALUES) {
      assert.equal(isSigningOrder(v), true);
    }
  });
});
