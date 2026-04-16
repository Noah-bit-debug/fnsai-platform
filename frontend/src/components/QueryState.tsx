import React from 'react';

/**
 * Shared wrapper for pages that load from an async query. Replaces the
 * "infinite spinner on empty/failed query" pattern that made the QA team
 * flag several pages as broken.
 *
 * Render order:
 *   isLoading  → spinner (until the query resolves)
 *   error      → error card with server message + Retry button
 *   isEmpty    → `empty` node (usually a call-to-action)
 *   default    → `children`
 *
 * `onRetry` is optional. If omitted, the retry button is hidden.
 */
export interface QueryStateProps {
  isLoading: boolean;
  error: unknown;
  isEmpty?: boolean;
  /** Rendered when no error, not loading, and isEmpty is true. */
  empty?: React.ReactNode;
  /** Called when the user clicks the Retry button on the error state. */
  onRetry?: () => void;
  /** Padding / min-height for the non-children states. */
  minHeight?: number;
  children: React.ReactNode;
}

export default function QueryState({
  isLoading,
  error,
  isEmpty,
  empty,
  onRetry,
  minHeight = 140,
  children,
}: QueryStateProps): React.ReactElement {
  if (isLoading) {
    return (
      <div
        style={{
          minHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          color: 'var(--t3)',
          fontSize: 13,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            border: '3px solid rgba(0,0,0,0.08)',
            borderTopColor: 'var(--pr)',
            borderRadius: '50%',
            animation: 'qs-spin 0.8s linear infinite',
            marginRight: 12,
          }}
        />
        Loading…
        <style>{`@keyframes qs-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    const e = error as {
      message?: string;
      response?: { data?: { error?: string; message?: string } };
    };
    const msg =
      e?.response?.data?.message ??
      e?.response?.data?.error ??
      e?.message ??
      'Something went wrong.';
    return (
      <div
        style={{
          minHeight,
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 10,
          padding: 16,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>⚠</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: '#991b1b', fontSize: 13, marginBottom: 4 }}>
            Failed to load
          </div>
          <div style={{ color: '#7f1d1d', fontSize: 12, marginBottom: 8 }}>{msg}</div>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                background: '#fff',
                border: '1px solid #fecaca',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                color: '#991b1b',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return <>{empty ?? <DefaultEmpty />}</>;
  }

  return <>{children}</>;
}

function DefaultEmpty() {
  return (
    <div
      style={{
        padding: 32,
        textAlign: 'center',
        color: 'var(--t3)',
        background: 'var(--sf)',
        border: '1px dashed var(--bd)',
        borderRadius: 'var(--br, 10px)',
        fontSize: 13,
      }}
    >
      No data yet.
    </div>
  );
}

/**
 * Convenience empty-state component with a title, optional subtitle, and a
 * primary call-to-action button. Use inside `empty={<EmptyCta …/>}`.
 */
export function EmptyCta({
  title,
  subtitle,
  ctaLabel,
  onCta,
}: {
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
}): React.ReactElement {
  return (
    <div
      style={{
        padding: 40,
        textAlign: 'center',
        color: 'var(--t3)',
        background: 'var(--sf)',
        border: '1px dashed var(--bd)',
        borderRadius: 'var(--br, 10px)',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)', marginBottom: subtitle ? 6 : 12 }}>
        {title}
      </div>
      {subtitle && <div style={{ fontSize: 12, marginBottom: 14, maxWidth: 420, margin: '0 auto 14px' }}>{subtitle}</div>}
      {ctaLabel && onCta && (
        <button
          onClick={onCta}
          style={{
            background: 'var(--pr)',
            color: 'var(--sf)',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
