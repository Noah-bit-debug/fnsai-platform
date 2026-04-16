import { useState, useEffect } from 'react';
import api from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  reason?: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'approved' | 'rejected' | 'saved';
  reviewer_name?: string;
  reviewed_at?: string;
  rejection_reason?: string;
  generated_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  high:   '#c62828',
  medium: '#e65100',
  low:    '#1565c0',
};

const TYPE_META: Record<string, { icon: string; color: string }> = {
  workflow:  { icon: '⚙️',  color: '#1565c0' },
  reminder:  { icon: '🔔', color: '#6a1b9a' },
  template:  { icon: '📝', color: '#00838f' },
  staffing:  { icon: '👥', color: '#2e7d32' },
  document:  { icon: '📄', color: '#e65100' },
  process:   { icon: '🔄', color: '#546e7a' },
};

const FILTER_TABS = ['all', 'pending', 'approved', 'rejected', 'saved'] as const;
type FilterTab = typeof FILTER_TABS[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 2)   return 'Just now';
  if (mins < 60)  return `${mins} minutes ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

// ─── Generate Confirm Modal ───────────────────────────────────────────────────

function GenerateModal({ onClose, onGenerated }: { onClose: () => void; onGenerated: () => void }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await api.post('/suggestions/generate');
      setMsg(`Generated ${res.data?.count ?? 0} new suggestion${res.data?.count !== 1 ? 's' : ''}.`);
      onGenerated();
      setTimeout(onClose, 1800);
    } catch (e: any) {
      setMsg(e?.response?.data?.error ?? 'Failed to generate suggestions.');
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>💡</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 10 }}>Generate Suggestions</div>
        <div style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
          This will analyze your current operations and generate new AI-powered suggestions for workflow improvements, reminders, and process optimizations.
        </div>
        {msg && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 14, color: '#15803d', fontWeight: 600 }}>
            {msg}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button
            onClick={handleGenerate}
            disabled={loading}
            style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Analyzing...' : '✨ Generate Now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reject Modal ─────────────────────────────────────────────────────────────

function RejectModal({ onClose, onReject }: { onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 14 }}>Reject Suggestion</div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Reason (optional)</label>
          <textarea
            style={{ width: '100%', padding: '9px 14px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box', height: 80, resize: 'vertical', fontFamily: 'inherit' }}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why is this suggestion not applicable?"
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#374151' }}>Cancel</button>
          <button onClick={() => onReject(reason)} style={{ background: '#c62828', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Reject</button>
        </div>
      </div>
    </div>
  );
}

// ─── Suggestion Card ──────────────────────────────────────────────────────────

interface SuggestionCardProps {
  suggestion: Suggestion;
  onRefresh: () => void;
}

function SuggestionCard({ suggestion: s, onRefresh }: SuggestionCardProps) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [editing, setEditing]       = useState(false);
  const [editDesc, setEditDesc]     = useState(s.description);
  const [saving, setSaving]         = useState(false);
  const [showReject, setShowReject] = useState(false);

  const typeMeta = TYPE_META[s.type] ?? { icon: '💡', color: '#546e7a' };
  const priorityColor = PRIORITY_COLORS[s.priority] ?? '#546e7a';
  const isPending = s.status === 'pending';

  const handleAction = async (action: string, extra?: Record<string, string>) => {
    setSaving(true);
    try {
      await api.post(`/suggestions/${s.id}/${action}`, extra ?? {});
      onRefresh();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? `Failed to ${action}.`);
    } finally {
      setSaving(false);
    }
  };

  const handleEditApprove = async () => {
    setSaving(true);
    try {
      await api.post(`/suggestions/${s.id}/approve`, { description: editDesc });
      setEditing(false);
      onRefresh();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Failed to approve.');
    } finally {
      setSaving(false);
    }
  };

  const pulseStyle: React.CSSProperties = isPending && s.priority === 'high'
    ? { animation: 'suggestionPulse 2.5s ease-in-out infinite' }
    : {};

  return (
    <>
      <style>{`
        @keyframes suggestionPulse {
          0%, 100% { box-shadow: 0 1px 4px rgba(198,40,40,0.08); }
          50%       { box-shadow: 0 0 0 3px rgba(198,40,40,0.12); }
        }
      `}</style>

      <div style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid #e8edf2',
        borderLeft: `4px solid ${priorityColor}`,
        padding: '18px 18px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...pulseStyle,
      }}>
        {/* Top row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <span style={{ fontSize: 18 }}>{typeMeta.icon}</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c', lineHeight: 1.3 }}>{s.title}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <span style={{ background: typeMeta.color + '1a', color: typeMeta.color, borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>
                  {s.type}
                </span>
                <span style={{ background: priorityColor + '1a', color: priorityColor, borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>
                  {s.priority} priority
                </span>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{timeAgo(s.generated_at)}</div>
        </div>

        {/* Description */}
        {editing ? (
          <div>
            <textarea
              style={{ width: '100%', padding: '9px 14px', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box', height: 90, resize: 'vertical', fontFamily: 'inherit' }}
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={handleEditApprove} disabled={saving} style={{ background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                {saving ? 'Saving...' : '✅ Save & Approve'}
              </button>
              <button onClick={() => setEditing(false)} style={{ background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{s.description}</div>
        )}

        {/* Why generated (collapsible) */}
        {s.reason && (
          <div>
            <button
              onClick={() => setReasonOpen(o => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#64748b', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {reasonOpen ? '▾' : '▸'} Why was this generated?
            </button>
            {reasonOpen && (
              <div style={{ background: '#fafbfc', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#64748b', marginTop: 6, lineHeight: 1.5, border: '1px solid #f1f5f9' }}>
                {s.reason}
              </div>
            )}
          </div>
        )}

        {/* Status indicators */}
        {s.status === 'approved' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0fdf4', borderRadius: 8, padding: '8px 12px' }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>Approved</div>
              {s.reviewer_name && <div style={{ fontSize: 11, color: '#64748b' }}>by {s.reviewer_name}{s.reviewed_at ? ` · ${timeAgo(s.reviewed_at)}` : ''}</div>}
            </div>
          </div>
        )}
        {s.status === 'rejected' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', borderRadius: 8, padding: '8px 12px' }}>
            <span style={{ fontSize: 16 }}>❌</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#c62828' }}>Rejected</div>
              {s.rejection_reason && <div style={{ fontSize: 11, color: '#64748b' }}>{s.rejection_reason}</div>}
            </div>
          </div>
        )}
        {s.status === 'saved' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fffbeb', borderRadius: 8, padding: '8px 12px' }}>
            <span style={{ fontSize: 16 }}>🔖</span>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e' }}>Saved for Later</div>
          </div>
        )}

        {/* Actions for pending */}
        {isPending && !editing && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid #f1f5f9', marginTop: 2 }}>
            <button
              onClick={() => handleAction('approve')}
              disabled={saving}
              style={{ background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
            >
              ✅ Approve
            </button>
            <button
              onClick={() => setEditing(true)}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
            >
              ✏️ Edit & Approve
            </button>
            <button
              onClick={() => setShowReject(true)}
              style={{ background: '#fef2f2', color: '#c62828', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
            >
              ❌ Reject
            </button>
            <button
              onClick={() => handleAction('save')}
              disabled={saving}
              style={{ background: '#fffbeb', color: '#92400e', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
            >
              🔖 Save
            </button>
          </div>
        )}
      </div>

      {showReject && (
        <RejectModal
          onClose={() => setShowReject(false)}
          onReject={(reason) => { setShowReject(false); handleAction('reject', { rejection_reason: reason }); }}
        />
      )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Suggestions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [filterTab, setFilterTab]     = useState<FilterTab>('all');
  const [showGenerate, setShowGenerate] = useState(false);

  const fetchSuggestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = filterTab !== 'all' ? { status: filterTab } : {};
      const res = await api.get('/suggestions', { params });
      setSuggestions(res.data?.suggestions ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load suggestions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSuggestions(); }, [filterTab]);

  const counts = {
    pending:  suggestions.filter(s => s.status === 'pending').length,
    approved: suggestions.filter(s => s.status === 'approved').length,
    rejected: suggestions.filter(s => s.status === 'rejected').length,
    saved:    suggestions.filter(s => s.status === 'saved').length,
  };

  const TAB_LABELS: Record<FilterTab, string> = {
    all:      `All (${suggestions.length})`,
    pending:  `Pending (${counts.pending})`,
    approved: `Approved`,
    rejected: `Rejected`,
    saved:    `Saved`,
  };

  const EMPTY_MESSAGES: Record<FilterTab, string> = {
    all:      'No suggestions yet. Click "Generate Suggestions" to get started.',
    pending:  'No pending suggestions. All caught up!',
    approved: 'No approved suggestions yet.',
    rejected: 'No rejected suggestions.',
    saved:    'No saved suggestions.',
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>💡 Suggestions</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>AI-powered improvement recommendations for your operations</p>
          </div>
          <button
            onClick={() => setShowGenerate(true)}
            style={{ background: 'linear-gradient(135deg,#1565c0,#2e7d32)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
          >
            ✨ Generate Suggestions
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Total Pending',        value: counts.pending,  color: '#e65100' },
          { label: 'Approved This Week',   value: counts.approved, color: '#2e7d32' },
          { label: 'Rejected',             value: counts.rejected, color: '#c62828' },
          { label: 'Saved for Later',      value: counts.saved,    color: '#1565c0' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '16px 20px' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs + content */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', overflow: 'hidden' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', overflowX: 'auto' }}>
          {FILTER_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              style={{
                padding: '12px 20px', border: 'none', cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap',
                fontWeight: filterTab === tab ? 700 : 500,
                color: filterTab === tab ? '#1565c0' : '#64748b',
                background: filterTab === tab ? '#eff6ff' : 'transparent',
                borderBottom: filterTab === tab ? '2px solid #1565c0' : '2px solid transparent',
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ padding: '18px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#64748b' }}>Loading suggestions...</div>
          ) : suggestions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>💡</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>No suggestions</div>
              <div style={{ fontSize: 14, color: '#64748b' }}>{EMPTY_MESSAGES[filterTab]}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {suggestions.map(s => (
                <SuggestionCard key={s.id} suggestion={s} onRefresh={fetchSuggestions} />
              ))}
            </div>
          )}
        </div>
      </div>

      {!loading && suggestions.length > 0 && (
        <div style={{ fontSize: 13, color: '#64748b', textAlign: 'right', marginTop: 8 }}>
          {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
        </div>
      )}

      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onGenerated={fetchSuggestions}
        />
      )}
    </div>
  );
}
