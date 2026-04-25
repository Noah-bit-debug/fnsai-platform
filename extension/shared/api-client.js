// shared/api-client.js — API client for SentrixAI Time Tracker extension
//
// All write operations queue automatically on network failure. Reads do not.
// Endpoints are relative to apiBase, which already includes the /api/v1 prefix.

import {
  DEFAULT_API_BASE,
  OFFLINE_QUEUE_KEY,
  SETTINGS_KEY,
} from './constants.js';
import { getValidIdToken } from './auth.js';
import { storageGet, storageSet } from './storage.js';

// ---------------------------------------------------------------------------
// Settings + headers
// ---------------------------------------------------------------------------

async function getApiBase() {
  const result = await storageGet([SETTINGS_KEY]);
  return result[SETTINGS_KEY]?.apiBase || DEFAULT_API_BASE;
}

async function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = await getValidIdToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

/**
 * Make a request against the SentrixAI API.
 * On failure: queues the request and returns { offline: true } unless
 * { queue: false } is passed (used by the queue replay loop to avoid loops).
 */
async function request(method, path, body, opts = {}) {
  const apiBase = await getApiBase();
  const url = `${apiBase}${path}`;
  try {
    const resp = await fetch(url, {
      method,
      headers: await buildHeaders(),
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }
    if (resp.status === 204) return { success: true };
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return { success: true };
    return await resp.json();
  } catch (e) {
    if (opts.queue === false) throw e;
    console.warn(`[SentrixAI] ${method} ${path} offline:`, e.message);
    await addToOfflineQueue({ method, path, body });
    return { offline: true, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------

async function addToOfflineQueue(entry) {
  const result = await storageGet([OFFLINE_QUEUE_KEY]);
  const queue = result[OFFLINE_QUEUE_KEY] || [];
  queue.push({ ...entry, queuedAt: Date.now(), retries: 0 });
  await storageSet({ [OFFLINE_QUEUE_KEY]: queue });
}

/**
 * Replay queued requests. Successes drop out of the queue; failures stay
 * with retries+1; entries past 10 retries are discarded.
 */
export async function processOfflineQueue() {
  const result = await storageGet([OFFLINE_QUEUE_KEY]);
  const queue = result[OFFLINE_QUEUE_KEY] || [];
  if (queue.length === 0) return;

  const remaining = [];
  for (const entry of queue) {
    if (entry.retries > 10) continue;
    try {
      await request(entry.method, entry.path, entry.body, { queue: false });
    } catch (_) {
      remaining.push({ ...entry, retries: entry.retries + 1 });
    }
  }
  await storageSet({ [OFFLINE_QUEUE_KEY]: remaining });
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/** POST /time-tracking/sessions/start  →  { session: { id, ... } } */
export function startSession(body) {
  return request('POST', '/time-tracking/sessions/start', body);
}

/** POST /time-tracking/sessions/:id/heartbeat — body deltas */
export function heartbeat(sessionId, body) {
  return request('POST', `/time-tracking/sessions/${sessionId}/heartbeat`, body);
}

/** POST /time-tracking/sessions/:id/end */
export function endSession(sessionId, body) {
  return request('POST', `/time-tracking/sessions/${sessionId}/end`, body);
}

/** POST /time-tracking/activity/batch — { session_id, logs } */
export function batchActivityLogs(sessionId, logs) {
  if (!sessionId || !logs || logs.length === 0) {
    return Promise.resolve({ success: true });
  }
  return request('POST', '/time-tracking/activity/batch', {
    session_id: sessionId,
    logs,
  });
}

/** POST /time-tracking/idle-events  →  { idle_event: { id, ... } } */
export function postIdleEvent(body) {
  return request('POST', '/time-tracking/idle-events', body);
}

/** PATCH /time-tracking/idle-events/:id/respond — { user_response, notes? } */
export function respondIdleEvent(idleEventId, body) {
  return request('PATCH', `/time-tracking/idle-events/${idleEventId}/respond`, body);
}

/** POST /time-tracking/breaks  →  { break_event: { id, ... } } */
export function startBreakEvent(body) {
  return request('POST', '/time-tracking/breaks', body);
}

/** PATCH /time-tracking/breaks/:id/end — { end_time } */
export function endBreakEvent(breakId, body) {
  return request('PATCH', `/time-tracking/breaks/${breakId}/end`, body);
}

/** GET /time-tracking/policy */
export async function getPolicy() {
  try {
    return await request('GET', '/time-tracking/policy', null, { queue: false });
  } catch (e) {
    return { offline: true, error: e.message };
  }
}

/**
 * Verify apiBase + current Microsoft session by hitting an authenticated
 * endpoint. 200 = ok, 401 = not signed in / token expired,
 * 403 = signed in but missing permission, 404 = bad URL, network error =
 * unreachable.
 */
export async function testConnection(apiBase) {
  try {
    const resp = await fetch(`${apiBase}/time-tracking/sessions/active`, {
      method: 'GET',
      headers: await buildHeaders(),
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
