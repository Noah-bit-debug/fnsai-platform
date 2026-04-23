import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SummaryMetrics {
  candidates_total?:       number;
  placements_active?:      number;
  reminders_overdue?:      number;
  credentials_expiring?:   number;
  onboarding_incomplete?:  number;
  pending_questions?:      number;
  [key: string]: number | undefined;
}

interface RiskAlert {
  severity: 'high' | 'medium' | 'low';
  message: string;
}

type SummaryPeriod = 'day' | 'week' | 'month';
type SummaryScope  = 'all' | 'recruiting' | 'hr' | 'credentialing' | 'bd' | 'ceo';

/** Label + emoji + color for each scope tab. 'all' is the neutral
 *  organization-wide view; the others are role-targeted lenses. */
const SCOPE_META: Record<SummaryScope, { label: string; icon: string; color: string }> = {
  all:           { label: 'All',            icon: '🧭', color: '#475569' },
  recruiting:    { label: 'Recruiting',     icon: '🎯', color: '#1565c0' },
  hr:            { label: 'HR',             icon: '🧑‍💼', color: '#2e7d32' },
  credentialing: { label: 'Credentialing',  icon: '📋', color: '#6a1b9a' },
  bd:            { label: 'Business Dev',   icon: '💼', color: '#e65100' },
  ceo:           { label: 'CEO',            icon: '👔', color: '#991b1b' },
};

interface DailySummaryRecord {
  id: string;
  summary_date: string;
  period: SummaryPeriod;
  scope: SummaryScope;
  headline: string;
  narrative: string;
  status: 'generated' | 'reviewed' | 'dismissed';
  metrics: SummaryMetrics;
  risk_alerts: RiskAlert[] | string[];
  suggestions_generated: number;
  questions_generated: number;
  generated_at: string;
  reviewed_at?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  generated: '#1565c0',
  reviewed:  '#2e7d32',
  dismissed: '#546e7a',
};

const STATUS_BG: Record<string, string> = {
  generated: '#eff6ff',
  reviewed:  '#f0fdf4',
  dismissed: '#f8fafc',
};

const METRIC_META: Record<string, { label: string; icon: string; color: string }> = {
  candidates_total:      { label: 'Total Candidates',       icon: '👤', color: '#1565c0' },
  placements_active:     { label: 'Active Placements',      icon: '🔗', color: '#2e7d32' },
  reminders_overdue:     { label: 'Overdue Reminders',      icon: '🔔', color: '#c62828' },
  credentials_expiring:  { label: 'Credentials Expiring',   icon: '🏥', color: '#e65100' },
  onboarding_incomplete: { label: 'Incomplete Onboarding',  icon: '✅', color: '#6a1b9a' },
  pending_questions:     { label: 'Pending Questions',      icon: '❓', color: '#00838f' },
};

const ALERT_META: Record<string, { icon: string; color: string; bg: string }> = {
  high:   { icon: '🚨', color: '#c62828', bg: '#fef2f2' },
  medium: { icon: '⚠️',  color: '#e65100', bg: '#fff7ed' },
  low:    { icon: 'ℹ️',  color: '#1565c0', bg: '#eff6ff' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function toISODate(date: Date): string {
  // LOCAL-timezone YYYY-MM-DD. `toISOString()` returns UTC — after ~7 PM
  // CDT that flips "today" forward a day, which confused daily-summary
  // lookups.
  return date.toLocaleDateString('en-CA');
}

// ─── Sidebar Recent List ──────────────────────────────────────────────────────

interface RecentSummary {
  id: string;
  summary_date: string;
  headline: string;
  status: string;
}

interface RecentSidebarProps {
  items: RecentSummary[];
  selectedDate: string;
  onSelect: (date: string) => void;
}

function RecentSidebar({ items, selectedDate, onSelect }: RecentSidebarProps) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', overflow: 'hidden', position: 'sticky', top: 20 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #e8edf2', fontWeight: 700, fontSize: 13, color: '#1a2b3c' }}>
        Recent Summaries
      </div>
      {items.length === 0 ? (
        <div style={{ padding: '20px 16px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>No recent summaries</div>
      ) : (
        items.map(item => {
          const isSelected = item.summary_date === selectedDate;
          const statusColor = STATUS_COLORS[item.status] ?? '#546e7a';
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.summary_date)}
              style={{
                width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
                background: isSelected ? '#eff6ff' : 'transparent',
                borderLeft: isSelected ? '3px solid #1565c0' : '3px solid transparent',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: isSelected ? '#1565c0' : '#374151', marginBottom: 3 }}>
                {new Date(item.summary_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4, marginBottom: 4 }}>
                {item.headline.slice(0, 60)}{item.headline.length > 60 ? '…' : ''}
              </div>
              <span style={{ background: STATUS_BG[item.status] ?? '#f8fafc', color: statusColor, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 700, textTransform: 'capitalize' }}>
                {item.status}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DailySummary() {
  const todayStr = toISODate(new Date());

  const [selectedDate, setSelectedDate]   = useState(todayStr);
  // Period extension — user can flip between Day / Week / Month and each
  // is stored as its own row keyed by (summary_date, period). Defaults
  // to 'day' on first load to match prior behavior.
  const [period, setPeriod]               = useState<SummaryPeriod>('day');
  // Scope lens — 'all' = organization-wide (default), others = role-
  // targeted views. Each (date, period, scope) is its own stored row.
  const [scope, setScope]                 = useState<SummaryScope>('all');
  const [summary, setSummary]             = useState<DailySummaryRecord | null>(null);
  const [recentList, setRecentList]       = useState<RecentSummary[]>([]);
  const [loading, setLoading]             = useState(true);
  const [generating, setGenerating]       = useState(false);
  const [marking, setMarking]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  const fetchSummary = async (date: string, p: SummaryPeriod, s: SummaryScope) => {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await api.get(`/daily-summary/${date}`, { params: { period: p, scope: s } });
      setSummary(res.data ?? null);
    } catch (e: any) {
      if (e?.response?.status !== 404) {
        setError(e?.response?.data?.error ?? 'Failed to load summary.');
      }
      // 404 is the expected "not generated yet" case — leave summary null.
    } finally {
      setLoading(false);
    }
  };

  const fetchRecent = async (p?: SummaryPeriod, s?: SummaryScope) => {
    try {
      const params: Record<string, string> = {};
      if (p) params.period = p;
      if (s) params.scope = s;
      const res = await api.get('/daily-summary', { params });
      setRecentList(res.data?.summaries ?? []);
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    fetchSummary(selectedDate, period, scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, period, scope]);

  useEffect(() => {
    fetchRecent();
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await api.post('/daily-summary/generate', { date: selectedDate, period, scope });
      setSummary(res.data ?? null);
      fetchRecent();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to generate summary.');
    } finally {
      setGenerating(false);
    }
  };

  const handleMarkReviewed = async () => {
    if (!summary) return;
    setMarking(true);
    try {
      const res = await api.post(`/daily-summary/${summary.id}/review`);
      setSummary(prev => prev ? { ...prev, status: 'reviewed', reviewed_at: res.data?.reviewed_at } : prev);
      fetchRecent();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Failed to mark as reviewed.');
    } finally {
      setMarking(false);
    }
  };

  const metricEntries = summary ? Object.entries(METRIC_META).map(([key, meta]) => ({
    key, meta, value: summary.metrics?.[key] ?? 0,
  })) : [];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>
              📅 {period === 'day' ? 'Daily' : period === 'week' ? 'Weekly' : 'Monthly'} Summary
              {scope !== 'all' && (
                <span style={{ fontSize: 15, fontWeight: 600, color: SCOPE_META[scope].color, marginLeft: 12, padding: '3px 10px', background: SCOPE_META[scope].color + '18', borderRadius: 999, verticalAlign: 'middle' }}>
                  {SCOPE_META[scope].icon} {SCOPE_META[scope].label}
                </span>
              )}
            </h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>
              AI-generated intelligence digest {period === 'day' ? 'for the selected day' : period === 'week' ? 'for the trailing 7 days' : 'for the trailing 30 days'}
              {scope !== 'all' && ` · targeted at ${SCOPE_META[scope].label.toLowerCase()}`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Period toggle. Each option is stored as its own row so
                switching between Day / Week / Month is instant and the
                comparison-over-time history survives. */}
            <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 8, padding: 3, border: '1px solid #e2e8f0' }}>
              {(['day', 'week', 'month'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  style={{
                    padding: '6px 14px',
                    background: period === p ? '#fff' : 'transparent',
                    color: period === p ? '#1565c0' : '#64748b',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: period === p ? 700 : 500,
                    cursor: 'pointer',
                    boxShadow: period === p ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                    textTransform: 'capitalize',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={selectedDate}
              max={todayStr}
              onChange={e => setSelectedDate(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, color: '#1a2b3c', outline: 'none', background: '#fff' }}
              title={period === 'day' ? 'Select a day' : period === 'week' ? 'Select end-of-week date' : 'Select end-of-month date'}
            />
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: generating ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: generating ? 0.7 : 1 }}
            >
              {generating ? 'Generating...' : `🔄 Generate ${period === 'day' ? 'Daily' : period === 'week' ? 'Weekly' : 'Monthly'}`}
            </button>
          </div>
        </div>
      </div>

      {/* Scope tabs — role-targeted lenses on the same underlying
          metrics. Clicking a scope refetches/regenerates with Claude
          re-framed for that audience. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', padding: '0 4px' }}>
        {(Object.keys(SCOPE_META) as SummaryScope[]).map((s) => {
          const meta = SCOPE_META[s];
          const active = scope === s;
          return (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                padding: '7px 14px',
                background: active ? meta.color : '#fff',
                color: active ? '#fff' : meta.color,
                border: `1.5px solid ${meta.color}${active ? '' : '40'}`,
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: active ? 700 : 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s',
              }}
              title={`${meta.label} view — Claude will emphasize this team's concerns`}
            >
              <span>{meta.icon}</span>
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 20, alignItems: 'start' }}>

        {/* Main column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Loading / Error */}
          {loading && (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 60, textAlign: 'center', color: '#64748b' }}>
              Loading summary...
            </div>
          )}

          {/* No summary state */}
          {!loading && !summary && (
            <div style={{ background: '#fff', borderRadius: 16, border: '2px dashed #e8edf2', padding: 80, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 14 }}>📅</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>No summary yet</div>
              <div style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
                {selectedDate === todayStr
                  ? "Today's intelligence digest hasn't been generated yet."
                  : `No summary found for ${formatDate(selectedDate)}.`}
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 26px', cursor: generating ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 15, opacity: generating ? 0.7 : 1 }}
              >
                {generating ? '✨ Generating...' : '✨ Generate Now'}
              </button>
            </div>
          )}

          {/* Hero card */}
          {!loading && summary && (
            <>
              <div style={{ background: 'linear-gradient(135deg,#1a2b3c 0%,#1e3a5f 100%)', borderRadius: 16, padding: '28px 32px', color: '#fff', position: 'relative', overflow: 'hidden' }}>
                {/* Background decoration */}
                <div style={{ position: 'absolute', top: -20, right: -20, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
                <div style={{ position: 'absolute', bottom: -40, right: 40, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />

                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                        {formatDate(summary.summary_date)}
                      </div>
                      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.3, margin: 0 }}>{summary.headline}</h2>
                    </div>
                    <span style={{
                      background: STATUS_BG[summary.status] ?? '#f8fafc',
                      color: STATUS_COLORS[summary.status] ?? '#546e7a',
                      borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 700,
                      textTransform: 'capitalize', whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {summary.status}
                    </span>
                  </div>

                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 20 }}>
                    Generated at {formatTime(summary.generated_at)}
                    {summary.reviewed_at && ` · Reviewed at ${formatTime(summary.reviewed_at)}`}
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 16 }}>
                    {summary.narrative.split('\n').filter(Boolean).map((para, i) => (
                      <p key={i} style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.7, margin: '0 0 10px' }}>{para}</p>
                    ))}
                  </div>

                  {summary.status !== 'reviewed' && (
                    <div style={{ marginTop: 20 }}>
                      <button
                        onClick={handleMarkReviewed}
                        disabled={marking}
                        style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: '8px 18px', cursor: marking ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13, backdropFilter: 'blur(4px)' }}
                      >
                        {marking ? 'Marking...' : '✓ Mark as Reviewed'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Metrics grid */}
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c', marginBottom: 12 }}>Key Metrics</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {metricEntries.map(({ key, meta, value }) => (
                    <div key={key} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8edf2', padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontSize: 22 }}>{meta.icon}</div>
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: meta.color }}>{value}</div>
                        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, lineHeight: 1.3 }}>{meta.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Risk alerts */}
              {summary.risk_alerts?.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', overflow: 'hidden' }}>
                  <div style={{ padding: '14px 18px', borderBottom: '1px solid #e8edf2', fontWeight: 700, fontSize: 14, color: '#1a2b3c' }}>
                    Risk Alerts
                  </div>
                  <div style={{ padding: '12px' }}>
                    {/* Normalize alerts: backend may return plain strings
                        (current shape) or {severity,message} objects. Both
                        are accepted here. */}
                    {summary.risk_alerts.map((alert, i) => {
                      const isObj = typeof alert === 'object' && alert !== null;
                      const severity: RiskAlert['severity'] = isObj && 'severity' in alert
                        ? (alert as RiskAlert).severity
                        : 'medium';
                      const message = isObj ? (alert as RiskAlert).message : String(alert);
                      const m = ALERT_META[severity] ?? ALERT_META.low;
                      return (
                        <div key={i} style={{ background: m.bg, borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: i < summary.risk_alerts.length - 1 ? 8 : 0 }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>{m.icon}</span>
                          <div style={{ fontSize: 13, color: m.color, fontWeight: 500, lineHeight: 1.5 }}>{message}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quick links */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#1565c0' }}>{summary.suggestions_generated ?? 0}</div>
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Suggestions Generated</div>
                  </div>
                  <Link
                    to="/suggestions"
                    style={{ background: '#eff6ff', color: '#1565c0', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                  >
                    View →
                  </Link>
                </div>
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#00838f' }}>{summary.questions_generated ?? 0}</div>
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Questions Generated</div>
                  </div>
                  <Link
                    to="/clarification"
                    style={{ background: '#e0f7fa', color: '#00838f', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                  >
                    View →
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Sidebar */}
        <RecentSidebar
          items={recentList}
          selectedDate={selectedDate}
          onSelect={setSelectedDate}
        />
      </div>
    </div>
  );
}
