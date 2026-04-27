import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

/**
 * "My Assigned Work" — the calling user's active assignments across
 * every assignable entity. Auth-only (no special permission required) —
 * every signed-in user can see their own work.
 */

interface Assignment {
  id: string;
  assignable_type: string;
  assignable_id: string;
  role: string;
  due_at: string | null;
  status: 'active' | 'completed' | 'cancelled';
  notes: string | null;
  assigned_by_name: string | null;
  created_at: string;
  completed_at: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', recruiter: 'Recruiter', hr: 'HR',
  manager_reviewer: 'Reviewer', credentialing: 'Credentialing', follow_up: 'Follow-up',
};

const TYPE_LABELS: Record<string, string> = {
  candidate: 'Candidate', task: 'Task', reminder: 'Reminder',
  submission: 'Submission', placement: 'Placement', incident: 'Incident', bid: 'Bid',
};

// Where each assignable type lives in the app, so clicking a row opens
// the right detail page.
const TYPE_PATH: Record<string, (id: string) => string> = {
  candidate:  (id) => `/candidates/${id}`,
  task:       (id) => `/tasks?id=${id}`,
  reminder:   (id) => `/reminders?id=${id}`,
  submission: (id) => `/submissions?id=${id}`,
  placement:  (id) => `/placements?id=${id}`,
  incident:   (id) => `/incidents?id=${id}`,
  bid:        (id) => `/business-dev?id=${id}`,
};

function dueClass(due: string | null): { fg: string; bg: string; label: string } {
  if (!due) return { fg: '#64748b', bg: '#f1f5f9', label: 'No due date' };
  const ms = new Date(due).getTime() - Date.now();
  const days = Math.floor(ms / 86_400_000);
  if (days < 0)  return { fg: '#b91c1c', bg: '#fee2e2', label: `${Math.abs(days)}d overdue` };
  if (days === 0) return { fg: '#b45309', bg: '#fef3c7', label: 'Due today' };
  if (days <= 3) return { fg: '#b45309', bg: '#fef3c7', label: `${days}d` };
  return { fg: '#0f766e', bg: '#ccfbf1', label: `${days}d` };
}

export default function MyAssignedWork() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Assignment[]>([]);
  const [includeDone, setIncludeDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await api.get<{ assignments: Assignment[] }>(
          `/assignments/my-work${includeDone ? '?include_done=true' : ''}`
        );
        if (cancelled) return;
        setItems(r.data.assignments ?? []);
      } catch (e: any) {
        if (!cancelled) setErr(e?.response?.data?.error ?? 'Failed to load your work');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [includeDone]);

  const onComplete = async (id: string) => {
    try {
      await api.post(`/assignments/${id}/complete`);
      setItems((prev) => prev.map((a) => a.id === id ? { ...a, status: 'completed', completed_at: new Date().toISOString() } : a));
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to complete');
    }
  };

  const filtered = items.filter((a) => filter === 'all' || a.assignable_type === filter);
  const activeCount = items.filter((a) => a.status === 'active').length;
  const overdueCount = items.filter((a) => {
    if (a.status !== 'active' || !a.due_at) return false;
    return new Date(a.due_at).getTime() < Date.now();
  }).length;

  return (
    <div className="page-wrapper" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>My Assigned Work</h1>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            {activeCount} active{overdueCount > 0 && <span style={{ color: '#b91c1c', fontWeight: 600 }}> · {overdueCount} overdue</span>}
          </p>
        </div>
        <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={includeDone}
            onChange={(e) => setIncludeDone(e.target.checked)}
          />
          Show completed
        </label>
      </div>

      {/* Type filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {['all', ...Object.keys(TYPE_LABELS)].map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 600,
              border: '1px solid', borderColor: filter === t ? '#2563eb' : '#e2e8f0',
              color: filter === t ? '#fff' : '#475569',
              background: filter === t ? '#2563eb' : '#fff',
              borderRadius: 999, cursor: 'pointer',
            }}
          >
            {t === 'all' ? 'All' : TYPE_LABELS[t] ?? t}
          </button>
        ))}
      </div>

      {err && (
        <div style={{ padding: '12px 16px', background: '#fee2e2', color: '#b91c1c', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {err}
        </div>
      )}

      <div className="pn">
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Nothing assigned to you{filter !== 'all' ? ` in ${TYPE_LABELS[filter] ?? filter}` : ''}. 🎉
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Type</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Role</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Due</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Notes</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => {
                const d = dueClass(a.due_at);
                const path = TYPE_PATH[a.assignable_type]?.(a.assignable_id) ?? null;
                return (
                  <tr
                    key={a.id}
                    style={{
                      background: a.status === 'completed' ? '#f8fafc' : i % 2 === 0 ? '#fff' : '#fafbfc',
                      opacity: a.status === 'completed' ? 0.6 : 1,
                      borderBottom: '1px solid #f1f5f9',
                      cursor: path ? 'pointer' : 'default',
                    }}
                    onClick={() => path && navigate(path)}
                  >
                    <td style={{ padding: '10px 16px', fontWeight: 600, color: '#1e293b' }}>
                      {TYPE_LABELS[a.assignable_type] ?? a.assignable_type}
                    </td>
                    <td style={{ padding: '10px 16px', color: '#475569' }}>
                      {ROLE_LABELS[a.role] ?? a.role}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                        color: d.fg, background: d.bg,
                      }}>
                        {d.label}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', color: '#64748b', fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.notes || '—'}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      {a.status === 'active' && (
                        <button
                          onClick={() => onComplete(a.id)}
                          style={{
                            padding: '4px 10px', fontSize: 11, fontWeight: 600,
                            background: '#16a34a', color: '#fff', border: 'none',
                            borderRadius: 6, cursor: 'pointer',
                          }}
                        >
                          ✓ Done
                        </button>
                      )}
                      {a.status === 'completed' && (
                        <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Completed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
