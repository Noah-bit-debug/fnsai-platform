/**
 * Phase 4.2 — Business Development Bids tab
 *
 * Self-contained component rendered inside BusinessDev.tsx when the Bids
 * tab is active. Pulled into its own file because it owns ~400 lines of
 * state + rendering and would make the parent file unreadable.
 *
 * Feature checklist per the Phase 4 notes:
 *   [✓] bid checklist            → bd_bid_checklist_items with per-bid edits
 *   [✓] required steps tracking  → `required` flag + progress bar
 *   [✓] AI help with bid creation → "✦ AI assist" button in the New Bid modal
 *   [✓] CEO-level tools          → stats header (open count, open value, win rate, due this week)
 */
import { Fragment, useEffect, useState } from 'react';
import {
  bdApi,
  BDBid,
  BDBidChecklistItem,
  BDBidStats,
} from '../../lib/api';

// ─── Helpers & styles ─────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
// Phase 4.4 QA fix — DATE-only or midnight-UTC ISO = treat as local
// date (bid.due_date). Otherwise normal Date parsing. See Contracts.tsx.
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const s = String(iso);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/;
  const m = dateOnly.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString();
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}

const STATUS_COLORS: Record<BDBid['status'], string> = {
  draft:       '#64748b',
  in_progress: '#e65100',
  submitted:   '#1565c0',
  won:         '#2e7d32',
  lost:        '#c62828',
};
const STATUS_LABELS: Record<BDBid['status'], string> = {
  draft:       'Draft',
  in_progress: 'In Progress',
  submitted:   'Submitted',
  won:         'Won',
  lost:        'Lost',
};

const inputSt: React.CSSProperties = {
  width: '100%', padding: '8px 11px', border: '1.5px solid #e2e8f0',
  borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box',
  background: '#fff', fontFamily: 'inherit', color: '#1e293b',
};
const ghostBtn: React.CSSProperties = {
  background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0',
  borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
  fontSize: 12, whiteSpace: 'nowrap',
};
const primaryBtn: React.CSSProperties = {
  background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8,
  padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
};

// ─── New / Edit Bid modal ─────────────────────────────────────────────────
//
// Handles create and edit paths. The "✦ AI assist" button asks the
// backend to generate a title + tailored checklist + notes from the
// context the user types in. The user reviews + edits before clicking
// "Create".

interface BidModalProps {
  initial?: BDBid | null;
  onClose: () => void;
  onSaved: (bid: BDBid) => void;
}

function BidModal({ initial, onClose, onSaved }: BidModalProps) {
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [clientName, setClientName] = useState(initial?.client_name ?? '');
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '');
  const [estimatedValue, setEstimatedValue] = useState<string>(
    initial?.estimated_value != null ? String(initial.estimated_value) : ''
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [status, setStatus] = useState<BDBid['status']>(initial?.status ?? 'draft');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // AI-assist state — only used when creating a new bid
  const [showAI, setShowAI] = useState(false);
  const [aiContext, setAiContext] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiChecklist, setAiChecklist] = useState<{ label: string; required: boolean }[] | null>(null);

  async function runAIAssist() {
    if (aiContext.trim().length < 10) { setErr('Paste more context for the AI to work with (at least 10 chars).'); return; }
    setAiLoading(true); setErr(null);
    try {
      const { data } = await bdApi.aiDraftBid({ context: aiContext, client_name: clientName || null });
      if (data.title && !title) setTitle(data.title);
      if (data.notes && !notes) setNotes(data.notes);
      setAiChecklist(data.checklist);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? 'AI failed.');
    } finally { setAiLoading(false); }
  }

  async function submit() {
    if (!title.trim()) { setErr('Title is required.'); return; }
    setSaving(true); setErr(null);
    try {
      const payload: Partial<BDBid> & { checklist?: { label: string; required?: boolean }[] } = {
        title: title.trim(),
        client_name: clientName.trim() || null,
        due_date: dueDate || null,
        estimated_value: estimatedValue ? Number(estimatedValue) : null,
        notes: notes.trim() || null,
        status,
      };
      let saved: BDBid;
      if (isEdit && initial) {
        const r = await bdApi.updateBid(initial.id, payload);
        saved = r.data;
      } else {
        if (aiChecklist && aiChecklist.length > 0) payload.checklist = aiChecklist;
        const r = await bdApi.createBid(payload);
        saved = r.data.bid;
      }
      onSaved(saved);
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? 'Save failed.');
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 620, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c' }}>
            {isEdit ? 'Edit Bid' : 'New Bid'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 5 }}>Title *</label>
            <input style={inputSt} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Memorial Health — RN staffing FY26" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 5 }}>Client name</label>
            <input style={inputSt} value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Company name" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 5 }}>Due date</label>
            <input type="date" style={inputSt} value={dueDate ?? ''} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 5 }}>Est. value ($)</label>
            <input type="number" min={0} step="0.01" style={inputSt} value={estimatedValue} onChange={e => setEstimatedValue(e.target.value)} placeholder="e.g. 150000" />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 5 }}>Status</label>
            <select style={inputSt} value={status} onChange={e => setStatus(e.target.value as BDBid['status'])}>
              {(Object.keys(STATUS_LABELS) as BDBid['status'][]).map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 5 }}>Notes</label>
            <textarea style={{ ...inputSt, minHeight: 70, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Scope, key decision makers, constraints…" />
          </div>
        </div>

        {/* AI-assist is only offered on new bids. For edits, admins can still
            touch up manually. Keeps the edit path simple and predictable. */}
        {!isEdit && (
          <div style={{ marginBottom: 18, padding: 14, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9' }}>✦ AI assist (optional)</div>
              {!showAI && (
                <button onClick={() => setShowAI(true)} style={ghostBtn}>Show</button>
              )}
            </div>
            {showAI && (
              <>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                  Paste RFP text, meeting notes, or a description of the opportunity.
                  The AI will suggest a title, a tailored checklist, and initial notes.
                  You can edit everything before creating.
                </div>
                <textarea
                  style={{ ...inputSt, minHeight: 100, background: '#fff', resize: 'vertical' }}
                  value={aiContext}
                  onChange={e => setAiContext(e.target.value)}
                  placeholder="Paste or type the opportunity context here…"
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => void runAIAssist()} disabled={aiLoading}
                    style={{ ...primaryBtn, background: '#6d28d9' }}>
                    {aiLoading ? 'Thinking…' : '✦ Draft with AI'}
                  </button>
                  {aiChecklist && (
                    <span style={{ fontSize: 12, color: '#6d28d9', fontWeight: 600, alignSelf: 'center' }}>
                      ✓ {aiChecklist.length} checklist items drafted
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {err && <div style={{ background: '#fef2f2', color: '#991b1b', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving} style={primaryBtn}>
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create bid')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail panel (inline, not a modal) ───────────────────────────────────
//
// Shows the full checklist for a bid when the user clicks a row. Rendered
// below the list so the user can toggle without losing the list context.

interface DetailProps {
  bidId: string;
  onClose: () => void;
  onChanged: () => void;
}

function BidDetail({ bidId, onClose, onChanged }: DetailProps) {
  const [bid, setBid] = useState<BDBid | null>(null);
  const [items, setItems] = useState<BDBidChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');

  async function load() {
    setLoading(true); setErr(null);
    try {
      const { data } = await bdApi.getBid(bidId);
      setBid(data.bid);
      setItems(data.checklist);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? 'Failed to load.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [bidId]);

  async function toggle(item: BDBidChecklistItem) {
    try {
      await bdApi.updateChecklistItem(bidId, item.id, { completed: !item.completed });
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: !i.completed } : i));
      onChanged();
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Update failed.'); }
  }

  async function addItem() {
    if (!newItem.trim()) return;
    try {
      const { data } = await bdApi.addChecklistItem(bidId, { label: newItem.trim(), required: false });
      setItems(prev => [...prev, data]);
      setNewItem('');
      onChanged();
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Add failed.'); }
  }

  async function removeItem(itemId: string) {
    if (!confirm('Remove this checklist step?')) return;
    try {
      await bdApi.deleteChecklistItem(bidId, itemId);
      setItems(prev => prev.filter(i => i.id !== itemId));
      onChanged();
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Delete failed.'); }
  }

  if (loading) return <div style={{ padding: 20, color: '#64748b' }}>Loading…</div>;
  if (err) return <div style={{ padding: 20, color: '#c62828' }}>{err}</div>;
  if (!bid) return null;

  const completed = items.filter(i => i.completed).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div style={{ padding: 20, background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c' }}>{bid.title}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {bid.client_name ?? 'No client set'} · Due {fmtDate(bid.due_date)} · {fmtMoney(bid.estimated_value)}
          </div>
        </div>
        <button onClick={onClose} style={ghostBtn}>Close</button>
      </div>

      {/* Progress */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 4 }}>
          <span>Checklist progress</span>
          <span style={{ fontWeight: 600 }}>{completed} / {total} ({pct}%)</span>
        </div>
        <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#2e7d32' : '#1565c0', transition: 'width 0.2s' }} />
        </div>
      </div>

      {/* Checklist */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 8 }}>
        {items.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, background: item.completed ? '#f0fdf4' : 'transparent' }}>
            <input type="checkbox" checked={item.completed} onChange={() => void toggle(item)} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#2e7d32' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: item.completed ? '#6b7280' : '#1a2b3c', textDecoration: item.completed ? 'line-through' : 'none' }}>
                {item.label}
              </div>
              {item.completed && item.completed_at && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Completed {fmtDate(item.completed_at)}
                </div>
              )}
            </div>
            {item.required && <span style={{ fontSize: 10, color: '#c62828', fontWeight: 700, letterSpacing: 0.3 }}>REQUIRED</span>}
            <button onClick={() => void removeItem(item.id)} style={{ background: 'none', border: 'none', color: '#c62828', cursor: 'pointer', fontSize: 14 }}>×</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderTop: items.length ? '1px solid #f1f5f9' : 'none', marginTop: items.length ? 4 : 0 }}>
          <input style={{ ...inputSt, padding: '6px 10px' }} value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addItem(); }} placeholder="+ Add a custom step…" />
          <button onClick={() => void addItem()} style={ghostBtn}>Add</button>
        </div>
      </div>

      {bid.notes && (
        <div style={{ marginTop: 16, padding: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Notes</div>
          <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap' }}>{bid.notes}</div>
        </div>
      )}
    </div>
  );
}

// ─── Main Bids tab component ──────────────────────────────────────────────

export default function BidsTab() {
  const [bids, setBids] = useState<BDBid[]>([]);
  const [stats, setStats] = useState<BDBidStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingBid, setEditingBid] = useState<BDBid | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expandedBidId, setExpandedBidId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [bRes, sRes] = await Promise.all([
        bdApi.listBids(statusFilter ? { status: statusFilter } : undefined),
        bdApi.bidStats(),
      ]);
      setBids(bRes.data.bids);
      setStats(sRes.data);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? 'Failed to load bids.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [statusFilter]);

  async function deleteBid(id: string) {
    if (!confirm('Delete this bid and its checklist? This cannot be undone.')) return;
    try {
      await bdApi.deleteBid(id);
      setBids(prev => prev.filter(b => b.id !== id));
      if (expandedBidId === id) setExpandedBidId(null);
      await refreshStats();
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Delete failed.'); }
  }

  async function refreshStats() {
    try {
      const r = await bdApi.bidStats();
      setStats(r.data);
    } catch { /* non-fatal */ }
  }

  return (
    <div>
      {/* CEO-level stats strip. Per the notes: "more tools useful for
          CEO-level work" — implemented narrowly as at-a-glance numbers
          above the list. Each card pulls directly from /bd/bids-stats. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, padding: '20px 20px 0' }}>
        {stats && [
          { label: 'Open Bids',        value: String(stats.open_count),              color: '#1565c0' },
          { label: 'Open Pipeline $',  value: fmtMoney(stats.open_value),            color: '#6d28d9' },
          { label: 'Win Rate',         value: stats.win_rate != null ? `${stats.win_rate}%` : '—', color: '#2e7d32' },
          { label: 'Due This Week',    value: String(stats.due_this_week),           color: stats.due_this_week > 0 ? '#e65100' : '#64748b' },
        ].map(s => (
          <div key={s.label} style={{ background: '#f8fafc', borderRadius: 10, border: '1px solid #e8edf2', padding: '14px 18px' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter + action bar */}
      <div style={{ display: 'flex', gap: 12, padding: '16px 20px', alignItems: 'center' }}>
        <select
          style={{ ...inputSt, maxWidth: 200, cursor: 'pointer' }}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABELS) as BDBid['status'][]).map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button onClick={() => { setEditingBid(null); setShowModal(true); }} style={primaryBtn}>
          + New Bid
        </button>
      </div>

      {err && <div style={{ margin: '0 20px 12px', background: '#fef2f2', color: '#991b1b', padding: 10, borderRadius: 8, fontSize: 13 }}>{err}</div>}

      {/* List */}
      {loading ? (
        <div style={{ padding: 48, color: '#64748b', textAlign: 'center', fontSize: 14 }}>Loading bids…</div>
      ) : bids.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>No bids yet</div>
          <div style={{ fontSize: 14, color: '#64748b' }}>Track your active bids and the required steps to submit them.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Title', 'Client', 'Status', 'Progress', 'Value', 'Due', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bids.map(b => {
                const total = b.checklist_total ?? 0;
                const done = b.checklist_completed ?? 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const isExpanded = expandedBidId === b.id;
                return (
                  <Fragment key={b.id}>
                    <tr style={{ borderTop: '1px solid #f1f5f9', background: isExpanded ? '#f8fafc' : '#fff', cursor: 'pointer' }}
                        onClick={() => setExpandedBidId(isExpanded ? null : b.id)}>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1a2b3c', fontSize: 14 }}>
                        <span style={{ color: '#94a3b8', marginRight: 6 }}>{isExpanded ? '▼' : '▶'}</span>
                        {b.title}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>
                        {b.client_name ?? b.facility_name ?? '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, background: STATUS_COLORS[b.status] + '22', color: STATUS_COLORS[b.status], fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                          {STATUS_LABELS[b.status]}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', minWidth: 140 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#2e7d32' : '#1565c0' }} />
                          </div>
                          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 36, textAlign: 'right' }}>{done}/{total}</span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151', whiteSpace: 'nowrap' }}>{fmtMoney(b.estimated_value)}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDate(b.due_date)}</td>
                      <td style={{ padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => { setEditingBid(b); setShowModal(true); }} style={ghostBtn}>Edit</button>
                          <button onClick={() => void deleteBid(b.id)} style={{ ...ghostBtn, color: '#c62828' }}>Remove</button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0 }}>
                          <BidDetail bidId={b.id} onClose={() => setExpandedBidId(null)} onChanged={() => void load()} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <BidModal
          initial={editingBid}
          onClose={() => { setShowModal(false); setEditingBid(null); }}
          onSaved={(bid) => {
            // Refresh the list after create/update so checklist progress
            // reflects the server state.
            void load();
            // Keep the modal closed + optionally open the new bid for detail.
            if (!editingBid) setExpandedBidId(bid.id);
          }}
        />
      )}
    </div>
  );
}
