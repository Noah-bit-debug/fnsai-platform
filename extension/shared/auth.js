// shared/auth.js — Microsoft Entra ID OAuth (PKCE) for the extension.
//
// The backend validates Azure-issued ID tokens (RS256, audience = SPA
// App Registration client id). For the extension to talk to the API we
// run the same auth flow the SPA uses, just using
// chrome.identity.launchWebAuthFlow as the redirect surface.
//
// Storage shape (chrome.storage.local under MS_AUTH_KEY):
//   {
//     tenantId, clientId,
//     idToken, accessToken, refreshToken,
//     expiresAt        // ms epoch, with a 60s safety margin
//   }
//
// Public API:
//   signIn(tenantId, clientId)  → claims (decoded id_token payload)
//   signOut()
//   getValidIdToken()           → string | null  (refreshes silently if needed)
//   getCurrentUser()            → claims | null
//   getRedirectUrl()            → the URI to register in Azure
//   isSignedIn()                → boolean

import { MS_AUTH_KEY } from './constants.js';
import { storageGet, storageSet, storageRemove } from './storage.js';

const SCOPES = 'openid profile email offline_access User.Read';

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function generateCodeVerifier() {
  const buf = new Uint8Array(64);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(hash);
}

function decodeJwt(jwt) {
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

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function getStored() {
  const r = await storageGet([MS_AUTH_KEY]);
  return r[MS_AUTH_KEY] || null;
}

function setStored(value) {
  return storageSet({ [MS_AUTH_KEY]: value });
}

function clearStored() {
  return storageRemove(MS_AUTH_KEY);
}

// ---------------------------------------------------------------------------
// Token endpoint exchanges
// ---------------------------------------------------------------------------

async function exchangeCode({ tenantId, clientId, code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    scope: SCOPES,
  });
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

async function refreshTokens({ tenantId, clientId, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPES,
  });
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Refresh failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the chromiumapp.org redirect URL — register this exact URL in
 * Azure App Registration → Authentication → Single-page application.
 */
export function getRedirectUrl() {
  return chrome.identity.getRedirectURL();
}

export async function isSignedIn() {
  const stored = await getStored();
  return !!(stored && stored.idToken);
}

/**
 * Run the interactive OAuth flow. Must be called from a user gesture
 * (e.g. a button click in the options page). Service worker context
 * cannot show interactive UI.
 */
export async function signIn(tenantId, clientId) {
  if (!tenantId || !clientId) {
    throw new Error('Azure tenant ID and client ID are required.');
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const redirectUri = getRedirectUrl();
  const state = crypto.randomUUID();

  const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'select_account');

  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (url) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!url) {
          reject(new Error('Authentication was cancelled.'));
        } else {
          resolve(url);
        }
      }
    );
  });

  const params = new URL(responseUrl).searchParams;
  if (params.get('error')) {
    throw new Error(`${params.get('error')}: ${params.get('error_description') ?? ''}`);
  }
  if (params.get('state') !== state) throw new Error('OAuth state mismatch');
  const code = params.get('code');
  if (!code) throw new Error('Authorization code missing from response');

  const tokens = await exchangeCode({ tenantId, clientId, code, codeVerifier: verifier, redirectUri });

  const stored = {
    tenantId,
    clientId,
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: Date.now() + Math.max(0, (tokens.expires_in ?? 3600) - 60) * 1000,
  };
  await setStored(stored);
  return decodeJwt(tokens.id_token);
}

export async function signOut() {
  await clearStored();
}

export async function getCurrentUser() {
  const stored = await getStored();
  if (!stored?.idToken) return null;
  return decodeJwt(stored.idToken);
}

/**
 * Returns a non-expired id_token, refreshing silently via refresh_token
 * if needed. Returns null if not signed in or if refresh failed (e.g.
 * refresh token revoked or expired) — caller should prompt re-sign-in.
 */
export async function getValidIdToken() {
  const stored = await getStored();
  if (!stored?.idToken) return null;

  if (Date.now() < stored.expiresAt) return stored.idToken;

  if (!stored.refreshToken) {
    await clearStored();
    return null;
  }

  try {
    const fresh = await refreshTokens({
      tenantId: stored.tenantId,
      clientId: stored.clientId,
      refreshToken: stored.refreshToken,
    });
    const next = {
      ...stored,
      idToken: fresh.id_token ?? stored.idToken,
      accessToken: fresh.access_token ?? stored.accessToken,
      refreshToken: fresh.refresh_token ?? stored.refreshToken,
      expiresAt: Date.now() + Math.max(0, (fresh.expires_in ?? 3600) - 60) * 1000,
    };
    await setStored(next);
    return next.idToken;
  } catch (e) {
    console.warn('[SentrixAI] Token refresh failed:', e.message);
    await clearStored();
    return null;
  }
}
