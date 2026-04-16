// shared/api-client.js — API client for SentrixAI Time Tracker extension

import {
  DEFAULT_API_BASE,
  OFFLINE_QUEUE_KEY,
  SETTINGS_KEY,
} from './constants.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read apiBase and authToken from chrome.storage.local.
 * Falls back to the default Railway backend URL.
 */
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (result) => {
      const settings = result[SETTINGS_KEY] || {};
      resolve({
        apiBase: settings.apiBase || DEFAULT_API_BASE,
        authToken: settings.authToken || '',
      });
    });
  });
}

/**
 * Build common request headers.
 */
function buildHeaders(authToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

/**
 * Core fetch wrapper. Returns parsed JSON on success, throws on HTTP error.
 */
async function apiFetch(url, options) {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    let body = '';
    try { body = await resp.text(); } catch (_) { /* ignore */ }
    throw new Error(`HTTP ${resp.status}: ${body}`);
  }
  // Some endpoints return 204 No Content
  const contentType = resp.headers.get('content-type') || '';
  if (resp.status === 204 || !contentType.includes('application/json')) {
    return { success: true };
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Offline queue helpers
// ---------------------------------------------------------------------------

/**
 * Add a failed request to the offline retry queue in chrome.storage.local.
 */
export async function addToOfflineQueue(type, data) {
  return new Promise((resolve) => {
    chrome.storage.local.get([OFFLINE_QUEUE_KEY], (result) => {
      const queue = result[OFFLINE_QUEUE_KEY] || [];
      queue.push({ type, data, queuedAt: Date.now(), retries: 0 });
      chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: queue }, resolve);
    });
  });
}

/**
 * Replay all queued requests. Successfully replayed entries are removed.
 * Entries that still fail are kept with incremented retry count.
 * Entries with more than 10 retries are discarded to prevent indefinite growth.
 */
export async function processOfflineQueue() {
  return new Promise((resolve) => {
    chrome.storage.local.get([OFFLINE_QUEUE_KEY], async (result) => {
      const queue = result[OFFLINE_QUEUE_KEY] || [];
      if (queue.length === 0) {
        resolve();
        return;
      }

      const remaining = [];

      for (const entry of queue) {
        if (entry.retries > 10) {
          // Discard stale entries
          continue;
        }

        try {
          let success = false;
          switch (entry.type) {
            case 'startSession':
              await startSession(entry.data);
              success = true;
              break;
            case 'heartbeat':
              await heartbeat(entry.data.sessionId, entry.data);
              success = true;
              break;
            case 'endSession':
              await endSession(entry.data.sessionId, entry.data);
              success = true;
              break;
            case 'batchActivityLogs':
              await batchActivityLogs(entry.data);
              success = true;
              break;
            case 'postIdleEvent':
              await postIdleEvent(entry.data);
              success = true;
              break;
            case 'postBreakEvent':
              await postBreakEvent(entry.data);
              success = true;
              break;
            default:
              // Unknown type — discard
              success = true;
          }

          if (!success) {
            remaining.push({ ...entry, retries: entry.retries + 1 });
          }
        } catch (_) {
          remaining.push({ ...entry, retries: entry.retries + 1 });
        }
      }

      chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: remaining }, resolve);
    });
  });
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * Start a new tracking session.
 * POST /time-tracking/sessions/start
 */
export async function startSession(data) {
  const { apiBase, authToken } = await getSettings();
  try {
    return await apiFetch(`${apiBase}/time-tracking/sessions/start`, {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.warn('[SentrixAI] startSession offline:', e.message);
    await addToOfflineQueue('startSession', data);
    return { offline: true };
  }
}

/**
 * Send a heartbeat ping for an active session.
 * POST /time-tracking/sessions/:sessionId/heartbeat
 */
export async function heartbeat(sessionId, data) {
  const { apiBase, authToken } = await getSettings();
  try {
    return await apiFetch(`${apiBase}/time-tracking/sessions/${sessionId}/heartbeat`, {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.warn('[SentrixAI] heartbeat offline:', e.message);
    await addToOfflineQueue('heartbeat', { sessionId, ...data });
    return { offline: true };
  }
}

/**
 * End an active session.
 * POST /time-tracking/sessions/:sessionId/end
 */
export async function endSession(sessionId, data) {
  const { apiBase, authToken } = await getSettings();
  try {
    return await apiFetch(`${apiBase}/time-tracking/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.warn('[SentrixAI] endSession offline:', e.message);
    await addToOfflineQueue('endSession', { sessionId, ...data });
    return { offline: true };
  }
}

/**
 * Upload a batch of activity log entries.
 * POST /time-tracking/activity/batch
 */
export async function batchActivityLogs(logs) {
  if (!logs || logs.length === 0) return { success: true };
  const { apiBase, authToken } = await getSettings();
  try {
    return await apiFetch(`${apiBase}/time-tracking/activity/batch`, {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify({ logs }),
    });
  } catch (e) {
    console.warn('[SentrixAI] batchActivityLogs offline:', e.message);
    await addToOfflineQueue('batchActivityLogs', logs);
    return { offline: true };
  }
}

/**
 * Record an idle event.
 * POST /time-tracking/events/idle
 */
export async function postIdleEvent(data) {
  const { apiBase, authToken } = await getSettings();
  try {
    return await apiFetch(`${apiBase}/time-tracking/events/idle`, {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.warn('[SentrixAI] postIdleEvent offline:', e.message);
    await addToOfflineQueue('postIdleEvent', data);
    return { offline: true };
  }
}

/**
 * Record a break event (start or end).
 * POST /time-tracking/events/break
 */
export async function postBreakEvent(data) {
  const { apiBase, authToken } = await getSettings();
  try {
    return await apiFetch(`${apiBase}/time-tracking/events/break`, {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.warn('[SentrixAI] postBreakEvent offline:', e.message);
    await addToOfflineQueue('postBreakEvent', data);
    return { offline: true };
  }
}

/**
 * Fetch the tracking policy for this account (approved domains, schedule, etc.).
 * GET /time-tracking/policy
 */
export async function getPolicy() {
  const { apiBase, authToken } = await getSettings();
  try {
    return await apiFetch(`${apiBase}/time-tracking/policy`, {
      method: 'GET',
      headers: buildHeaders(authToken),
    });
  } catch (e) {
    console.warn('[SentrixAI] getPolicy offline:', e.message);
    return { offline: true };
  }
}

/**
 * Test that the API base URL and auth token are valid.
 * GET /health or /auth/me
 */
export async function testConnection(apiBase, authToken) {
  try {
    const resp = await fetch(`${apiBase}/health`, {
      method: 'GET',
      headers: buildHeaders(authToken),
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
