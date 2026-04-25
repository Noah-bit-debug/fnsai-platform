// tests/util.test.mjs — pure-helper tests, runnable via `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  iso,
  hasCrossedMidnight,
  isLocalSessionId,
  isWithinSchedule,
  matchesPattern,
  classifyDomain,
  base64UrlEncode,
  decodeJwt,
  generateCodeChallenge,
  generateCodeVerifier,
} from '../shared/util.js';

// ─── iso ─────────────────────────────────────────────────────────────────
test('iso renders epoch ms as ISO 8601', () => {
  assert.equal(iso(0), '1970-01-01T00:00:00.000Z');
  assert.equal(iso(1714000000000), new Date(1714000000000).toISOString());
});

// ─── hasCrossedMidnight ──────────────────────────────────────────────────
test('hasCrossedMidnight: same calendar day returns false', () => {
  const start = new Date(2026, 3, 25, 9, 0, 0).getTime();
  const now   = new Date(2026, 3, 25, 23, 59, 0).getTime();
  assert.equal(hasCrossedMidnight(start, now), false);
});

test('hasCrossedMidnight: next day returns true', () => {
  const start = new Date(2026, 3, 25, 23, 59, 0).getTime();
  const now   = new Date(2026, 3, 26, 0, 1, 0).getTime();
  assert.equal(hasCrossedMidnight(start, now), true);
});

test('hasCrossedMidnight: month boundary returns true', () => {
  const start = new Date(2026, 3, 30, 23, 59, 0).getTime();
  const now   = new Date(2026, 4, 1, 0, 1, 0).getTime();
  assert.equal(hasCrossedMidnight(start, now), true);
});

// ─── isLocalSessionId ────────────────────────────────────────────────────
test('isLocalSessionId: detects local_ prefix', () => {
  assert.equal(isLocalSessionId('local_1714000000000'), true);
  assert.equal(isLocalSessionId('uuid-something'), false);
  assert.equal(isLocalSessionId(null), false);
  assert.equal(isLocalSessionId(undefined), false);
  assert.equal(isLocalSessionId(123), false);
});

// ─── isWithinSchedule ────────────────────────────────────────────────────
test('isWithinSchedule: browser_profile mode is always within', () => {
  const s = { trackingMode: 'browser_profile' };
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 3, 0)), true);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 14, 0)), true);
});

test('isWithinSchedule: scheduled day window 09:00–17:00', () => {
  const s = { trackingMode: 'scheduled', scheduledStart: '09:00', scheduledEnd: '17:00' };
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 8, 59)), false);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 9, 0)),  true);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 12, 0)), true);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 16, 59)), true);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 17, 0)),  false);
});

test('isWithinSchedule: overnight window 22:00–06:00', () => {
  const s = { trackingMode: 'scheduled', scheduledStart: '22:00', scheduledEnd: '06:00' };
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 21, 59)), false);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 22, 0)),  true);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 23, 30)), true);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 0, 30)),  true);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 5, 59)),  true);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 6, 0)),   false);
});

test('isWithinSchedule: equal start and end is always out-of-range', () => {
  const s = { trackingMode: 'scheduled', scheduledStart: '09:00', scheduledEnd: '09:00' };
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 9, 0)),  false);
  assert.equal(isWithinSchedule(s, new Date(2026, 3, 25, 14, 0)), false);
});

// ─── matchesPattern ──────────────────────────────────────────────────────
test('matchesPattern: bare domain matches itself and subdomains', () => {
  assert.equal(matchesPattern('github.com',     ['github.com']), true);
  assert.equal(matchesPattern('api.github.com', ['github.com']), true);
  assert.equal(matchesPattern('not-github.com', ['github.com']), false);
  assert.equal(matchesPattern('github.com.evil.com', ['github.com']), false);
});

test('matchesPattern: *.host pattern still matches the bare host', () => {
  assert.equal(matchesPattern('vercel.app',         ['*.vercel.app']), true);
  assert.equal(matchesPattern('foo.vercel.app',     ['*.vercel.app']), true);
  assert.equal(matchesPattern('foo.bar.vercel.app', ['*.vercel.app']), true);
});

// ─── classifyDomain ──────────────────────────────────────────────────────
test('classifyDomain: excluded wins over approved', () => {
  const settings = {
    approvedDomains: ['example.com'],
    excludedDomains: ['bad.example.com'],
  };
  assert.equal(classifyDomain('example.com',     settings), 'work');
  assert.equal(classifyDomain('bad.example.com', settings), 'excluded');
});

test('classifyDomain: empty domain is non_work', () => {
  assert.equal(classifyDomain('', {}), 'non_work');
  assert.equal(classifyDomain(null, {}), 'non_work');
});

test('classifyDomain: unknown domain is non_work', () => {
  assert.equal(
    classifyDomain('reddit.com', { approvedDomains: ['github.com'], excludedDomains: [] }),
    'non_work'
  );
});

test('classifyDomain: *.x.com works in excluded list (symmetry)', () => {
  const settings = {
    approvedDomains: ['*.vercel.app'],
    excludedDomains: ['*.facebook.com'],
  };
  assert.equal(classifyDomain('m.facebook.com', settings), 'excluded');
  assert.equal(classifyDomain('app.vercel.app', settings), 'work');
});

// ─── base64UrlEncode ─────────────────────────────────────────────────────
test('base64UrlEncode: produces URL-safe base64 with no padding', () => {
  const input = new Uint8Array([0xfb, 0xff, 0xbf]);
  const out = base64UrlEncode(input.buffer);
  assert.match(out, /^[A-Za-z0-9_-]+$/);
  assert.equal(out.includes('+'), false);
  assert.equal(out.includes('/'), false);
  assert.equal(out.includes('='), false);
});

test('base64UrlEncode: empty buffer → empty string', () => {
  assert.equal(base64UrlEncode(new Uint8Array([]).buffer), '');
});

// ─── decodeJwt ───────────────────────────────────────────────────────────
test('decodeJwt: returns the payload claims', () => {
  // Payload = { sub: "abc", name: "Test" }
  const header  = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replaceAll('=', '');
  const payload = btoa(JSON.stringify({ sub: 'abc', name: 'Test' })).replaceAll('=', '');
  const jwt = `${header}.${payload}.signature`;
  const out = decodeJwt(jwt);
  assert.deepEqual(out, { sub: 'abc', name: 'Test' });
});

test('decodeJwt: malformed input returns null', () => {
  assert.equal(decodeJwt('not.a.jwt-but-has-three-parts'), null);
  assert.equal(decodeJwt('only-one-part'), null);
  assert.equal(decodeJwt(''), null);
});

// ─── PKCE ────────────────────────────────────────────────────────────────
test('generateCodeVerifier: produces a URL-safe string ≥ 43 chars', () => {
  const v = generateCodeVerifier();
  assert.match(v, /^[A-Za-z0-9_-]+$/);
  assert.ok(v.length >= 43, `verifier length ${v.length} < 43`);
});

test('generateCodeChallenge: matches RFC 7636 example', async () => {
  // Per RFC 7636 Appendix B
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const got = await generateCodeChallenge(verifier);
  assert.equal(got, expected);
});
