import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────

interface OverviewData {
  total_records: number;
  completion_rate: number;
  expiring_soon_count: number;
  overdue_count: number;
  by_status: Record<string, number>;
  by_type: Record<string, Record<string, number>>;
  published_content: { policies: number; documents: number; exams: number; checklists: number };
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

interface UserSummary {
  user_clerk_id: string;
  total: number;
  completed: number;
  pending: number;
  expired: number;
  completion_rate: number;
}

interface UserRecord {
  id: number;
  title: string;
  item_type: string;
  status: string;
  assigned_at: string | null;
  due_date: string | null;
  completed_at: string | null;
  score: number | null;
}

interface UserDetailData {
  user_clerk_id: string;
  records: UserRecord[];
  summary: {
    total: number;
    completed: number;
    pending: number;
    expired: number;
    completion_rate: number;
    by_type: Record<string, { total: number; completed: number }>;
  };
}

interface ExamItem {
  id: number;
  title: string;
  passing_score: number;
  max_attempts: number;
}

interface ExamAnalysis {
  total_attempts: number;
  unique_takers: number;
  pass_rate: number;
  avg_score: number;
  score_distribution: Record<string, number>;
}

interface ExpiringItem {
  id: number;
  title: string;
  user_clerk_id: string;
  item_type: string;
  expiration_date: string | null;
  days_until_expiry: number;
  status: string;
}

interface OverdueItem {
  id: number;
  title: string;
  user_clerk_id: string;
  item_type: string;
  due_date: string | null;
  days_overdue: number;
  status: string;
}

interface TrendDay {
  day: string;
  completions: number;
  exams: number;
  policies: number;
  documents: number;
  checklists: number;
}

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

function truncate(s: string, n = 20) {
  if (!s) return '—';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

function completionColor(rate: number) {
  if (rate >= 80) return '#16a34a';
  if (rate >= 50) return '#ea580c';
  return '#dc2626';
}

function MiniProgressBar({ rate, width = 100 }: { rate: number; width?: number }) {
  const color = completionColor(rate);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, rate)}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 600, minWidth: 40 }}>{rate.toFixed(1)}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    completed: { bg: '#dcfce7', color: '#166534' },
    signed: { bg: '#dcfce7', color: '#166534' },
    read: { bg: '#dcfce7', color: '#166534' },
    passed: { bg: '#dcfce7', color: '#166534' },
    in_progress: { bg: '#dbeafe', color: '#1e40af' },
    pending: { bg: '#fef3c7', color: '#92400e' },
    not_started: { bg: '#f1f5f9', color: '#475569' },
    failed: { bg: '#fee2e2', color: '#991b1b' },
    expired: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f1f5f9', color: '#64748b' };
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.color,
      textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px',
  background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, color: '#1e293b', borderBottom: '1px solid #f1f5f9',
};

// ─── Report 1: Completion Summary ─────────────────────────────

function CompletionSummaryReport() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<keyof ContentItem>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ovRes, contentRes] = await Promise.all([
        api.get('/compliance/reports/overview'),
        api.get('/compliance/reports/content'),
      ]);
      setOverview(ovRes.data);
      setItems(contentRes.data?.items ?? contentRes.data ?? []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const exportCSV = () => {
    const csv = ['Title,Type,Assigned,Completed,Rate']
      .concat(items.map(i => `"${i.title}",${i.item_type},${i.total_assigned},${i.completed_count},${i.total_assigned > 0 ? (i.completed_count / i.total_assigned * 100).toFixed(1) : '0.0'}%`))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'compliance_summary.csv'; a.click();
  };

  if (loading) return <div style={{ padding: 32, color: '#2563eb' }}>Loading...</div>;
  if (error) return <div style={{ padding: 32, color: '#dc2626' }}>Error: {error} <button onClick={load} style={{ marginLeft: 8, padding: '4px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>Retry</button></div>;
  if (!overview) return null;

  const byTypeRows = [
    { type: 'Policies', key: 'policies', path: '/compliance/admin/policies' },
    { type: 'Documents', key: 'documents', path: '/compliance/admin/documents' },
    { type: 'Exams', key: 'exams', path: '/compliance/admin/exams' },
    { type: 'Checklists', key: 'checklists', path: '/compliance/admin/checklists' },
  ];

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const completedTotal = overview.by_status
    ? (overview.by_status['completed'] ?? 0) + (overview.by_status['signed'] ?? 0) + (overview.by_status['read'] ?? 0)
    : 0;

  const toggleSort = (col: keyof ContentItem) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const filtered = items.filter(i => i.title.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortCol] ?? '';
    const bv = b[sortCol] ?? '';
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1e293b' }}>Completion Summary</h2>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{today}</div>
        </div>
        <button onClick={exportCSV} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          📥 Export CSV
        </button>
      </div>

      {/* 4 Summary Cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Records', value: overview.total_records.toLocaleString(), color: '#2563eb', icon: '📋' },
          { label: `Completed (${overview.completion_rate.toFixed(1)}%)`, value: completedTotal.toLocaleString(), color: '#16a34a', icon: '✅' },
          { label: 'Expiring Soon', value: overview.expiring_soon_count.toLocaleString(), color: '#ea580c', icon: '⏳' },
          { label: 'Overdue', value: overview.overdue_count.toLocaleString(), color: '#dc2626', icon: '⚠️' },
        ].map(card => (
          <div key={card.label} style={{ flex: 1, minWidth: 160, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' }}>
            <div style={{ fontSize: 24 }}>{card.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: card.color, marginTop: 8 }}>{card.value}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* By Content Type Table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b' }}>By Content Type</h3>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Type', 'Total Published', 'Total Assigned', 'Completed', 'Completion Rate', 'Actions'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byTypeRows.map(({ type, key, path }) => {
              const published = overview.published_content[key as keyof typeof overview.published_content] ?? 0;
              const typeData = overview.by_type?.[key] ?? {};
              const assigned = Object.values(typeData).reduce((a, b) => a + b, 0);
              const completed = (typeData['completed'] ?? 0) + (typeData['signed'] ?? 0) + (typeData['read'] ?? 0);
              const rate = assigned > 0 ? (completed / assigned) * 100 : 0;
              return (
                <tr key={key}>
                  <td style={tdStyle}><strong>{type}</strong></td>
                  <td style={tdStyle}>{published.toLocaleString()}</td>
                  <td style={tdStyle}>{assigned.toLocaleString()}</td>
                  <td style={tdStyle}>{completed.toLocaleString()}</td>
                  <td style={{ ...tdStyle, minWidth: 180 }}><MiniProgressBar rate={rate} width={120} /></td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => navigate(path)}
                      style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* All Items Table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b' }}>All Items</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search items..."
              style={{ padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, width: 220, outline: 'none' }}
            />
            <button onClick={exportCSV} style={{ padding: '7px 14px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Export CSV
            </button>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {([
                ['title', 'Title'],
                ['item_type', 'Type'],
                ['total_assigned', 'Assigned'],
                ['completed_count', 'Completed'],
                ['failed_count', 'Failed'],
                ['expired_count', 'Expired'],
              ] as [keyof ContentItem, string][]).map(([col, label]) => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }}
                >
                  {label}
                  <span style={{ color: sortCol === col ? '#2563eb' : '#cbd5e1', marginLeft: 4 }}>
                    {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
              ))}
              <th style={thStyle}>Rate</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No items found.</td></tr>
            ) : sorted.map(item => {
              const rate = item.total_assigned > 0 ? (item.completed_count / item.total_assigned) * 100 : 0;
              return (
                <tr key={`${item.item_type}-${item.item_id}`}>
                  <td style={{ ...tdStyle, maxWidth: 220 }}>{item.title}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#f1f5f9', color: '#475569', textTransform: 'capitalize' }}>
                      {item.item_type}
                    </span>
                  </td>
                  <td style={tdStyle}>{item.total_assigned}</td>
                  <td style={{ ...tdStyle, color: '#16a34a' }}>{item.completed_count}</td>
                  <td style={{ ...tdStyle, color: '#dc2626' }}>{item.failed_count}</td>
                  <td style={{ ...tdStyle, color: '#dc2626' }}>{item.expired_count}</td>
                  <td style={{ ...tdStyle, minWidth: 160 }}><MiniProgressBar rate={rate} width={100} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: '10px 16px', fontSize: 12, color: '#64748b', borderTop: '1px solid #f1f5f9' }}>
          {sorted.length} items
        </div>
      </div>
    </div>
  );
}

// ─── Report 2: User Detail Report ─────────────────────────────

function UserDetailReport() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get('/compliance/reports/users');
      const raw = res.data?.users ?? res.data ?? [];
      setUsers(raw);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const loadUserDetail = async (userId: string) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/compliance/reports/user/${userId}`);
      setUserDetail(res.data);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSelectUser = (userId: string) => {
    setSelectedUser(userId);
    loadUserDetail(userId);
  };

  const exportUserCSV = () => {
    if (!userDetail) return;
    const csv = ['Title,Type,Status,Assigned,Due,Completed,Score']
      .concat(userDetail.records.map(r =>
        `"${r.title}",${r.item_type},${r.status},${formatDate(r.assigned_at)},${formatDate(r.due_date)},${formatDate(r.completed_at)},${r.score ?? ''}`
      ))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `user_report_${selectedUser}.csv`; a.click();
  };

  if (loading) return <div style={{ padding: 32, color: '#2563eb' }}>Loading...</div>;
  if (error) return <div style={{ padding: 32, color: '#dc2626' }}>Error: {error}</div>;

  const filtered = users.filter(u => u.user_clerk_id.toLowerCase().includes(search.toLowerCase()));

  // Phase 2: User Detail
  if (selectedUser) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => { setSelectedUser(null); setUserDetail(null); }}
            style={{ padding: '7px 14px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            ← All Users
          </button>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1e293b' }}>User: <span style={{ fontFamily: 'monospace', fontSize: 16, color: '#2563eb' }}>{truncate(selectedUser, 30)}</span></h2>
          <button
            onClick={exportUserCSV}
            disabled={!userDetail}
            style={{ marginLeft: 'auto', padding: '7px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            📥 Export This User's Report
          </button>
        </div>

        {detailLoading && <div style={{ padding: 24, color: '#2563eb' }}>Loading user details...</div>}

        {userDetail && !detailLoading && (
          <>
            {/* Summary chips */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {[
                { label: 'Total', value: userDetail.summary.total, color: '#2563eb' },
                { label: 'Completed', value: userDetail.summary.completed, color: '#16a34a' },
                { label: 'Pending', value: userDetail.summary.pending, color: '#ea580c' },
                { label: 'Expired', value: userDetail.summary.expired, color: '#dc2626' },
              ].map(chip => (
                <div key={chip.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 20px', textAlign: 'center', minWidth: 90 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: chip.color }}>{chip.value}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{chip.label}</div>
                </div>
              ))}
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 20px', textAlign: 'center', minWidth: 90 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: completionColor(userDetail.summary.completion_rate) }}>
                  {userDetail.summary.completion_rate.toFixed(1)}%
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Completion Rate</div>
              </div>
            </div>

            {/* By-type mini table */}
            {userDetail.summary.by_type && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>By Type</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Type', 'Total', 'Completed'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(userDetail.summary.by_type).map(([type, counts]) => (
                      <tr key={type}>
                        <td style={{ ...tdStyle, textTransform: 'capitalize' }}>{type}</td>
                        <td style={tdStyle}>{counts.total}</td>
                        <td style={{ ...tdStyle, color: '#16a34a' }}>{counts.completed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Full Records Table */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                All Records ({userDetail.records.length})
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Title', 'Type', 'Status', 'Assigned', 'Due', 'Completed', 'Score', 'Actions'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {userDetail.records.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No records.</td></tr>
                  ) : userDetail.records.map(record => (
                    <tr key={record.id}>
                      <td style={{ ...tdStyle, maxWidth: 200 }}>{record.title}</td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#f1f5f9', color: '#475569', textTransform: 'capitalize' }}>
                          {record.item_type}
                        </span>
                      </td>
                      <td style={tdStyle}><StatusBadge status={record.status} /></td>
                      <td style={{ ...tdStyle, fontSize: 12, color: '#64748b' }}>{formatDate(record.assigned_at)}</td>
                      <td style={{ ...tdStyle, fontSize: 12, color: '#64748b' }}>{formatDate(record.due_date)}</td>
                      <td style={{ ...tdStyle, fontSize: 12, color: '#64748b' }}>{formatDate(record.completed_at)}</td>
                      <td style={{ ...tdStyle, color: record.score !== null ? (record.score >= 70 ? '#16a34a' : '#dc2626') : '#64748b' }}>
                        {record.score !== null ? `${record.score}%` : '—'}
                      </td>
                      <td style={tdStyle}>
                        {record.item_type === 'exam' && record.status === 'completed' && (
                          <button
                            style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                          >
                            View Certificate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    );
  }

  // Phase 1: User selector
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1e293b' }}>User Detail Report</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>Select a user to view their full compliance report.</p>
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by user ID..."
        style={{ padding: '9px 14px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, width: 320, outline: 'none' }}
      />

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['User ID', 'Total', 'Completed', 'Pending', 'Expired', 'Completion Rate'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No users found.</td></tr>
            ) : filtered.map(u => (
              <tr
                key={u.user_clerk_id}
                onClick={() => handleSelectUser(u.user_clerk_id)}
                style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: '#2563eb' }}>{truncate(u.user_clerk_id, 24)}</td>
                <td style={tdStyle}>{u.total}</td>
                <td style={{ ...tdStyle, color: '#16a34a' }}>{u.completed}</td>
                <td style={{ ...tdStyle, color: '#ea580c' }}>{u.pending}</td>
                <td style={{ ...tdStyle, color: '#dc2626' }}>{u.expired}</td>
                <td style={{ ...tdStyle, minWidth: 160 }}><MiniProgressBar rate={u.completion_rate} width={100} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '10px 16px', fontSize: 12, color: '#64748b', borderTop: '1px solid #f1f5f9' }}>
          {filtered.length} users
        </div>
      </div>
    </div>
  );
}

// ─── Report 3: Exam Analysis ──────────────────────────────────

function ExamAnalysisReport() {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [analyses, setAnalyses] = useState<Record<number, ExamAnalysis>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get('/compliance/exams');
      setExams(res.data?.exams ?? res.data ?? []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadExams(); }, [loadExams]);

  const handleViewAnalysis = async (examId: number) => {
    if (expanded === examId) { setExpanded(null); return; }
    setExpanded(examId);
    if (analyses[examId]) return;
    try {
      const res = await api.get(`/compliance/reports/exam/${examId}`);
      setAnalyses(prev => ({ ...prev, [examId]: res.data }));
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    }
  };

  if (loading) return <div style={{ padding: 32, color: '#2563eb' }}>Loading...</div>;
  if (error) return <div style={{ padding: 32, color: '#dc2626' }}>Error: {error}</div>;

  const buckets = [
    { label: '<60', key: 'below_60', color: '#dc2626' },
    { label: '60–69', key: '60_69', color: '#ea580c' },
    { label: '70–79', key: '70_79', color: '#eab308' },
    { label: '80–89', key: '80_89', color: '#16a34a' },
    { label: '90–100', key: '90_100', color: '#15803d' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1e293b' }}>Exam Analysis</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>Click "View Analysis" to expand detailed statistics for each exam.</p>
      </div>

      {exams.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: '#64748b', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
          No exams found.
        </div>
      )}

      {exams.map(exam => {
        const analysis = analyses[exam.id];
        const isExpanded = expanded === exam.id;
        const maxBucketCount = analysis ? Math.max(...buckets.map(b => analysis.score_distribution?.[b.key] ?? 0), 1) : 1;

        return (
          <div key={exam.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: isExpanded ? '1px solid #e2e8f0' : 'none' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{exam.title}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                  Passing Score: <strong>{exam.passing_score}%</strong> · Max Attempts: <strong>{exam.max_attempts}</strong>
                </div>
              </div>
              <button
                onClick={() => handleViewAnalysis(exam.id)}
                style={{ padding: '7px 16px', background: isExpanded ? '#f1f5f9' : '#2563eb', color: isExpanded ? '#475569' : '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                {isExpanded ? 'Collapse' : 'View Analysis'}
              </button>
            </div>

            {isExpanded && (
              <div style={{ padding: '20px 24px' }}>
                {!analysis ? (
                  <div style={{ color: '#2563eb', fontSize: 13 }}>Loading analysis...</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Key Metrics */}
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Total Attempts', value: analysis.total_attempts, color: '#2563eb' },
                        { label: 'Unique Takers', value: analysis.unique_takers, color: '#7c3aed' },
                        { label: 'Pass Rate', value: `${analysis.pass_rate.toFixed(1)}%`, color: '#16a34a' },
                        { label: 'Avg Score', value: `${analysis.avg_score.toFixed(1)}%`, color: analysis.avg_score >= exam.passing_score ? '#16a34a' : '#dc2626' },
                      ].map(metric => (
                        <div key={metric.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 20px', textAlign: 'center', minWidth: 100 }}>
                          <div style={{ fontSize: 24, fontWeight: 700, color: metric.color }}>{metric.value}</div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{metric.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Score Distribution */}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 12 }}>Score Distribution</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {buckets.map(bucket => {
                          const count = analysis.score_distribution?.[bucket.key] ?? 0;
                          const barWidth = maxBucketCount > 0 ? (count / maxBucketCount) * 200 : 0;
                          return (
                            <div key={bucket.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span style={{ width: 48, fontSize: 12, color: '#475569', flexShrink: 0, textAlign: 'right' }}>{bucket.label}</span>
                              <div style={{ width: barWidth, height: 20, background: bucket.color, borderRadius: 3, minWidth: count > 0 ? 4 : 0, transition: 'width 0.3s' }} />
                              <span style={{ fontSize: 12, color: '#64748b' }}>{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Avg Score large display */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, color: '#64748b' }}>Average Score:</span>
                      <span style={{ fontSize: 32, fontWeight: 800, color: analysis.avg_score >= exam.passing_score ? '#16a34a' : '#dc2626' }}>
                        {analysis.avg_score.toFixed(1)}%
                      </span>
                      <span style={{ fontSize: 12, color: '#64748b' }}>(passing: {exam.passing_score}%)</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Report 4: Expiration Report ──────────────────────────────

function ExpirationReport() {
  const [expiringDays, setExpiringDays] = useState(30);
  const [expiring, setExpiring] = useState<ExpiringItem[]>([]);
  const [overdue, setOverdue] = useState<OverdueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExpiring = useCallback(async (days: number) => {
    setLoading(true); setError(null);
    try {
      const [expiringRes, overdueRes] = await Promise.all([
        api.get(`/compliance/reports/expiring?days=${days}`),
        api.get('/compliance/reports/overdue'),
      ]);
      const ex = expiringRes.data?.items ?? expiringRes.data ?? [];
      setExpiring(Array.isArray(ex) ? ex : []);
      const od = overdueRes.data?.items ?? overdueRes.data ?? [];
      setOverdue(Array.isArray(od) ? od : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadExpiring(expiringDays); }, [loadExpiring, expiringDays]);

  const daysColor = (days: number) => {
    if (days < 7) return '#dc2626';
    if (days < 30) return '#ea580c';
    if (days < 60) return '#eab308';
    return '#16a34a';
  };

  const exportExpiringCSV = () => {
    const csv = ['Title,User,Type,Expiration Date,Days Until Expiry,Status']
      .concat(expiring.map(i => `"${i.title}","${i.user_clerk_id}",${i.item_type},${formatDate(i.expiration_date)},${i.days_until_expiry},${i.status}`))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'expiring_items.csv'; a.click();
  };

  const exportOverdueCSV = () => {
    const csv = ['Title,User,Type,Due Date,Days Overdue,Status']
      .concat(overdue.map(i => `"${i.title}","${i.user_clerk_id}",${i.item_type},${formatDate(i.due_date)},${i.days_overdue},${i.status}`))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'overdue_items.csv'; a.click();
  };

  if (loading) return <div style={{ padding: 32, color: '#2563eb' }}>Loading...</div>;
  if (error) return <div style={{ padding: 32, color: '#dc2626' }}>Error: {error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Expiring Soon */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1e293b' }}>⏳ Expiring Soon</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {[7, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setExpiringDays(d)}
                style={{
                  padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  background: expiringDays === d ? '#2563eb' : '#fff',
                  color: expiringDays === d ? '#fff' : '#475569',
                  fontWeight: expiringDays === d ? 600 : 400,
                }}
              >
                {d} days
              </button>
            ))}
            <button onClick={exportExpiringCSV} style={{ padding: '6px 14px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Export CSV
            </button>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Title', 'User', 'Type', 'Expiration Date', 'Days Until Expiry', 'Status'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expiring.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No items expiring in the next {expiringDays} days.</td></tr>
              ) : expiring.map(item => (
                <tr key={item.id}>
                  <td style={{ ...tdStyle, maxWidth: 200 }}>{item.title}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{truncate(item.user_clerk_id, 20)}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#f1f5f9', color: '#475569', textTransform: 'capitalize' }}>
                      {item.item_type}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>{formatDate(item.expiration_date)}</td>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 700, color: daysColor(item.days_until_expiry) }}>{item.days_until_expiry}d</span>
                  </td>
                  <td style={tdStyle}><StatusBadge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Overdue */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1e293b' }}>⚠️ Overdue</h2>
            {overdue.length > 0 && (
              <span style={{ background: '#dc2626', color: '#fff', fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 12 }}>
                {overdue.length}
              </span>
            )}
          </div>
          <button onClick={exportOverdueCSV} style={{ padding: '6px 14px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            Export CSV
          </button>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Title', 'User', 'Type', 'Due Date', 'Days Overdue', 'Status'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overdue.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No overdue items. 🎉</td></tr>
              ) : overdue.map(item => (
                <tr key={item.id}>
                  <td style={{ ...tdStyle, maxWidth: 200 }}>{item.title}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{truncate(item.user_clerk_id, 20)}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#f1f5f9', color: '#475569', textTransform: 'capitalize' }}>
                      {item.item_type}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>{formatDate(item.due_date)}</td>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 700, color: '#dc2626' }}>{item.days_overdue}d</span>
                  </td>
                  <td style={tdStyle}><StatusBadge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Report 5: Completion Trends ──────────────────────────────

function CompletionTrendsReport() {
  const [days, setDays] = useState<TrendDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get('/compliance/reports/trends');
      setDays(res.data?.days ?? res.data ?? []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 32, color: '#2563eb' }}>Loading...</div>;
  if (error) return <div style={{ padding: 32, color: '#dc2626' }}>Error: {error}</div>;

  const maxCount = Math.max(...days.map(d => d.completions), 1);
  const totalThisMonth = days.reduce((s, d) => s + d.completions, 0);
  const dailyAvg = days.length > 0 ? totalThisMonth / days.length : 0;
  const busiestDay = days.reduce((best, d) => d.completions > (best?.completions ?? -1) ? d : best, days[0] ?? null);

  const exportCSV = () => {
    const csv = ['Day,Completions,Exams,Policies,Documents,Checklists']
      .concat(days.map(d => `${d.day},${d.completions},${d.exams},${d.policies},${d.documents},${d.checklists}`))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'completion_trends.csv'; a.click();
  };

  const top10 = [...days].sort((a, b) => b.completions - a.completions).slice(0, 10);

  const CHART_HEIGHT = 160;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1e293b' }}>Completion Trends</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>Last 30 days of completion activity</p>
        </div>
        <button onClick={exportCSV} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          📥 Export CSV
        </button>
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Completions', value: totalThisMonth.toLocaleString(), color: '#2563eb' },
          { label: 'Daily Average', value: dailyAvg.toFixed(1), color: '#7c3aed' },
          { label: 'Busiest Day', value: busiestDay ? `${busiestDay.day} (${busiestDay.completions})` : '—', color: '#16a34a' },
        ].map(stat => (
          <div key={stat.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 20px', flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Bar Chart */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '24px 20px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 16 }}>Daily Completions (Last 30 Days)</div>

        {days.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>No completions in the last 30 days</div>
        ) : (
          <div>
            {/* Chart area */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: CHART_HEIGHT, borderBottom: '1px solid #e2e8f0', paddingBottom: 0, overflowX: 'auto' }}>
              {days.map((d, idx) => {
                const barH = maxCount > 0 ? Math.max((d.completions / maxCount) * CHART_HEIGHT, d.completions > 0 ? 4 : 0) : 0;
                const showLabel = idx % 5 === 0;
                const shortDay = d.day.slice(5); // MM-DD
                return (
                  <div
                    key={d.day}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 18 }}
                    title={`${d.day}: ${d.completions} total (exams: ${d.exams}, policies: ${d.policies}, docs: ${d.documents}, checklists: ${d.checklists})`}
                  >
                    <div style={{ height: CHART_HEIGHT - barH, flex: 'none' }} />
                    <div
                      style={{
                        width: '80%', height: barH,
                        background: '#2563eb',
                        borderRadius: '3px 3px 0 0',
                        opacity: d.completions === 0 ? 0.15 : 1,
                        transition: 'height 0.2s',
                      }}
                    />
                  </div>
                );
              })}
            </div>
            {/* X-axis labels */}
            <div style={{ display: 'flex', gap: 3, marginTop: 4, overflowX: 'hidden' }}>
              {days.map((d, idx) => {
                const showLabel = idx % 5 === 0;
                const shortDay = d.day.slice(5);
                return (
                  <div key={d.day} style={{ flex: 1, minWidth: 18, textAlign: 'center' }}>
                    {showLabel && <span style={{ fontSize: 9, color: '#94a3b8' }}>{shortDay}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Top 10 Days Table */}
      {top10.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
            Top 10 Days by Completions
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Day', 'Total', 'Exams', 'Policies', 'Documents', 'Checklists'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {top10.map((d, i) => (
                <tr key={d.day} style={{ background: i === 0 ? '#f0fdf4' : 'transparent' }}>
                  <td style={{ ...tdStyle, fontWeight: i === 0 ? 700 : 400 }}>{d.day}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: '#2563eb' }}>{d.completions}</td>
                  <td style={{ ...tdStyle, color: '#64748b' }}>{d.exams}</td>
                  <td style={{ ...tdStyle, color: '#64748b' }}>{d.policies}</td>
                  <td style={{ ...tdStyle, color: '#64748b' }}>{d.documents}</td>
                  <td style={{ ...tdStyle, color: '#64748b' }}>{d.checklists}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main: ComplianceReports ──────────────────────────────────

type ReportKey = 'summary' | 'user' | 'exam' | 'expiration' | 'trends';

interface ReportType {
  key: ReportKey;
  label: string;
  icon: string;
}

const REPORTS: ReportType[] = [
  { key: 'summary', label: 'Completion Summary', icon: '📊' },
  { key: 'user', label: 'User Detail Report', icon: '👤' },
  { key: 'exam', label: 'Exam Analysis', icon: '📝' },
  { key: 'expiration', label: 'Expiration Report', icon: '⏰' },
  { key: 'trends', label: 'Completion Trends', icon: '📈' },
];

export default function ComplianceReports() {
  const [activeReport, setActiveReport] = useState<ReportKey>('summary');

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', margin: 0 }}>Compliance Reports</h1>
        <p style={{ fontSize: 14, color: '#64748b', marginTop: 6 }}>Generate and export detailed compliance data</p>
      </div>

      {/* 2-column layout */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* Left Sidebar */}
        <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {REPORTS.map(report => (
            <button
              key={report.key}
              onClick={() => setActiveReport(report.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                background: activeReport === report.key ? '#2563eb' : '#fff',
                color: activeReport === report.key ? '#fff' : '#475569',
                border: activeReport === report.key ? 'none' : '1px solid #e2e8f0',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: activeReport === report.key ? 700 : 500,
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (activeReport !== report.key) {
                  e.currentTarget.style.background = '#eff6ff';
                  e.currentTarget.style.color = '#2563eb';
                }
              }}
              onMouseLeave={e => {
                if (activeReport !== report.key) {
                  e.currentTarget.style.background = '#fff';
                  e.currentTarget.style.color = '#475569';
                }
              }}
            >
              <span style={{ fontSize: 16 }}>{report.icon}</span>
              <span>{report.label}</span>
            </button>
          ))}
        </div>

        {/* Right Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {activeReport === 'summary' && <CompletionSummaryReport />}
          {activeReport === 'user' && <UserDetailReport />}
          {activeReport === 'exam' && <ExamAnalysisReport />}
          {activeReport === 'expiration' && <ExpirationReport />}
          {activeReport === 'trends' && <CompletionTrendsReport />}
        </div>
      </div>
    </div>
  );
}
