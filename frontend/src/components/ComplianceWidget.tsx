import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

interface ComplianceWidgetProps {
  clerkUserId?: string;
  staffId?: string;
  candidateId?: string;
  compact?: boolean;
  showRecords?: boolean;
}

interface ComplianceSummary {
  total: number;
  completed: number;
  pending: number;
  expired: number;
  failed: number;
  completion_rate: number;
}

interface ComplianceData {
  linked: boolean;
  staff?: { id: string; first_name: string; last_name: string; clerk_user_id?: string };
  summary?: ComplianceSummary;
  records?: any[];
  expiring_soon?: any[];
}

type WidgetState = 'loading' | 'error' | 'not_linked' | 'data';

function rateColor(rate: number): string {
  if (rate > 80) return '#16a34a';
  if (rate > 50) return '#ea580c';
  return '#dc2626';
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    completed:   { bg: '#dcfce7', color: '#166534' },
    pending:     { bg: '#f1f5f9', color: '#475569' },
    expired:     { bg: '#fee2e2', color: '#991b1b' },
    failed:      { bg: '#fee2e2', color: '#991b1b' },
    in_progress: { bg: '#dbeafe', color: '#1e40af' },
  };
  const s = map[status] ?? map.pending;
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span style={{ background: '#ede9fe', color: '#6d28d9', borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>
      {type}
    </span>
  );
}

export default function ComplianceWidget({
  clerkUserId,
  staffId,
  candidateId,
  compact = false,
  showRecords = false,
}: ComplianceWidgetProps) {
  const nav = useNavigate();
  const [state, setState] = useState<WidgetState>('loading');
  const [data, setData] = useState<ComplianceData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState('loading');
      setError('');
      try {
        let result: ComplianceData;

        if (staffId) {
          const res = await api.get(`/compliance/integration/staff/${staffId}/compliance`);
          result = res.data;
          if (!cancelled) {
            setData(result);
            setState(result.linked ? 'data' : 'not_linked');
          }
        } else if (candidateId) {
          const res = await api.get(`/compliance/integration/candidate/${candidateId}/compliance`);
          result = res.data;
          if (!cancelled) {
            setData(result);
            setState(result.linked ? 'data' : 'not_linked');
          }
        } else if (clerkUserId) {
          const res = await api.get('/compliance/competency-records?mine=true');
          const records = res.data?.records ?? res.data ?? [];
          const total = records.length;
          const completed = records.filter((r: any) => r.status === 'completed').length;
          const pending = records.filter((r: any) => r.status === 'pending' || r.status === 'in_progress').length;
          const expired = records.filter((r: any) => r.status === 'expired').length;
          const failed = records.filter((r: any) => r.status === 'failed').length;
          const completion_rate = total > 0 ? Math.round((completed / total) * 100) : 0;
          result = {
            linked: true,
            summary: { total, completed, pending, expired, failed, completion_rate },
            records,
          };
          if (!cancelled) {
            setData(result);
            setState('data');
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load compliance data');
          setState('error');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [staffId, candidateId, clerkUserId]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div style={{ padding: compact ? '10px 14px' : 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
        Loading compliance data…
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <div style={{ padding: compact ? '10px 14px' : 20, background: '#fee2e2', borderRadius: 10, border: '1px solid #fca5a5', color: '#991b1b', fontSize: 13 }}>
        {error || 'Unable to load compliance data.'}
      </div>
    );
  }

  // ── Not Linked ───────────────────────────────────────────────────────────
  if (state === 'not_linked') {
    return (
      <div style={{ padding: compact ? '10px 14px' : 20, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', color: '#64748b', fontSize: 13 }}>
        User account not linked. Link a Clerk account to track compliance.
      </div>
    );
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  const summary = data?.summary;
  const records = data?.records ?? [];
  const expiringSoon = data?.expiring_soon ?? [];

  if (!summary) {
    return (
      <div style={{ padding: 20, color: '#94a3b8', fontSize: 13 }}>No compliance data available.</div>
    );
  }

  const rate = summary.completion_rate ?? 0;
  const color = rateColor(rate);

  // Navigate target
  const adminHref = staffId
    ? `/compliance/admin/records?staff_id=${staffId}`
    : candidateId
      ? `/compliance/admin/records?candidate_id=${candidateId}`
      : clerkUserId
        ? `/compliance/admin/records?user_clerk_id=${clerkUserId}`
        : '/compliance/my';

  // ── Compact Mode ─────────────────────────────────────────────────────────
  if (compact) {
    return (
      <div
        onClick={() => nav(adminHref)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff' }}
      >
        {/* Circle */}
        <div style={{
          width: 38, height: 38, borderRadius: '50%', background: color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 800, fontSize: 12, flexShrink: 0,
        }}>
          {rate}%
        </div>

        {/* Label */}
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', flexShrink: 0 }}>{rate}% compliant</span>

        {/* Chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
            {summary.completed} completed
          </span>
          <span style={{ background: '#f1f5f9', color: '#475569', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
            {summary.pending} pending
          </span>
          {summary.expired > 0 && (
            <span style={{ background: '#fee2e2', color: '#dc2626', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
              {summary.expired} expired
            </span>
          )}
        </div>

        {/* Warning icon */}
        {summary.expired > 0 && (
          <span style={{ color: '#ea580c', fontSize: 15, flexShrink: 0 }}>⚠️</span>
        )}
      </div>
    );
  }

  // ── Full Mode ────────────────────────────────────────────────────────────
  const displayRecords = records.slice(0, 10);

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>Compliance Summary</div>
        <a
          href={adminHref}
          onClick={e => { e.preventDefault(); nav(adminHref); }}
          style={{ fontSize: 13, color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}
        >
          View Full Records →
        </a>
      </div>

      <div style={{ padding: '20px 20px 0' }}>
        {/* 4 stat boxes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total',     value: summary.total,     color: '#1e293b',  bg: '#f8fafc' },
            { label: 'Completed', value: summary.completed, color: '#16a34a',  bg: '#dcfce7' },
            { label: 'Pending',   value: summary.pending,   color: '#475569',  bg: '#f1f5f9' },
            { label: 'Expired',   value: summary.expired,   color: '#dc2626',  bg: '#fee2e2' },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '14px 16px', textAlign: 'center', border: `1px solid ${s.color}20` }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: s.color, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ height: 8, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${rate}%`, background: color, borderRadius: 99, transition: 'width 0.4s ease' }} />
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color, marginBottom: 16 }}>{rate}% Complete</div>

        {/* Expired warning */}
        {summary.expired > 0 && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', color: '#991b1b', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            ⚠ {summary.expired} item{summary.expired !== 1 ? 's' : ''} expired — action required
          </div>
        )}

        {/* Expiring soon */}
        {expiringSoon.length > 0 && (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 14px', color: '#c2410c', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            ⏳ {expiringSoon.length} item{expiringSoon.length !== 1 ? 's' : ''} expiring within 30 days
          </div>
        )}
      </div>

      {/* Records table */}
      {showRecords && (
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b', marginBottom: 10, marginTop: 4 }}>Records</div>
          {displayRecords.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>No records found.</div>
          ) : (
            <>
              <div style={{ borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Title', 'Type', 'Status', 'Due Date', 'Score'].map(h => (
                        <th key={h} style={{ padding: '9px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRecords.map((r: any, i: number) => (
                      <tr key={r.id ?? i} style={{ borderBottom: i < displayRecords.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 600, color: '#1e293b' }}>{r.title ?? r.competency_name ?? '—'}</td>
                        <td style={{ padding: '9px 12px' }}><TypeBadge type={r.type ?? r.competency_type ?? '—'} /></td>
                        <td style={{ padding: '9px 12px' }}><StatusBadge status={r.status ?? 'pending'} /></td>
                        <td style={{ padding: '9px 12px', color: '#64748b' }}>
                          {r.due_date ? new Date(r.due_date).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#64748b' }}>
                          {r.score != null ? `${r.score}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {records.length > 10 && (
                <div style={{ marginTop: 10, textAlign: 'right' }}>
                  <a
                    href={adminHref}
                    onClick={e => { e.preventDefault(); nav(adminHref); }}
                    style={{ fontSize: 13, color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}
                  >
                    View all {records.length} records →
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
