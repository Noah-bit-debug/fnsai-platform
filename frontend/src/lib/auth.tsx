import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  useMsal,
  useIsAuthenticated,
  useAccount,
  MsalProvider,
} from '@azure/msal-react';
import { InteractionRequiredAuthError, AccountInfo } from '@azure/msal-browser';
import axios from 'axios';
import { msalInstance, loginRequest, apiTokenRequest } from './msal';

/**
 * Clerk-shaped auth shim over MSAL.
 *
 * The 9 frontend files that used @clerk/clerk-react continue to import
 * useAuth / useUser / useClerk / SignIn / RedirectToSignIn — from here —
 * and keep working with no code changes beyond the import path swap.
 *
 * Why shim instead of "just use MSAL directly":
 *   - Clerk's data shape is deeply entangled with 9 files across the SPA
 *     (user.firstName, user.primaryEmailAddress.emailAddress,
 *      user.publicMetadata.role, user.imageUrl…). Rewriting each of those
 *     to MSAL's AccountInfo shape = 50+ line-level edits + risk of
 *     introducing bugs in the RBAC flow.
 *   - The shim fits in ~250 LOC and is the single place to fix if we ever
 *     want to change the auth provider again.
 *
 * Role resolution:
 *   MSAL only carries Azure-level claims (oid, email, name). Our app-level
 *   role lives in the Postgres `users` table. After login we fetch it once
 *   from /api/v1/admin/whoami and expose it as user.publicMetadata.role so
 *   RBACContext keeps working with zero changes.
 */

// ─── Export the MSAL provider directly so main.tsx can wrap the app ─────
export { MsalProvider };
export { msalInstance };

// ─── Shape definitions that mirror Clerk's ClerkUser ────────────────────
export interface ClerkShapedUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  imageUrl: string;
  primaryEmailAddress: { emailAddress: string } | null;
  emailAddresses: Array<{ emailAddress: string }>;
  publicMetadata: { role?: string };
}

// ─── Whoami cache (fetched once per session per account) ───────────────
// The fetch happens inside useUser, but we cache at module level so
// every component that calls useUser shares the same state (otherwise
// each would refetch). Keyed by Azure oid.
type WhoamiCacheEntry = {
  promise: Promise<{ role?: string; email?: string; name?: string } | null>;
  value: { role?: string; email?: string; name?: string } | null;
};
const whoamiCache = new Map<string, WhoamiCacheEntry>();

function fetchWhoami(getToken: () => Promise<string | null>): Promise<{
  role?: string;
  email?: string;
  name?: string;
} | null> {
  return getToken()
    .then(async (token) => {
      if (!token) return null;
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
      const res = await axios.get(`${base}/api/v1/admin/whoami`, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true,
      });
      if (res.status !== 200) return null;
      return {
        role: res.data.role_in_db ?? undefined,
        email: res.data.email ?? undefined,
        name: res.data.name ?? undefined,
      };
    })
    .catch(() => null);
}

function splitName(full: string | null | undefined): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// ─── Token acquisition (silent + interactive fallback) ──────────────────
async function acquireTokenSilentOrPopup(account: AccountInfo): Promise<string | null> {
  try {
    const result = await msalInstance.acquireTokenSilent({
      ...apiTokenRequest,
      account,
    });
    return result.accessToken || result.idToken || null;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      try {
        const result = await msalInstance.acquireTokenPopup({
          ...apiTokenRequest,
          account,
        });
        return result.accessToken || result.idToken || null;
      } catch (popupErr) {
        console.error('[auth] popup token acquisition failed:', popupErr);
        return null;
      }
    }
    console.error('[auth] silent token acquisition failed:', err);
    return null;
  }
}

// ─── useAuth — Clerk-compat ───────────────────────────────────────────────
export interface UseAuthReturn {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const { accounts, inProgress } = useMsal();
  const account = useAccount(accounts[0] ?? null);
  const isSignedIn = !!account;

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!account) return null;
    return acquireTokenSilentOrPopup(account);
  }, [account]);

  const signOut = useCallback(async () => {
    await msalInstance.logoutRedirect({
      postLogoutRedirectUri: window.location.origin,
    });
  }, []);

  return {
    isLoaded: inProgress !== 'startup',
    isSignedIn,
    userId: account?.homeAccountId?.split('.')[0] ?? null, // Azure oid is first segment
    getToken,
    signOut,
  };
}

// ─── useUser — Clerk-compat (fetches DB role via /whoami) ────────────────
export interface UseUserReturn {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: ClerkShapedUser | null;
}

export function useUser(): UseUserReturn {
  const { accounts, inProgress } = useMsal();
  const account = useAccount(accounts[0] ?? null);
  const { getToken } = useAuth();

  // Local mirror of the whoami result. Updated once the cached fetch
  // resolves. Starts null; RBAC consumers handle `role === null` by
  // treating it as "loading" (RBACProvider already does).
  const [whoami, setWhoami] = useState<{ role?: string; email?: string; name?: string } | null>(
    () => (account ? whoamiCache.get(account.homeAccountId)?.value ?? null : null)
  );
  // Track the key we're currently subscribed to so the effect only fires
  // once per account change.
  const subscribedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!account) {
      setWhoami(null);
      subscribedRef.current = null;
      return;
    }
    const key = account.homeAccountId;
    if (subscribedRef.current === key) return;
    subscribedRef.current = key;

    const cached = whoamiCache.get(key);
    if (cached?.value) {
      setWhoami(cached.value);
      return;
    }
    const promise = cached?.promise ?? fetchWhoami(getToken);
    whoamiCache.set(key, { promise, value: cached?.value ?? null });
    promise.then((value) => {
      whoamiCache.set(key, { promise, value });
      if (subscribedRef.current === key) setWhoami(value);
    });
  }, [account, getToken]);

  const user = useMemo<ClerkShapedUser | null>(() => {
    if (!account) return null;
    // Azure's account.name is the full display name; split it to match
    // Clerk's firstName/lastName shape.
    const displayName = whoami?.name ?? account.name ?? null;
    const { first, last } = splitName(displayName);
    const email = whoami?.email ?? account.username ?? null;
    const oid = account.homeAccountId.split('.')[0];
    return {
      id: oid,
      firstName: first,
      lastName: last,
      fullName: displayName,
      imageUrl: '',
      primaryEmailAddress: email ? { emailAddress: email } : null,
      emailAddresses: email ? [{ emailAddress: email }] : [],
      publicMetadata: { role: whoami?.role },
    };
  }, [account, whoami]);

  return {
    isLoaded: inProgress !== 'startup',
    isSignedIn: !!account,
    user,
  };
}

// ─── useClerk — Clerk-compat (signOut + openUserProfile) ────────────────
export interface UseClerkReturn {
  signOut: (opts?: { redirectUrl?: string }) => Promise<void>;
  openUserProfile: () => void;
}

export function useClerk(): UseClerkReturn {
  const signOut = useCallback(async (opts?: { redirectUrl?: string }) => {
    await msalInstance.logoutRedirect({
      postLogoutRedirectUri: opts?.redirectUrl
        ? new URL(opts.redirectUrl, window.location.origin).toString()
        : window.location.origin,
    });
  }, []);

  const openUserProfile = useCallback(() => {
    // Azure doesn't have an in-app profile widget. Open the Microsoft
    // account page in a new tab — closest UX match to Clerk's modal.
    window.open('https://myaccount.microsoft.com/', '_blank', 'noopener');
  }, []);

  return { signOut, openUserProfile };
}

// ─── <SignIn /> — Clerk-compat login card ───────────────────────────────
// Mimics Clerk's SignIn component — a card with a "Sign in" button that
// triggers the MSAL popup/redirect flow. Supports the `routing="hash"`
// prop for API compat, even though MSAL handles routing internally.
export function SignIn(_props: { routing?: string }): React.ReactElement {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await msalInstance.loginRedirect(loginRequest);
    } catch (err) {
      console.error('[auth] sign-in failed:', err);
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        padding: 32,
        minWidth: 360,
        boxShadow: '0 8px 32px rgba(0,0,0,0.24)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: '#1e293b' }}>
        Sign in to FNS AI
      </div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
        Sign in with your Microsoft work account.
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        style={{
          width: '100%',
          padding: '12px 16px',
          background: '#2f2f2f',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 500,
          cursor: busy ? 'wait' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden>
          <rect x="1"  y="1"  width="9" height="9" fill="#F25022" />
          <rect x="11" y="1"  width="9" height="9" fill="#7FBA00" />
          <rect x="1"  y="11" width="9" height="9" fill="#00A4EF" />
          <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
        </svg>
        {busy ? 'Signing in…' : 'Sign in with Microsoft'}
      </button>
    </div>
  );
}

// ─── <RedirectToSignIn /> — Clerk-compat ────────────────────────────────
// Mimics Clerk's RedirectToSignIn. On mount, kicks the MSAL redirect flow.
// Renders nothing visible — the browser navigates to Microsoft login.
export function RedirectToSignIn(): React.ReactElement | null {
  const isAuthed = useIsAuthenticated();
  useEffect(() => {
    if (isAuthed) return;
    msalInstance.loginRedirect(loginRequest).catch((err) => {
      console.error('[auth] RedirectToSignIn failed:', err);
    });
  }, [isAuthed]);
  return null;
}
