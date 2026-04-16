import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────

interface Exam {
  id: string;
  title: string;
  description: string | null;
  passing_score: number;
  max_attempts: number;
  expiration_type: 'one_time' | 'yearly' | 'bi_annual';
  question_count: number;
  status: 'draft' | 'published' | 'archived';
  created_at: string;
  updated_at: string;
}

interface ExamStats {
  total: number;
  published: number;
  draft: number;
  total_attempts: number;
}

// ─── Style helpers ────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid #e2e8f0',
  borderRadius: 7,
  color: '#1e293b',
  background: '#ffffff',
  outline: 'none',
};

// ─── Sub-components ───────────────────────────────────────────

function StatChip({
  label,
  value,
  borderColor,
}: {
  label: string;
  value: number;
  borderColor: string;
}) {
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: 10,
        padding: '16px 20px',
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Exam['status'] }) {
  const map: Record<Exam['status'], { bg: string; color: string; label: string }> = {
    draft:     { bg: '#f1f5f9', color: '#94a3b8', label: 'Draft' },
    published: { bg: '#f0fdf4', color: '#16a34a', label: 'Published' },
    archived:  { bg: '#fee2e2', color: '#dc2626', label: 'Archived' },
  };
  const s = map[status] ?? map.draft;
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 9px',
        borderRadius: 10,
        background: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

function ExpiryBadge({ type }: { type: Exam['expiration_type'] }) {
  const map: Record<Exam['expiration_type'], { bg: string; color: string; label: string }> = {
    one_time:  { bg: '#dbeafe', color: '#1d4ed8', label: 'One Time' },
    yearly:    { bg: '#fff7ed', color: '#c2410c', label: 'Yearly' },
    bi_annual: { bg: '#f5f3ff', color: '#7c3aed', label: 'Bi-Annual' },
  };
  const s = map[type] ?? map.one_time;
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 9px',
        borderRadius: 10,
        background: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function ExamList() {
  const navigate = useNavigate();

  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<ExamStats | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [archiving, setArchiving] = useState<string | null>(null);

  // Fetch stats
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/compliance/exams/stats');
        setStats(res.data);
      } catch {
        // non-fatal
      }
    })();
  }, []);

  // Fetch exams
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params: Record<string, string> = {};
        if (statusFilter !== 'all') params.status = statusFilter;
        const res = await api.get('/compliance/exams', { params });
        const data = res.data;
        setExams(Array.isArray(data) ? data : (data.exams ?? []));
      } catch (e: any) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [statusFilter]);

  async function handleArchive(exam: Exam) {
    if (
      !window.confirm(
        `Archive "${exam.title}"? It will no longer be assignable but existing attempts will be preserved.`
      )
    )
      return;

    setArchiving(exam.id);
    try {
      await api.patch(`/compliance/exams/${exam.id}`, { status: 'archived' });
      setExams((prev) =>
        prev.map((e) => (e.id === exam.id ? { ...e, status: 'archived' } : e))
      );
      if (stats) {
        setStats((s) =>
          s
            ? {
                ...s,
                published: exam.status === 'published' ? s.published - 1 : s.published,
                draft: exam.status === 'draft' ? s.draft - 1 : s.draft,
              }
            : s
        );
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setArchiving(null);
    }
  }

  // Client-side search filter
  const visibleExams = exams.filter((e) => {
    if (!searchQuery.trim()) return true;
    return e.title.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 28,
        }}
      >
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', margin: 0 }}>Exams</h1>
        <button
          onClick={() => navigate('/compliance/admin/exams/new')}
          style={{
            padding: '9px 20px',
            fontSize: 14,
            fontWeight: 600,
            background: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          + New Exam
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div style={{ display: 'flex', gap: 14, marginBottom: 28, flexWrap: 'wrap' }}>
          <StatChip label="Total Exams"     value={stats.total}          borderColor="#2563eb" />
          <StatChip label="Published"       value={stats.published}      borderColor="#16a34a" />
          <StatChip label="Draft"           value={stats.draft}          borderColor="#94a3b8" />
          <StatChip label="Total Attempts"  value={stats.total_attempts} borderColor="#7c3aed" />
        </div>
      )}

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>

        <input
          type="text"
          placeholder="Search by title…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ ...inputStyle, minWidth: 240 }}
        />
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            background: '#fee2e2',
            color: '#991b1b',
            padding: '12px 16px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {/* Table */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <>
            {/* Skeleton header */}
            <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '10px 16px', display: 'flex', gap: 20 }}>
              {[160, 80, 90, 80, 70, 70, 80].map((w, i) => (
                <div key={i} style={{ height: 11, width: w, borderRadius: 5, background: '#e2e8f0' }} />
              ))}
            </div>
            {/* Skeleton rows */}
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 20, alignItems: 'center' }}>
                {[180, 40, 50, 70, 30, 60, 100].map((w, j) => (
                  <div key={j} style={{ height: 13, width: w, borderRadius: 6, background: '#f1f5f9' }} />
                ))}
              </div>
            ))}
          </>
        ) : visibleExams.length === 0 ? (
          exams.length === 0 ? (
            <div style={{ padding: '60px 40px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>No exams yet</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
                Create your first exam to start assessing competency.
              </div>
              <button
                onClick={() => navigate('/compliance/admin/exams/new')}
                style={{
                  padding: '9px 22px',
                  fontSize: 14,
                  fontWeight: 600,
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                + Create Exam
              </button>
            </div>
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
              No exams match your search.
            </div>
          )
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                {['Title', 'Passing Score', 'Max Attempts', 'Expiry Type', 'Questions', 'Status', 'Actions'].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {visibleExams.map((exam) => (
                <tr
                  key={exam.id}
                  style={{ borderBottom: '1px solid #f1f5f9' }}
                >
                  <td
                    style={{
                      padding: '12px 16px',
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#1e293b',
                      maxWidth: 260,
                    }}
                  >
                    {exam.title}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#475569' }}>
                    {exam.passing_score}%
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#475569' }}>
                    {exam.max_attempts}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <ExpiryBadge type={exam.expiration_type} />
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#475569' }}>
                    {exam.question_count ?? '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <StatusBadge status={exam.status} />
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => navigate(`/compliance/admin/exams/${exam.id}/edit`)}
                        style={{
                          padding: '5px 14px',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#2563eb',
                          background: '#ffffff',
                          border: '1px solid #2563eb',
                          borderRadius: 6,
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                      {exam.status !== 'archived' && (
                        <button
                          onClick={() => handleArchive(exam)}
                          disabled={archiving === exam.id}
                          style={{
                            padding: '5px 14px',
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#dc2626',
                            background: '#ffffff',
                            border: '1px solid #dc2626',
                            borderRadius: 6,
                            cursor: archiving === exam.id ? 'not-allowed' : 'pointer',
                            opacity: archiving === exam.id ? 0.6 : 1,
                          }}
                        >
                          {archiving === exam.id ? 'Archiving…' : 'Archive'}
                        </button>
                      )}
                    </div>
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
