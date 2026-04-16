import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface KnowledgeSource {
  id: string; name: string;
  type: 'email' | 'onedrive' | 'teams' | 'documents' | 'notes';
  status: 'active' | 'indexing' | 'error' | 'disabled';
  item_count?: number; last_indexed_at?: string;
  description?: string; permissions?: string[]; enabled: boolean; created_at: string;
}
interface KnowledgeItem {
  id: string; source_id: string; source_name: string; title: string;
  content_preview: string; type: string; indexed_at: string; relevance_score?: number;
}

interface LearningSource {
  id: string; type: 'document' | 'url' | 'note'; title: string;
  content: string; addedAt: string; tags: string[];
}

interface AIRule {
  id: string; rule: string; category: string; active: boolean; createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SOURCE_TYPE_META: Record<string, { icon: string; label: string; description: string; color: string }> = {
  email:     { icon: '📧', label: 'Email',     description: 'Outlook email threads and attachments', color: '#0072c6' },
  onedrive:  { icon: '🗂️', label: 'OneDrive',  description: 'Files and documents from OneDrive',    color: '#0078d4' },
  teams:     { icon: '💬', label: 'Teams',     description: 'Teams channel messages and files',     color: '#5b5fc7' },
  documents: { icon: '📄', label: 'Documents', description: 'Uploaded internal documents',          color: '#166534' },
  notes:     { icon: '📝', label: 'Notes',     description: 'Manual notes and knowledge entries',   color: '#7c3aed' },
};
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: 'Active',   color: '#166534', bg: '#dcfce7' },
  indexing: { label: 'Indexing', color: '#854d0e', bg: '#fef9c3' },
  error:    { label: 'Error',    color: '#991b1b', bg: '#fee2e2' },
  disabled: { label: 'Disabled', color: '#374151', bg: '#f1f5f9' },
};
const ROLES = ['Admin', 'Manager', 'Recruiter', 'HR', 'Viewer'];
const LEARNING_STORAGE = 'fns_ai_learning_sources';
const RULES_STORAGE    = 'fns_ai_rules';

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
  return { width: '100%', padding: '9px 14px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box', background: '#fff', ...extra };
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, background: type === 'success' ? '#166534' : '#991b1b', color: '#fff', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: 10, maxWidth: 360 }}>
      <span>{type === 'success' ? '✅' : '❌'}</span>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
    </div>
  );
}

// ─── Add Knowledge Source Modal ────────────────────────────────────────────────
function AddSourceModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ name: '', type: 'documents' as KnowledgeSource['type'], description: '', permissions: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const toggleRole = (role: string) => setForm(f => ({ ...f, permissions: f.permissions.includes(role) ? f.permissions.filter(r => r !== role) : [...f.permissions, role] }));
  const handleSubmit = async () => {
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    setSaving(true); setErr(null);
    try { await api.post('/knowledge/sources', { ...form, name: form.name.trim() }); onAdded(); onClose(); }
    catch (e: any) { setErr(e?.response?.data?.error ?? 'Failed to add source.'); }
    finally { setSaving(false); }
  };
  const meta = SOURCE_TYPE_META[form.type];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>Add Knowledge Source</div>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>Connect a data source to enrich internal AI suggestions.</p>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Source Type</label>
          <select style={inp()} value={form.type} onChange={set('type')}>
            {Object.entries(SOURCE_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label} – {v.description}</option>)}
          </select>
        </div>
        <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>{meta.icon}</span>
          <div><div style={{ fontWeight: 700, fontSize: 14 }}>{meta.label}</div><div style={{ fontSize: 12, color: '#64748b' }}>{meta.description}</div></div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Source Name *</label>
          <input style={inp()} value={form.name} onChange={set('name')} placeholder={`e.g. ${meta.label} – HR Policies`} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Description</label>
          <textarea style={{ ...inp(), height: 72, resize: 'vertical' }} value={form.description} onChange={set('description')} placeholder="What data does this source contain?" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>Access Permissions</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ROLES.map(role => {
              const active = form.permissions.includes(role);
              return <button key={role} type="button" onClick={() => toggleRole(role)} style={{ border: `1px solid ${active ? '#1565c0' : '#e8edf2'}`, borderRadius: 8, padding: '5px 13px', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: active ? '#eff6ff' : '#f8fafc', color: active ? '#1565c0' : '#374151' }}>{active ? '✓ ' : ''}{role}</button>;
            })}
          </div>
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

// ─── Tab: Knowledge Items ─────────────────────────────────────────────────────
function KnowledgeItemsTab() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [liveQuery, setLiveQuery] = useState('');
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setLiveQuery(searchQuery), 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  const { data: statsData } = useQuery({ queryKey: ['knowledge-stats'], queryFn: () => api.get<any>('/knowledge/stats'), refetchInterval: 30000 });
  const stats = statsData?.data ?? { total_sources: 0, active_sources: 0, indexed_items: 0, pending_questions: 0 };

  const { data: sourcesData, isLoading } = useQuery({ queryKey: ['knowledge-sources'], queryFn: () => api.get<{ sources: KnowledgeSource[] }>('/knowledge/sources'), refetchInterval: 15000 });
  const sources: KnowledgeSource[] = sourcesData?.data?.sources ?? [];

  const { data: searchData, isLoading: searching } = useQuery({
    queryKey: ['knowledge-search', liveQuery],
    queryFn: () => api.get<{ items: KnowledgeItem[] }>(`/knowledge/items/search?q=${encodeURIComponent(liveQuery)}`),
    enabled: liveQuery.trim().length >= 2,
  });
  const { data: recentData, isLoading: loadingRecent } = useQuery({ queryKey: ['knowledge-recent'], queryFn: () => api.get<{ items: KnowledgeItem[] }>('/knowledge/items/recent') });

  const indexMutation = useMutation({
    mutationFn: (id: string) => api.post(`/knowledge/sources/${id}/index`),
    onMutate: (id) => setIndexingId(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['knowledge-sources'] }); queryClient.invalidateQueries({ queryKey: ['knowledge-stats'] }); setIndexingId(null); },
    onError: () => setIndexingId(null),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.patch(`/knowledge/sources/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge-sources'] }),
  });

  const searchItems: KnowledgeItem[] = searchData?.data?.items ?? [];
  const recentItems: KnowledgeItem[] = recentData?.data?.items ?? [];

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total Sources',     value: stats.total_sources,    icon: '📚', color: '#1565c0' },
          { label: 'Active Sources',    value: stats.active_sources,   icon: '✅', color: '#166534' },
          { label: 'Indexed Items',     value: stats.indexed_items,    icon: '🔍', color: '#7c3aed' },
          { label: 'Pending Questions', value: stats.pending_questions, icon: '❓', color: '#854d0e' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 22 }}>{icon}</span>
            <div><div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div><div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 3 }}>{label}</div></div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 16, pointerEvents: 'none' }}>🔍</span>
        <input style={{ ...inp({ paddingLeft: 44 }), borderRadius: 12 }} placeholder="Search knowledge items…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        {searchQuery && <button onClick={() => { setSearchQuery(''); setLiveQuery(''); }} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#94a3b8' }}>×</button>}
      </div>

      {/* Search Results */}
      {liveQuery.trim().length >= 2 && (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', fontWeight: 700, fontSize: 14 }}>
            🔍 Results for "{liveQuery}" {!searching && <span style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>— {searchItems.length} found</span>}
          </div>
          {searching ? <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>Searching…</div> : searchItems.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: '#64748b' }}>No items match "{liveQuery}"</div>
          ) : searchItems.map((item, i) => (
            <div key={item.id} style={{ padding: '14px 18px', borderTop: i > 0 ? '1px solid #f1f5f9' : 'none' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1a2b3c', marginBottom: 4 }}>{item.title}</div>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, marginBottom: 4 }}>{item.content_preview}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.source_name} · {fmtDate(item.indexed_at)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sources Grid + Add button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c' }}>Knowledge Sources</div>
        <button onClick={() => setShowAdd(true)} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>+ Add Source</button>
      </div>

      {isLoading ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading…</div> : sources.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', padding: '48px 24px', textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🧠</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>No knowledge sources yet</div>
          <p style={{ fontSize: 14, color: '#64748b', maxWidth: 340, margin: '0 auto 20px' }}>Add sources to let the AI learn from your company's data.</p>
          <button onClick={() => setShowAdd(true)} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>+ Add Your First Source</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginBottom: 24 }}>
          {sources.map(source => {
            const meta = SOURCE_TYPE_META[source.type] ?? SOURCE_TYPE_META.documents;
            const sm = STATUS_META[source.status] ?? STATUS_META.disabled;
            return (
              <div key={source.id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', padding: 16, opacity: source.enabled ? 1 : 0.7 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${meta.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{meta.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1a2b3c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.name}</div>
                    <span style={{ background: sm.bg, color: sm.color, borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{sm.label}</span>
                  </div>
                  <button onClick={() => toggleMutation.mutate({ id: source.id, enabled: !source.enabled })} style={{ width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', background: source.enabled ? '#22c55e' : '#d1d5db', position: 'relative', flexShrink: 0 }} title={source.enabled ? 'Disable' : 'Enable'}>
                    <span style={{ position: 'absolute', top: 2, left: source.enabled ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </button>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>📦 {(source.item_count ?? 0).toLocaleString()} items · 🕐 {fmtDate(source.last_indexed_at)}</div>
                <button onClick={() => indexMutation.mutate(source.id)} disabled={indexingId === source.id || !source.enabled} style={{ background: '#eff6ff', color: '#1565c0', border: 'none', borderRadius: 8, padding: '7px 0', cursor: 'pointer', fontWeight: 600, fontSize: 12, width: '100%', opacity: (!source.enabled || indexingId === source.id) ? 0.5 : 1 }}>
                  {indexingId === source.id ? '⏳ Indexing…' : '🔍 Index Now'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent items */}
      {!liveQuery && (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', fontWeight: 700, fontSize: 14 }}>🕐 Recently Indexed Items</div>
          {loadingRecent ? <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>Loading…</div> : recentItems.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
              <div>No items indexed yet. Add a source and index it.</div>
            </div>
          ) : recentItems.map((item, i) => (
            <div key={item.id} style={{ padding: '12px 18px', borderTop: i > 0 ? '1px solid #f1f5f9' : 'none', display: 'flex', gap: 12 }}>
              <span style={{ fontSize: 18 }}>{SOURCE_TYPE_META[item.type]?.icon ?? '📄'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#1a2b3c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{item.source_name} · {fmtDate(item.indexed_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddSourceModal onClose={() => setShowAdd(false)} onAdded={() => { queryClient.invalidateQueries({ queryKey: ['knowledge-sources'] }); queryClient.invalidateQueries({ queryKey: ['knowledge-stats'] }); }} />}
    </div>
  );
}

// ─── Tab: Learning Sources ─────────────────────────────────────────────────────
function LearningSourcesTab() {
  const [sources, setSources] = useState<LearningSource[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ type: 'note' as LearningSource['type'], title: '', content: '', tags: '' });
  const [err, setErr] = useState('');

  useEffect(() => {
    try { const raw = localStorage.getItem(LEARNING_STORAGE); if (raw) setSources(JSON.parse(raw)); } catch {}
  }, []);

  const save = (updated: LearningSource[]) => { setSources(updated); localStorage.setItem(LEARNING_STORAGE, JSON.stringify(updated)); };

  const addSource = () => {
    if (!form.title.trim() || !form.content.trim()) { setErr('Title and content are required.'); return; }
    const newItem: LearningSource = {
      id: `ls_${Date.now()}`, type: form.type, title: form.title.trim(),
      content: form.content.trim(), addedAt: new Date().toISOString(),
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    };
    save([newItem, ...sources]);
    setShowAdd(false);
    setForm({ type: 'note', title: '', content: '', tags: '' });
    setErr('');
  };

  const TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
    document: { icon: '📄', label: 'Document', color: '#1565c0' },
    url:      { icon: '🔗', label: 'URL',      color: '#0891b2' },
    note:     { icon: '📝', label: 'Note',     color: '#7c3aed' },
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c' }}>Learning Sources</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Documents, URLs, and notes that teach the AI about your business</div>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>+ Add Source</button>
      </div>

      {sources.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', padding: '56px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>No learning sources yet</div>
          <p style={{ fontSize: 14, color: '#64748b', maxWidth: 340, margin: '0 auto 20px' }}>Add documents, URLs, or notes to help the AI understand your company's context and workflows.</p>
          <button onClick={() => setShowAdd(true)} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>+ Add First Source</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sources.map(s => {
            const meta = TYPE_META[s.type];
            return (
              <div key={s.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 16, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: `${meta.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{meta.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1a2b3c', marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8, lineHeight: 1.5 }}>{s.content.slice(0, 160)}{s.content.length > 160 ? '…' : ''}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ background: `${meta.color}15`, color: meta.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{meta.label}</span>
                    {s.tags.map(t => <span key={t} style={{ background: '#f1f5f9', color: '#374151', borderRadius: 6, padding: '2px 7px', fontSize: 11 }}>{t}</span>)}
                    <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>Added {fmtDate(s.addedAt)}</span>
                  </div>
                </div>
                <button onClick={() => save(sources.filter(x => x.id !== s.id))} style={{ background: '#fef2f2', color: '#c62828', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>✕ Remove</button>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Add Learning Source</div>
            {[
              { label: 'Type', key: 'type', type: 'select', options: [['note','📝 Note'],['document','📄 Document'],['url','🔗 URL']] },
              { label: 'Title *', key: 'title', type: 'text', placeholder: 'e.g. Onboarding SOP, Company Policy…' },
              { label: (s: string) => s === 'url' ? 'URL *' : 'Content *', key: 'content', type: 'textarea', placeholder: 'Paste content or URL here…' },
              { label: 'Tags (comma-separated)', key: 'tags', type: 'text', placeholder: 'e.g. hr, onboarding, compliance' },
            ].map((f: any) => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>{typeof f.label === 'function' ? f.label(form.type) : f.label}</label>
                {f.type === 'select' ? (
                  <select style={inp()} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}>
                    {f.options.map(([v, l]: string[]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea style={{ ...inp(), height: 100, resize: 'vertical' }} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} />
                ) : (
                  <input style={inp()} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} />
                )}
              </div>
            ))}
            {err && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAdd(false); setErr(''); }} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
              <button onClick={addSource} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Add Source</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Rules & Corrections ─────────────────────────────────────────────────
function RulesTab() {
  const [rules, setRules] = useState<AIRule[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ rule: '', category: 'General' });
  const [err, setErr] = useState('');

  const CATEGORIES = ['General', 'Recruiting', 'HR', 'Credentialing', 'Onboarding', 'Compliance', 'Tone & Style'];

  useEffect(() => {
    try { const raw = localStorage.getItem(RULES_STORAGE); if (raw) setRules(JSON.parse(raw)); } catch {}
  }, []);

  const save = (updated: AIRule[]) => { setRules(updated); localStorage.setItem(RULES_STORAGE, JSON.stringify(updated)); };

  const addRule = () => {
    if (!form.rule.trim()) { setErr('Rule description is required.'); return; }
    save([{ id: `rule_${Date.now()}`, rule: form.rule.trim(), category: form.category, active: true, createdAt: new Date().toISOString() }, ...rules]);
    setShowAdd(false); setForm({ rule: '', category: 'General' }); setErr('');
  };

  const toggleRule = (id: string) => save(rules.map(r => r.id === id ? { ...r, active: !r.active } : r));
  const deleteRule = (id: string) => save(rules.filter(r => r.id !== id));

  const CAT_COLORS: Record<string, string> = {
    General: '#64748b', Recruiting: '#1565c0', HR: '#6a1b9a', Credentialing: '#00695c',
    Onboarding: '#e65100', Compliance: '#c62828', 'Tone & Style': '#0891b2',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c' }}>Rules &amp; Corrections</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Override or refine AI behavior with custom rules</div>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>+ Add Rule</button>
      </div>

      {rules.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', padding: '56px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚙️</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>No AI rules yet</div>
          <p style={{ fontSize: 14, color: '#64748b', maxWidth: 380, margin: '0 auto 20px' }}>Add rules to control how the AI responds — e.g., "Always use formal tone," "Never suggest overtime without manager approval."</p>
          <button onClick={() => setShowAdd(true)} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>+ Add First Rule</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map((r, i) => (
            <div key={r.id} style={{ background: '#fff', borderRadius: 12, border: `1px solid ${r.active ? '#e8edf2' : '#f1f5f9'}`, padding: '14px 18px', display: 'flex', gap: 14, alignItems: 'center', opacity: r.active ? 1 : 0.55 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c', marginBottom: 4, textDecoration: r.active ? 'none' : 'line-through' }}>{r.rule}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ background: `${CAT_COLORS[r.category] ?? '#64748b'}15`, color: CAT_COLORS[r.category] ?? '#64748b', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{r.category}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>Added {fmtDate(r.createdAt)}</span>
                </div>
              </div>
              <button onClick={() => toggleRule(r.id)} style={{ background: r.active ? '#dcfce7' : '#f1f5f9', color: r.active ? '#166534' : '#64748b', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12, flexShrink: 0 }}>
                {r.active ? 'Active' : 'Disabled'}
              </button>
              <button onClick={() => deleteRule(r.id)} style={{ background: '#fef2f2', color: '#c62828', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Add AI Rule</div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Rule Description *</label>
              <textarea autoFocus value={form.rule} onChange={e => { setForm(p => ({ ...p, rule: e.target.value })); setErr(''); }} placeholder="e.g. Always address staff by their first name. Never suggest overtime without manager approval."
                style={{ ...inp(), height: 90, resize: 'vertical' }} />
              {err && <div style={{ color: '#c62828', fontSize: 12, marginTop: 4 }}>{err}</div>}
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Category</label>
              <select style={inp()} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAdd(false); setErr(''); }} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
              <button onClick={addRule} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Add Rule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type KBTab = 'knowledge' | 'learning' | 'rules';

export default function AIKnowledgeBase() {
  const [tab, setTab] = useState<KBTab>('knowledge');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const TABS: { key: KBTab; icon: string; label: string }[] = [
    { key: 'knowledge', icon: '🧠', label: 'Knowledge Items' },
    { key: 'learning',  icon: '📚', label: 'Learning Sources' },
    { key: 'rules',     icon: '⚙️', label: 'Rules & Corrections' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>🧠 AI Knowledge Base</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Manage everything the AI knows — sources, learnings, and rules</p>
          </div>
        </div>
      </div>

      {/* Privacy notice */}
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>🔒</span>
        <p style={{ fontSize: 13, color: '#1d4ed8', margin: 0, lineHeight: 1.6 }}>
          <strong>Privacy Notice:</strong> All knowledge data is encrypted, access-controlled, and only used to improve internal AI suggestions. Data is never shared externally or used to train models outside your workspace.
        </p>
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e8edf2', marginBottom: 24 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '12px 24px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: tab === t.key ? 700 : 500,
              background: 'none', borderBottom: tab === t.key ? '2px solid #1565c0' : '2px solid transparent',
              color: tab === t.key ? '#1565c0' : '#64748b', marginBottom: -2, transition: 'all 0.15s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'knowledge' && <KnowledgeItemsTab />}
      {tab === 'learning'  && <LearningSourcesTab />}
      {tab === 'rules'     && <RulesTab />}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
