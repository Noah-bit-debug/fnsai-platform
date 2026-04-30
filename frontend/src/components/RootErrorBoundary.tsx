import { Component, type ReactNode } from 'react';

/**
 * Top-level error boundary. Without this, any uncaught render error in the
 * app (e.g. a broken page component, a bad API response parser, a new
 * component that throws on mount) unmounts the entire React tree — leaving
 * a totally blank page with no sidebar, no navigation, nothing.
 *
 * Phase 1 QA hit this: the Reminders page was blanking the whole shell.
 * With this boundary, the user sees a red error card + reload button
 * instead of a white page and they retain access to the sidebar/topbar.
 *
 * Phase 2 QA hit a different failure mode: after a Vercel deploy, browsers
 * holding the old index.html try to lazy-import chunk hashes that no
 * longer exist. The dynamic import rejects with a ChunkLoadError /
 * "Failed to fetch dynamically imported module". The generic recovery
 * card here was useless for that — clicking "Try again" re-triggered
 * the same broken import. We now detect chunk-load failures specifically
 * and offer a hard reload that picks up the new index.html.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
  isChunkLoad: boolean;
}

// Match Vite/Webpack/Rollup chunk-load error shapes across browsers.
// Chrome: TypeError "Failed to fetch dynamically imported module: ..."
// Firefox: "error loading dynamically imported module"
// Safari: "Importing a module script failed."
// Vite ships its own ChunkLoadError class on some configs.
//
// Exported for testing — see RootErrorBoundary.test.tsx.
export function isChunkLoadError(error: Error): boolean {
  const name = error.name ?? '';
  const msg = error.message ?? '';
  return (
    name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

export default class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, isChunkLoad: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null, isChunkLoad: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('[ErrorBoundary] uncaught render error:', error);
    console.error(info.componentStack);
    this.setState({ info: info.componentStack ?? null });

    // Auto-reload on chunk-load errors after a short delay so the user sees
    // *why* the page is reloading. Prevents an infinite loop by gating on a
    // sessionStorage marker — if we just reloaded for this reason, we stop
    // and show the error card so the user isn't stuck in a loop on a real
    // outage.
    if (isChunkLoadError(error)) {
      try {
        const reloadedKey = 'fns_chunk_reload_at';
        const last = Number(sessionStorage.getItem(reloadedKey) ?? '0');
        const now = Date.now();
        if (now - last > 30_000) {
          sessionStorage.setItem(reloadedKey, String(now));
          setTimeout(() => { window.location.reload(); }, 1200);
        }
      } catch { /* sessionStorage may be disabled (private mode) — fall through */ }
    }

    // Fire-and-forget: report to the in-app error log so admins can see it
    try {
      fetch('/api/v1/error-log/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: 'error',
          message: error.message,
          stack: error.stack,
          chunk_load: isChunkLoadError(error),
          path: typeof window !== 'undefined' ? window.location.pathname : null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      }).catch(() => { /* silent */ });
    } catch { /* silent */ }
  }

  render() {
    const { error, info, isChunkLoad } = this.state;
    if (!error) return this.props.children;

    // Distinct UI for the deploy-version-mismatch case: lighter color,
    // no scary stack trace, and the primary action is "Reload" (not
    // "Try again", which would just re-trigger the same broken import).
    if (isChunkLoad) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, background: '#f8fafc',
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
            padding: 28, maxWidth: 480, width: '100%',
            boxShadow: '0 4px 16px rgba(15,23,42,0.06)',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
              A new version is ready
            </div>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 18, lineHeight: 1.55 }}>
              The app updated since this tab was opened, so a piece of code we tried to load no longer exists.
              Reloading the page will pick up the new version.
            </div>
            <button
              onClick={() => { window.location.reload(); }}
              style={{ padding: '10px 18px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#fef2f2',
      }}>
        <div style={{
          background: '#fff',
          borderRadius: 12,
          border: '1px solid #fecaca',
          padding: 28,
          maxWidth: 720,
          width: '100%',
          boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#991b1b', marginBottom: 8 }}>
            Something broke on this page
          </div>
          <div style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 16, lineHeight: 1.5 }}>
            A rendering error stopped the page from loading. The rest of the app should still work —
            you can navigate away using the sidebar, or reload.
          </div>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 10, marginBottom: 12, fontFamily: 'monospace', fontSize: 12, color: '#991b1b', overflowX: 'auto' }}>
            {error.message || String(error)}
          </div>
          {info && (
            <details style={{ fontSize: 11, color: '#7f1d1d' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Stack trace</summary>
              <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>{info}</pre>
            </details>
          )}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              onClick={() => { this.setState({ error: null, info: null, isChunkLoad: false }); }}
              style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >
              Try again
            </button>
            <button
              onClick={() => { window.location.reload(); }}
              style={{ padding: '8px 16px', background: '#fff', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
