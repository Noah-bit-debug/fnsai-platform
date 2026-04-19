import React, { useEffect, useState, useCallback } from 'react';
import { useRBAC } from '../../contexts/RBACContext';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';

interface CompetencyRecord {
  id: string;
  user_id: string;
  item_id: string;
  item_type: 'policy' | 'document' | 'exam' | 'checklist';
  title: string;
  status: 'not_started' | 'in_progress' | 'signed' | 'read' | 'completed' | 'expired' | 'failed';
  assigned_date?: string;
  due_date?: string;
  completed_date?: string;
  notes?: string;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'signed', label: 'Signed' },
  { value: 'read', label: 'Read' },
  { value: 'expired', label: 'Expired' },
  { value: 'failed', label: 'Failed' },
];

const TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'policy', label: 'Policy' },
  { value: 'document', label: 'Document' },
  { value: 'exam', label: 'Exam' },
  { value: 'checklist', label: 'Checklist' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  not_started: { label: 'Not Started', color: '#94a3b8', bg: '#f1f5f9' },
  in_progress: { label: 'In Progress', color: '#2563eb', bg: '#eff6ff' },
  signed: { label: 'Signed', color: '#16a34a', bg: '#f0fdf4' },
  read: { label: 'Read', color: '#16a34a', bg: '#f0fdf4' },
  completed: { label: 'Completed', color: '#16a34a', bg: '#f0fdf4' },
  expired: { label: 'Expired', color: '#dc2626', bg: '#fef2f2' },
  failed: { label: 'Failed', color: '#dc2626', bg: '#fef2f2' },
};

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  policy: { label: 'Policy', color: '#7c3aed', bg: '#f5f3ff' },
  document: { label: 'Document', color: '#0891b2', bg: '#ecfeff' },
  exam: { label: 'Exam', color: '#d97706', bg: '#fffbeb' },
  checklist: { label: 'Checklist', color: '#059669', bg: '#ecfdf5' },
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function truncate(str: string, len: number): string {
  if (!str) return '—';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

interface NoteModalProps {
  recordId: string;
  onClose: () => void;
  onSaved: () => void;
}

function NoteModal({ recordId, onClose, onSaved }: NoteModalProps) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!note.trim()) {
      setError('Please enter a note.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post(`/compliance/competency-records/${recordId}/notes`, { note: note.trim() });
      onSaved();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? 'Failed to save note.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
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
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          padding: 28,
          width: '100%',
          maxWidth: 480,
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: 17, fontWeight: 700, color: '#1e293b' }}>Add Admin Note</h3>
        <textarea
          value={note}
          onChange={e => {
            setNote(e.target.value);
            setError('');
          }}
          placeholder="Enter your note here..."
          rows={5}
          style={{
            width: '100%',
            padding: '10px 14px',
            border: error ? '1px solid #dc2626' : '1px solid #e2e8f0',
            borderRadius: 8,
            fontSize: 14,
            color: '#1e293b',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
            lineHeight: 1.5,
          }}
        />
        {error && <div style={{ marginTop: 6, color: '#dc2626', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 20px',
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
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '9px 20px',
              border: 'none',
              borderRadius: 8,
              background: saving ? '#93c5fd' : '#2563eb',
              color: '#fff',
              fontSize: 14,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving...' : 'Save Note'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ToastProps {
  message: string;
}

function Toast({ message }: ToastProps) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 32,
        right: 32,
        background: '#1e293b',
        color: '#fff',
        padding: '12px 20px',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        zIndex: 2000,
        animation: 'fadeIn 0.2s ease',
      }}
    >
      {message}
    </div>
  );
}

const ADMIN_ROLES = ['ceo', 'admin', 'manager', 'hr'];

export default function ComplianceRecords() {
  const { role } = useRBAC();

  const [records, setRecords] = useState<CompetencyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(50);
  const [total, setTotal] = useState(0);

  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? 'all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchText, setSearchText] = useState('');

  const [noteModalRecord, setNoteModalRecord] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  const isAdmin = ADMIN_ROLES.includes(role ?? '');

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('item_type', typeFilter);

      const res = await api.get(`/compliance/competency-records?${params.toString()}`);
      const data = res.data;
      const recs: CompetencyRecord[] = data?.records ?? data ?? [];
      setRecords(recs);
      setTotal(data?.total ?? recs.length);
    } catch {
      setError('Failed to load records.');
    } finally {
      setLoading(false);
    }
  }, [limit, statusFilter, typeFilter]);

  useEffect(() => {
    if (isAdmin) fetchRecords();
  }, [isAdmin, fetchRecords]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleStatusChange(recordId: string, newStatus: string) {
    setUpdatingStatus(recordId);
    try {
      await api.patch(`/compliance/competency-records/${recordId}`, { status: newStatus });
      setRecords(prev => prev.map(r => (r.id === recordId ? { ...r, status: newStatus as CompetencyRecord['status'] } : r)));
    } catch {
      showToast('Failed to update status.');
    } finally {
      setUpdatingStatus(null);
    }
  }

  const filtered = records.filter(r => {
    if (!searchText.trim()) return true;
    return r.title?.toLowerCase().includes(searchText.toLowerCase());
  });

  // Stats across all records (not just filtered)
  const statuses = ['not_started', 'in_progress', 'signed', 'read', 'completed', 'expired', 'failed'];
  const statCounts = statuses.reduce((acc, s) => {
    acc[s] = records.filter(r => r.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  if (!isAdmin) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 12,
            padding: 40,
            textAlign: 'center',
            maxWidth: 400,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <h2 style={{ color: '#dc2626', margin: '0 0 8px 0' }}>Access Denied</h2>
          <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>
            You don't have permission to view this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 24px' }}>
      {toast && <Toast message={toast} />}
      {noteModalRecord && (
        <NoteModal
          recordId={noteModalRecord}
          onClose={() => setNoteModalRecord(null)}
          onSaved={() => showToast('Note saved')}
        />
      )}

      <div style={{ maxWidth: 1300, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', margin: 0 }}>Competency Records</h1>
          <p style={{ color: '#64748b', marginTop: 6, fontSize: 15 }}>All user compliance tracking records</p>
        </div>

        {/* Stats chips */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {statuses.map(s => {
            const cfg = STATUS_CONFIG[s];
            const count = statCounts[s] ?? 0;
            if (count === 0) return null;
            return (
              <div
                key={s}
                style={{
                  background: cfg.bg,
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 18, fontWeight: 700, color: cfg.color }}>{count}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>{cfg.label}</span>
              </div>
            );
          })}
        </div>

        {/* Filters */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '16px 20px',
            marginBottom: 20,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Status
            </label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                fontSize: 14,
                color: '#1e293b',
                background: '#fff',
                cursor: 'pointer',
                minWidth: 160,
              }}
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Type
            </label>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                fontSize: 14,
                color: '#1e293b',
                background: '#fff',
                cursor: 'pointer',
                minWidth: 140,
              }}
            >
              {TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Search Title
            </label>
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Search by title..."
              style={{
                padding: '8px 12px',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                fontSize: 14,
                color: '#1e293b',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 20 }}>
            <button
              onClick={() => { setStatusFilter('all'); setTypeFilter('all'); setSearchText(''); }}
              style={{
                padding: '8px 16px',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                background: '#f8fafc',
                color: '#64748b',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Clear Filters
            </button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            {/* Skeleton header */}
            <div style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', padding: '12px 16px', display: 'flex', gap: 16 }}>
              {[160, 220, 90, 110, 100, 100, 100, 80].map((w, i) => (
                <div key={i} style={{ height: 12, width: w, borderRadius: 6, background: '#e2e8f0' }} />
              ))}
            </div>
            {/* Skeleton rows */}
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 16, alignItems: 'center' }}>
                {[100, 200, 70, 90, 80, 80, 80, 60].map((w, j) => (
                  <div key={j} style={{ height: 12, width: w, borderRadius: 6, background: i % 2 === 0 ? '#f1f5f9' : '#e9eef5' }} />
                ))}
              </div>
            ))}
          </div>
        ) : error ? (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 10,
            padding: '24px 28px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
          }}>
            <span style={{ fontSize: 24, lineHeight: 1 }}>🚨</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>
                Failed to load compliance records
              </div>
              <div style={{ fontSize: 13, color: '#991b1b' }}>
                Failed to load records. If this persists, check your connection.
              </div>
              <button
                onClick={() => fetchRecords()}
                style={{
                  marginTop: 12,
                  padding: '7px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 7,
                  cursor: 'pointer',
                }}
              >
                Try Again
              </button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '56px 48px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>
              {records.length === 0 ? 'No compliance records yet' : 'No records match your filters'}
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              {records.length === 0
                ? 'Records will appear here once staff are assigned compliance items.'
                : 'Try adjusting your status, type, or search filters.'}
            </div>
          </div>
        ) : (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
              overflow: 'hidden',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['User ID', 'Title', 'Type', 'Status', 'Assigned', 'Due', 'Completed', 'Actions'].map(col => (
                      <th
                        key={col}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontWeight: 600,
                          color: '#64748b',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((record, idx) => {
                    const statusCfg = STATUS_CONFIG[record.status] ?? STATUS_CONFIG['not_started'];
                    const typeCfg = TYPE_CONFIG[record.item_type] ?? { label: record.item_type, color: '#64748b', bg: '#f1f5f9' };
                    return (
                      <tr
                        key={record.id}
                        style={{
                          borderBottom: '1px solid #e2e8f0',
                          background: idx % 2 === 0 ? '#fff' : '#fafafa',
                        }}
                      >
                        <td style={{ padding: '12px 16px', color: '#64748b', fontFamily: 'monospace', fontSize: 12 }}>
                          {truncate(record.user_id, 12)}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#1e293b', fontWeight: 500, maxWidth: 220 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {record.title}
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              padding: '2px 10px',
                              borderRadius: 20,
                              background: typeCfg.bg,
                              color: typeCfg.color,
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {typeCfg.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <select
                            value={record.status}
                            disabled={updatingStatus === record.id}
                            onChange={e => handleStatusChange(record.id, e.target.value)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              border: `1px solid ${statusCfg.color}30`,
                              background: statusCfg.bg,
                              color: statusCfg.color,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                              outline: 'none',
                            }}
                          >
                            {STATUS_OPTIONS.filter(o => o.value !== 'all').map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '12px 16px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {formatDate(record.assigned_date)}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {formatDate(record.due_date)}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {formatDate(record.completed_date)}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <button
                            onClick={() => setNoteModalRecord(record.id)}
                            style={{
                              padding: '6px 14px',
                              border: '1px solid #e2e8f0',
                              borderRadius: 6,
                              background: '#fff',
                              color: '#2563eb',
                              fontSize: 12,
                              cursor: 'pointer',
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Add Note
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination / load more */}
            <div
              style={{
                padding: '16px 20px',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <span style={{ fontSize: 13, color: '#64748b' }}>
                Showing {filtered.length} of {total} records
              </span>
              {total > limit && (
                <button
                  onClick={() => setLimit(prev => prev + 50)}
                  style={{
                    padding: '8px 20px',
                    border: '1px solid #2563eb',
                    borderRadius: 8,
                    background: '#fff',
                    color: '#2563eb',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Load More
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
