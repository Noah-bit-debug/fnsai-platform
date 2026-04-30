/**
 * Pure-function tests for the form-error helpers.
 *
 * These exercise the extractFieldErrors / summarizeFieldErrors helpers
 * that PRs #15/#16/#18 use to surface zod's structured field errors
 * (the original "Validation error" generic-shell symptom from the QA
 * reports). Establishes the pattern for testing other lib/ helpers.
 */
import { describe, test, expect } from 'vitest';
import { extractFieldErrors, summarizeFieldErrors } from './formErrors';

describe('extractFieldErrors', () => {
  test('returns null when error has no `details`', () => {
    expect(extractFieldErrors({ response: { data: { error: 'oops' } } })).toBe(null);
    expect(extractFieldErrors({})).toBe(null);
    expect(extractFieldErrors(null)).toBe(null);
  });

  test('extracts a flat field map from a zod-flatten() shape', () => {
    const err = {
      response: {
        data: {
          error: 'Validation error',
          details: {
            formErrors: [],
            fieldErrors: {
              first_name: ['First name is required.'],
              email: ['Invalid email'],
            },
          },
        },
      },
    };
    const out = extractFieldErrors(err);
    expect(out).toEqual({
      first_name: 'First name is required.',
      email: 'Invalid email',
    });
  });

  test('captures formErrors under the _form key', () => {
    const out = extractFieldErrors({
      response: {
        data: {
          details: {
            formErrors: ['Top-level problem A', 'and B'],
            fieldErrors: {},
          },
        },
      },
    });
    expect(out?._form).toBe('Top-level problem A and B');
  });

  test('returns null when fieldErrors is empty AND formErrors is empty', () => {
    const out = extractFieldErrors({
      response: { data: { details: { formErrors: [], fieldErrors: {} } } },
    });
    expect(out).toBe(null);
  });

  test('uses the first message when a field has multiple errors', () => {
    const out = extractFieldErrors({
      response: {
        data: {
          details: {
            formErrors: [],
            fieldErrors: { phone: ['Bad format', 'Too short', 'Wrong country'] },
          },
        },
      },
    });
    expect(out?.phone).toBe('Bad format');
  });
});

describe('summarizeFieldErrors', () => {
  const labels = { first_name: 'First Name', email: 'Email' };

  test('joins per-field errors with a label map', () => {
    const summary = summarizeFieldErrors(
      { first_name: 'Required', email: 'Invalid' },
      labels,
    );
    expect(summary).toContain('First Name: Required');
    expect(summary).toContain('Email: Invalid');
    expect(summary).toContain(' · ');
  });

  test('falls back to the raw key when no label is provided', () => {
    expect(summarizeFieldErrors({ phone: 'bad' })).toContain('phone: bad');
  });

  test('uses _form when there are no field-level errors', () => {
    expect(summarizeFieldErrors({ _form: 'Top-level message' })).toBe('Top-level message');
  });

  test('falls back to the generic correction message on empty input', () => {
    expect(summarizeFieldErrors({})).toMatch(/correct/i);
  });
});
