/**
 * Pure-function tests for the locale-independent ISO date helpers.
 *
 * Pins QA Phase 3 #12: `new Date().toLocaleDateString("en-CA")` is
 * locale-dependent and produces non-ISO output on some browsers,
 * which broke the incident-report submit. The helpers in lib/isoDate.ts
 * build the string from numeric components instead.
 */
import { describe, test, expect } from 'vitest';
import { todayIso, toIso, isIsoDate } from './isoDate';

describe('todayIso', () => {
  test('returns a string matching the strict YYYY-MM-DD pattern', () => {
    const out = todayIso();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('matches what toIso(new Date()) would return', () => {
    expect(todayIso()).toBe(toIso(new Date()));
  });
});

describe('toIso', () => {
  test('formats arbitrary dates as zero-padded YYYY-MM-DD', () => {
    expect(toIso(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toIso(new Date(2024, 11, 31))).toBe('2024-12-31');
  });

  test('throws on Invalid Date', () => {
    expect(() => toIso(new Date('not a date'))).toThrow(/invalid/i);
  });

  test('output passes isIsoDate', () => {
    expect(isIsoDate(toIso(new Date(2026, 5, 15)))).toBe(true);
  });
});

describe('isIsoDate', () => {
  test('accepts valid ISO dates', () => {
    expect(isIsoDate('2026-04-29')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true); // leap day in leap year
  });

  test('rejects calendar-impossible dates', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2025-02-29')).toBe(false); // non-leap year
  });

  test('rejects malformed strings', () => {
    expect(isIsoDate('04/29/2026')).toBe(false);
    expect(isIsoDate('2026-4-29')).toBe(false); // missing zero-pad
    expect(isIsoDate('next tuesday')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});
