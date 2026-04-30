import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/globals.css';
import './styles/mobile.css';
import { setTokenGetter } from './lib/api';
import { installErrorReporting } from './lib/errorReporting';
import { ToastProvider } from './components/ToastHost';
import { ConfirmProvider } from './components/ConfirmHost';
import { MsalProvider, msalInstance, useAuth } from './lib/auth';
import { EventType } from '@azure/msal-browser';
import { PermissionsProvider } from './contexts/PermissionsContext';

// One-shot — attaches window.onerror + unhandledrejection listeners that
// POST client-side errors to /api/v1/error-log/client for admin triage.
installErrorReporting();

// ─── MSAL initialisation ───────────────────────────────────────────────
// MSAL needs a one-time initialize() call before React renders — without
// it, acquireTokenSilent throws "not yet initialized". We also handle the
// LOGIN_SUCCESS event to set the active account, which is what React's
// useAccount() reads.
//
// CRITICAL: this promise MUST have a .catch() AND a timeout. If
// initialize() rejects (bad tenant ID, popup blocker, third-party-cookie
// block, transient network), without a catch nothing renders — React
// never mounts — and the user sees a permanent white screen with no
// error message and no way to recover. If initialize() *hangs* (network
// stall, slow DNS, Azure outage), neither .then nor .catch ever fires,
// which produced the same white-screen symptom for a different reason.
// The Promise.race below caps the wait at 12s and surfaces a recovery
// card via renderInitFallback so the user always lands on something
// actionable rather than a blank page.
const MSAL_INIT_TIMEOUT_MS = 12_000;

const initTimeout = new Promise<never>((_resolve, reject) => {
  setTimeout(
    () => reject(new Error(`MSAL initialize() exceeded ${MSAL_INIT_TIMEOUT_MS}ms — likely a network or Azure AD issue.`)),
    MSAL_INIT_TIMEOUT_MS,
  );
});

Promise.race([msalInstance.initialize(), initTimeout]).then(() => {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0 && !msalInstance.getActiveAccount()) {
    msalInstance.setActiveAccount(accounts[0]);
  }
  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
      const payload = event.payload as { account?: import('@azure/msal-browser').AccountInfo };
      if (payload.account) msalInstance.setActiveAccount(payload.account);
    }
  });

  bootstrap();
}).catch((err: unknown) => {
  renderInitFallback(err);
});

// Hand-rolled fallback rendered directly into #root before any React
// provider is mounted. Plain DOM, no React, no router — just enough
// for the user to see what went wrong and reload. Inline styles only
// so we don't need our CSS bundle to have parsed yet.
function renderInitFallback(err: unknown): void {
  const root = document.getElementById('root');
  if (!root) return;
  const message = err instanceof Error ? err.message : String(err);
  // Best-effort error report; if this also fails, swallow — the user
  // is already in a fallback path.
  try {
    void fetch('/api/v1/error-log/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'msal_init_failure',
        message,
        stack: err instanceof Error ? err.stack : null,
        userAgent: navigator.userAgent,
        href: window.location.href,
      }),
      keepalive: true,
    }).catch(() => { /* fallback path — telemetry is best-effort */ });
  } catch { /* same */ }
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:24px">
      <div style="max-width:480px;background:#fff;border:1px solid #fecaca;border-radius:14px;padding:28px 32px;box-shadow:0 12px 32px rgba(15,23,42,0.08)">
        <div style="font-size:14px;font-weight:700;color:#dc2626;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:8px">Sign-in unavailable</div>
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#111827">We couldn't reach Microsoft sign-in.</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.55">
          This usually means a popup blocker, third-party cookie block, or a transient network issue. Reloading the page will retry.
        </p>
        <div style="background:#fef2f2;border:1px solid #fee2e2;border-radius:8px;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#991b1b;margin-bottom:18px;word-break:break-word">${escapeHtml(message)}</div>
        <button id="fns-reload-btn" type="button"
          style="background:#1565c0;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600;font-size:14px;cursor:pointer">
          Reload page
        </button>
      </div>
    </div>`;
  const btn = document.getElementById('fns-reload-btn');
  if (btn) btn.addEventListener('click', () => { window.location.reload(); });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' : '&#39;'
  ));
}

function bootstrap() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 2, // 2 minutes
        retry: 1,
      },
    },
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ToastProvider>
              <ConfirmProvider>
                <PermissionsProvider>
                  <AppWithAuth />
                </PermissionsProvider>
              </ConfirmProvider>
            </ToastProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </MsalProvider>
    </React.StrictMode>
  );
}

// Inner component that has access to our MSAL-backed auth hook. Wires
// the token getter for our axios instance so every API call picks up
// the current Azure access token.
function AppWithAuth() {
  const { getToken } = useAuth();
  React.useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);

  return <App />;
}
