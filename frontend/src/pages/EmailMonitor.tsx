/**
 * Phase 5.1 — Email Monitor stabilization
 *
 * Changes from the previous pass:
 *   * Specific error surfacing — the backend emails route already has
 *     detailed error messages for Graph-credential / Graph-auth /
 *     user-not-found failures. Previously a generic `alert()` ate all
 *     of them. Now the actual message is shown inline with a banner.
 *   * Setup-required banner — if the backend returns 503 (credentials
 *     not configured), the page shows a persistent yellow banner with
 *     the exact env-var list that needs to be set.
 *   * Safe stats parsing — old code cast `statsData` through an anon
 *     type; any malformed shape rendered undefined counts. Now we
 *     validate the array + each row before using it.
 *   * Action mutation errors now show a toast-style alert with the
 *     backend's reason instead of failing silently.
 *   * Tab-switch no longer 500s on empty categories (react-query keeps
 *     previous data during refetch; empty state is explicit).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { emailsApi, EmailLog } from '../lib/api';

const CATEGORIES = ['all', 'urgent', 'important', 'low', 'spam'];

function categoryClass(cat?: string) {
  switch (cat) {
    case 'urgent': return 'td';
    case 'important': return 'tw';
    case 'low': return 'tb';
    case 'spam': return 'tgr';
    default: return 'tgr';
  }
}

/** Coerce the stats response into a guaranteed-safe array. */
function parseStats(data: unknown): Array<{ ai_category: string; total: number; pending_action: number }> {
  const rec = data as { byCategory?: unknown };
  const raw = Array.isArray(rec?.byCategory) ? rec.byCategory : [];
  return raw
    .filter((r): r is { ai_category: string; total: string | number; pending_action?: string | number } =>
      r != null && typeof (r as any).ai_category === 'string')
    .map((r) => ({
      ai_category: r.ai_category,
      total: Number(r.total) || 0,
      pending_action: Number(r.pending_action) || 0,
    }));
}

/** Pull a useful message from any axios-shape error. */
function errorDetail(err: unknown): { message: string; status?: number } {
  const e = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
  return {
    message: e.response?.data?.error ?? e.message ?? 'Unknown error',
    status: e.response?.status,
  };
}

export default function EmailMonitor() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeFilter, setActiveFilter] = useState('all');
  const [isScanning, setIsScanning] = useState(false);
  /** Surfaces the last scan / action error at the top of the page.
   *  Persistent — user dismisses explicitly. */
  const [pageError, setPageError] = useState<{ message: string; status?: number } | null>(null);

  const { data, isLoading, isError, error: listError, refetch } = useQuery({
    queryKey: ['emails', activeFilter],
    queryFn: () =>
      emailsApi.list({
        category: activeFilter !== 'all' ? activeFilter : undefined,
      }),
    select: (r) => r.data,
    retry: 0,
    staleTime: 30000,
  });

  const { data: statsData, error: statsError } = useQuery({
    queryKey: ['email-stats'],
    queryFn: () => emailsApi.stats(),
    select: (r) => r.data,
    retry: 0,
  });

  const actionMutation = useMutation({
    mutationFn: (id: string) => emailsApi.action(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['emails'] });
      void qc.invalidateQueries({ queryKey: ['email-stats'] });
    },
    onError: (err) => {
      setPageError(errorDetail(err));
    },
  });

  async function handleScan() {
    setIsScanning(true);
    setPageError(null);
    try {
      await emailsApi.scan(undefined, 25);
      void qc.invalidateQueries({ queryKey: ['emails'] });
      void qc.invalidateQueries({ queryKey: ['email-stats'] });
    } catch (err) {
      // Preserve the backend's specific error instead of a generic alert.
      setPageError(errorDetail(err));
    } finally {
      setIsScanning(false);
    }
  }

  function handleDraftReply(email: EmailLog) {
    const prompt = `Draft a professional reply to this email from ${email.from_name ?? email.from_address}. Subject: "${email.subject ?? ''}". Summary: ${email.ai_summary ?? ''}`;
    navigate(`/ai-assistant?prompt=${encodeURIComponent(prompt)}`);
  }

  const stats = parseStats(statsData);
  const isSetupIssue = pageError?.status === 503 || pageError?.status === 400;
  const hasListError = isError && listError;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>📧 Email Monitor</h1>
            <p>AI-powered Outlook email triage and categorization</p>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void handleScan()}
            disabled={isScanning}
          >
            {isScanning ? (
              <>
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                Scanning…
              </>
            ) : (
              '🔄 Scan Now'
            )}
          </button>
        </div>
      </div>

      {/* Page-level error banner. Persistent setup-required messages get
          a different color so they don't look like a transient error. */}
      {pageError && (
        <div
          style={{
            background: isSetupIssue ? '#fef3c7' : '#fee2e2',
            border: `1px solid ${isSetupIssue ? '#fcd34d' : '#fca5a5'}`,
            color: isSetupIssue ? '#92400e' : '#991b1b',
            padding: '12px 16px',
            borderRadius: 10,
            marginBottom: 16,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>{isSetupIssue ? '⚠️' : '✗'}</span>
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
            <strong>{isSetupIssue ? 'Setup required' : 'Request failed'}{pageError.status ? ` (${pageError.status})` : ''}:</strong>{' '}
            {pageError.message}
          </div>
          <button
            onClick={() => setPageError(null)}
            style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', color: 'inherit' }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Stats-load error — non-fatal, shown as a small notice */}
      {statsError && !pageError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
          Couldn't load category stats: {errorDetail(statsError).message}. Counts below may be stale.
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {CATEGORIES.filter((c) => c !== 'all').map((cat) => {
          const stat = stats.find((s) => s.ai_category === cat);
          const count = stat?.total ?? 0;
          const pending = stat?.pending_action ?? 0;
          return (
            <div
              key={cat}
              className="pn"
              style={{ padding: '12px 16px', cursor: 'pointer', minWidth: 100 }}
              onClick={() => setActiveFilter(cat)}
            >
              <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>
                {cat}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)' }}>{count}</div>
              {pending > 0 && (
                <div style={{ fontSize: 11, color: 'var(--dg)', marginTop: 2 }}>{pending} need action</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Filter buttons */}
      <div className="filter-bar">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`filter-btn ${activeFilter === cat ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveFilter(cat)}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* Email list */}
      <div className="pn">
        {isLoading ? (
          <div className="loading-overlay"><div className="spinner" /></div>
        ) : hasListError ? (
          <div className="empty-state">
            <div className="empty-state-icon">✗</div>
            <h3>Failed to load emails</h3>
            <p>{errorDetail(listError).message}</p>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        ) : !data?.emails?.length ? (
          <div className="empty-state">
            <div className="empty-state-icon">📧</div>
            <h3>No {activeFilter === 'all' ? '' : activeFilter} emails</h3>
            <p>Click "Scan Now" to fetch and categorize emails from Outlook.</p>
          </div>
        ) : (
          data.emails.map((email) => (
            <div key={email.id} className={`email-card ${!email.actioned && email.action_required ? 'unread' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="email-from">{email.from_name ?? email.from_address ?? 'Unknown'}</span>
                  {email.ai_category && (
                    <span className={categoryClass(email.ai_category)}>
                      {email.ai_category}
                    </span>
                  )}
                  {email.action_required && !email.actioned && (
                    <span className="tw">⚡ Action Required</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
                  {email.received_at
                    ? new Date(email.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '—'}
                </div>
              </div>

              <div className="email-subject">{email.subject ?? '(no subject)'}</div>
              {email.ai_summary && (
                <div className="email-preview" style={{ marginTop: 4, fontSize: 12, color: 'var(--t3)', fontStyle: 'italic' }}>
                  AI: {email.ai_summary}
                </div>
              )}

              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => handleDraftReply(email)}
                >
                  ✍️ Draft Reply
                </button>
                {!email.actioned && (
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => actionMutation.mutate(email.id)}
                    disabled={actionMutation.isPending}
                  >
                    {actionMutation.isPending ? 'Saving…' : '✓ Mark Actioned'}
                  </button>
                )}
                {email.actioned && (
                  <span className="tg" style={{ padding: '4px 8px' }}>✓ Actioned</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
