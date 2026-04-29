/**
 * Tests for the candidate "Available Start Date" parser.
 *
 * Pins the QA fix that replaced a generic "Validation error" with a
 * specific, user-facing message and ensured both ISO `YYYY-MM-DD` (what
 * <input type="date"> produces) and US `MM/DD/YYYY` (what users type)
 * round-trip correctly.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseAvailabilityStart, parseFutureAvailabilityStart, isParsedDateErr } from '../dates';

describe('parseAvailabilityStart', () => {
  test('blank string parses as null (field is optional)', () => {
    const r = parseAvailabilityStart('');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, null);
  });

  test('null input parses as null', () => {
    const r = parseAvailabilityStart(null);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, null);
  });

  test('undefined input parses as null', () => {
    const r = parseAvailabilityStart(undefined);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, null);
  });

  test('valid ISO date round-trips unchanged', () => {
    const r = parseAvailabilityStart('2026-07-15');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, '2026-07-15');
  });

  test('valid MM/DD/YYYY normalizes to ISO', () => {
    const r = parseAvailabilityStart('07/15/2026');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, '2026-07-15');
  });

  test('single-digit M/D/YYYY normalizes correctly', () => {
    const r = parseAvailabilityStart('1/5/2026');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, '2026-01-05');
  });

  test('whitespace-padded input is trimmed', () => {
    const r = parseAvailabilityStart('  07/15/2026  ');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, '2026-07-15');
  });

  test('garbage string is rejected with a useful message', () => {
    const r = parseAvailabilityStart('next tuesday');
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.message.toLowerCase().includes('mm/dd/yyyy'));
    }
  });

  test('partially numeric string is rejected', () => {
    const r = parseAvailabilityStart('2026/07/15');
    assert.equal(r.ok, false);
  });

  test('calendar-impossible date is rejected (Feb 30)', () => {
    const r = parseAvailabilityStart('02/30/2026');
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.message.length > 10);
  });

  test('calendar-impossible date is rejected (month 13)', () => {
    const r = parseAvailabilityStart('13/01/2026');
    assert.equal(r.ok, false);
  });

  test('leap day 02/29 in a non-leap year is rejected', () => {
    const r = parseAvailabilityStart('02/29/2025');
    assert.equal(r.ok, false);
  });

  test('leap day 02/29 in a leap year is accepted', () => {
    const r = parseAvailabilityStart('02/29/2028');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, '2028-02-29');
  });

  test('past dates are accepted by the parser (future-dated check is server-policy, applied elsewhere)', () => {
    // The parser only validates *parseability*. The frontend caller
    // and any business-policy "must be future" checks live closer to
    // the form / route, where they have request context.
    const r = parseAvailabilityStart('2020-01-01');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, '2020-01-01');
  });
});

describe('parseFutureAvailabilityStart', () => {
  test('rejects past dates with a useful message', () => {
    const r = parseFutureAvailabilityStart('2020-01-01');
    assert.equal(r.ok, false);
    if (isParsedDateErr(r)) {
      assert.ok(r.message.toLowerCase().includes('today or later'));
    }
  });

  test('accepts a future date and normalizes to ISO', () => {
    const r = parseFutureAvailabilityStart('12/31/2099');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, '2099-12-31');
  });

  test('accepts today (UTC midnight comparison, not strict gt)', () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const r = parseFutureAvailabilityStart(todayIso);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, todayIso);
  });

  test('null/empty input parses as null (optional field)', () => {
    assert.equal(parseFutureAvailabilityStart(null).ok, true);
    assert.equal(parseFutureAvailabilityStart('').ok, true);
    assert.equal(parseFutureAvailabilityStart(undefined).ok, true);
  });

  test('non-parseable input still rejected (delegates to parseAvailabilityStart)', () => {
    const r = parseFutureAvailabilityStart('not a date');
    assert.equal(r.ok, false);
  });

  test('boundary: yesterday is rejected', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const y = yesterday.getUTCFullYear();
    const m = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getUTCDate()).padStart(2, '0');
    const r = parseFutureAvailabilityStart(`${y}-${m}-${d}`);
    assert.equal(r.ok, false);
  });
});
