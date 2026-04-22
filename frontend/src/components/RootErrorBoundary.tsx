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
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

export default class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('[ErrorBoundary] uncaught render error:', error);
    console.error(info.componentStack);
    this.setState({ info: info.componentStack ?? null });
    // Fire-and-forget: report to the in-app error log so admins can see it
    try {
      fetch('/api/v1/error-log/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: 'error',
          message: error.message,
          stack: error.stack,
          path: typeof window !== 'undefined' ? window.location.pathname : null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      }).catch(() => { /* silent */ });
    } catch { /* silent */ }
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

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
              onClick={() => { this.setState({ error: null, info: null }); }}
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
