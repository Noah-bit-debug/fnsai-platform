/**
 * Recruiting → Tasks page.
 *
 * Redesigned to mirror Intelligence → Action Plan:
 *   - Stats cards row (Open / Overdue / Due Today / Done this week)
 *   - AI Task Wizard ("✦ AI Wizard" button — purple)
 *   - Polished task cards with entity linking (candidate/job/client)
 *   - Filter row (status, task_type, assignee, show done)
 *
 * Data model is the same recruiter_tasks table — we didn't change that,
 * just the UX + added an AI draft endpoint for the wizard.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../lib/auth';
import { tasksApi, usersApi, RecruiterTask, OrgUser } from '../lib/api';
import { extractApiError } from '../lib/apiErrors';
import { useToast } from '../components/ToastHost';
import RecruiterTaskWizard from '../components/Tasks/RecruiterTaskWizard';

const TASK_TYPE_META: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  call:      { label: 'Call',      emoji: '📞', color: '#0369a1', bg: '#e0f2fe' },
  meeting:   { label: 'Meeting',   emoji: '📅', color: '#6d28d9', bg: '#ede9fe' },
  email:     { label: 'Email',     emoji: '📧', color: '#0f766e', bg: '#ccfbf1' },
  sms:       { label: 'SMS',       emoji: '💬', color: '#be185d', bg: '#fce7f3' },
  follow_up: { label: 'Follow-up', emoji: '🔄', color: '#b45309', bg: '#fef3c7' },
  todo:      { label: 'To-do',     emoji: '📝', color: '#475569', bg: '#f1f5f9' },
  other:     { label: 'Other',     emoji: '•',  color: '#64748b', bg: '#f1f5f9' },
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function hoursUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 3_600_000);
}

export default function Tasks() {
  const nav = useNavigate();
  const toast = useToast();
  const { user: me } = useUser();

  const [tasks, setTasks] = useState<RecruiterTask[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'open' | 'overdue' | 'due_today' | 'done' | 'all'>('open');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');

  // Modal state
  const [showWizard, setShowWizard] = useState(false);
  const [showManual, setShowManual] = useState(false);

  // Load users once — needed for assignee dropdown + rendering assignee names.
  useEffect(() => {
    void usersApi.list().then(r => setUsers(r.data.users)).catch(() => { /* silent */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params: Record<string, string> = {};
      if (statusFilter === 'overdue') params.overdue = 'true';
      else if (statusFilter === 'due_today') params.due_today = 'true';
      else if (statusFilter === 'done') params.status = 'done';
      else if (statusFilter === 'open') params.status = 'open';
      if (assigneeFilter) params.assigned_to = assigneeFilter;
      const res = await tasksApi.list(params);
      let rows = res.data.tasks;
      if (typeFilter) rows = rows.filter(t => t.task_type === typeFilter);
      setTasks(rows);
    } catch (e) {
      setError(extractApiError(e, 'Failed to load tasks'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, assigneeFilter]);

  useEffect(() => { void load(); }, [load]);

  // Stats — all computed on the current unfiltered view (by hitting the API
  // again with different filters would be chatty; instead we fetch all open
  // once and derive from that if statusFilter === 'open', otherwise fall
  // back to the current rows). Simpler + correct-enough: stats reflect the
  // tasks currently visible, plus we also fetch an "all" snapshot for the
  // big-picture counts.
  const [allOpen, setAllOpen] = useState<RecruiterTask[]>([]);
  useEffect(() => {
    void tasksApi.list({ status: 'open' }).then(r => setAllOpen(r.data.tasks)).catch(() => { /* silent */ });
  }, [tasks.length]); // re-pull after any mutation reflected in tasks

  const stats = useMemo(() => {
    const now = Date.now();
    const todayISO = new Date().toISOString().slice(0, 10);
    const weekAgo = now - 7 * 24 * 3_600_000;
    const overdue = allOpen.filter(t => t.due_at && new Date(t.due_at).getTime() < now).length;
    const dueToday = allOpen.filter(t => t.due_at?.slice(0, 10) === todayISO).length;
    const open = allOpen.length;
    const doneThisWeek = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).getTime() >= weekAgo).length;
    return { open, overdue, dueToday, doneThisWeek };
  }, [allOpen, tasks]);

  async function completeTask(id: string) {
    try {
      await tasksApi.complete(id);
      toast.success('Task completed');
      await load();
    } catch (e) {
      toast.error(extractApiError(e, 'Failed to complete task'));
    }
  }

  async function cancelTask(id: string) {
    if (!window.confirm('Cancel this task?')) return;
    try {
      await tasksApi.cancel(id);
      await load();
    } catch (e) {
      toast.error(extractApiError(e, 'Failed'));
    }
  }

  const contextLabel = (t: RecruiterTask): { label: string; href: string | null } | null => {
    if (t.candidate_name && t.candidate_id) return { label: `👤 ${t.candidate_name}`, href: `/candidates/${t.candidate_id}` };
    if (t.job_title && t.job_id)             return { label: `📋 ${t.job_title}`,       href: `/jobs/${t.job_id}` };
    if (t.client_name && t.client_id)        return { label: `🏢 ${t.client_name}`,     href: `/clients-orgs/${t.client_id}` };
    if (t.submission_id)                     return { label: `📤 Submission`,            href: `/submissions/${t.submission_id}` };
    return null;
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>📋 Recruiter Tasks</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>Calls, meetings, follow-ups — stay on top of your candidates and clients</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowManual(true)} style={ghostBtn}>+ Task</button>
          <button
            onClick={() => setShowWizard(true)}
            style={{ padding: '9px 18px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            ✦ AI Wizard
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <Stat label="Open" value={stats.open} color="#1565c0" onClick={() => setStatusFilter('open')} />
        <Stat label="Overdue" value={stats.overdue} color="#991b1b" onClick={() => setStatusFilter('overdue')} />
        <Stat label="Due today" value={stats.dueToday} color="#e65100" onClick={() => setStatusFilter('due_today')} />
        <Stat label="Done this week" value={stats.doneThisWeek} color="#2e7d32" onClick={() => setStatusFilter('done')} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={filter} value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="open">Open</option>
          <option value="overdue">Overdue</option>
          <option value="due_today">Due today</option>
          <option value="done">Done</option>
          <option value="all">All</option>
        </select>
        <select style={filter} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TASK_TYPE_META).map(([k, m]) => (
            <option key={k} value={k}>{m.emoji} {m.label}</option>
          ))}
        </select>
        <select style={filter} value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}>
          <option value="">All assignees</option>
          {me && (() => {
            const meRow = users.find(u => u.clerk_user_id === me.id);
            return meRow ? <option value={meRow.id}>👤 Mine</option> : null;
          })()}
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
          ))}
        </select>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {/* Empty / loading / list */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>
      ) : tasks.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c' }}>No tasks here</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
            Click ✦ AI Wizard to draft one in seconds, or + Task for manual entry.
          </div>
          <button onClick={() => setShowWizard(true)} style={{ padding: '9px 20px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            ✦ Start with AI
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map(t => {
            const meta = TASK_TYPE_META[t.task_type ?? 'todo'] ?? TASK_TYPE_META.todo;
            const hours = hoursUntil(t.due_at);
            const overdue = t.status === 'open' && hours != null && hours < 0;
            const dueSoon = t.status === 'open' && hours != null && hours >= 0 && hours <= 24;
            const ctx = contextLabel(t);
            const assignee = users.find(u => u.id === t.assigned_to);
            return (
              <div
                key={t.id}
                style={{
                  padding: 14,
                  background: '#fff',
                  border: '1px solid ' + (overdue ? '#fca5a5' : dueSoon ? '#fde68a' : '#e2e8f0'),
                  borderRadius: 10,
                  opacity: t.status === 'done' || t.status === 'cancelled' ? 0.55 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={t.status === 'done'}
                    onChange={() => void completeTask(t.id)}
                    disabled={t.status !== 'open'}
                    style={{ width: 18, height: 18, marginTop: 2, accentColor: '#2e7d32', cursor: t.status === 'open' ? 'pointer' : 'not-allowed' }}
                    title={t.status === 'open' ? 'Mark complete' : `Already ${t.status}`}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                        {t.title}
                      </span>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: meta.bg, color: meta.color, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                        {meta.emoji} {meta.label}
                      </span>
                      {ctx && (
                        ctx.href ? (
                          <a
                            href={ctx.href}
                            onClick={e => { e.preventDefault(); if (ctx.href) nav(ctx.href); }}
                            style={{ padding: '2px 8px', borderRadius: 10, background: '#eff6ff', color: '#1e40af', fontSize: 10, fontWeight: 700, textDecoration: 'none' }}
                          >
                            {ctx.label}
                          </a>
                        ) : (
                          <span style={{ padding: '2px 8px', borderRadius: 10, background: '#eff6ff', color: '#1e40af', fontSize: 10, fontWeight: 700 }}>{ctx.label}</span>
                        )
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {t.due_at && (
                        <span style={{ color: overdue ? '#991b1b' : dueSoon ? '#e65100' : '#64748b', fontWeight: overdue || dueSoon ? 600 : 400 }}>
                          📆 {fmtDateTime(t.due_at)}
                          {overdue ? ' (overdue)' : dueSoon && hours != null ? ` (${hours >= 0 ? hours : 0}h)` : ''}
                        </span>
                      )}
                      {assignee && <span>👤 {assignee.name ?? assignee.email}</span>}
                      {t.description && <span style={{ color: '#94a3b8' }}>· {t.description.slice(0, 80)}{t.description.length > 80 ? '…' : ''}</span>}
                    </div>
                  </div>
                  {t.status === 'open' && (
                    <button
                      onClick={() => void cancelTask(t.id)}
                      style={{ background: 'none', border: 'none', color: '#c62828', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
                      title="Cancel task"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {showWizard && (
        <RecruiterTaskWizard
          onCreated={() => { void load(); }}
          onClose={() => setShowWizard(false)}
        />
      )}
      {showManual && (
        <ManualTaskModal
          users={users}
          me={me?.id}
          onClose={() => setShowManual(false)}
          onSaved={() => { setShowManual(false); void load(); }}
        />
      )}
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────
function Stat({ label, value, color, onClick }: { label: string; value: number; color: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: 14,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = color; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.borderColor = '#e2e8f0'; }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ─── Manual entry modal (simple form, mirrors AI wizard review stage) ───
interface ManualProps {
  users: OrgUser[];
  me: string | null | undefined;
  onClose: () => void;
  onSaved: () => void;
}

function ManualTaskModal({ users, me, onClose, onSaved }: ManualProps) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState<RecruiterTask['task_type']>('todo');
  const [dueAt, setDueAt] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState<string>(() => {
    const meRow = users.find(u => u.clerk_user_id === me);
    return meRow?.id ?? '';
  });

  async function save() {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      await tasksApi.create({
        title: title.trim(),
        task_type: taskType,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        description: description.trim() || null,
        assigned_to: assignedTo || null,
      });
      toast.success('Task created');
      onSaved();
    } catch (e) {
      toast.error(extractApiError(e, 'Failed to create task'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>New Task</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Manual entry — or try the ✦ AI Wizard</div>
          </div>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Title</label>
            <input autoFocus style={field} value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title…" />
          </div>
          <div>
            <label style={lbl}>Type</label>
            <select style={field} value={taskType ?? 'todo'} onChange={e => setTaskType(e.target.value as RecruiterTask['task_type'])}>
              {Object.entries(TASK_TYPE_META).map(([k, m]) => (
                <option key={k} value={k}>{m.emoji} {m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbl}>Due</label>
            <input type="datetime-local" style={field} value={dueAt} onChange={e => setDueAt(e.target.value)} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Assign to</label>
            <select style={field} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
              <option value="">— Unassigned —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Description</label>
            <textarea
              style={{ ...field, minHeight: 60, resize: 'vertical' }}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional context / notes"
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => void save()} style={primaryBtn} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles (shared with RecruiterTaskWizard but self-contained here) ────
const ghostBtn: React.CSSProperties = { padding: '9px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, fontSize: 13, color: '#475569', cursor: 'pointer' };
const filter: React.CSSProperties = { padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' };
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const card: React.CSSProperties = { background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
const field: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit', color: '#1e293b' };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
const primaryBtn: React.CSSProperties = { padding: '9px 18px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' };
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: 'pointer' };
