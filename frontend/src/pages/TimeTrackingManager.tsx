import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '../lib/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DateRange = 'today' | 'week' | 'month' | 'custom';

interface EmployeeStatus {
  employee_id: string;
  name: string;
  status: 'active' | 'idle' | 'inactive' | 'break';
  today_active: number;
  today_idle: number;
  today_break: number;
  adjusted_time: number;
  last_seen: string | null;
  idle_pct: number;
  domain_breakdown?: { approved: number; non_work: number };
}

interface EmployeeSummary {
  employee_id: string;
  name: string;
  days_tracked: number;
  avg_daily_active: number;
  total_active: number;
  total_idle: number;
  avg_break: number;
  adjusted_total: number;
}

interface TeamData {
  employees: EmployeeStatus[];
  summary: EmployeeSummary[];
  total_tracked: number;
  avg_active_today: number;
  total_idle_today: number;
  sessions_with_issues: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', padding: '20px 22px', flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: color ?? '#1a2b3c' }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function StatusDot({ status }: { status: EmployeeStatus['status'] }) {
  const map: Record<string, { color: string; label: string; pulse: boolean }> = {
    active:   { color: '#16a34a', label: '🟢 Active',   pulse: true },
    idle:     { color: '#ca8a04', label: '🟡 Idle',     pulse: false },
    inactive: { color: '#dc2626', label: '🔴 Inactive', pulse: false },
    break:    { color: '#6366f1', label: '☕ Break',    pulse: false },
  };
  const cfg = map[status] ?? map.inactive;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: cfg.color }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: cfg.color, display: 'inline-block',
        animation: cfg.pulse ? 'pulse 1.5s infinite' : 'none',
      }} />
      {cfg.label}
    </span>
  );
}

function rowBg(emp: EmployeeStatus): string {
  if (emp.idle_pct > 30) return '#fff5f5';
  if (emp.idle_pct > 15) return '#fefce8';
  return '#fff';
}

function AISummaryModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, error } = useQuery<{ data: { summary: string } }>({
    queryKey: ['tt-ai-summary'],
    queryFn: () => api.post('/time-tracking/ai-summary', {}),
    staleTime: 0,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>🤖 AI Work Pattern Summary</div>
        {isLoading && (
          <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: 14 }}>
            <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#1565c0', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            Analyzing team work patterns...
          </div>
        )}
        {error && <div style={{ color: '#dc2626', fontSize: 14 }}>Failed to generate summary. Please try again.</div>}
        {data?.data?.summary && (
          <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7 }}>
            {data.data.summary.split('\n\n').map((para, i) => (
              <p key={i} style={{ marginBottom: 14 }}>{para}</p>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: '#374151' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TimeTrackingManager() {
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<keyof EmployeeSummary>('total_active');
  const [sortAsc, setSortAsc] = useState(false);
  const [showAI, setShowAI] = useState(false);

  const today = new Date();
  const fromDate =
    dateRange === 'today' ? toDateStr(today) :
    dateRange === 'week'  ? toDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)) :
    dateRange === 'month' ? toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)) :
    customFrom;
  const toDate = dateRange === 'custom' ? customTo : toDateStr(today);

  const { data: teamData, isLoading } = useQuery<{ data: TeamData }>({
    queryKey: ['team-tracking', dateRange, customFrom, customTo],
    queryFn: () => api.get('/time-tracking/team', { params: { from_date: fromDate, to_date: toDate } }),
    refetchInterval: 30000,
  });

  const team = teamData?.data;
  const employees = team?.employees ?? [];
  const summary = team?.summary ?? [];

  // Idle pattern alerts: employees averaging >40% idle last 3 days
  const idleAlerts = employees.filter((e) => e.idle_pct > 40);

  const sorted = [...summary].sort((a, b) => {
    const aVal = a[sortCol] as number ?? 0;
    const bVal = b[sortCol] as number ?? 0;
    return sortAsc ? aVal - bVal : bVal - aVal;
  });

  function toggleSort(col: keyof EmployeeSummary) {
    if (sortCol === col) setSortAsc((v) => !v);
    else { setSortCol(col); setSortAsc(false); }
  }

  function SortTh({ col, label }: { col: keyof EmployeeSummary; label: string }) {
    const active = sortCol === col;
    return (
      <th
        onClick={() => toggleSort(col)}
        style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: active ? '#1565c0' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
      >
        {label} {active ? (sortAsc ? '↑' : '↓') : ''}
      </th>
    );
  }

  function handleExport() {
    const url = `/api/time-tracking/reports?from_date=${fromDate}&to_date=${toDate}&format=csv`;
    window.open(url, '_blank');
  }

  const rangeLabels: Record<DateRange, string> = { today: 'Today', week: 'This Week', month: 'This Month', custom: 'Custom' };

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
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>⏱ Team Time Tracking</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Live visibility into team work activity</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Date range picker */}
            <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 10, padding: 3 }}>
              {(['today', 'week', 'month', 'custom'] as DateRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setDateRange(r)}
                  style={{
                    padding: '6px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    background: dateRange === r ? '#fff' : 'transparent',
                    color: dateRange === r ? '#1565c0' : '#64748b',
                    boxShadow: dateRange === r ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  {rangeLabels[r]}
                </button>
              ))}
            </div>
            {dateRange === 'custom' && (
              <>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
              </>
            )}
            <button onClick={() => setShowAI(true)} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              🤖 AI Summary
            </button>
            <button onClick={handleExport} style={{ background: '#fff', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              ⬇ Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <StatCard label="Employees Tracked Today" value={team?.total_tracked ?? '—'} color="#1565c0" />
        <StatCard label="Avg Active Time Today" value={team ? formatDuration(team.avg_active_today) : '—'} color="#16a34a" />
        <StatCard label="Total Idle Time Today" value={team ? formatDuration(team.total_idle_today) : '—'} color="#dc2626" />
        <StatCard label="Sessions With Issues" value={team?.sessions_with_issues ?? '—'} sub="Large idle gaps" color="#ca8a04" />
      </div>

      {/* ── Idle Pattern Alerts ── */}
      {idleAlerts.length > 0 && (
        <div style={{ background: '#fffbeb', borderRadius: 14, border: '1px solid #fde68a', padding: '16px 22px', marginBottom: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 12 }}>⚠ High Idle Pattern Alerts</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {idleAlerts.map((e) => (
              <div key={e.employee_id} style={{ background: '#fff', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#92400e' }}>
                <strong>{e.name}</strong> has averaged <strong>{formatDuration(e.today_idle)}</strong> idle today ({Math.round(e.idle_pct)}% idle rate)
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Live Team Status ── */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e8edf2', marginBottom: 22, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c' }}>Live Team Status</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Auto-refreshes every 30 seconds</div>
          </div>
          {isLoading && <div style={{ width: 18, height: 18, border: '2px solid #e2e8f0', borderTopColor: '#1565c0', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
        </div>
        {employees.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontSize: 14 }}>No employee data available.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Employee', 'Status', 'Today Active', 'Today Idle', 'Today Break', 'Adjusted', 'Last Seen'].map((h) => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const isExpanded = expandedEmp === emp.employee_id;
                const bg = rowBg(emp);
                return (
                  <>
                    <tr
                      key={emp.employee_id}
                      onClick={() => setExpandedEmp(isExpanded ? null : emp.employee_id)}
                      style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer', background: bg }}
                    >
                      <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>{emp.name}</td>
                      <td style={{ padding: '12px 14px' }}><StatusDot status={emp.status} /></td>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#16a34a', fontWeight: 600 }}>{formatDuration(emp.today_active)}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#dc2626' }}>{formatDuration(emp.today_idle)}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#ca8a04' }}>{formatDuration(emp.today_break)}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>{formatDuration(emp.adjusted_time)}</td>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b' }}>{emp.last_seen ? formatTime(emp.last_seen) : '—'}</td>
                    </tr>
                    {isExpanded && emp.domain_breakdown && (
                      <tr key={`${emp.employee_id}-exp`}>
                        <td colSpan={7} style={{ padding: '12px 24px', background: '#f0f9ff', fontSize: 13, color: '#0369a1' }}>
                          <strong>Domain Breakdown:</strong>&nbsp;
                          Work domains: <strong>{Math.round(emp.domain_breakdown.approved)}%</strong> &nbsp;·&nbsp;
                          Non-work domains: <strong style={{ color: '#dc2626' }}>{Math.round(emp.domain_breakdown.non_work)}%</strong>
                          &nbsp;·&nbsp; Idle rate today: <strong>{Math.round(emp.idle_pct)}%</strong>
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

      {/* ── Daily Summary by Employee ── */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e8edf2', marginBottom: 22, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c' }}>Daily Summary by Employee</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Click column headers to sort</div>
        </div>
        {sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 14 }}>No data for this period.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Employee</th>
                <SortTh col="days_tracked" label="Days" />
                <SortTh col="avg_daily_active" label="Avg Daily" />
                <SortTh col="total_active" label="Total Active" />
                <SortTh col="total_idle" label="Total Idle" />
                <SortTh col="avg_break" label="Avg Break" />
                <SortTh col="adjusted_total" label="Adjusted Total" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => {
                const lowActive = s.avg_daily_active < 4 * 3600;
                const medActive = s.avg_daily_active < 6 * 3600 && !lowActive;
                const rowColor = lowActive ? '#fff5f5' : medActive ? '#fefce8' : '#fff';
                return (
                  <tr key={s.employee_id} style={{ borderTop: '1px solid #f1f5f9', background: i % 2 === 0 ? rowColor : rowColor }}>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>{s.name}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{s.days_tracked}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: lowActive ? '#dc2626' : medActive ? '#ca8a04' : '#16a34a', fontWeight: 600 }}>{formatDuration(s.avg_daily_active)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>{formatDuration(s.total_active)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#dc2626' }}>{formatDuration(s.total_idle)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#ca8a04' }}>{formatDuration(s.avg_break)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>{formatDuration(s.adjusted_total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Domain Breakdown ── */}
      {employees.some((e) => e.domain_breakdown) && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e8edf2', marginBottom: 22, overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c' }}>Approved vs Non-Work Domain Breakdown</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Employee', '% Work Domains', '% Non-Work Domains'].map((h) => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.filter((e) => e.domain_breakdown).map((emp, i) => (
                <tr key={emp.employee_id} style={{ borderTop: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                  <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>{emp.name}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${emp.domain_breakdown!.approved}%`, height: '100%', background: '#16a34a', borderRadius: 4 }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a', minWidth: 36 }}>{Math.round(emp.domain_breakdown!.approved)}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${emp.domain_breakdown!.non_work}%`, height: '100%', background: '#dc2626', borderRadius: 4 }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', minWidth: 36 }}>{Math.round(emp.domain_breakdown!.non_work)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAI && <AISummaryModal onClose={() => setShowAI(false)} />}
    </div>
  );
}
