import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { tasksApi, RecruiterTask } from '../lib/api';

const TASK_TYPE_EMOJI: Record<string, string> = {
  call: '📞', meeting: '📅', todo: '📝', follow_up: '🔄',
  email: '📧', sms: '💬', other: '•',
};

export default function Tasks() {
  const nav = useNavigate();
  const [tasks, setTasks] = useState<RecruiterTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'overdue' | 'due_today' | 'done' | 'all'>('open');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{
    title: string; task_type: RecruiterTask['task_type']; due_at: string; description: string;
  }>({ title: '', task_type: 'todo', due_at: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params: Record<string, string> = {};
      if (filter === 'overdue') params.overdue = 'true';
      else if (filter === 'due_today') params.due_today = 'true';
      else if (filter === 'done') params.status = 'done';
      else if (filter === 'open') params.status = 'open';
      const res = await tasksApi.list(params);
      setTasks(res.data.tasks);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const createTask = async () => {
    if (!draft.title.trim()) return;
    setCreating(true);
    try {
      await tasksApi.create({
        title: draft.title.trim(),
        task_type: draft.task_type,
        due_at: draft.due_at || null,
        description: draft.description || null,
      });
      setDraft({ title: '', task_type: 'todo', due_at: '', description: '' });
      setShowCreate(false);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to create');
    } finally { setCreating(false); }
  };

  const completeTask = async (id: string) => {
    try { await tasksApi.complete(id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
  };

  const cancelTask = async (id: string) => {
    if (!window.confirm('Cancel this task?')) return;
    try { await tasksApi.cancel(id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
  };

  const contextLabel = (t: RecruiterTask): string | null => {
    if (t.candidate_name) return `👤 ${t.candidate_name}`;
    if (t.job_title) return `📋 ${t.job_title}`;
    if (t.client_name) return `🏢 ${t.client_name}`;
    return null;
  };

  const contextLink = (t: RecruiterTask): string | null => {
    if (t.candidate_id) return `/candidates/${t.candidate_id}`;
    if (t.submission_id) return `/submissions/${t.submission_id}`;
    if (t.job_id) return `/jobs/${t.job_id}`;
    if (t.client_id) return `/clients-orgs/${t.client_id}`;
    return null;
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>Tasks</h1>
          <div style={{ color: 'var(--t3)', fontSize: 13, marginTop: 4 }}>
            {loading ? 'Loading…' : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} style={btnPrimary}>
          {showCreate ? 'Cancel' : '+ New Task'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{ background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)', padding: 16, marginBottom: 16, display: 'grid', gap: 10 }}>
          <input
            autoFocus value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Task title…"
            style={{ padding: '10px 12px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 14, outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select value={draft.task_type ?? 'todo'} onChange={(e) => setDraft({ ...draft, task_type: e.target.value as RecruiterTask['task_type'] })} style={inputBase}>
              <option value="todo">📝 To-do</option>
              <option value="call">📞 Call</option>
              <option value="meeting">📅 Meeting</option>
              <option value="follow_up">🔄 Follow-up</option>
              <option value="email">📧 Email</option>
              <option value="sms">💬 SMS</option>
              <option value="other">• Other</option>
            </select>
            <input
              type="datetime-local" value={draft.due_at}
              onChange={(e) => setDraft({ ...draft, due_at: e.target.value })}
              style={inputBase}
            />
          </div>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Details (optional)…"
            rows={3}
            style={{ padding: '8px 12px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCreate(false)} style={btnSecondary}>Cancel</button>
            <button onClick={createTask} disabled={creating || !draft.title.trim()} style={{ ...btnPrimary, opacity: !draft.title.trim() ? 0.5 : 1 }}>
              {creating ? 'Creating…' : 'Create Task'}
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['open', 'overdue', 'due_today', 'done', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '7px 14px',
              background: filter === f ? 'var(--pr)' : 'var(--sf2)',
              color: filter === f ? 'var(--sf)' : 'var(--t2)',
              border: '1px solid var(--bd)',
              borderRadius: 999,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {error && <div style={{ padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>
      ) : tasks.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)', background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px dashed var(--bd)' }}>
          No tasks in this filter.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {tasks.map((t) => (
            <div
              key={t.id}
              style={{
                background: 'var(--sf)',
                borderRadius: 'var(--br)',
                border: t.is_overdue ? '1px solid #f59e0b' : '1px solid var(--bd)',
                padding: '12px 16px',
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
                gap: 14,
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: 20 }}>{TASK_TYPE_EMOJI[t.task_type ?? 'other'] ?? '•'}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: t.status === 'done' ? 'var(--t3)' : 'var(--t1)', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                  {t.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {t.due_at && (
                    <span style={{ color: t.is_overdue ? '#b45309' : 'var(--t3)', fontWeight: t.is_overdue ? 600 : 400 }}>
                      {t.is_overdue ? '⚠ Overdue · ' : ''}
                      Due {new Date(t.due_at).toLocaleString()}
                    </span>
                  )}
                  {t.assigned_to_name && <span>· @{t.assigned_to_name}</span>}
                  {contextLabel(t) && contextLink(t) && (
                    <a
                      onClick={(e) => { e.stopPropagation(); nav(contextLink(t)!); }}
                      style={{ color: 'var(--pr)', cursor: 'pointer', textDecoration: 'none' }}
                    >
                      · {contextLabel(t)}
                    </a>
                  )}
                </div>
                {t.description && (
                  <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 5 }}>{t.description}</div>
                )}
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: statusBg(t.status), color: statusColor(t.status), textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t.status}
              </span>
              {t.status === 'open' ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => completeTask(t.id)} style={smallBtnGreen}>✓ Done</button>
                  <button onClick={() => cancelTask(t.id)} style={smallBtnRed}>✗</button>
                </div>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function statusBg(s: RecruiterTask['status']): string {
  switch (s) {
    case 'open': return '#dbeafe';
    case 'done': return '#d1fae5';
    case 'snoozed': return '#fef3c7';
    case 'cancelled': return '#f3f4f6';
  }
}
function statusColor(s: RecruiterTask['status']): string {
  switch (s) {
    case 'open': return '#1e40af';
    case 'done': return '#065f46';
    case 'snoozed': return '#92400e';
    case 'cancelled': return '#6b7280';
  }
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--pr)', color: 'var(--sf)', border: 'none', borderRadius: 'var(--br)',
  padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: 'var(--sf2)', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 6,
  padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const smallBtnGreen: React.CSSProperties = {
  background: '#10b981', color: '#fff', border: 'none', borderRadius: 5,
  padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
};
const smallBtnRed: React.CSSProperties = {
  background: '#ef4444', color: '#fff', border: 'none', borderRadius: 5,
  padding: '5px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
};
const inputBase: React.CSSProperties = {
  padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6,
  fontSize: 13, background: 'var(--sf)', outline: 'none',
};
