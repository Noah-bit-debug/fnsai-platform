/**
 * Shared Loading / Empty / Error state components.
 *
 * Drop these in across the app for consistent UX. Replaces hand-rolled
 * `<div>Loading…</div>` and ad-hoc empty states with polished versions.
 */

export function LoadingState({
  message = 'Loading…',
  size = 'md',
}: {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dim = size === 'sm' ? 20 : size === 'md' ? 32 : 48;
  const pad = size === 'sm' ? 20 : size === 'md' ? 40 : 60;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: pad,
        textAlign: 'center',
        color: '#64748b',
        fontSize: 13,
      }}
    >
      <div
        aria-hidden
        style={{
          display: 'inline-block',
          width: dim,
          height: dim,
          border: '3px solid rgba(109,40,217,0.1)',
          borderTopColor: '#6d28d9',
          borderRadius: '50%',
          animation: 'fns-spin 0.8s linear infinite',
          marginBottom: 10,
        }}
      />
      <div>{message}</div>
      <style>{`@keyframes fns-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function EmptyState({
  icon = '📭',
  title,
  description,
  cta,
}: {
  icon?: string;
  title: string;
  description?: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        padding: 50,
        textAlign: 'center',
        background: '#fff',
        border: '1px dashed #e2e8f0',
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 10 }} aria-hidden>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 4 }}>{title}</div>
      {description && (
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: cta ? 16 : 0, maxWidth: 400, margin: '0 auto' }}>
          {description}
        </div>
      )}
      {cta && (
        <button
          onClick={cta.onClick}
          style={{
            marginTop: 14,
            padding: '9px 20px',
            background: '#6d28d9',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        padding: 24,
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderLeft: '4px solid #dc2626',
        borderRadius: 10,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 10 }} aria-hidden>⚠️</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#7f1d1d', marginBottom: 4 }}>{title}</div>
      {message && (
        <div style={{ fontSize: 13, color: '#991b1b', maxWidth: 480, margin: '0 auto 12px' }}>
          {message}
        </div>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '8px 18px',
            background: '#dc2626',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** Skip link — should be the first focusable element in the app shell.
 *  Hidden until focused. Sends keyboard users past the sidebar. */
export function SkipToMain() {
  return (
    <a
      href="#main-content"
      style={{
        position: 'absolute',
        left: 8,
        top: -100,
        zIndex: 9999,
        padding: '8px 16px',
        background: '#6d28d9',
        color: '#fff',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 6,
        textDecoration: 'none',
      }}
      onFocus={(e) => { e.currentTarget.style.top = '8px'; }}
      onBlur={(e) => { e.currentTarget.style.top = '-100px'; }}
    >
      Skip to main content
    </a>
  );
}
