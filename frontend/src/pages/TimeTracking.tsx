import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionSummary {
  date: string;
  start_time: string;
  end_time: string | null;
  total_duration: number;
  active_duration: number;
  idle_duration: number;
  break_duration: number;
  auto_deducted_idle: number;
  status: 'active' | 'completed' | 'break';
}

interface IdleEvent {
  id: string;
  detected_at: string;
  duration: number;
  user_response: 'pending' | 'working' | 'idle' | null;
}

interface MeSummary {
  today: SessionSummary | null;
  sessions: SessionSummary[];
  daily_active: { date: string; active_duration: number }[];
  active_session: boolean;
}

interface ActiveSession {
  session_id: string | null;
  status: 'active' | 'break' | null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'active' | 'break' | 'none' }) {
  if (status === 'active') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#dcfce7', color: '#16a34a', borderRadius: 20, padding: '4px 12px', fontSize: 13, fontWeight: 600 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', animation: 'pulse 1.5s infinite', display: 'inline-block' }} />
      Session Active
    </span>
  );
  if (status === 'break') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fef9c3', color: '#a16207', borderRadius: 20, padding: '4px 12px', fontSize: 13, fontWeight: 600 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ca8a04', display: 'inline-block' }} />
      On Break
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f1f5f9', color: '#64748b', borderRadius: 20, padding: '4px 12px', fontSize: 13, fontWeight: 600 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />
      No Active Session
    </span>
  );
}

function ArcProgress({ fraction, label, sub }: { fraction: number; label: string; sub: string }) {
  const r = 60;
  const cx = 80;
  const cy = 80;
  const circumference = Math.PI * r; // half-circle arc
  const clampedFraction = Math.min(1, Math.max(0, fraction));
  const dash = clampedFraction * circumference;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={160} height={95} viewBox="0 0 160 95">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#e2e8f0" strokeWidth={12} strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="var(--pr, #1565c0)" strokeWidth={12} strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text x={cx} y={cy - 8} textAnchor="middle" style={{ fontSize: 15, fontWeight: 700, fill: '#1a2b3c' }}>{label}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" style={{ fontSize: 11, fill: '#64748b' }}>{sub}</text>
      </svg>
    </div>
  );
}

function MetricBadge({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px', textAlign: 'center', border: '1px solid #e8edf2', minWidth: 90 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? '#1a2b3c' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function WeeklyBar({ days }: { days: { date: string; active_duration: number }[] }) {
  const max = Math.max(...days.map((d) => d.active_duration), 1);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 64 }}>
      {days.map((d) => {
        const h = Math.max(4, (d.active_duration / max) * 56);
        const isToday = d.date === todayISO();
        return (
          <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div title={formatDuration(d.active_duration)} style={{
              width: '100%', height: h, borderRadius: 4,
              background: isToday ? 'var(--pr, #1565c0)' : '#93c5fd',
              transition: 'height 0.3s ease',
            }} />
            <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: isToday ? 700 : 400 }}>
              {new Date(d.date + 'T12:00').toLocaleDateString([], { weekday: 'short' })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ExtensionModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>Install SentrixAI Extension</div>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>The browser extension enables automatic time tracking based on your active browser sessions.</p>
        <ol style={{ fontSize: 14, color: '#374151', paddingLeft: 20, lineHeight: 1.9, marginBottom: 20 }}>
          <li>Open the Chrome Web Store / Edge Add-ons</li>
          <li>Search for <strong>SentrixAI Time Tracker</strong></li>
          <li>Click <strong>Add to Browser</strong></li>
          <li>Sign in with your SentrixAI account</li>
          <li>Tracking begins automatically during scheduled hours</li>
        </ol>
        <div style={{ background: '#f0f9ff', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#0369a1', marginBottom: 24 }}>
          Your employer has configured which domains count as work activity. Only domain metadata is tracked — page content is never recorded.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Got It
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TimeTracking() {
  const queryClient = useQueryClient();
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showExtModal, setShowExtModal] = useState(false);

  const { data: meData } = useQuery<{ data: MeSummary }>({
    queryKey: ['time-tracking-me'],
    queryFn: () => api.get('/time-tracking/me'),
    refetchInterval: 30000,
  });

  const { data: summaryData } = useQuery<{ data: { daily_active: { date: string; active_duration: number }[] } }>({
    queryKey: ['time-tracking-summary'],
    queryFn: () => api.get('/time-tracking/me/summary'),
    refetchInterval: 30000,
  });

  const { data: activeData } = useQuery<{ data: ActiveSession }>({
    queryKey: ['time-tracking-active'],
    queryFn: () => api.get('/time-tracking/sessions/active'),
    refetchInterval: 30000,
  });

  const respondMutation = useMutation({
    mutationFn: ({ id, response }: { id: string; response: 'working' | 'idle' }) =>
      api.patch(`/time-tracking/idle-events/${id}/respond`, { response }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['time-tracking-me'] }),
  });

  const me = meData?.data;
  const today = me?.today ?? null;
  const sessions = me?.sessions ?? [];
  const dailyActive = summaryData?.data?.daily_active ?? me?.daily_active ?? [];
  const activeSession = activeData?.data;

  const extensionConnected = !!(activeSession?.session_id);
  const sessionStatus: 'active' | 'break' | 'none' =
    activeSession?.status === 'active' ? 'active' :
    activeSession?.status === 'break' ? 'break' : 'none';

  const adjustedSeconds = today
    ? Math.max(0, (today.active_duration ?? 0) - (today.auto_deducted_idle ?? 0))
    : 0;

  const totalWorkday = 8 * 3600;
  const progressFraction = today ? Math.min(1, (today.active_duration ?? 0) / totalWorkday) : 0;

  // Pending idle events from today's session activity (filter from sessions if direct endpoint absent)
  const pendingIdle: IdleEvent[] = (me as any)?.idle_events_pending ?? [];

  return (
    <div>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>⏱ My Work Session</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {extensionConnected ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#dcfce7', color: '#15803d', borderRadius: 20, padding: '5px 14px', fontSize: 13, fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                Extension Connected
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f1f5f9', color: '#64748b', borderRadius: 20, padding: '5px 14px', fontSize: 13, fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />
                Extension Not Installed
              </span>
            )}
            <StatusBadge status={sessionStatus} />
          </div>
        </div>
      </div>

      {/* ── Today's Summary Hero ── */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e8edf2', padding: 28, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Today's Summary</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <ArcProgress
              fraction={progressFraction}
              label={today ? formatDuration(today.active_duration) : '0m'}
              sub="Active Work Time"
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <MetricBadge label="Total Session" value={today ? formatDuration(today.total_duration) : '—'} />
              <MetricBadge label="Active Time" value={today ? formatDuration(today.active_duration) : '—'} color="#16a34a" />
              <MetricBadge label="Idle Time" value={today ? formatDuration(today.idle_duration) : '—'} color="#dc2626" />
              <MetricBadge label="Break Time" value={today ? formatDuration(today.break_duration) : '—'} color="#ca8a04" />
            </div>
            <div style={{ background: '#eff6ff', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600, marginBottom: 2 }}>ADJUSTED PRODUCTIVE TIME</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: '#1d4ed8' }}>{formatDuration(adjustedSeconds)}</div>
              </div>
              {today && today.auto_deducted_idle > 0 && (
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  <span style={{ color: '#dc2626', fontWeight: 600 }}>−{formatDuration(today.auto_deducted_idle)}</span> auto-deducted idle
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Formula Info Box ── */}
      <div style={{ background: '#fefce8', border: '1px solid #fde047', borderRadius: 10, padding: '11px 16px', marginBottom: 20, fontSize: 13, color: '#713f12' }}>
        <strong>How Adjusted Time Is Calculated: </strong>
        Adjusted Work Time = Total Active Time − Deducted Idle Time − Break Time. Idle periods are auto-deducted when they exceed your organization's idle threshold.
      </div>

      {/* ── Pending Idle Events ── */}
      {pendingIdle.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #fca5a5', padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>Idle Events Requiring Your Review</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            We detected idle periods. Please confirm whether you were working so your time is accurately credited.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingIdle.map((evt) => (
              <div key={evt.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fef2f2', borderRadius: 10, padding: '12px 16px', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>Idle detected at {formatTime(evt.detected_at)}</span>
                  <span style={{ fontSize: 12, color: '#64748b', marginLeft: 10 }}>Duration: {formatDuration(evt.duration)}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => respondMutation.mutate({ id: evt.id, response: 'working' })}
                    disabled={respondMutation.isPending}
                    style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                  >
                    I Was Working
                  </button>
                  <button
                    onClick={() => respondMutation.mutate({ id: evt.id, response: 'idle' })}
                    disabled={respondMutation.isPending}
                    style={{ background: '#e2e8f0', color: '#374151', border: 'none', borderRadius: 7, padding: '6px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                  >
                    It Was Idle
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Sessions Table ── */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e8edf2', marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c' }}>Recent Sessions</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>Last 7 days</div>
        </div>
        {sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontSize: 14 }}>No sessions recorded yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Date', 'Start', 'End', 'Total', 'Active', 'Idle', 'Break', 'Adjusted', 'Status'].map((h) => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => {
                const adj = Math.max(0, (s.active_duration ?? 0) - (s.auto_deducted_idle ?? 0));
                const isExpanded = expandedRow === s.date;
                return (
                  <>
                    <tr
                      key={s.date}
                      onClick={() => setExpandedRow(isExpanded ? null : s.date)}
                      style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer', background: isExpanded ? '#f8fafc' : i % 2 === 0 ? '#fff' : '#fafbfc' }}
                    >
                      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>{formatDate(s.date)}</td>
                      <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{formatTime(s.start_time)}</td>
                      <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{s.end_time ? formatTime(s.end_time) : <span style={{ color: '#16a34a' }}>Active</span>}</td>
                      <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{formatDuration(s.total_duration)}</td>
                      <td style={{ padding: '11px 14px', fontSize: 13, color: '#16a34a', fontWeight: 600 }}>{formatDuration(s.active_duration)}</td>
                      <td style={{ padding: '11px 14px', fontSize: 13, color: '#dc2626' }}>{formatDuration(s.idle_duration)}</td>
                      <td style={{ padding: '11px 14px', fontSize: 13, color: '#ca8a04' }}>{formatDuration(s.break_duration)}</td>
                      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>{formatDuration(adj)}</td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{
                          background: s.status === 'active' ? '#dcfce7' : '#f1f5f9',
                          color: s.status === 'active' ? '#16a34a' : '#64748b',
                          borderRadius: 8, padding: '3px 10px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
                        }}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${s.date}-exp`}>
                        <td colSpan={9} style={{ padding: '12px 24px', background: '#f0f9ff', fontSize: 13, color: '#0369a1' }}>
                          <strong>Session Detail:</strong>&nbsp;
                          Active {formatDuration(s.active_duration)} · Idle {formatDuration(s.idle_duration)} · Break {formatDuration(s.break_duration)} · Auto-deducted {formatDuration(s.auto_deducted_idle ?? 0)} · Net Adjusted: <strong>{formatDuration(adj)}</strong>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Weekly Bar ── */}
      {dailyActive.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e8edf2', padding: '20px 24px', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>7-Day Active Time</div>
          <WeeklyBar days={dailyActive.slice(-7)} />
        </div>
      )}

      {/* ── Extension Banner ── */}
      {!extensionConnected && (
        <div style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', borderRadius: 16, border: '1px solid #bfdbfe', padding: '22px 28px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 32 }}>🧩</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1e40af', marginBottom: 4 }}>Install the SentrixAI Browser Extension</div>
            <div style={{ fontSize: 14, color: '#3b82f6' }}>Enable automatic time tracking based on your active browser sessions.</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setShowExtModal(true)}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
            >
              Get Chrome Extension
            </button>
            <button
              onClick={() => setShowExtModal(true)}
              style={{ background: '#fff', color: '#1565c0', border: '1px solid #93c5fd', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
            >
              Get Edge Extension
            </button>
          </div>
        </div>
      )}

      {showExtModal && <ExtensionModal onClose={() => setShowExtModal(false)} />}
    </div>
  );
}
