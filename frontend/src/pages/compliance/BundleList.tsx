import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────

interface Bundle {
  id: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  sequential: boolean;
  applicable_roles: string[];
  item_count?: number;
  items?: unknown[];
  created_at: string;
}

interface Stats {
  total: number;
  published: number;
  draft: number;
  total_assignments: number;
}

// ─── Helpers ──────────────────────────────────────────────────

function statusBadge(status: Bundle['status']) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    draft:     { bg: '#f1f5f9', color: '#64748b', label: 'Draft' },
    published: { bg: '#dcfce7', color: '#166534', label: 'Published' },
    archived:  { bg: '#fee2e2', color: '#991b1b', label: 'Archived' },
  };
  const s = map[status] ?? map.draft;
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

// ─── Main Component ───────────────────────────────────────────

export default function BundleList() {
  const navigate = useNavigate();

  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, published: 0, draft: 0, total_assignments: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasCategories, setHasCategories] = useState<boolean | null>(null);
  const [showNoCategoryAlert, setShowNoCategoryAlert] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [listRes, statsRes] = await Promise.all([
          api.get('/compliance/bundles'),
          api.get('/compliance/bundles/stats'),
        ]);
        const data = listRes.data;
        setBundles(Array.isArray(data) ? data : (data.bundles ?? []));
        const sd = statsRes.data;
        setStats({
          total: sd.total ?? 0,
          published: sd.published ?? 0,
          draft: sd.draft ?? 0,
          total_assignments: sd.total_assignments ?? 0,
        });
      } catch (e: any) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Check if any categories exist (for guiding the user)
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/compliance/categories');
        const cats = Array.isArray(res.data) ? res.data : (res.data.categories ?? []);
        setHasCategories(cats.length > 0);
      } catch {
        setHasCategories(true); // Don't block if check fails
      }
    })();
  }, []);

  function handleCreateBundle() {
    if (hasCategories === false) {
      setShowNoCategoryAlert(true);
      return;
    }
    navigate('/compliance/admin/bundles/new');
  }

  async function handleArchive(id: string, title: string) {
    if (!window.confirm(`Archive "${title}"?`)) return;
    try {
      await api.delete(`/compliance/bundles/${id}`);
      setBundles((prev) => prev.filter((b) => b.id !== id));
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    }
  }

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* No-category alert modal */}
        {showNoCategoryAlert && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            onClick={() => setShowNoCategoryAlert(false)}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: 12,
                boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                padding: 32,
                maxWidth: 460,
                width: '100%',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>🗂️</div>
              <h3 style={{ margin: '0 0 10px 0', fontSize: 18, fontWeight: 700, color: '#1e293b' }}>
                Set Up Role Types First
              </h3>
              <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 20px 0' }}>
                Before creating a bundle, make sure you have <strong>Role Types</strong> set up in{' '}
                <strong>Category Setup</strong>. Bundles can be assigned to specific roles.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowNoCategoryAlert(false)}
                  style={{
                    padding: '9px 18px',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    background: '#fff',
                    color: '#64748b',
                    fontSize: 14,
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowNoCategoryAlert(false); navigate('/compliance/admin/categories'); }}
                  style={{
                    padding: '9px 18px',
                    border: 'none',
                    borderRadius: 8,
                    background: '#2563eb',
                    color: '#fff',
                    fontSize: 14,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Go to Category Setup
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>Bundles</h1>
          <button
            onClick={handleCreateBundle}
            style={{
              padding: '9px 20px', fontSize: 14, fontWeight: 600,
              background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >
            + New Bundle
          </button>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'Total', value: stats.total },
            { label: 'Published', value: stats.published },
            { label: 'Draft', value: stats.draft },
            { label: 'Total Assignments', value: stats.total_assignments },
          ].map((s) => (
            <div
              key={s.label}
              style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 20px' }}
            >
              <div style={{ fontSize: 26, fontWeight: 700, color: '#1e293b' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 16px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Table */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          {loading ? (
            <>
              <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '10px 16px', display: 'flex', gap: 20 }}>
                {[160, 60, 80, 70, 120, 90].map((w, i) => (
                  <div key={i} style={{ height: 11, width: w, borderRadius: 5, background: '#e2e8f0' }} />
                ))}
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 20, alignItems: 'center' }}>
                  {[180, 50, 70, 60, 100, 110].map((w, j) => (
                    <div key={j} style={{ height: 13, width: w, borderRadius: 6, background: '#f1f5f9' }} />
                  ))}
                </div>
              ))}
            </>
          ) : bundles.length === 0 ? (
            <div style={{ padding: '60px 40px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>No bundles yet</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
                Create a bundle to group policies, documents, exams, and checklists together.
              </div>
              <button
                onClick={handleCreateBundle}
                style={{
                  padding: '9px 20px', fontSize: 14, fontWeight: 600,
                  background: '#2563eb', color: '#fff', border: 'none',
                  borderRadius: 8, cursor: 'pointer',
                }}
              >
                New Bundle
              </button>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  {['Title', 'Items', 'Sequential', 'Status', 'Roles', 'Actions'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px', textAlign: 'left',
                        fontSize: 12, fontWeight: 600, color: '#64748b',
                        textTransform: 'uppercase', letterSpacing: '0.4px',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bundles.map((b, i) => {
                  const itemCount = b.item_count ?? (Array.isArray(b.items) ? b.items.length : 0);
                  return (
                    <tr key={b.id} style={{ borderBottom: i < bundles.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                      <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 500, color: '#1e293b' }}>
                        {b.title}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>
                        {itemCount} item{itemCount !== 1 ? 's' : ''}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {b.sequential ? (
                          <span style={{
                            display: 'inline-block', fontSize: 11, fontWeight: 600,
                            padding: '2px 8px', borderRadius: 10,
                            background: '#dbeafe', color: '#1d4ed8',
                          }}>
                            Sequential
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: 14 }}>–</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>{statusBadge(b.status)}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>
                        {(b.applicable_roles ?? []).length === 0
                          ? 'All roles'
                          : (b.applicable_roles ?? []).join(', ')}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Link
                            to={`/compliance/admin/bundles/${b.id}/edit`}
                            style={{
                              fontSize: 13, fontWeight: 500, color: '#2563eb',
                              textDecoration: 'none', padding: '4px 10px',
                              border: '1px solid #bfdbfe', borderRadius: 6, background: '#eff6ff',
                            }}
                          >
                            Edit
                          </Link>
                          <Link
                            to={`/compliance/admin/bundles/${b.id}/assign`}
                            style={{
                              fontSize: 13, fontWeight: 500, color: '#059669',
                              textDecoration: 'none', padding: '4px 10px',
                              border: '1px solid #a7f3d0', borderRadius: 6, background: '#ecfdf5',
                            }}
                          >
                            Assign
                          </Link>
                          <button
                            onClick={() => handleArchive(b.id, b.title)}
                            style={{
                              fontSize: 13, fontWeight: 500, color: '#64748b',
                              padding: '4px 10px', border: '1px solid #e2e8f0',
                              borderRadius: 6, background: '#ffffff', cursor: 'pointer',
                            }}
                          >
                            Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
