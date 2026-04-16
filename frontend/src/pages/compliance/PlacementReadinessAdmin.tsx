import React, { useEffect, useState, useCallback, useRef } from 'react';
import api from '../../lib/api';

interface ReadinessRecord {
  id: string;
  staff_id?: string;
  candidate_id?: string;
  staff_name?: string;
  staff_role?: string;
  candidate_name?: string;
  candidate_stage?: string;
  is_ready: boolean;
  readiness_score: number;
  blocking_issues: string[];
  last_evaluated: string;
}

interface Summary {
  total: number;
  ready: number;
  not_ready: number;
  avg_score: number;
}

type FilterTab = 'all' | 'ready' | 'not_ready' | 'staff' | 'candidates';

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  const mos = Math.floor(days / 30);
  return `${mos} month${mos !== 1 ? 's' : ''} ago`;
}

function scoreColor(score: number): string {
  if (score >= 70) return '#16a34a';
  if (score >= 50) return '#ea580c';
  return '#dc2626';
}

interface ToastProps {
  message: string;
  onDone: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, onDone }) => {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        background: '#1e293b',
        color: 'white',
        borderRadius: 8,
        padding: '12px 20px',
        fontSize: 14,
        fontWeight: 500,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        zIndex: 9999,
        maxWidth: 340,
        lineHeight: 1.5,
      }}
    >
      {message}
    </div>
  );
};

const PlacementReadinessAdmin: React.FC = () => {
  const [records, setRecords] = useState<ReadinessRecord[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, ready: 0, not_ready: 0, avg_score: 0 });
  const [loading, setLoading] = useState(true);
  const [evaluatingAll, setEvaluatingAll] = useState(false);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/compliance/readiness');
      setRecords(res.data.records ?? []);
      setSummary(res.data.summary ?? { total: 0, ready: 0, not_ready: 0, avg_score: 0 });
    } catch {
      setError('Failed to load readiness data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleEvaluateAll = async () => {
    setEvaluatingAll(true);
    try {
      const res = await api.post('/compliance/readiness/evaluate-all');
      const { ready = 0, not_ready = 0 } = res.data ?? {};
      setToast(`Evaluation complete: ${ready} staff ready, ${not_ready} not ready.`);
      await fetchData();
    } catch {
      setToast('Evaluation failed. Please try again.');
    } finally {
      setEvaluatingAll(false);
    }
  };

  const handleReEvaluate = async (record: ReadinessRecord) => {
    setEvaluatingId(record.id);
    try {
      if (record.staff_id) {
        await api.post(`/compliance/readiness/evaluate/staff/${record.staff_id}`);
      } else if (record.candidate_id) {
        await api.post(`/compliance/readiness/evaluate/candidate/${record.candidate_id}`);
      }
      await fetchData();
    } catch {
      setToast('Re-evaluation failed.');
    } finally {
      setEvaluatingId(null);
    }
  };

  const filteredRecords = records.filter((r) => {
    if (filter === 'ready' && !r.is_ready) return false;
    if (filter === 'not_ready' && r.is_ready) return false;
    if (filter === 'staff' && !r.staff_id) return false;
    if (filter === 'candidates' && !r.candidate_id) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const name = (r.staff_name || r.candidate_name || '').toLowerCase();
      const role = (r.staff_role || r.candidate_stage || '').toLowerCase();
      if (!name.includes(q) && !role.includes(q)) return false;
    }

    return true;
  });

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'ready', label: 'Ready' },
    { key: 'not_ready', label: 'Not Ready' },
    { key: 'staff', label: 'Staff Only' },
    { key: 'candidates', label: 'Candidates Only' },
  ];

  const cardStyle: React.CSSProperties = {
    background: 'white',
    borderRadius: 10,
    boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
    padding: 24,
  };

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', padding: 32, color: '#1e293b' }}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 6 }}>
          Placement Readiness
        </h1>
        <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
          Track whether staff and candidates meet compliance requirements for placement
        </p>
      </div>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* KPI Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard
          label="Total Evaluated"
          value={String(summary.total)}
          color="#64748b"
          bg="#f1f5f9"
        />
        <KpiCard
          label="Ready"
          value={`${summary.ready} ✓`}
          color="#16a34a"
          bg="#dcfce7"
        />
        <KpiCard
          label="Not Ready"
          value={`${summary.not_ready} ✗`}
          color="#dc2626"
          bg="#fee2e2"
        />
        <KpiCard
          label="Avg Score"
          value={`${Math.round(summary.avg_score)} / 100`}
          color="#2563eb"
          bg="#eff6ff"
        />
      </div>

      {/* Actions row */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={handleEvaluateAll}
          disabled={evaluatingAll}
          style={{
            background: evaluatingAll ? '#93c5fd' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 7,
            padding: '9px 20px',
            fontSize: 14,
            fontWeight: 600,
            cursor: evaluatingAll ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {evaluatingAll && (
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 14,
                border: '2px solid rgba(255,255,255,0.4)',
                borderTopColor: 'white',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }}
            />
          )}
          {evaluatingAll ? 'Evaluating…' : 'Evaluate All'}
        </button>
      </div>

      {/* Filter tabs + search */}
      <div style={cardStyle}>
        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1.5px solid',
                borderColor: filter === tab.key ? '#2563eb' : '#e2e8f0',
                background: filter === tab.key ? '#eff6ff' : 'white',
                color: filter === tab.key ? '#2563eb' : '#64748b',
                fontWeight: filter === tab.key ? 600 : 400,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or role…"
            style={{
              width: '100%',
              maxWidth: 320,
              padding: '8px 12px',
              border: '1.5px solid #e2e8f0',
              borderRadius: 7,
              fontSize: 13,
              color: '#1e293b',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0' }}>
            Loading…
          </div>
        ) : filteredRecords.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: '#64748b',
              padding: '40px 0',
              fontSize: 14,
            }}
          >
            {records.length === 0
              ? "No readiness evaluations yet. Click 'Evaluate All' to run the first evaluation."
              : 'No records match your filters.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  {['Name', 'Type', 'Role / Stage', 'Readiness', 'Score', 'Issues', 'Last Evaluated', 'Actions'].map(
                    (col) => (
                      <th
                        key={col}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          color: '#64748b',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          fontSize: 12,
                        }}
                      >
                        {col}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => {
                  const isStaff = !!record.staff_id;
                  const name = record.staff_name || record.candidate_name || '—';
                  const roleOrStage = record.staff_role || record.candidate_stage || '—';
                  const issueCount = record.blocking_issues?.length ?? 0;
                  const isExpanded = expandedId === record.id;
                  const isEvaluating = evaluatingId === record.id;

                  return (
                    <React.Fragment key={record.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : record.id)}
                        style={{
                          borderBottom: '1px solid #e2e8f0',
                          cursor: 'pointer',
                          background: isExpanded ? '#f8fafc' : 'white',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          if (!isExpanded)
                            (e.currentTarget as HTMLTableRowElement).style.background = '#f8fafc';
                        }}
                        onMouseLeave={(e) => {
                          if (!isExpanded)
                            (e.currentTarget as HTMLTableRowElement).style.background = 'white';
                        }}
                      >
                        {/* Name */}
                        <td style={{ padding: '10px 10px', fontWeight: 500, color: '#1e293b' }}>
                          {name}
                        </td>

                        {/* Type badge */}
                        <td style={{ padding: '10px 10px' }}>
                          <span
                            style={{
                              background: isStaff ? '#eff6ff' : '#f3e8ff',
                              color: isStaff ? '#2563eb' : '#7c3aed',
                              borderRadius: 5,
                              padding: '2px 8px',
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {isStaff ? 'Staff' : 'Candidate'}
                          </span>
                        </td>

                        {/* Role/Stage */}
                        <td style={{ padding: '10px 10px', color: '#64748b' }}>{roleOrStage}</td>

                        {/* Readiness badge */}
                        <td style={{ padding: '10px 10px' }}>
                          <span
                            style={{
                              background: record.is_ready ? '#dcfce7' : '#fee2e2',
                              color: record.is_ready ? '#16a34a' : '#dc2626',
                              borderRadius: 20,
                              padding: '3px 10px',
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {record.is_ready ? '✓ Ready' : '✗ Not Ready'}
                          </span>
                        </td>

                        {/* Score with mini bar */}
                        <td style={{ padding: '10px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div
                              style={{
                                width: 60,
                                height: 5,
                                borderRadius: 3,
                                background: '#e2e8f0',
                                overflow: 'hidden',
                                flexShrink: 0,
                              }}
                            >
                              <div
                                style={{
                                  height: '100%',
                                  width: `${Math.min(record.readiness_score, 100)}%`,
                                  background: scoreColor(record.readiness_score),
                                  borderRadius: 3,
                                }}
                              />
                            </div>
                            <span style={{ color: '#1e293b', fontSize: 12, whiteSpace: 'nowrap' }}>
                              {record.readiness_score} / 100
                            </span>
                          </div>
                        </td>

                        {/* Issues chip */}
                        <td style={{ padding: '10px 10px' }}>
                          {issueCount > 0 ? (
                            <span
                              style={{
                                background: '#fff7ed',
                                color: '#ea580c',
                                border: '1px solid #fed7aa',
                                borderRadius: 5,
                                padding: '2px 8px',
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              {issueCount} issue{issueCount !== 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>
                          )}
                        </td>

                        {/* Last evaluated */}
                        <td style={{ padding: '10px 10px', color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {record.last_evaluated ? relativeDate(record.last_evaluated) : '—'}
                        </td>

                        {/* Actions */}
                        <td
                          style={{ padding: '10px 10px' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => handleReEvaluate(record)}
                            disabled={isEvaluating}
                            style={{
                              background: 'white',
                              border: '1.5px solid #2563eb',
                              color: '#2563eb',
                              borderRadius: 5,
                              padding: '3px 10px',
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: isEvaluating ? 'not-allowed' : 'pointer',
                              opacity: isEvaluating ? 0.6 : 1,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isEvaluating ? 'Running…' : 'Re-evaluate'}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded row */}
                      {isExpanded && (
                        <tr style={{ background: '#f8fafc' }}>
                          <td
                            colSpan={8}
                            style={{ padding: '12px 16px 16px 16px', borderBottom: '1px solid #e2e8f0' }}
                          >
                            <div style={{ fontWeight: 600, fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                              Blocking Issues
                            </div>
                            {issueCount === 0 ? (
                              <p style={{ margin: 0, color: '#16a34a', fontSize: 13 }}>
                                No blocking issues — this person meets all requirements.
                              </p>
                            ) : (
                              <ul style={{ margin: 0, padding: '0 0 0 18px', color: '#b91c1c', fontSize: 13 }}>
                                {record.blocking_issues.map((issue, i) => (
                                  <li key={i} style={{ marginBottom: 4 }}>
                                    {issue}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

interface KpiCardProps {
  label: string;
  value: string;
  color: string;
  bg: string;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, color, bg }) => (
  <div
    style={{
      background: 'white',
      borderRadius: 10,
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      padding: '18px 20px',
    }}
  >
    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 500 }}>{label}</div>
    <div
      style={{
        fontSize: 22,
        fontWeight: 700,
        color,
        background: bg,
        display: 'inline-block',
        borderRadius: 7,
        padding: '2px 10px',
      }}
    >
      {value}
    </div>
  </div>
);

export default PlacementReadinessAdmin;
