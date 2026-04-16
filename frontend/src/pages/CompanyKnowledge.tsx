import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface KnowledgeSource {
  id: string;
  name: string;
  type: 'email' | 'onedrive' | 'teams' | 'documents' | 'notes';
  status: 'active' | 'indexing' | 'error' | 'disabled';
  item_count?: number;
  last_indexed_at?: string;
  description?: string;
  permissions?: string[];
  enabled: boolean;
  created_at: string;
}

interface KnowledgeItem {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  content_preview: string;
  type: string;
  indexed_at: string;
  relevance_score?: number;
}

interface KnowledgeStats {
  total_sources: number;
  active_sources: number;
  indexed_items: number;
  pending_questions: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SOURCE_TYPE_META: Record<string, { icon: string; label: string; description: string; color: string }> = {
  email:     { icon: '📧', label: 'Email',     description: 'Outlook email threads and attachments', color: '#0072c6' },
  onedrive:  { icon: '🗂️',  label: 'OneDrive',  description: 'Files and documents from OneDrive',    color: '#0078d4' },
  teams:     { icon: '💬', label: 'Teams',     description: 'Teams channel messages and files',     color: '#5b5fc7' },
  documents: { icon: '📄', label: 'Documents', description: 'Uploaded internal documents',          color: '#166534' },
  notes:     { icon: '📝', label: 'Notes',     description: 'Manual notes and knowledge entries',   color: '#7c3aed' },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: 'Active',    color: '#166534', bg: '#dcfce7' },
  indexing:  { label: 'Indexing',  color: '#854d0e', bg: '#fef9c3' },
  error:     { label: 'Error',     color: '#991b1b', bg: '#fee2e2' },
  disabled:  { label: 'Disabled',  color: '#374151', bg: '#f1f5f9' },
};

const ROLES = ['Admin', 'Manager', 'Recruiter', 'HR', 'Viewer'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d?: string) {
  if (!d) return 'Never';
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function inp(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%', padding: '9px 14px', border: '1px solid #e8edf2',
    borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c',
    boxSizing: 'border-box', background: '#fff', ...extra,
  };
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 2000,
      background: type === 'success' ? '#166534' : '#991b1b',
      color: '#fff', borderRadius: 10, padding: '12px 20px',
      fontSize: 14, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', gap: 10, maxWidth: 360,
    }}>
      <span>{type === 'success' ? '✅' : '❌'}</span>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
    </div>
  );
}

// ─── Add Source Modal ─────────────────────────────────────────────────────────
function AddSourceModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({
    name: '',
    type: 'documents' as KnowledgeSource['type'],
    description: '',
    permissions: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggleRole = (role: string) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(role)
        ? f.permissions.filter((r) => r !== role)
        : [...f.permissions, role],
    }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    setSaving(true);
    setErr(null);
    try {
      await api.post('/knowledge/sources', { ...form, name: form.name.trim() });
      onAdded();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to add source.');
    } finally {
      setSaving(false);
    }
  };

  const meta = SOURCE_TYPE_META[form.type];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>Add Knowledge Source</div>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>Connect a data source to enrich internal AI suggestions.</p>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Source Type</label>
          <select style={inp()} value={form.type} onChange={set('type')}>
            {Object.entries(SOURCE_TYPE_META).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label} – {v.description}</option>
            ))}
          </select>
        </div>

        {/* Preview */}
        <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>{meta.icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1a2b3c' }}>{meta.label}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{meta.description}</div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Source Name *</label>
          <input style={inp()} value={form.name} onChange={set('name')} placeholder={`e.g. ${meta.label} – HR Policies`} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Description / Config Notes</label>
          <textarea style={{ ...inp(), height: 80, resize: 'vertical' }} value={form.description} onChange={set('description')} placeholder="What data does this source contain?" />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>Access Permissions</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ROLES.map((role) => {
              const active = form.permissions.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  style={{
                    border: `1px solid ${active ? '#1565c0' : '#e8edf2'}`,
                    borderRadius: 8, padding: '5px 13px', cursor: 'pointer',
                    fontWeight: 600, fontSize: 13,
                    background: active ? '#eff6ff' : '#f8fafc',
                    color: active ? '#1565c0' : '#374151',
                    transition: 'all 0.15s',
                  }}
                >
                  {active ? '✓ ' : ''}{role}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Select which roles can access this knowledge source.</div>
        </div>

        {err && <div style={{ color: '#991b1b', fontSize: 13, marginBottom: 12, background: '#fee2e2', borderRadius: 8, padding: '8px 12px' }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Adding...' : '🧠 Add Source'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Source Card ──────────────────────────────────────────────────────────────
function SourceCard({
  source,
  onIndex,
  onToggle,
  indexing,
}: {
  source: KnowledgeSource;
  onIndex: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  indexing: boolean;
}) {
  const meta = SOURCE_TYPE_META[source.type] ?? SOURCE_TYPE_META.documents;
  const sm = STATUS_META[source.status] ?? STATUS_META.disabled;

  return (
    <div style={{
      background: '#fff', borderRadius: 14, border: '1px solid #e8edf2',
      padding: 18, display: 'flex', flexDirection: 'column', gap: 0,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      opacity: source.enabled ? 1 : 0.7, transition: 'opacity 0.2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: `${meta.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
          {meta.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#1a2b3c', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {source.name}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{meta.label}</div>
          <span style={{ background: sm.bg, color: sm.color, borderRadius: 8, padding: '2px 9px', fontSize: 11, fontWeight: 600 }}>{sm.label}</span>
        </div>
        {/* Toggle */}
        <button
          onClick={() => onToggle(source.id, !source.enabled)}
          style={{
            width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
            background: source.enabled ? '#22c55e' : '#d1d5db',
            position: 'relative', transition: 'background 0.2s', flexShrink: 0,
          }}
          title={source.enabled ? 'Disable source' : 'Enable source'}
        >
          <span style={{
            position: 'absolute', top: 2, left: source.enabled ? 20 : 2,
            width: 18, height: 18, borderRadius: '50%', background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        <span>📦 <strong style={{ color: '#1a2b3c' }}>{(source.item_count ?? 0).toLocaleString()}</strong> items</span>
        <span>🕐 <strong style={{ color: '#1a2b3c' }}>{fmtDate(source.last_indexed_at)}</strong></span>
      </div>

      {source.description && (
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, fontStyle: 'italic', lineHeight: 1.5 }}>
          {source.description}
        </div>
      )}

      {source.permissions && source.permissions.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
          {source.permissions.map((p) => (
            <span key={p} style={{ background: '#f1f5f9', borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 600, color: '#374151' }}>
              {p}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={() => onIndex(source.id)}
        disabled={indexing || !source.enabled}
        style={{
          background: '#eff6ff', color: '#1565c0', border: 'none', borderRadius: 8,
          padding: '7px 0', cursor: (indexing || !source.enabled) ? 'not-allowed' : 'pointer',
          fontWeight: 600, fontSize: 13, opacity: (indexing || !source.enabled) ? 0.6 : 1,
          width: '100%', transition: 'opacity 0.2s',
        }}
      >
        {indexing ? '⏳ Indexing...' : '🔍 Index Now'}
      </button>
    </div>
  );
}

// ─── Search Results ───────────────────────────────────────────────────────────
function SearchResults({ query }: { query: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['knowledge-search', query],
    queryFn: () => api.get<{ items: KnowledgeItem[] }>(`/knowledge/items/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
  });

  const items: KnowledgeItem[] = data?.data?.items ?? [];

  if (query.trim().length < 2) return null;

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c' }}>
          🔍 Search Results for "{query}"
        </span>
        {!isLoading && (
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>— {items.length} item{items.length !== 1 ? 's' : ''} found</span>
        )}
      </div>
      {isLoading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 14 }}>Searching...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
          <div style={{ fontSize: 14, color: '#64748b' }}>No knowledge items match "{query}"</div>
        </div>
      ) : (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {items.map((item, i) => (
            <div key={item.id} style={{ padding: '14px 18px', borderTop: i > 0 ? '1px solid #f1f5f9' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2b3c', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </span>
                {item.relevance_score != null && (
                  <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 6, padding: '1px 7px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {Math.round(item.relevance_score * 100)}% match
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, marginBottom: 6 }}>
                {item.content_preview}
              </div>
              <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#94a3b8' }}>
                <span>📂 {item.source_name}</span>
                <span>🕐 {fmtDate(item.indexed_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Recent Items ─────────────────────────────────────────────────────────────
function RecentItems() {
  const { data, isLoading } = useQuery({
    queryKey: ['knowledge-recent'],
    queryFn: () => api.get<{ items: KnowledgeItem[] }>('/knowledge/items/recent'),
  });

  const items: KnowledgeItem[] = data?.data?.items ?? [];

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c' }}>🕐 Recently Indexed Items</span>
      </div>
      {isLoading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 14 }}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 14, color: '#64748b' }}>No items indexed yet. Add a source and index it.</div>
        </div>
      ) : (
        <div>
          {items.map((item, i) => (
            <div key={item.id} style={{ padding: '12px 18px', borderTop: i > 0 ? '1px solid #f1f5f9' : 'none', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>
                {SOURCE_TYPE_META[item.type]?.icon ?? '📄'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#1a2b3c', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4, lineHeight: 1.5 }}>
                  {item.content_preview.length > 100 ? `${item.content_preview.slice(0, 100)}...` : item.content_preview}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  {item.source_name} · {fmtDate(item.indexed_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CompanyKnowledge() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [liveQuery, setLiveQuery] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Debounced search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setLiveQuery(searchQuery), 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  const { data: statsData } = useQuery({
    queryKey: ['knowledge-stats'],
    queryFn: () => api.get<KnowledgeStats>('/knowledge/stats'),
    refetchInterval: 30000,
  });

  const stats: KnowledgeStats = statsData?.data ?? { total_sources: 0, active_sources: 0, indexed_items: 0, pending_questions: 0 };

  const { data: sourcesData, isLoading, error } = useQuery({
    queryKey: ['knowledge-sources'],
    queryFn: () => api.get<{ sources: KnowledgeSource[] }>('/knowledge/sources'),
    refetchInterval: 15000,
  });

  const sources: KnowledgeSource[] = sourcesData?.data?.sources ?? [];

  const indexMutation = useMutation({
    mutationFn: (id: string) => api.post(`/knowledge/sources/${id}/index`),
    onMutate: (id) => setIndexingId(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-stats'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-recent'] });
      showToast('Indexing started! Items will appear shortly.');
      setIndexingId(null);
    },
    onError: (e: any) => {
      showToast(e?.response?.data?.error ?? 'Indexing failed.', 'error');
      setIndexingId(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/knowledge/sources/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge-sources'] }),
    onError: (e: any) => showToast(e?.response?.data?.error ?? 'Toggle failed.', 'error'),
  });

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>🧠 Company Knowledge</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Manage AI knowledge sources and indexed data</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
          >
            + Add Source
          </button>
        </div>
      </div>

      {/* Privacy notice */}
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>🔒</span>
        <p style={{ fontSize: 13, color: '#1d4ed8', margin: 0, lineHeight: 1.6 }}>
          <strong>Privacy Notice:</strong> Knowledge data is encrypted, access-controlled, and only used to improve internal suggestions and workflows. Data is never shared externally or used to train AI models outside of your workspace.
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total Sources',    value: stats.total_sources,    icon: '📚', color: '#1565c0' },
          { label: 'Active Sources',   value: stats.active_sources,   icon: '✅', color: '#166534' },
          { label: 'Indexed Items',    value: stats.indexed_items.toLocaleString(), icon: '🔍', color: '#7c3aed' },
          { label: 'Pending Questions',value: stats.pending_questions, icon: '❓', color: '#854d0e' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 24 }}>{icon}</span>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 3 }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 24 }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 18, pointerEvents: 'none' }}>🔍</span>
        <input
          style={{ ...inp({ paddingLeft: 44 }), borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
          placeholder="Search knowledge items..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); setLiveQuery(''); }}
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#94a3b8' }}
          >
            ×
          </button>
        )}
      </div>

      {/* Live search results */}
      {liveQuery.trim().length >= 2 && <SearchResults query={liveQuery} />}

      {/* Sources grid */}
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c' }}>Knowledge Sources</div>
        {sources.length > 0 && <span style={{ fontSize: 13, color: '#64748b' }}>{sources.length} source{sources.length !== 1 ? 's' : ''}</span>}
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 180 }}>
          <div style={{ fontSize: 14, color: '#64748b' }}>Loading sources...</div>
        </div>
      ) : sources.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', padding: '56px 24px', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>🧠</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>No knowledge sources yet</div>
          <p style={{ fontSize: 14, color: '#64748b', maxWidth: 380, margin: '0 auto 20px' }}>
            Add sources to let the AI learn from your company's data.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
            {Object.values(SOURCE_TYPE_META).map((m) => (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#374151' }}>
                {m.icon} {m.label}
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}
          >
            + Add Your First Source
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 28 }}>
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onIndex={(id) => indexMutation.mutate(id)}
              onToggle={(id, enabled) => toggleMutation.mutate({ id, enabled })}
              indexing={indexingId === source.id}
            />
          ))}
        </div>
      )}

      {/* Recent items */}
      {!liveQuery && <RecentItems />}

      {showAdd && (
        <AddSourceModal
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            queryClient.invalidateQueries({ queryKey: ['knowledge-sources'] });
            queryClient.invalidateQueries({ queryKey: ['knowledge-stats'] });
          }}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
