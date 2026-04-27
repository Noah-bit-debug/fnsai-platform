import { useEffect, useState } from 'react';
import api from '../lib/api';
import { useCan } from '../contexts/PermissionsContext';

/**
 * AssignmentPanel — sidebar widget that shows everyone assigned to an
 * entity (candidate, task, etc.) and lets users with `assignments.manage`
 * add/remove/reassign owners.
 *
 * Why a single component per entity: the polymorphic backend means the
 * UI surface is the same everywhere — only the props change.
 */

interface Assignment {
  id: string;
  user_id: string;
  role: string;
  due_at: string | null;
  status: 'active' | 'completed' | 'cancelled';
  notes: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  assigned_by_name: string | null;
  created_at: string;
}

interface TeamMember {
  id: string;            // Azure oid
  db_id: string;         // DB UUID — what assignments.user_id expects
  fullName: string;
  email: string;
  role: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner:            'Owner',
  recruiter:        'Recruiter',
  hr:               'HR',
  manager_reviewer: 'Manager (review)',
  credentialing:    'Credentialing',
  follow_up:        'Follow-up',
};

const ROLE_COLOR: Record<string, { fg: string; bg: string }> = {
  owner:            { fg: '#1e40af', bg: '#dbeafe' },
  recruiter:        { fg: '#0369a1', bg: '#e0f2fe' },
  hr:               { fg: '#b45309', bg: '#fef3c7' },
  manager_reviewer: { fg: '#0f766e', bg: '#ccfbf1' },
  credentialing:    { fg: '#6b21a8', bg: '#f3e8ff' },
  follow_up:        { fg: '#4f46e5', bg: '#ede9fe' },
};

export default function AssignmentPanel({
  assignableType,
  assignableId,
}: {
  assignableType: 'candidate' | 'task' | 'reminder' | 'submission' | 'placement' | 'incident' | 'bid';
  assignableId: string;
}) {
  const canManage = useCan('assignments.manage');
  const canView = useCan('assignments.view');
  const [items, setItems] = useState<Assignment[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [adding, setAdding] = useState(false);
  const [pickRole, setPickRole] = useState<string>('owner');
  const [pickUser, setPickUser] = useState<string>('');
  const [pickDue, setPickDue] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // /api/v1/users returns both Azure oid (as `id`) and DB UUID (as `db_id`).
  // assignments.user_id is a UUID FK to users.id, so we send db_id when
  // creating an assignment.

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const [a, u] = await Promise.all([
          api.get<{ assignments: Assignment[] }>(`/assignments/for/${assignableType}/${assignableId}`),
          api.get<{ users: TeamMember[] }>(`/users`).catch(() => ({ data: { users: [] } })),
        ]);
        if (cancelled) return;
        setItems(a.data.assignments ?? []);
        setTeam(u.data.users ?? []);
      } catch (e: any) {
        if (!cancelled) setErr(e?.response?.data?.error ?? 'Failed to load assignments');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assignableType, assignableId, canView]);

  if (!canView) return null;

  const refresh = async () => {
    const a = await api.get<{ assignments: Assignment[] }>(`/assignments/for/${assignableType}/${assignableId}`);
    setItems(a.data.assignments ?? []);
  };

  const onAdd = async () => {
    if (!pickUser) return;
    setErr(null);
    try {
      await api.post(`/assignments`, {
        assignable_type: assignableType,
        assignable_id: assignableId,
        user_id: pickUser,           // db_id from /api/v1/users
        role: pickRole,
        due_at: pickDue ? new Date(pickDue).toISOString() : null,
      });
      setAdding(false);
      setPickUser('');
      setPickDue('');
      setPickRole('owner');
      await refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to assign');
    }
  };

  const onRemove = async (id: string) => {
    if (!confirm('Remove this assignment?')) return;
    try {
      await api.delete(`/assignments/${id}`);
      await refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to remove');
    }
  };

  const onComplete = async (id: string) => {
    try {
      await api.post(`/assignments/${id}/complete`);
      await refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to complete');
    }
  };

  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
      padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Assigned
        </h4>
        {canManage && !adding && (
          <button
            onClick={() => setAdding(true)}
            style={{
              fontSize: 11, fontWeight: 600, color: '#2563eb', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0,
            }}
          >
            + Assign
          </button>
        )}
      </div>

      {loading && <div style={{ fontSize: 12, color: '#94a3b8' }}>Loading…</div>}
      {err && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}

      {!loading && items.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
          No one assigned yet.
        </div>
      )}

      {items.map((a) => {
        const c = ROLE_COLOR[a.role] ?? ROLE_COLOR.owner;
        return (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 0', borderBottom: '1px solid #f1f5f9',
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
              color: c.fg, background: c.bg, textTransform: 'uppercase', letterSpacing: '0.3px',
              flexShrink: 0,
            }}>
              {ROLE_LABELS[a.role] ?? a.role}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.assignee_name || a.assignee_email || 'Unknown'}
              </div>
              {a.due_at && (
                <div style={{ fontSize: 10.5, color: '#64748b' }}>
                  Due {new Date(a.due_at).toLocaleDateString()}
                </div>
              )}
            </div>
            {a.status === 'active' && (
              <button
                title="Mark complete"
                onClick={() => onComplete(a.id)}
                style={{
                  fontSize: 11, color: '#16a34a', background: 'none', border: 'none',
                  cursor: 'pointer', padding: '2px 4px', flexShrink: 0,
                }}
              >
                ✓
              </button>
            )}
            {canManage && (
              <button
                title="Remove"
                onClick={() => onRemove(a.id)}
                style={{
                  fontSize: 14, color: '#94a3b8', background: 'none', border: 'none',
                  cursor: 'pointer', padding: '2px 4px', flexShrink: 0, lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {adding && (
        <div style={{ marginTop: 10, padding: 10, background: '#f8fafc', borderRadius: 8 }}>
          <select
            value={pickRole}
            onChange={(e) => setPickRole(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 6 }}
          >
            {Object.entries(ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={pickUser}
            onChange={(e) => setPickUser(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 6 }}
          >
            <option value="">Pick a teammate…</option>
            {team.map((m) => (
              <option key={m.db_id} value={m.db_id}>{m.fullName} ({m.role})</option>
            ))}
          </select>
          <input
            type="date"
            value={pickDue}
            onChange={(e) => setPickDue(e.target.value)}
            placeholder="Due date (optional)"
            style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setAdding(false); setErr(null); }}
              style={{ padding: '5px 12px', fontSize: 12, background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={onAdd}
              disabled={!pickUser}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600,
                background: pickUser ? '#2563eb' : '#cbd5e1', color: '#fff',
                border: 'none', borderRadius: 6, cursor: pickUser ? 'pointer' : 'not-allowed',
              }}
            >
              Assign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
