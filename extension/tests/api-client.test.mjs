// tests/api-client.test.mjs — integration test for the request() retry path.
//
// Stubs `globalThis.chrome.storage.local` and `globalThis.fetch` so we can
// drive api-client.js through its full call graph (request → buildHeaders
// → getValidIdToken → forceRefreshIdToken → request retry).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeChromeStub(initialData = {}) {
  return {
    storage: {
      local: {
        _data: { ...initialData },
        get(keys, cb) {
          const out = {};
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) out[k] = this._data[k];
          cb(out);
        },
        set(data, cb) {
          Object.assign(this._data, data);
          if (cb) cb();
        },
        remove(keys, cb) {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete this._data[k];
          if (cb) cb();
        },
      },
    },
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeFetchSequence(responses) {
  let i = 0;
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (i >= responses.length) {
      throw new Error(`unexpected fetch #${i + 1}: ${url}`);
    }
    return responses[i++];
  };
  fn.calls = calls;
  return fn;
}

const validTokenStore = (overrides = {}) => ({
  tenantId: 'tid',
  clientId: 'cid',
  idToken: 'old-id',
  accessToken: 'old-access',
  refreshToken: 'old-rt',
  // Local clock thinks the token is still valid for an hour.
  expiresAt: Date.now() + 60 * 60 * 1000,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('startSession: 401 triggers force-refresh and retries with new token', async () => {
  globalThis.chrome = makeChromeStub({
    settings: { apiBase: 'http://test.local/api/v1' },
    msAuthTokens: validTokenStore(),
  });

  globalThis.fetch = makeFetchSequence([
    jsonResponse(401, { error: 'unauthorized' }),
    jsonResponse(200, {
      id_token: 'new-id',
      access_token: 'new-access',
      refresh_token: 'new-rt',
      expires_in: 3600,
    }),
    jsonResponse(201, { session: { id: 'srv-session-1' } }),
  ]);

  const { startSession } = await import('../shared/api-client.js');
  const result = await startSession({ tracking_mode: 'browser_profile' });

  assert.deepEqual(result, { session: { id: 'srv-session-1' } });
  assert.equal(globalThis.fetch.calls.length, 3);
  assert.match(globalThis.fetch.calls[0].url, /\/time-tracking\/sessions\/start$/);
  assert.match(globalThis.fetch.calls[1].url, /login\.microsoftonline\.com.*\/oauth2\/v2\.0\/token$/);
  assert.match(globalThis.fetch.calls[2].url, /\/time-tracking\/sessions\/start$/);

  // Retry request used the freshly-issued token, not the original
  const retryAuth = globalThis.fetch.calls[2].init.headers['Authorization'];
  assert.equal(retryAuth, 'Bearer new-id');

  // New tokens persisted
  assert.equal(globalThis.chrome.storage.local._data.msAuthTokens.idToken, 'new-id');
  assert.equal(globalThis.chrome.storage.local._data.msAuthTokens.refreshToken, 'new-rt');
});

test('startSession: refresh failure clears stored tokens and returns authFailed', async () => {
  globalThis.chrome = makeChromeStub({
    settings: { apiBase: 'http://test.local/api/v1' },
    msAuthTokens: validTokenStore(),
  });

  globalThis.fetch = makeFetchSequence([
    jsonResponse(401, { error: 'unauthorized' }),
    jsonResponse(400, { error: 'invalid_grant', error_description: 'refresh expired' }),
  ]);

  const { startSession } = await import('../shared/api-client.js');
  const result = await startSession({ tracking_mode: 'browser_profile' });

  assert.equal(result.authFailed, true);
  assert.equal(result.status, 401);

  // No third fetch — we don't retry the API call when the refresh itself fails
  assert.equal(globalThis.fetch.calls.length, 2);

  // Stored tokens cleared so the popup will surface the sign-in banner
  assert.equal(globalThis.chrome.storage.local._data.msAuthTokens, undefined);
});

test('testConnection: 200 returns ok=true', async () => {
  globalThis.chrome = makeChromeStub({
    settings: { apiBase: 'http://test.local/api/v1' },
    msAuthTokens: validTokenStore(),
  });

  globalThis.fetch = makeFetchSequence([
    jsonResponse(200, { session: null }),
  ]);

  const { testConnection } = await import('../shared/api-client.js');
  const result = await testConnection('http://test.local/api/v1');
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
});
