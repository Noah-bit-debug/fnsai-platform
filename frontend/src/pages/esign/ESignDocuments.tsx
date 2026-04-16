import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { esignApi, ESignDocument } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type DocStatus = ESignDocument['status'];
type FilterTab = 'all' | DocStatus;

interface TabDef {
  key: FilterTab;
  label: string;
  emptyTitle: string;
  emptyBody: string;
}

const TABS: TabDef[] = [
  { key: 'all',             label: 'All',         emptyTitle: 'No documents yet',          emptyBody: 'Send your first document to get started.' },
  { key: 'draft',           label: 'Draft',       emptyTitle: 'No drafts',                 emptyBody: 'Documents you start but do not send will appear here.' },
  { key: 'sent',            label: 'Awaiting',    emptyTitle: 'No documents awaiting',     emptyBody: 'Sent documents waiting for signers show up here.' },
  { key: 'partially_signed',label: 'In Progress', emptyTitle: 'Nothing in progress',       emptyBody: 'Documents that have been partially signed appear here.' },
  { key: 'completed',       label: 'Completed',   emptyTitle: 'No completed documents',    emptyBody: 'Fully signed documents will appear here.' },
  { key: 'voided',          label: 'Voided',      emptyTitle: 'No voided documents',       emptyBody: 'Documents you have voided will appear here.' },
  { key: 'expired',         label: 'Expired',     emptyTitle: 'No expired documents',      emptyBody: 'Documents past their signing deadline appear here.' },
];

const STATUS_CONFIG: Record<DocStatus, { label: string; bg: string; color: string }> = {
  draft:            { label: 'Draft',       bg: '#f3f4f6', color: '#6b7280' },
  sent:             { label: 'Awaiting',    bg: '#fff7ed', color: '#c2410c' },
  partially_signed: { label: 'In Progress', bg: '#eff6ff', color: '#1d4ed8' },
  completed:        { label: 'Completed',   bg: '#f0fdf4', color: '#15803d' },
  voided:           { label: 'Voided',      bg: '#fef2f2', color: '#b91c1c' },
  expired:          { label: 'Expired',     bg: '#fdf4e7', color: '#92400e' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) > 1 ? 's' : ''} ago`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function lastActivity(doc: ESignDocument): string {
  const candidate = doc.completed_at ?? doc.voided_at ?? doc.created_at;
  return relativeTime(candidate);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DocStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      background: cfg.bg,
      color: cfg.color,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

function SignerList({ signers }: { signers: ESignDocument['signers'] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {(signers ?? []).map((s) => (
        <span key={s.id} style={{
          fontSize: 12,
          color: s.status === 'signed' ? '#15803d' : '#6b7280',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <span style={{ fontSize: 10 }}>{s.status === 'signed' ? '✓' : '○'}</span>
          {s.name}
        </span>
      ))}
    </div>
  );
}

function Skeleton({ width = '100%', height = 14, radius = 6 }: { width?: string | number; height?: number; radius?: number }) {
  return (
    <div style={{
      width,
      height,
      borderRadius: radius,
      background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );
}

// ─── 3-Dot Actions Menu ───────────────────────────────────────────────────────

interface ActionMenuProps {
  doc: ESignDocument;
  onOpen: () => void;
  onDownload: () => void;
  onVoid: () => void;
  onRemind: () => void;
  onDuplicate: () => void;
}

function ActionMenu({ doc, onOpen, onDownload, onVoid, onRemind, onDuplicate }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const menuItem = (label: string, icon: string, onClick: () => void, danger = false) => (
    <button
      key={label}
      type="button"
      onClick={() => { onClick(); setOpen(false); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: 500,
        color: danger ? '#b91c1c' : 'var(--prd, #1e293b)',
        background: 'transparent',
        border: 'none',
        width: '100%',
        cursor: 'pointer',
        textAlign: 'left',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = danger ? '#fef2f2' : '#f9fafb'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      <span>{icon}</span> {label}
    </button>
  );

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          background: 'transparent',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 16,
          cursor: 'pointer',
          color: '#6b7280',
          lineHeight: 1,
        }}
        title="Actions"
      >
        ⋯
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 'calc(100% + 4px)',
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          zIndex: 100,
          minWidth: 170,
          overflow: 'hidden',
          padding: '4px 0',
        }}>
          {menuItem('Open', '📄', onOpen)}
          {doc.status === 'completed' && menuItem('Download PDF', '⬇️', onDownload)}
          {(doc.status === 'sent' || doc.status === 'partially_signed') && menuItem('Remind All', '🔔', onRemind)}
          {menuItem('Duplicate', '📋', onDuplicate)}
          {(doc.status !== 'voided' && doc.status !== 'completed') && (
            <>
              <div style={{ height: 1, background: '#f3f4f6', margin: '4px 0' }} />
              {menuItem('Void Document', '🚫', onVoid, true)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Void Modal ───────────────────────────────────────────────────────────────

interface VoidModalProps {
  docTitle: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function VoidModal({ docTitle, onConfirm, onCancel, loading }: VoidModalProps) {
  const [reason, setReason] = useState('');
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, padding: 28, width: 420,
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        }}
      >
        <h3 style={{ margin: '0 0 6px', color: 'var(--prd, #1e293b)' }}>Void Document</h3>
        <p style={{ margin: '0 0 18px', fontSize: 14, color: '#6b7280' }}>
          Are you sure you want to void <strong>{docTitle}</strong>? This cannot be undone.
        </p>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
          Reason (optional)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Document sent in error"
          rows={3}
          style={{
            width: '100%', borderRadius: 8, border: '1px solid #d1d5db',
            padding: '8px 12px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" onClick={onCancel} disabled={loading} style={{
            background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 8,
            padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151',
          }}>
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(reason)} disabled={loading} style={{
            background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Voiding…' : 'Void Document'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ESignDocuments() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [documents, setDocuments] = useState<ESignDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 25;

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkVoiding, setBulkVoiding] = useState(false);

  // Void modal
  const [voidTarget, setVoidTarget] = useState<ESignDocument | null>(null);
  const [voidLoading, setVoidLoading] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchDocuments = useCallback(async (tab: FilterTab, offset: number, append = false) => {
    if (!append) setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { limit: PAGE_SIZE, offset: offset * PAGE_SIZE };
      if (tab !== 'all') params.status = tab;
      const res = await esignApi.listDocuments(params as Parameters<typeof esignApi.listDocuments>[0]);
      const fetched: ESignDocument[] = res.data?.documents ?? [];
      setDocuments((prev) => append ? [...prev, ...fetched] : fetched);
      setHasMore(fetched.length === PAGE_SIZE);
    } catch {
      setError('Could not load documents. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
    fetchDocuments(activeTab, 0, false);
  }, [activeTab, fetchDocuments]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchDocuments(activeTab, next, true);
  };

  // Client-side search filter
  const filtered = search.trim()
    ? documents.filter((d) => d.title.toLowerCase().includes(search.trim().toLowerCase()))
    : documents;

  // Count per tab (from loaded data — approximation for tab badges)
  const countForTab = (tab: FilterTab) => {
    if (tab === 'all') return documents.length;
    return documents.filter((d) => d.status === tab).length;
  };

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((d) => d.id)));
    }
  };

  // Void single
  const handleVoid = async (reason: string) => {
    if (!voidTarget) return;
    setVoidLoading(true);
    try {
      await esignApi.voidDocument(voidTarget.id, reason);
      setDocuments((prev) => prev.map((d) => d.id === voidTarget.id ? { ...d, status: 'voided' as DocStatus } : d));
      showToast('Document voided.');
    } catch {
      showToast('Could not void document.', 'error');
    } finally {
      setVoidLoading(false);
      setVoidTarget(null);
    }
  };

  // Void bulk
  const handleBulkVoid = async () => {
    if (selected.size === 0) return;
    setBulkVoiding(true);
    let failed = 0;
    for (const id of Array.from(selected)) {
      try {
        await esignApi.voidDocument(id);
        setDocuments((prev) => prev.map((d) => d.id === id ? { ...d, status: 'voided' as DocStatus } : d));
      } catch {
        failed++;
      }
    }
    setBulkVoiding(false);
    setSelected(new Set());
    if (failed > 0) {
      showToast(`${selected.size - failed} voided, ${failed} failed.`, 'error');
    } else {
      showToast(`${selected.size} document${selected.size > 1 ? 's' : ''} voided.`);
    }
  };

  // Remind
  const handleRemind = async (doc: ESignDocument) => {
    try {
      await esignApi.remind(doc.id);
      showToast(`Reminders sent for "${doc.title}".`);
    } catch {
      showToast('Could not send reminders.', 'error');
    }
  };

  // Download
  const handleDownload = async (doc: ESignDocument) => {
    try {
      const res = await esignApi.downloadSigned(doc.id);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.title.replace(/\s+/g, '_')}_signed.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Could not download document.', 'error');
    }
  };

  const activeTabDef = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  return (
    <div>
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .esign-doc-row { transition: background 0.1s; cursor: pointer; }
        .esign-doc-row:hover { background: #f9fafb !important; }
        .esign-tab-btn {
          background: transparent;
          border: none;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 500;
          color: #6b7280;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: color 0.12s, border-color 0.12s;
        }
        .esign-tab-btn:hover { color: var(--prd, #1e293b); }
        .esign-tab-btn.active {
          color: var(--ac, #6366f1);
          border-bottom-color: var(--ac, #6366f1);
          font-weight: 600;
        }
        .esign-tab-count {
          background: #f3f4f6;
          color: #6b7280;
          border-radius: 10px;
          padding: 1px 7px;
          font-size: 11px;
          font-weight: 700;
        }
        .esign-tab-btn.active .esign-tab-count {
          background: var(--ac, #6366f1);
          color: #fff;
        }
        .th-cell {
          padding: 10px 16px;
          text-align: left;
          font-size: 11px;
          font-weight: 700;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          white-space: nowrap;
          user-select: none;
        }
        .td-cell { padding: 13px 16px; vertical-align: middle; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 28,
          right: 28,
          background: toast.type === 'success' ? '#1e293b' : '#b91c1c',
          color: '#fff',
          borderRadius: 10,
          padding: '12px 20px',
          fontSize: 14,
          fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          zIndex: 2000,
          animation: 'toastIn 0.2s ease',
          maxWidth: 320,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Void modal */}
      {voidTarget && (
        <VoidModal
          docTitle={voidTarget.title}
          onConfirm={handleVoid}
          onCancel={() => setVoidTarget(null)}
          loading={voidLoading}
        />
      )}

      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--prd, #1e293b)' }}>Documents</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: '#6b7280' }}>
            All signing documents across your organization
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/esign/documents/new')}
          style={{
            background: 'var(--ac, #6366f1)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> New Document
        </button>
      </div>

      {/* Main card */}
      <div style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>

        {/* Toolbar: tabs + search */}
        <div style={{ borderBottom: '1px solid #e5e7eb' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', overflowX: 'auto', padding: '0 16px' }}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`esign-tab-btn${activeTab === tab.key ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                <span className="esign-tab-count">{countForTab(tab.key)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Search + bulk actions bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 20px',
          borderBottom: '1px solid #f3f4f6',
          flexWrap: 'wrap',
        }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 180 }}>
            <span style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#9ca3af',
              fontSize: 14,
              pointerEvents: 'none',
            }}>
              🔍
            </span>
            <input
              type="text"
              placeholder="Search by document title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 32px',
                borderRadius: 8,
                border: '1px solid #e5e7eb',
                fontSize: 13,
                color: 'var(--prd, #1e293b)',
                outline: 'none',
                boxSizing: 'border-box',
                background: '#f9fafb',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ac, #6366f1)'; e.currentTarget.style.background = '#fff'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#f9fafb'; }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14,
                }}
              >×</button>
            )}
          </div>

          {selected.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                {selected.size} selected
              </span>
              <button
                type="button"
                onClick={handleBulkVoid}
                disabled={bulkVoiding}
                style={{
                  background: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                  borderRadius: 7,
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: bulkVoiding ? 'not-allowed' : 'pointer',
                  opacity: bulkVoiding ? 0.7 : 1,
                }}
              >
                {bulkVoiding ? 'Voiding…' : `🚫 Void Selected (${selected.size})`}
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                style={{
                  background: 'transparent', border: 'none', fontSize: 13,
                  color: '#9ca3af', cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            margin: '0 20px 0',
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            color: '#b91c1c',
            fontSize: 13,
          }}>
            {error}{' '}
            <button
              type="button"
              onClick={() => fetchDocuments(activeTab, 0, false)}
              style={{ background: 'none', border: 'none', color: '#b91c1c', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div style={{ padding: '24px 20px' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 16, marginBottom: 18, alignItems: 'center' }}>
                <Skeleton width={20} height={20} radius={4} />
                <Skeleton width="25%" height={14} />
                <div style={{ flex: 1 }}><Skeleton height={12} /></div>
                <Skeleton width={72} height={22} radius={20} />
                <Skeleton width={80} height={12} />
                <Skeleton width={80} height={12} />
                <Skeleton width={60} height={28} radius={7} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '56px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>📭</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--prd, #1e293b)', marginBottom: 8 }}>
              {search ? `No results for "${search}"` : activeTabDef.emptyTitle}
            </div>
            <div style={{ fontSize: 14, color: '#9ca3af', maxWidth: 340, margin: '0 auto 24px' }}>
              {search ? 'Try a different search term.' : activeTabDef.emptyBody}
            </div>
            {!search && activeTab === 'all' && (
              <button
                type="button"
                onClick={() => navigate('/esign/documents/new')}
                style={{
                  background: 'var(--ac, #6366f1)', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                + New Document
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <th className="th-cell" style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === filtered.length}
                      ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < filtered.length; }}
                      onChange={toggleSelectAll}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th className="th-cell">Title</th>
                  <th className="th-cell">Signers</th>
                  <th className="th-cell">Status</th>
                  <th className="th-cell">Sent Date</th>
                  <th className="th-cell">Last Activity</th>
                  <th className="th-cell" style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc) => (
                  <tr
                    key={doc.id}
                    className="esign-doc-row"
                    style={{
                      borderBottom: '1px solid #f9fafb',
                      background: selected.has(doc.id) ? '#f5f3ff' : 'transparent',
                    }}
                    onClick={() => navigate(`/esign/documents/${doc.id}`)}
                  >
                    <td className="td-cell" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(doc.id)}
                        onChange={() => toggleSelect(doc.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td className="td-cell" style={{ maxWidth: 260 }}>
                      <div style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: 'var(--prd, #1e293b)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {doc.title}
                      </div>
                    </td>
                    <td className="td-cell">
                      <SignerList signers={doc.signers ?? []} />
                    </td>
                    <td className="td-cell" style={{ whiteSpace: 'nowrap' }}>
                      <StatusBadge status={doc.status} />
                    </td>
                    <td className="td-cell" style={{ fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="td-cell" style={{ fontSize: 13, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                      {lastActivity(doc)}
                    </td>
                    <td className="td-cell" style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <ActionMenu
                        doc={doc}
                        onOpen={() => navigate(`/esign/documents/${doc.id}`)}
                        onDownload={() => handleDownload(doc)}
                        onVoid={() => setVoidTarget(doc)}
                        onRemind={() => handleRemind(doc)}
                        onDuplicate={() => navigate(`/esign/documents/new?duplicate=${doc.id}`)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Load More */}
            {hasMore && !search && (
              <div style={{ padding: '16px', textAlign: 'center', borderTop: '1px solid #f3f4f6' }}>
                <button
                  type="button"
                  onClick={handleLoadMore}
                  style={{
                    background: 'transparent',
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: '8px 24px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--prd, #1e293b)',
                    cursor: 'pointer',
                  }}
                >
                  Load More
                </button>
              </div>
            )}

            {/* Row count */}
            <div style={{
              padding: '10px 20px',
              borderTop: '1px solid #f3f4f6',
              fontSize: 12,
              color: '#9ca3af',
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span>Showing {filtered.length} document{filtered.length !== 1 ? 's' : ''}</span>
              {selected.size > 0 && (
                <span>{selected.size} selected</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
