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

export default function EmailMonitor() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeFilter, setActiveFilter] = useState('all');
  const [isScanning, setIsScanning] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['emails', activeFilter],
    queryFn: () =>
      emailsApi.list({
        category: activeFilter !== 'all' ? activeFilter : undefined,
      }),
    select: (r) => r.data,
    retry: 0,
    staleTime: 30000,
  });

  const { data: statsData } = useQuery({
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
  });

  async function handleScan() {
    setIsScanning(true);
    try {
      await emailsApi.scan(undefined, 25);
      void qc.invalidateQueries({ queryKey: ['emails'] });
      void qc.invalidateQueries({ queryKey: ['email-stats'] });
    } catch {
      alert('Failed to scan emails. Check Microsoft Graph credentials.');
    } finally {
      setIsScanning(false);
    }
  }

  function handleDraftReply(email: EmailLog) {
    const prompt = `Draft a professional reply to this email from ${email.from_name ?? email.from_address}. Subject: "${email.subject ?? ''}". Summary: ${email.ai_summary ?? ''}`;
    navigate(`/ai-assistant?prompt=${encodeURIComponent(prompt)}`);
  }

  const stats = (statsData as { byCategory?: Array<{ ai_category: string; total: string; pending_action: string }> })?.byCategory ?? [];

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

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {CATEGORIES.filter((c) => c !== 'all').map((cat) => {
          const stat = stats.find((s) => s.ai_category === cat);
          const count = stat ? Number(stat.total) : 0;
          const pending = stat ? Number(stat.pending_action) : 0;
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
        ) : isError || !data?.emails?.length ? (
          <div className="empty-state">
            <div className="empty-state-icon">📧</div>
            <h3>No emails found</h3>
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
                  >
                    ✓ Mark Actioned
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
