import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';
import SendForESignButton from '../../components/ESign/SendForESignButton';

// ─── Types ────────────────────────────────────────────────────

interface Policy {
  id: number;
  title: string;
  version: string;
  status: 'draft' | 'published' | 'archived';
  applicable_roles: string[];
  requires_signature: boolean;
  created_at: string;
  cat1_name?: string;
}

interface Category {
  id: number;
  name: string;
  level: 1 | 2 | 3;
  parent_id: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────

function statusBadge(status: Policy['status']) {
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

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

// ─── Main Component ───────────────────────────────────────────

export default function PolicyList() {
  const navigate = useNavigate();

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCat1, setFilterCat1] = useState<string>('');
  const [archiving, setArchiving] = useState<number | null>(null);

  const cat1Items = categories.filter((c) => c.level === 1);

  async function fetchPolicies() {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterCat1) params.cat1_id = filterCat1;

      const query = new URLSearchParams(params).toString();
      const res = await api.get(`/compliance/policies${query ? '?' + query : ''}`);
      setPolicies(Array.isArray(res.data) ? res.data : (res.data.policies ?? []));
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/compliance/categories');
        setCategories(Array.isArray(res.data) ? res.data : (res.data.categories ?? []));
      } catch {
        // non-fatal
      }
    })();
  }, []);

  useEffect(() => {
    fetchPolicies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterCat1]);

  async function handleArchive(id: number) {
    if (!window.confirm('Archive this policy? It will no longer be visible to staff.')) return;
    setArchiving(id);
    try {
      await api.delete(`/compliance/policies/${id}`);
      await fetchPolicies();
    } catch (e: any) {
      alert('Archive failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setArchiving(null);
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: '7px 12px',
    fontSize: 13,
    border: '1px solid #e2e8f0',
    borderRadius: 7,
    color: '#1e293b',
    background: '#ffffff',
    outline: 'none',
    cursor: 'pointer',
  };

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>Policies</h1>
          <p style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
            Manage compliance policies for your organization.
          </p>
        </div>
        <button
          onClick={() => navigate('/compliance/admin/policies/new')}
          style={{
            padding: '9px 18px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + New Policy
        </button>
        {/* Phase 2.3 — AI wizard entry point */}
        <button
          onClick={() => navigate('/compliance/admin/policies/ai-wizard')}
          style={{
            padding: '9px 18px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            marginLeft: 8,
          }}
        >
          ✦ AI from document
        </button>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={inputStyle}
        >
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>

        <select
          value={filterCat1}
          onChange={(e) => setFilterCat1(e.target.value)}
          style={inputStyle}
        >
          <option value="">All Roles / Modalities</option>
          {cat1Items.map((c) => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, color: '#64748b', fontSize: 14 }}>Loading…</div>
        ) : policies.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>No policies yet</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18 }}>
              Create your first policy to get started.
            </div>
            <button
              onClick={() => navigate('/compliance/admin/policies/new')}
              style={{
                padding: '8px 16px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Create Policy
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                {['Title', 'Version', 'Status', 'Roles', 'Req. Signature', 'Created', 'Actions'].map((h) => (
                  <th key={h} style={{
                    padding: '10px 16px',
                    textAlign: 'left',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    whiteSpace: 'nowrap',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '11px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{p.title}</div>
                  </td>
                  <td style={{ padding: '11px 16px', fontSize: 13, color: '#64748b' }}>
                    v{p.version || '1.0'}
                  </td>
                  <td style={{ padding: '11px 16px' }}>{statusBadge(p.status)}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: '#475569', maxWidth: 160 }}>
                    {Array.isArray(p.applicable_roles) && p.applicable_roles.length > 0
                      ? p.applicable_roles.slice(0, 3).join(', ') + (p.applicable_roles.length > 3 ? ` +${p.applicable_roles.length - 3}` : '')
                      : <span style={{ color: '#94a3b8' }}>All</span>}
                  </td>
                  <td style={{ padding: '11px 16px', fontSize: 18, textAlign: 'center' }}>
                    {p.requires_signature ? '✓' : '✗'}
                  </td>
                  <td style={{ padding: '11px 16px', fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>
                    {formatDate(p.created_at)}
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Link
                        to={`/compliance/admin/policies/${p.id}/edit`}
                        style={{
                          padding: '5px 12px',
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#2563eb',
                          border: '1px solid #bfdbfe',
                          borderRadius: 6,
                          textDecoration: 'none',
                          background: '#eff6ff',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Edit
                      </Link>
                      {/* Phase 3.2 — Send this policy for eSign signature.
                          Opens the shared picker; the policy's title is
                          used as the default doc title. */}
                      {p.status === 'published' && (
                        <SendForESignButton
                          compact
                          label="eSign"
                          referenceId={String(p.id)}
                          referenceType="policy"
                          defaultDocTitle={p.title}
                        />
                      )}
                      {p.status !== 'archived' && (
                        <button
                          onClick={() => handleArchive(p.id)}
                          disabled={archiving === p.id}
                          style={{
                            padding: '5px 12px',
                            fontSize: 12,
                            fontWeight: 500,
                            color: '#dc2626',
                            border: '1px solid #fecaca',
                            borderRadius: 6,
                            background: '#fff5f5',
                            cursor: archiving === p.id ? 'not-allowed' : 'pointer',
                            opacity: archiving === p.id ? 0.6 : 1,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {archiving === p.id ? 'Archiving…' : 'Archive'}
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
