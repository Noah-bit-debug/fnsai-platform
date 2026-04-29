/**
 * Tests for the Anthropic-error translator.
 *
 * Pins QA Phase 5 #5 (Anthropic credits exhausted produces a generic
 * "AI service error: 400" instead of telling the recruiter to contact
 * admin) and #2 (Re-score failed swallowed the real Anthropic shape).
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { translateAnthropicError } from '../aiErrors';

describe('translateAnthropicError', () => {
  test('402 credit-balance error is classified as billing', () => {
    const r = translateAnthropicError({
      status: 402,
      error: { message: 'Your credit balance is too low to access the Anthropic API.' },
    });
    assert.ok(r);
    assert.equal(r!.code, 'billing');
    assert.ok(r!.message.toLowerCase().includes('credits'));
    assert.equal(r!.status, 503);
  });

  test('400 with credit-balance text is also classified as billing', () => {
    // Anthropic sometimes returns 400 (not 402) with the same body,
    // matching what the QA-tester actually saw on /ai/suggest-actions.
    const r = translateAnthropicError({
      status: 400,
      message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    });
    assert.ok(r);
    assert.equal(r!.code, 'billing');
  });

  test('429 is classified as rate_limit', () => {
    const r = translateAnthropicError({ status: 429, message: 'Rate limit exceeded' });
    assert.ok(r);
    assert.equal(r!.code, 'rate_limit');
    assert.equal(r!.status, 429);
  });

  test('401 is classified as auth', () => {
    const r = translateAnthropicError({ status: 401, message: 'Invalid API key' });
    assert.ok(r);
    assert.equal(r!.code, 'auth');
    assert.ok(r!.message.toLowerCase().includes('admin'));
  });

  test('503 is classified as server', () => {
    const r = translateAnthropicError({ status: 503, message: 'Service Unavailable' });
    assert.ok(r);
    assert.equal(r!.code, 'server');
  });

  test('500 is classified as server', () => {
    const r = translateAnthropicError({ status: 500 });
    assert.ok(r);
    assert.equal(r!.code, 'server');
  });

  test('non-Anthropic-shaped error returns null', () => {
    // Generic Error has no .status — caller should fall through to its
    // own error path rather than try to translate.
    assert.equal(translateAnthropicError(new Error('plain error')), null);
    assert.equal(translateAnthropicError({ message: 'something' }), null);
    assert.equal(translateAnthropicError(null), null);
    assert.equal(translateAnthropicError(undefined), null);
  });

  test('unknown status with body uses message in fallback', () => {
    const r = translateAnthropicError({ status: 418, message: "I'm a teapot" });
    assert.ok(r);
    assert.equal(r!.code, 'unknown');
    assert.ok(r!.message.includes('418'));
  });

  test('message is bounded to 240 chars to prevent log/UI bloat', () => {
    const r = translateAnthropicError({ status: 418, message: 'x'.repeat(2000) });
    assert.ok(r);
    assert.ok(r!.message.length <= 240);
  });
});
