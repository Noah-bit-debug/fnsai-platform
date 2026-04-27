import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

/**
 * AI Team list page — lists tasks the user has created, plus a
 * "+ New Team Task" button that opens the create modal. Drilling into
 * a task opens AITeamTaskDetail.
 */

interface TeamTask {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'running' | 'awaiting_approval' | 'approved' | 'rejected' | 'failed';
  turn_count: number;
  error: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const STATUS_BADGE: Record<TeamTask['status'], { label: string; bg: string; fg: string }> = {
  draft:              { label: 'Draft',              bg: '#f1f5f9', fg: '#64748b' },
  running:            { label: 'Running',            bg: '#e0f2fe', fg: '#0369a1' },
  awaiting_approval:  { label: 'Awaiting approval',  bg: '#fef3c7', fg: '#b45309' },
  approved:           { label: 'Approved',           bg: '#dcfce7', fg: '#15803d' },
  rejected:           { label: 'Rejected',           bg: '#fee2e2', fg: '#b91c1c' },
  failed:             { label: 'Failed',             bg: '#fee2e2', fg: '#b91c1c' },
};

function NewTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (title.trim().length < 3 || description.trim().length < 10) {
      setErr('Title and description are required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ id: string }>('/ai-team/tasks', {
        title: title.trim(),
        description: description.trim(),
      });
      onCreated(r.data.id);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to create task.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: 24, width: '100%',
        maxWidth: 580, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', margin: '0 0 6px' }}>
          New AI Team task
        </h3>
        <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 18px' }}>
          Describe the brief. The AI Team's Operations Lead will read it, consult specialists (Recruiting, HR, Compliance, Credentialing, Operations) as needed, gather data, and deliver a synthesized recommendation for you to approve.
        </p>

        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
          Title
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Catch up on overdue onboarding this week"
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 14 }}
        />

        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
          Brief
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What do you need the team to figure out, summarize, or recommend?"
          style={{ width: '100%', height: 130, padding: '8px 10px', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'inherit', resize: 'vertical', marginBottom: 14 }}
        />

        {err && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', fontSize: 13, background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: '#374151' }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            style={{
              padding: '7px 14px', fontSize: 13, fontWeight: 700,
              background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8,
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AITeam() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TeamTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | TeamTask['status']>('all');

  const load = async () => {
    setErr(null);
    try {
      const r = await api.get<{ tasks: TeamTask[] }>('/ai-team/tasks');
      setTasks(r.data.tasks ?? []);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);
  const counts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page-wrapper" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>AI Team Workspace</h1>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            Hand a brief to your AI specialists. They consult each other, pull data, and come back with a recommendation.
          </p>
        </div>
        <button
          onClick={() => setNewOpen(true)}
          style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
        >
          + New team task
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '14px 0 18px' }}>
        {(['all', 'running', 'awaiting_approval', 'approved', 'rejected', 'failed', 'draft'] as const).map((f) => {
          const c = f === 'all' ? tasks.length : counts[f] ?? 0;
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600,
                border: '1px solid', borderColor: active ? '#1565c0' : '#e2e8f0',
                color: active ? '#fff' : '#475569',
                background: active ? '#1565c0' : '#fff',
                borderRadius: 999, cursor: 'pointer',
              }}
            >
              {f === 'all' ? 'All' : STATUS_BADGE[f].label} ({c})
            </button>
          );
        })}
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
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            {filter === 'all' ? 'No team tasks yet. Click + to start one.' : 'No tasks in that status.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Task</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Turns</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const b = STATUS_BADGE[t.status];
                return (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/ai-team/${t.id}`)}
                    style={{
                      background: i % 2 === 0 ? '#fff' : '#fafbfc',
                      borderBottom: '1px solid #f1f5f9',
                      cursor: 'pointer',
                    }}
                  >
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{t.title}</div>
                      <div style={{ fontSize: 11.5, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>
                        {t.description}
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{
                        display: 'inline-block', fontSize: 10.5, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 6, color: b.fg, background: b.bg,
                        textTransform: 'uppercase', letterSpacing: '0.4px',
                      }}>
                        {b.label}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', color: '#475569' }}>{t.turn_count}</td>
                    <td style={{ padding: '10px 16px', color: '#94a3b8', fontSize: 12 }}>
                      {new Date(t.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {newOpen && (
        <NewTaskModal
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            navigate(`/ai-team/${id}`);
          }}
        />
      )}
    </div>
  );
}
