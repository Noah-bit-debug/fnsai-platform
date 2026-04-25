// shared/util.js — Pure helpers with no chrome.* dependency.
//
// Everything here is unit-testable in plain Node. If you find yourself
// adding `chrome.` here, it belongs in another module.

import { TRACKING_MODES, DEFAULT_APPROVED_DOMAINS } from './constants.js';

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** ISO-format a millisecond timestamp. */
export const iso = (ms) => new Date(ms).toISOString();

/** Returns true iff the two timestamps fall on different local calendar days. */
export function hasCrossedMidnight(startMs, nowMs) {
  const start = new Date(startMs);
  const now = new Date(nowMs);
  return (
    start.getFullYear() !== now.getFullYear() ||
    start.getMonth() !== now.getMonth() ||
    start.getDate() !== now.getDate()
  );
}

/** Detect whether a session id is a local-only placeholder (no server row). */
export function isLocalSessionId(id) {
  return typeof id === 'string' && id.startsWith('local_');
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Whether the current local time falls within the configured schedule
 * window. scheduledStart / scheduledEnd are HH:MM strings (24-hour).
 * Overnight windows (start > end, e.g. 22:00–06:00) are supported. If
 * tracking mode is not 'scheduled', returns true unconditionally.
 *
 * Accepts an optional `now` parameter for testability.
 */
export function isWithinSchedule(settings, now = new Date()) {
  if (settings.trackingMode !== TRACKING_MODES.SCHEDULED) return true;
  if (!settings.scheduledStart || !settings.scheduledEnd) return true;

  const [sh, sm] = settings.scheduledStart.split(':').map(Number);
  const [eh, em] = settings.scheduledEnd.split(':').map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  // Overnight window: in-range if after start OR before end
  return nowMin >= startMin || nowMin < endMin;
}

// ---------------------------------------------------------------------------
// Domain classification
// ---------------------------------------------------------------------------

/**
 * Match a hostname against a list of patterns. A pattern starting with
 * "*." matches any subdomain (and the bare domain). A bare domain matches
 * itself plus its subdomains.
 */
export function matchesPattern(domain, list) {
  return list.some((raw) => {
    const pattern = raw.replace(/^\*\./, '');
    return domain === pattern || domain.endsWith('.' + pattern);
  });
}

/**
 * Classify a hostname. Returns 'excluded' | 'work' | 'non_work'.
 * Falls back to DEFAULT_APPROVED_DOMAINS when settings.approvedDomains
 * is undefined.
 */
export function classifyDomain(domain, settings) {
  if (!domain) return 'non_work';
  const approved = settings.approvedDomains || DEFAULT_APPROVED_DOMAINS;
  const excluded = settings.excludedDomains || [];
  if (matchesPattern(domain, excluded)) return 'excluded';
  if (matchesPattern(domain, approved)) return 'work';
  return 'non_work';
}

// ---------------------------------------------------------------------------
// JWT / PKCE primitives (pure crypto — depends on globalThis.crypto, which
// is available both in Chrome workers and in modern Node.)
// ---------------------------------------------------------------------------

export function base64UrlEncode(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  // btoa is available globally in browsers and in Node ≥ 16.
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Decode the payload of a JWT. Does NOT verify the signature. */
export function decodeJwt(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const json = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function generateCodeVerifier() {
  const buf = new Uint8Array(64);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

export async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(hash);
}
