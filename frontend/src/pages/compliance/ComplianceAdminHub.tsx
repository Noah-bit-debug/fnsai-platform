import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { useRBAC } from '../../contexts/RBACContext';

// ─── Types ────────────────────────────────────────────────────

type TabKey = 'overview' | 'users' | 'content' | 'activity';

interface OverviewData {
  total_records: number;
  by_status: Record<string, number>;
  completion_rate: number;
  by_type: Record<string, Record<string, number>>;
  published_content: { policies: number; documents: number; exams: number; checklists: number };
  expiring_soon_count: number;
  overdue_count: number;
}

interface OverdueItem {
  id: number;
  title: string;
  user_clerk_id: string;
  days_overdue: number;
}

interface UserStat {
  user_clerk_id: string;
  total: number;
  completed_count: number;
  pending_count: number;
  expired_count: number;
  failed_count: number;
  next_due_date: string | null;
  completion_rate: number;
}

interface ContentItem {
  item_type: string;
  item_id: number;
  title: string;
  total_assigned: number;
  completed_count: number;
  expired_count: number;
  failed_count: number;
}

interface ExpiringRecord {
  id: number;
  title: string;
  user_clerk_id: string;
  days_until_expiry: number;
}

interface Notification {
  id: number;
  user_clerk_id: string;
  notification_type: string;
  subject: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  recipient_email: string;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

// ─── Toast System ─────────────────────────────────────────────

let toastIdCounter = 0;

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          style={{
            background: t.type === 'success' ? '#16a34a' : t.type === 'error' ? '#dc2626' : '#2563eb',
            color: '#fff',
            padding: '12px 18px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            maxWidth: 340,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            cursor: 'pointer',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

function truncate(s: string, n = 16) {
  if (!s) return '—';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

function completionColor(rate: number) {
  if (rate >= 80) return '#16a34a';
  if (rate >= 50) return '#ea580c';
  return '#dc2626';
}

const STATUS_COLORS: Record<string, string> = {
  not_started: '#94a3b8',
  in_progress: '#2563eb',
  completed: '#16a34a',
  signed: '#16a34a',
  read: '#16a34a',
  expired: '#dc2626',
  failed: '#ef4444',
};

function MiniProgressBar({ rate, width = 80 }: { rate: number; width?: number }) {
  const color = completionColor(rate);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, rate)}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 600, minWidth: 36 }}>{rate.toFixed(1)}%</span>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    policy: { bg: '#ede9fe', color: '#5b21b6' },
    policies: { bg: '#ede9fe', color: '#5b21b6' },
    document: { bg: '#e0f2fe', color: '#0369a1' },
    documents: { bg: '#e0f2fe', color: '#0369a1' },
    exam: { bg: '#fef3c7', color: '#b45309' },
    exams: { bg: '#fef3c7', color: '#b45309' },
    checklist: { bg: '#fce7f3', color: '#be185d' },
    checklists: { bg: '#fce7f3', color: '#be185d' },
    new_assignment: { bg: '#dbeafe', color: '#1e40af' },
    due_soon: { bg: '#ffedd5', color: '#c2410c' },
    expiring_soon: { bg: '#ffedd5', color: '#c2410c' },
    passed: { bg: '#dcfce7', color: '#166534' },
    failed: { bg: '#fee2e2', color: '#991b1b' },
    all_attempts_used: { bg: '#fee2e2', color: '#991b1b' },
    expired: { bg: '#f1f5f9', color: '#64748b' },
    reminder: { bg: '#dbeafe', color: '#1e40af' },
  };
  const s = map[type] ?? { bg: '#f1f5f9', color: '#64748b' };
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.color,
      textTransform: 'capitalize',
    }}>
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    sent: { bg: '#dcfce7', color: '#166534' },
    failed: { bg: '#fee2e2', color: '#991b1b' },
    pending: { bg: '#fef3c7', color: '#92400e' },
    skipped: { bg: '#f1f5f9', color: '#64748b' },
  };
  const s = map[status] ?? { bg: '#f1f5f9', color: '#64748b' };
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.color,
      textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span style={{ color: '#cbd5e1', marginLeft: 4 }}>↕</span>;
  return <span style={{ color: '#2563eb', marginLeft: 4 }}>{dir === 'asc' ? '↑' : '↓'}</span>;
}

// ─── Tab: Overview ────────────────────────────────────────────

function OverviewTab({ addToast }: { addToast: (msg: string, type: Toast['type']) => void }) {
  const navigate = useNavigate();
  const [data, setData] = useState<OverviewData | null>(null);
  const [overdue, setOverdue] = useState<OverdueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningJobs, setRunningJobs] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, overdueRes] = await Promise.all([
        api.get('/compliance/reports/overview'),
        api.get('/compliance/reports/overdue'),
      ]);
      setData(overviewRes.data);
      const od = overdueRes.data?.items ?? overdueRes.data ?? [];
      setOverdue(Array.isArray(od) ? od.slice(0, 5) : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleStatusDrillDown = (status: string) => {
    navigate('/compliance/admin/records?status=' + status);
  };

  const handleRunAllJobs = async () => {
    setRunningJobs(true);
    try {
      const res = await api.post('/compliance/jobs/run-all');
      addToast(res.data?.message || 'All jobs completed successfully.', 'success');
    } catch (e: any) {
      addToast(e.response?.data?.error || 'Failed to run jobs.', 'error');
    } finally {
      setRunningJobs(false);
    }
  };

  if (loading) return <div style={{ padding: 32, color: '#2563eb' }}>Loading...</div>;
  if (error) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#dc2626', marginBottom: 12 }}>Error: {error}</div>
      <button onClick={load} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Retry</button>
    </div>
  );
  if (!data) return null;

  const totalByStatus = Object.values(data.by_status).reduce((a, b) => a + b, 0);
  const rateColor = completionColor(data.completion_rate);

  const contentTypes = [
    { key: 'policies', label: 'Policies', icon: '📋', path: '/compliance/admin/policies' },
    { key: 'documents', label: 'Documents', icon: '📄', path: '/compliance/admin/documents' },
    { key: 'exams', label: 'Exams', icon: '📝', path: '/compliance/admin/exams' },
    { key: 'checklists', label: 'Checklists', icon: '✅', path: '/compliance/admin/checklists' },
    // Phase 2 additions
    { key: 'courses', label: 'Courses', icon: '📚', path: '/compliance/admin/courses' },
    { key: 'doc_types', label: 'Doc Types', icon: '🏷️', path: '/compliance/admin/doc-types' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Row 1: KPI Cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* Total Assigned */}
        <div style={{ flex: 1, minWidth: 180, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' }}>
          <div style={{ fontSize: 28 }}>📋</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', marginTop: 8 }}>{data.total_records.toLocaleString()}</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Total Assigned</div>
        </div>
        {/* Completion Rate */}
        <div style={{ flex: 1, minWidth: 180, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' }}>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Completion Rate</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: rateColor }}>{data.completion_rate.toFixed(1)}%</div>
          <div style={{ marginTop: 8, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, data.completion_rate)}%`, height: '100%', background: rateColor, borderRadius: 4 }} />
          </div>
        </div>
        {/* Expiring Soon */}
        <div style={{ flex: 1, minWidth: 180, background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #ea580c', borderRadius: 10, padding: '20px 24px' }}>
          <div style={{ fontSize: 28 }}>⏳</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#ea580c', marginTop: 8 }}>{data.expiring_soon_count.toLocaleString()}</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Expiring Soon</div>
        </div>
        {/* Overdue */}
        <div style={{ flex: 1, minWidth: 180, background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #dc2626', borderRadius: 10, padding: '20px 24px' }}>
          <div style={{ fontSize: 28 }}>⚠️</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#dc2626', marginTop: 8 }}>{data.overdue_count.toLocaleString()}</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Overdue</div>
        </div>
      </div>

      {/* Row 2: Status Breakdown */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '24px' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 600, color: '#1e293b' }}>Completion by Status</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Object.entries(data.by_status).map(([status, count]) => {
            const pct = totalByStatus > 0 ? (count / totalByStatus) * 100 : 0;
            const color = STATUS_COLORS[status] ?? '#94a3b8';
            const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            return (
              <div
                key={status}
                onClick={() => handleStatusDrillDown(status)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', borderRadius: 6, cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f7ff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ width: 120, fontSize: 13, color: '#475569', textTransform: 'capitalize', flexShrink: 0 }}>{label}</span>
                <div style={{ flex: 1, height: 10, background: '#e2e8f0', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 5 }} />
                </div>
                <span style={{ width: 80, fontSize: 12, color: '#64748b', flexShrink: 0 }}>
                  {count.toLocaleString()} ({pct.toFixed(1)}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Row 3: Content Type Cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {contentTypes.map(({ key, label, icon, path }) => {
          const published = data.published_content[key as keyof typeof data.published_content] ?? 0;
          const typeData = data.by_type[key] ?? {};
          const assigned = Object.values(typeData).reduce((a, b) => a + b, 0);
          const completedCount = (typeData['completed'] ?? 0) + (typeData['signed'] ?? 0) + (typeData['read'] ?? 0);
          const compRate = assigned > 0 ? (completedCount / assigned) * 100 : 0;
          return (
            <div
              key={key}
              onClick={() => navigate(path)}
              style={{ flex: 1, minWidth: 180, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(37,99,235,0.12)')}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 20 }}>{icon}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{label}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>{published.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>published · {assigned.toLocaleString()} assigned</div>
              <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, compRate)}%`, height: '100%', background: completionColor(compRate), borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{compRate.toFixed(1)}% complete</div>
            </div>
          );
        })}
      </div>

      {/* Row 4: Quick Actions + Recent Alerts */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* Quick Actions */}
        <div style={{ flex: 3, minWidth: 280, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: '#1e293b' }}>Quick Actions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={handleRunAllJobs}
              disabled={runningJobs}
              style={{
                padding: '10px 18px', background: runningJobs ? '#94a3b8' : '#2563eb', color: '#fff',
                border: 'none', borderRadius: 7, cursor: runningJobs ? 'not-allowed' : 'pointer',
                fontSize: 13, fontWeight: 600, textAlign: 'left',
              }}
            >
              {runningJobs ? '⏳ Running...' : '▶ Run All Jobs'}
            </button>
            <button
              onClick={() => addToast('Export feature coming soon.', 'info')}
              style={{
                padding: '10px 18px', background: '#f1f5f9', color: '#475569',
                border: '1px solid #e2e8f0', borderRadius: 7, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, textAlign: 'left',
              }}
            >
              📥 Export Report
            </button>
          </div>
        </div>

        {/* Recent Alerts */}
        <div style={{ flex: 2, minWidth: 220, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: '#1e293b' }}>Recent Alerts</h3>
          {overdue.length === 0 ? (
            <div style={{ fontSize: 13, color: '#64748b' }}>No overdue items. 🎉</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {overdue.map((item) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid #f1f5f9' }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#1e293b', fontWeight: 500 }}>{truncate(item.title, 28)}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{truncate(item.user_clerk_id, 20)}</div>
                  </div>
                  <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>
                    {item.days_overdue}d overdue
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Users ───────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<UserStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<keyof UserStat>('completion_rate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get('/compliance/reports/users');
      setUsers(res.data?.users ?? res.data ?? []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSort = (col: keyof UserStat) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  const filtered = users.filter((u) => u.user_clerk_id.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortCol] ?? 0;
    const bv = b[sortCol] ?? 0;
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const avgRate = users.length > 0 ? users.reduce((s, u) => s + u.completion_rate, 0) / users.length : 0;
  const at100 = users.filter((u) => u.completion_rate >= 100).length;
  const withExpired = users.filter((u) => u.expired_count > 0).length;

  if (loading) return <div style={{ padding: 32, color: '#2563eb' }}>Loading...</div>;
  if (error) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#dc2626', marginBottom: 12 }}>Error: {error}</div>
      <button onClick={load} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Retry</button>
    </div>
  );

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer', userSelect: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: `${users.length} Total Users`, color: '#2563eb' },
          { label: `Avg ${avgRate.toFixed(1)}% Complete`, color: '#16a34a' },
          { label: `${at100} at 100%`, color: '#7c3aed' },
          { label: `${withExpired} with Expired`, color: '#dc2626' },
        ].map((chip) => (
          <span key={chip.label} style={{
            fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 12,
            background: chip.color + '15', color: chip.color, border: `1px solid ${chip.color}30`,
          }}>{chip.label}</span>
        ))}
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter by user ID..."
        style={{ padding: '9px 14px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, width: 300, outline: 'none' }}
      />

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              {([
                ['user_clerk_id', 'User'],
                ['total', 'Total'],
                ['completed_count', 'Completed'],
                ['pending_count', 'Pending'],
                ['expired_count', 'Expired'],
                ['completion_rate', 'Rate'],
                ['next_due_date', 'Next Due'],
              ] as [keyof UserStat, string][]).map(([col, label]) => (
                <th key={col} onClick={() => toggleSort(col)} style={thStyle}>
                  {label}<SortIcon active={sortCol === col} dir={sortDir} />
                </th>
              ))}
              <th style={{ ...thStyle, cursor: 'default' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <>
                <tr
                  key={u.user_clerk_id}
                  onClick={() => setExpandedUser(expandedUser === u.user_clerk_id ? null : u.user_clerk_id)}
                  style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#475569', fontFamily: 'monospace' }}>{truncate(u.user_clerk_id, 16)}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: '#1e293b', fontWeight: 600 }}>{u.total}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: '#16a34a' }}>{u.completed_count}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: '#ea580c' }}>{u.pending_count}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{u.expired_count}</td>
                  <td style={{ padding: '10px 14px' }}><MiniProgressBar rate={u.completion_rate} /></td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#64748b' }}>{formatDate(u.next_due_date)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <button style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                      {expandedUser === u.user_clerk_id ? 'Collapse' : 'Details'}
                    </button>
                  </td>
                </tr>
                {expandedUser === u.user_clerk_id && (
                  <tr key={`${u.user_clerk_id}-detail`}>
                    <td colSpan={8} style={{ padding: '12px 24px', background: '#f0f9ff', borderBottom: '1px solid #bae6fd' }}>
                      <div style={{ display: 'flex', gap: 32 }}>
                        <div><span style={{ fontSize: 11, color: '#64748b' }}>Full ID</span><div style={{ fontSize: 12, fontFamily: 'monospace', color: '#1e293b' }}>{u.user_clerk_id}</div></div>
                        <div><span style={{ fontSize: 11, color: '#64748b' }}>Completed</span><div style={{ fontSize: 18, fontWeight: 700, color: '#16a34a' }}>{u.completed_count}</div></div>
                        <div><span style={{ fontSize: 11, color: '#64748b' }}>Pending</span><div style={{ fontSize: 18, fontWeight: 700, color: '#ea580c' }}>{u.pending_count}</div></div>
                        <div><span style={{ fontSize: 11, color: '#64748b' }}>Failed</span><div style={{ fontSize: 18, fontWeight: 700, color: '#dc2626' }}>{u.failed_count}</div></div>
                        <div><span style={{ fontSize: 11, color: '#64748b' }}>Expired</span><div style={{ fontSize: 18, fontWeight: 700, color: '#dc2626' }}>{u.expired_count}</div></div>
                        <div><span style={{ fontSize: 11, color: '#64748b' }}>Next Due</span><div style={{ fontSize: 13, color: '#1e293b' }}>{formatDate(u.next_due_date)}</div></div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '10px 16px', fontSize: 12, color: '#64748b', borderTop: '1px solid #f1f5f9' }}>
          {sorted.length} users
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Content ─────────────────────────────────────────────

function ContentTab() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [expiring, setExpiring] = useState<ExpiringRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [expiringExpanded, setExpiringExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [contentRes, expiringRes] = await Promise.all([
        api.get('/compliance/reports/content'),
        api.get('/compliance/reports/expiring?days=30'),
      ]);
      setItems(contentRes.data?.items ?? contentRes.data ?? []);
      const ex = expiringRes.data?.items ?? expiringRes.data ?? [];
      setExpiring(Array.isArray(ex) ? ex : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 32, color: '#2563eb' }}>Loading...</div>;
  if (error) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#dc2626', marginBottom: 12 }}>Error: {error}</div>
      <button onClick={load} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Retry</button>
    </div>
  );

  const typeFilters = ['all', 'policy', 'document', 'exam', 'checklist'];
  const filtered = typeFilter === 'all' ? items : items.filter((i) => i.item_type === typeFilter);

  const expiryColor = (days: number) => days < 7 ? '#dc2626' : days < 14 ? '#ea580c' : '#ca8a04';

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Type filter tabs */}
      <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 8, padding: 4, alignSelf: 'flex-start' }}>
        {typeFilters.map((f) => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            style={{
              padding: '6px 14px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500,
              background: typeFilter === f ? '#fff' : 'transparent',
              color: typeFilter === f ? '#1e293b' : '#64748b',
              boxShadow: typeFilter === f ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Content table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              {['Title', 'Type', 'Assigned', 'Completed', 'Expired', 'Failed', 'Rate', 'Actions'].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No items found.</td></tr>
            ) : filtered.map((item) => {
              const rate = item.total_assigned > 0 ? (item.completed_count / item.total_assigned) * 100 : 0;
              return (
                <tr key={`${item.item_type}-${item.item_id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: '#1e293b', maxWidth: 200 }}>{item.title}</td>
                  <td style={{ padding: '10px 14px' }}><TypeBadge type={item.item_type} /></td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: '#475569' }}>{item.total_assigned}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: '#16a34a' }}>{item.completed_count}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{item.expired_count}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: '#ef4444' }}>{item.failed_count}</td>
                  <td style={{ padding: '10px 14px' }}><MiniProgressBar rate={rate} /></td>
                  <td style={{ padding: '10px 14px' }}>
                    <button style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>View</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expiring soon */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <div
          onClick={() => setExpiringExpanded((p) => !p)}
          style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: expiringExpanded ? '1px solid #e2e8f0' : 'none' }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
            ⏳ {expiring.length} item{expiring.length !== 1 ? 's' : ''} expiring in the next 30 days
          </div>
          <span style={{ color: '#64748b' }}>{expiringExpanded ? '▲' : '▼'}</span>
        </div>
        {expiringExpanded && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Title', 'User', 'Days Until Expiry'].map((h) => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expiring.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '9px 14px', fontSize: 13, color: '#1e293b' }}>{r.title}</td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>{truncate(r.user_clerk_id, 20)}</td>
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: expiryColor(r.days_until_expiry) }}>
                      {r.days_until_expiry} days
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Activity ────────────────────────────────────────────

function ActivityTab({ addToast }: { addToast: (msg: string, type: Toast['type']) => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get('/compliance/reports/notifications');
      setNotifications(res.data?.notifications ?? res.data ?? []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRunNotifications = async () => {
    setRunning(true);
    try {
      const res = await api.post('/compliance/jobs/process-notifications');
      addToast(res.data?.message || 'Notifications processed.', 'success');
      load();
    } catch (e: any) {
      addToast(e.response?.data?.error || 'Failed to process notifications.', 'error');
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div style={{ padding: 32, color: '#2563eb' }}>Loading...</div>;
  if (error) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#dc2626', marginBottom: 12 }}>Error: {error}</div>
      <button onClick={load} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Retry</button>
    </div>
  );

  const counts = {
    sent: notifications.filter((n) => n.status === 'sent').length,
    failed: notifications.filter((n) => n.status === 'failed').length,
    pending: notifications.filter((n) => n.status === 'pending').length,
    skipped: notifications.filter((n) => n.status === 'skipped').length,
  };

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1e293b' }}>Notification Log</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>{notifications.length} records</p>
        </div>
        <button
          onClick={handleRunNotifications}
          disabled={running}
          style={{
            padding: '9px 18px', background: running ? '#94a3b8' : '#2563eb', color: '#fff',
            border: 'none', borderRadius: 7, cursor: running ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 600,
          }}
        >
          {running ? '⏳ Running...' : '▶ Run Notifications'}
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { label: `${counts.sent} Sent`, color: '#16a34a' },
          { label: `${counts.failed} Failed`, color: '#dc2626' },
          { label: `${counts.pending} Pending`, color: '#ea580c' },
          { label: `${counts.skipped} Skipped`, color: '#64748b' },
        ].map((chip) => (
          <span key={chip.label} style={{
            fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 12,
            background: chip.color + '18', color: chip.color, border: `1px solid ${chip.color}30`,
          }}>{chip.label}</span>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              {['User', 'Type', 'Subject', 'Recipient', 'Status', 'Date'].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {notifications.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No notifications found.</td></tr>
            ) : notifications.map((n) => (
              <tr key={n.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 14px', fontSize: 12, color: '#475569', fontFamily: 'monospace' }}>{truncate(n.user_clerk_id, 16)}</td>
                <td style={{ padding: '10px 14px' }}><TypeBadge type={n.notification_type} /></td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: '#1e293b', maxWidth: 200 }}>{truncate(n.subject, 36)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: '#64748b' }}>{truncate(n.recipient_email, 24)}</td>
                <td style={{ padding: '10px 14px' }}><StatusBadge status={n.status} /></td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: '#64748b' }}>{formatDate(n.sent_at ?? n.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function ComplianceAdminHub() {
  const { user } = useUser();
  const { role } = useRBAC();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loadedTabs, setLoadedTabs] = useState<Set<TabKey>>(new Set(['overview']));
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleTabClick = (tab: TabKey) => {
    setActiveTab(tab);
    setLoadedTabs((prev) => new Set([...prev, tab]));
  };

  const allowedRoles = ['ceo', 'admin', 'manager', 'hr'];
  if (!allowedRoles.includes(role ?? '')) {
    return (
      <div style={{ padding: '64px 40px', background: '#f8fafc', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', margin: 0 }}>Access Denied</h2>
        <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>You don't have permission to view this page. Contact an administrator.</p>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'users', label: 'Users' },
    { key: 'content', label: 'Content' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', margin: 0 }}>Compliance Dashboard</h1>
        <p style={{ fontSize: 14, color: '#64748b', marginTop: 6, margin: '6px 0 0' }}>
          Monitor completions, track users, manage notifications
        </p>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', marginBottom: 28 }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabClick(tab.key)}
            style={{
              padding: '10px 22px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: '-2px',
              fontSize: 14,
              fontWeight: activeTab === tab.key ? 700 : 500,
              color: activeTab === tab.key ? '#2563eb' : '#64748b',
              cursor: 'pointer',
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && loadedTabs.has('overview') && <OverviewTab addToast={addToast} />}
        {activeTab === 'users' && loadedTabs.has('users') && <UsersTab />}
        {activeTab === 'content' && loadedTabs.has('content') && <ContentTab />}
        {activeTab === 'activity' && loadedTabs.has('activity') && <ActivityTab addToast={addToast} />}
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
