import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────

interface Checklist {
  id: string;
  title: string;
  mode: 'skills' | 'questionnaire';
  status: 'draft' | 'published' | 'archived';
  applicable_roles: string[];
  created_at: string;
}

interface Stats {
  total: number;
  published: number;
  draft: number;
  total_submissions: number;
}

// ─── Helpers ──────────────────────────────────────────────────

function statusBadge(status: Checklist['status']) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    draft:     { bg: '#f1f5f9', color: '#64748b', label: 'Draft' },
    published: { bg: '#dcfce7', color: '#166534', label: 'Published' },
    archived:  { bg: '#fee2e2', color: '#991b1b', label: 'Archived' },
  };
  const s = map[status] ?? map.draft;
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 10,
      background: s.bg,
      color: s.color,
    }}>
      {s.label}
    </span>
  );
}

function modeBadge(mode: Checklist['mode']) {
  const isSkills = mode === 'skills';
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 10,
      background: isSkills ? '#dbeafe' : '#ede9fe',
      color: isSkills ? '#1d4ed8' : '#6d28d9',
    }}>
      {isSkills ? 'Skills' : 'Questionnaire'}
    </span>
  );
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

// ─── Main Component ───────────────────────────────────────────

export default function ChecklistList() {
  const navigate = useNavigate();

  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, published: 0, draft: 0, total_submissions: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [listRes, statsRes] = await Promise.all([
          api.get('/compliance/checklists'),
          api.get('/compliance/checklists/stats'),
        ]);
        const data = listRes.data;
        setChecklists(Array.isArray(data) ? data : (data.checklists ?? []));
        const sd = statsRes.data;
        setStats({
          total: sd.total ?? 0,
          published: sd.published ?? 0,
          draft: sd.draft ?? 0,
          total_submissions: sd.total_submissions ?? 0,
        });
      } catch (e: any) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleArchive(id: string, title: string) {
    if (!window.confirm(`Archive "${title}"? It will no longer be visible to staff.`)) return;
    try {
      await api.delete(`/compliance/checklists/${id}`);
      setChecklists((prev) => prev.filter((c) => c.id !== id));
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    }
  }

  // ─── Render ───────────────────────────────────────────────

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>Skills Checklists</h1>
          <button
            onClick={() => navigate('/compliance/admin/checklists/new')}
            style={{
              padding: '9px 20px',
              fontSize: 14,
              fontWeight: 600,
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            + New Checklist
          </button>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'Total', value: stats.total },
            { label: 'Published', value: stats.published },
            { label: 'Draft', value: stats.draft },
            { label: 'Total Submissions', value: stats.total_submissions },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '16px 20px',
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 700, color: '#1e293b' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: '#fee2e2', color: '#991b1b', padding: '12px 16px',
            borderRadius: 8, fontSize: 13, marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {/* Table */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          {loading ? (
            <>
              {/* Skeleton header */}
              <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '10px 16px', display: 'flex', gap: 20 }}>
                {[160, 90, 70, 120, 90, 100].map((w, i) => (
                  <div key={i} style={{ height: 11, width: w, borderRadius: 5, background: '#e2e8f0' }} />
                ))}
              </div>
              {/* Skeleton rows */}
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 20, alignItems: 'center' }}>
                  {[180, 80, 60, 100, 80, 110].map((w, j) => (
                    <div key={j} style={{ height: 13, width: w, borderRadius: 6, background: '#f1f5f9' }} />
                  ))}
                </div>
              ))}
            </>
          ) : error ? (
            <div style={{
              padding: '24px 28px',
              background: '#fef2f2',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
            }}>
              <span style={{ fontSize: 24, lineHeight: 1 }}>🚨</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>
                  Failed to load checklists
                </div>
                <div style={{ fontSize: 13, color: '#991b1b' }}>
                  Failed to load records. If this persists, check your connection.
                </div>
              </div>
            </div>
          ) : checklists.length === 0 ? (
            <div style={{ padding: '60px 40px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>☑️</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>No checklists yet</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
                Create your first skills checklist to get started.
              </div>
              <button
                onClick={() => navigate('/compliance/admin/checklists/new')}
                style={{
                  padding: '9px 20px', fontSize: 14, fontWeight: 600,
                  background: '#2563eb', color: '#fff', border: 'none',
                  borderRadius: 8, cursor: 'pointer',
                }}
              >
                New Checklist
              </button>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  {['Title', 'Mode', 'Status', 'Roles', 'Created', 'Actions'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.4px',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checklists.map((cl, i) => (
                  <tr
                    key={cl.id}
                    style={{
                      borderBottom: i < checklists.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 500, color: '#1e293b' }}>
                      {cl.title}
                    </td>
                    <td style={{ padding: '12px 16px' }}>{modeBadge(cl.mode)}</td>
                    <td style={{ padding: '12px 16px' }}>{statusBadge(cl.status)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>
                      {(cl.applicable_roles ?? []).length === 0
                        ? 'All roles'
                        : (cl.applicable_roles ?? []).join(', ')}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>
                      {formatDate(cl.created_at)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Link
                          to={`/compliance/admin/checklists/${cl.id}/edit`}
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: '#2563eb',
                            textDecoration: 'none',
                            padding: '4px 10px',
                            border: '1px solid #bfdbfe',
                            borderRadius: 6,
                            background: '#eff6ff',
                          }}
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => handleArchive(cl.id, cl.title)}
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: '#64748b',
                            padding: '4px 10px',
                            border: '1px solid #e2e8f0',
                            borderRadius: 6,
                            background: '#ffffff',
                            cursor: 'pointer',
                          }}
                        >
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
