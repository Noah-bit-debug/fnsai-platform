import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { credentialsApi, remindersApi } from '../../lib/api';
import api from '../../lib/api';
import DailySummaryWidget from '../../components/DailySummaryWidget';

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

type UrgencyTier = 'CRITICAL' | 'URGENT' | 'UPCOMING';

function getTier(days: number): UrgencyTier {
  if (days <= 7) return 'CRITICAL';
  if (days <= 14) return 'URGENT';
  return 'UPCOMING';
}

const TIER_STYLES: Record<UrgencyTier, { bg: string; border: string; label: string; color: string }> = {
  CRITICAL: { bg: 'rgba(220,38,38,0.07)', border: 'rgba(220,38,38,0.25)', label: 'CRITICAL', color: 'var(--dg)' },
  URGENT:   { bg: 'rgba(234,88,12,0.07)', border: 'rgba(234,88,12,0.25)', label: 'URGENT',   color: 'var(--wn)' },
  UPCOMING: { bg: 'rgba(202,138,4,0.06)', border: 'rgba(202,138,4,0.2)',  label: 'UPCOMING', color: '#ca8a04' },
};

export default function CredentialingDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const [compBadge, setCompBadge] = useState<{ total: number; completed: number; expired: number; overdue: number; completion_rate: number } | null>(null);

  useEffect(() => {
    api.get('/compliance/integration/overview-badge')
      .then(r => setCompBadge(r.data))
      .catch(() => {}); // silent fail
  }, []);
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const { data: expiringData, isLoading } = useQuery({
    queryKey: ['cred-dashboard-expiring'],
    queryFn: () => credentialsApi.expiring(),
  });

  const { data: remindersData, isLoading: loadingReminders } = useQuery({
    queryKey: ['cred-dashboard-reminders'],
    queryFn: () => remindersApi.list({ status: 'scheduled' }),
  });

  const { data: allCreds } = useQuery({
    queryKey: ['cred-dashboard-all'],
    queryFn: () => credentialsApi.list(),
  });

  const expiringSoon = expiringData?.data?.expiringSoon ?? [];
  const alreadyExpired = expiringData?.data?.alreadyExpired ?? [];
  const expiringWithin7 = expiringSoon.filter((c) => c.expiry_date && daysUntil(c.expiry_date) <= 7).length;
  const expiringWithin30 = expiringSoon.filter((c) => c.expiry_date && daysUntil(c.expiry_date) > 7 && daysUntil(c.expiry_date) <= 30).length;
  const totalAll = allCreds?.data?.credentials?.length ?? 0;
  const currentCount = totalAll - alreadyExpired.length - expiringSoon.length;
  const recentReminders = remindersData?.data?.reminders ?? [];

  // Sort all expiring by urgency
  const tieredCreds = [
    ...alreadyExpired.map((c) => ({ ...c, days: c.expiry_date ? daysUntil(c.expiry_date) : -999, tier: 'CRITICAL' as UrgencyTier })),
    ...expiringSoon.map((c) => {
      const days = c.expiry_date ? daysUntil(c.expiry_date) : 999;
      return { ...c, days, tier: getTier(days) };
    }),
  ].sort((a, b) => a.days - b.days);

  const handleSendReminder = async (cred: typeof tieredCreds[0]) => {
    setSendingId(cred.id);
    try {
      await remindersApi.create({
        type: 'email',
        trigger_type: 'credential_expiry',
        recipient_name: `${cred.first_name ?? ''} ${cred.last_name ?? ''}`.trim(),
        subject: `Action Required: ${cred.type} credential expiring ${cred.days < 0 ? '(EXPIRED)' : `in ${cred.days} days`}`,
        message: `Your ${cred.type} credential ${cred.days < 0 ? 'has expired' : `is expiring in ${cred.days} days`}. Please renew as soon as possible to remain eligible for placement.`,
        status: 'scheduled',
      });
      setSentMsg(`Reminder sent for ${cred.first_name} ${cred.last_name}.`);
      queryClient.invalidateQueries({ queryKey: ['cred-dashboard-reminders'] });
    } catch {
      setSentMsg('Failed to send reminder.');
    } finally {
      setSendingId(null);
      setTimeout(() => setSentMsg(null), 3000);
    }
  };

  const handleSendAll = async () => {
    setSendingAll(true);
    setSentMsg(null);
    let count = 0;
    for (const cred of tieredCreds) {
      try {
        await remindersApi.create({
          type: 'email',
          trigger_type: 'credential_expiry',
          recipient_name: `${cred.first_name ?? ''} ${cred.last_name ?? ''}`.trim(),
          subject: `Action Required: ${cred.type} credential expiring ${cred.days < 0 ? '(EXPIRED)' : `in ${cred.days} days`}`,
          message: `Your ${cred.type} credential ${cred.days < 0 ? 'has expired' : `is expiring in ${cred.days} days`}. Please renew immediately.`,
          status: 'scheduled',
        });
        count++;
      } catch { /* skip failures */ }
    }
    setSendingAll(false);
    setSentMsg(`${count} reminder${count !== 1 ? 's' : ''} generated.`);
    queryClient.invalidateQueries({ queryKey: ['cred-dashboard-reminders'] });
    setTimeout(() => setSentMsg(null), 4000);
  };

  // Compliance progress bars
  const totalTracked = totalAll || 1;
  const compliantPct = Math.round((currentCount / totalTracked) * 100);
  const expiringPct = Math.round((expiringSoon.length / totalTracked) * 100);
  const expiredPct = Math.round((alreadyExpired.length / totalTracked) * 100);

  return (
    <div>
      {/* Compliance Overview Bar */}
      {compBadge && (
        <div style={{
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.6px' }}>
            Compliance
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 18, fontWeight: 700,
              color: compBadge.completion_rate > 80 ? '#16a34a' : compBadge.completion_rate > 50 ? '#ea580c' : '#dc2626',
            }}>
              {compBadge.completion_rate}%
            </span>
            <div style={{ height: 4, width: 80, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${compBadge.completion_rate}%`,
                background: compBadge.completion_rate > 80 ? '#16a34a' : compBadge.completion_rate > 50 ? '#ea580c' : '#dc2626',
                borderRadius: 4,
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', background: '#f0fdf4', borderRadius: 8, padding: '3px 10px' }}>
            {compBadge.completed} Completed
          </span>
          {compBadge.expired > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', background: '#fef2f2', borderRadius: 8, padding: '3px 10px' }}>
              ⚠ {compBadge.expired} Expired
            </span>
          )}
          {compBadge.overdue > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#ea580c', background: '#fff7ed', borderRadius: 8, padding: '3px 10px' }}>
              {compBadge.overdue} Overdue
            </span>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <a
              href="/compliance/admin"
              style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}
            >
              View Compliance →
            </a>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--t1)' }}>Credentialing Dashboard</h1>
            <p style={{ color: 'var(--t3)', fontSize: 14 }}>{today}</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {sentMsg && (
              <span style={{ fontSize: 13, color: 'var(--ac)', fontWeight: 600 }}>{sentMsg}</span>
            )}
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => navigate('/credentialing')}
            >
              📋 All Credentials
            </button>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={handleSendAll}
              disabled={sendingAll || tieredCreds.length === 0}
              style={{ opacity: sendingAll ? 0.7 : 1 }}
            >
              {sendingAll ? 'Sending...' : `📧 Send All Reminders (${tieredCreds.length})`}
            </button>
          </div>
        </div>
      </div>

      {/* Daily Intelligence Widget */}
      <DailySummaryWidget />

      {/* 4 Stat Cards */}
      <div className="sc-grid">
        <div className="sc" style={{ borderTop: '3px solid var(--dg)' }}>
          <div className="sc-icon" style={{ background: 'rgba(220,38,38,0.1)', color: 'var(--dg)' }}>🔴</div>
          <div className="sc-label">Expired</div>
          <div className="sc-value" style={{ color: alreadyExpired.length > 0 ? 'var(--dg)' : 'var(--ac)' }}>
            {alreadyExpired.length}
          </div>
          <div className="sc-sub">Require immediate action</div>
        </div>

        <div className="sc" style={{ borderTop: '3px solid var(--dg)' }}>
          <div className="sc-icon" style={{ background: 'rgba(220,38,38,0.1)', color: 'var(--dg)' }}>🔔</div>
          <div className="sc-label">Expiring This Week</div>
          <div className="sc-value" style={{ color: expiringWithin7 > 0 ? 'var(--dg)' : 'var(--ac)' }}>
            {expiringWithin7}
          </div>
          <div className="sc-sub">Within 7 days</div>
        </div>

        <div className="sc" style={{ borderTop: '3px solid #ca8a04' }}>
          <div className="sc-icon" style={{ background: 'rgba(202,138,4,0.1)', color: '#ca8a04' }}>⏳</div>
          <div className="sc-label">Expiring This Month</div>
          <div className="sc-value" style={{ color: expiringWithin30 > 0 ? '#ca8a04' : 'var(--ac)' }}>
            {expiringWithin30}
          </div>
          <div className="sc-sub">Within 30 days</div>
        </div>

        <div className="sc" style={{ borderTop: '3px solid var(--ac)' }}>
          <div className="sc-icon" style={{ background: 'rgba(22,163,74,0.1)', color: 'var(--ac)' }}>✅</div>
          <div className="sc-label">All Current</div>
          <div className="sc-value" style={{ color: 'var(--ac)' }}>{currentCount}</div>
          <div className="sc-sub">No action needed</div>
        </div>
      </div>

      {/* Row 1: Expiration Timeline + Compliance Summary */}
      <div className="grid-2">
        {/* Expiration Timeline */}
        <div className="pn">
          <div className="pnh">
            <h3>⏱️ Expiration Timeline</h3>
            <span style={{ fontSize: 12, color: 'var(--t3)' }}>{tieredCreds.length} total</span>
          </div>
          <div className="pnb" style={{ padding: 0, maxHeight: 420, overflowY: 'auto' }}>
            {isLoading ? (
              <div className="spinner" style={{ margin: '32px auto' }} />
            ) : tieredCreds.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-icon">🎉</div>
                <h3>All credentials current!</h3>
                <p>No expiring or expired credentials.</p>
              </div>
            ) : (
              tieredCreds.map((cred) => {
                const tier = TIER_STYLES[cred.tier];
                const isSending = sendingId === cred.id;
                return (
                  <div
                    key={cred.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '11px 18px',
                      background: tier.bg,
                      borderLeft: `3px solid ${tier.color}`,
                      borderBottom: `1px solid ${tier.border}`,
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: tier.color,
                        background: `${tier.color}18`, borderRadius: 4,
                        padding: '2px 6px', flexShrink: 0, letterSpacing: '0.4px',
                      }}>
                        {tier.label}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {cred.first_name} {cred.last_name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--t3)' }}>{cred.type}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--t3)' }}>
                        {cred.expiry_date ? new Date(cred.expiry_date).toLocaleDateString() : '—'}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: tier.color }}>
                        {cred.days < 0 ? `${Math.abs(cred.days)}d expired` : `${cred.days}d left`}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={isSending}
                      onClick={() => handleSendReminder(cred)}
                      style={{ flexShrink: 0, fontSize: 12 }}
                    >
                      {isSending ? '...' : '📧 Remind'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right column: Compliance Summary + Reminder Status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Compliance Summary */}
          <div className="pn" style={{ flex: '0 0 auto' }}>
            <div className="pnh">
              <h3>📊 Compliance Summary</h3>
            </div>
            <div className="pnb">
              {[
                { label: 'Compliant', pct: compliantPct, count: currentCount, color: 'var(--ac)', bg: '#16a34a' },
                { label: 'Expiring', pct: expiringPct, count: expiringSoon.length, color: 'var(--wn)', bg: '#ea580c' },
                { label: 'Expired', pct: expiredPct, count: alreadyExpired.length, color: 'var(--dg)', bg: '#dc2626' },
              ].map((bar) => (
                <div key={bar.label} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: 'var(--t2)' }}>{bar.label}</span>
                    <span style={{ color: bar.color, fontWeight: 700 }}>{bar.count} ({bar.pct}%)</span>
                  </div>
                  <div style={{ height: 10, background: 'var(--sf3)', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--bd)' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.max(bar.pct, bar.count > 0 ? 3 : 0)}%`,
                      background: bar.bg,
                      borderRadius: 6,
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                </div>
              ))}
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <div style={{
                  fontSize: 36, fontWeight: 800,
                  color: compliantPct >= 90 ? 'var(--ac)' : compliantPct >= 70 ? 'var(--wn)' : 'var(--dg)',
                }}>
                  {compliantPct}%
                </div>
                <div style={{ fontSize: 12, color: 'var(--t3)' }}>Overall Compliance Rate</div>
              </div>
            </div>
          </div>

          {/* Reminder Status */}
          <div className="pn" style={{ flex: 1 }}>
            <div className="pnh">
              <h3>📧 Recent Reminders (7 days)</h3>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/reminders')}>
                All →
              </button>
            </div>
            <div className="pnb" style={{ padding: '8px 18px' }}>
              {loadingReminders ? (
                <div className="spinner" style={{ margin: '16px auto' }} />
              ) : recentReminders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--t3)', fontSize: 13 }}>
                  No reminders sent in the last 7 days.
                </div>
              ) : (
                recentReminders.slice(0, 5).map((r) => (
                  <div key={r.id} className="action-item" style={{ marginBottom: 6 }}>
                    <div className="action-dot blue" />
                    <div className="action-content">
                      <div className="action-title" style={{ fontSize: 12 }}>{r.subject}</div>
                      <div className="action-meta">{r.recipient_name ?? '—'}</div>
                    </div>
                    <span className="tg" style={{ fontSize: 11, textTransform: 'capitalize' }}>{r.status}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
