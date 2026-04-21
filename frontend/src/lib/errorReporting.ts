import api from './api';

// Minimal client-side error reporter. Ships window errors and unhandled
// promise rejections to the backend's in-memory error log. The backend
// stores the last 200 in a ring buffer that admins can read from the
// /admin/errors page.
//
// Intentionally NOT a full Sentry clone — no breadcrumbs, no sourcemaps
// processing, no session replay. Just the minimum needed to see "the app
// is crashing for somebody" in prod without paying for a vendor.

let installed = false;
let lastSig: string | null = null;
let lastTime = 0;

function sig(message: string): string {
  // First 200 chars is enough to dedupe a spammy repeated error (e.g. a
  // render loop throwing every tick) without bucketing genuinely different
  // errors together.
  return message.slice(0, 200);
}

export function reportError(message: string, stack?: string, level: 'error' | 'warning' = 'error'): void {
  // Throttle identical messages to once per 10s to avoid self-DOS.
  const s = sig(message);
  const now = Date.now();
  if (s === lastSig && now - lastTime < 10_000) return;
  lastSig = s;
  lastTime = now;

  // Fire-and-forget. Failures swallowed — if the error log endpoint itself
  // is down, reporting its failure would recurse.
  api.post('/error-log/client', {
    message,
    stack,
    level,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
  }).catch(() => { /* silently ignore */ });
}

export function installErrorReporting(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    const msg = event.message || String(event.error ?? 'Unknown window error');
    const stack = event.error instanceof Error ? event.error.stack : undefined;
    reportError(msg, stack);
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    let msg = 'Unhandled promise rejection';
    let stack: string | undefined;
    if (reason instanceof Error) {
      msg = reason.message || msg;
      stack = reason.stack;
    } else if (typeof reason === 'string') {
      msg = reason;
    } else if (reason && typeof reason === 'object') {
      try { msg = JSON.stringify(reason).slice(0, 500); } catch { /* ignore */ }
    }
    reportError(msg, stack);
  });
}
