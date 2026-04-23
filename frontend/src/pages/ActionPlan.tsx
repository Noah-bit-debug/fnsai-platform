/**
 * Phase 5.2 — Action Plan (rewritten)
 *
 * Previously: 500+ lines of localStorage-backed custom tasks plus a
 * hardcoded 12-item "launch checklist" with demo-only action buttons.
 * Now: API-backed task tracker with subtasks + reminders + an AI
 * wizard that can draft a new task from a one-line goal.
 *
 * Feature checklist per the Phase 5 notes:
 *   [✓] AI helps create tasks
 *   [✓] AI asks questions to make the task detailed and helpful
 *   [✓] AI can build lists/items/subtasks
 *   [✓] AI can include reminders
 *   [✓] Button that clearly invokes AI help (✦ AI Wizard)
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  planTasksApi,
  PlanTask,
  PlanTaskGroup,
  PlanSubtask,
  PlanReminder,
} from '../lib/api';
import AITaskWizard from '../components/ActionPlan/AITaskWizard';

const PRIORITY_COLORS = { High: '#c62828', Medium: '#e65100', Low: '#2e7d32' };

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const s = String(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString();
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default function ActionPlan() {
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [groups, setGroups] = useState<PlanTaskGroup[]>([]);
  const [upcoming, setUpcoming] = useState<PlanReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [showWizard, setShowWizard] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true); setError(null);
    const [tRes, gRes, rRes] = await Promise.allSettled([
      planTasksApi.listTasks({
        done: showDone ? undefined : false,
        priority: priorityFilter || undefined,
        group_id: groupFilter || undefined,
      }),
      planTasksApi.listGroups(),
      planTasksApi.upcomingReminders(),
    ]);
    if (tRes.status === 'fulfilled') setTasks(tRes.value.data.tasks);
    else setError((tRes.reason as any)?.response?.data?.error ?? 'Failed to load tasks');
    if (gRes.status === 'fulfilled') setGroups(gRes.value.data.groups);
    if (rRes.status === 'fulfilled') setUpcoming(rRes.value.data.reminders);
    setLoading(false);
  }
  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, [showDone, priorityFilter, groupFilter]);

  async function toggleDone(t: PlanTask) {
    try { await planTasksApi.updateTask(t.id, { done: !t.done }); await loadAll(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Failed.'); }
  }
  async function deleteTask(id: string) {
    if (!confirm('Delete this task (and its subtasks)?')) return;
    try { await planTasksApi.deleteTask(id); await loadAll(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Failed.'); }
  }

  const stats = useMemo(() => ({
    total: tasks.length,
    high: tasks.filter(t => t.priority === 'High' && !t.done).length,
    overdue: tasks.filter(t => !t.done && t.due_date && (daysUntil(t.due_date) ?? 99) < 0).length,
    dueThisWeek: tasks.filter(t => !t.done && t.due_date && (daysUntil(t.due_date) ?? 99) >= 0 && (daysUntil(t.due_date) ?? 99) <= 7).length,
  }), [tasks]);

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>📋 Action Plan & Tasks</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>Track work with subtasks, priorities, and reminders</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAddGroup(true)} style={ghostBtn}>+ Group</button>
          <button onClick={() => setShowManual(true)} style={ghostBtn}>+ Task</button>
          <button onClick={() => setShowWizard(true)} style={{ padding: '9px 18px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            ✦ AI Wizard
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <Stat label="Open" value={stats.total} color="#1565c0" />
        <Stat label="High priority" value={stats.high} color="#c62828" />
        <Stat label="Overdue" value={stats.overdue} color="#991b1b" />
        <Stat label="Due in 7 days" value={stats.dueThisWeek} color="#e65100" />
      </div>

      {/* Upcoming reminders strip */}
      {upcoming.length > 0 && (
        <div style={{ padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
            ⏰ Upcoming reminders ({upcoming.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {upcoming.slice(0, 6).map(r => (
              <div key={r.id} style={{ fontSize: 12, padding: '4px 10px', background: '#fff', border: '1px solid #fde68a', borderRadius: 999 }}>
                <strong>{r.task_title}</strong> — {fmtDate(r.remind_at)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select style={filter} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
          <option value="">All priorities</option>
          <option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
        </select>
        <select style={filter} value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
          <option value="">All groups</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
          Show done
        </label>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>
      : tasks.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c' }}>No tasks yet</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Click ✦ AI Wizard to draft one in seconds, or + Task for manual entry.</div>
          <button onClick={() => setShowWizard(true)} style={{ padding: '9px 20px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            ✦ Start with AI
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map(t => {
            const days = daysUntil(t.due_date);
            const overdue = !t.done && days != null && days < 0;
            const pct = (t.subtask_total ?? 0) > 0 ? Math.round(((t.subtask_done ?? 0) / (t.subtask_total ?? 1)) * 100) : 0;
            const isExpanded = expandedId === t.id;
            return (
              <Fragment key={t.id}>
                <div style={{ padding: 14, background: '#fff', border: '1px solid ' + (overdue ? '#fca5a5' : '#e2e8f0'), borderRadius: 10, opacity: t.done ? 0.55 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <input type="checkbox" checked={t.done} onChange={() => void toggleDone(t)}
                           style={{ width: 18, height: 18, marginTop: 2, accentColor: '#2e7d32', cursor: 'pointer' }} />
                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : t.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c', textDecoration: t.done ? 'line-through' : 'none' }}>
                          {t.title}
                        </span>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: PRIORITY_COLORS[t.priority] + '22', color: PRIORITY_COLORS[t.priority], fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                          {t.priority}
                        </span>
                        {t.group_name && (
                          <span style={{ padding: '2px 8px', borderRadius: 10, background: (t.group_color ?? '#64748b') + '22', color: t.group_color ?? '#64748b', fontSize: 10, fontWeight: 700 }}>
                            {t.group_name}
                          </span>
                        )}
                        {t.reminder_soon && !t.done && <span style={{ fontSize: 10, color: '#92400e', fontWeight: 700 }}>⏰</span>}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {t.category && <span>{t.category}</span>}
                        {t.due_date && (
                          <span style={{ color: overdue ? '#991b1b' : days != null && days <= 7 ? '#e65100' : '#64748b', fontWeight: overdue ? 600 : 400 }}>
                            Due {fmtDate(t.due_date)} {overdue ? '(overdue)' : days != null && days <= 7 ? `(${days}d)` : ''}
                          </span>
                        )}
                        {(t.subtask_total ?? 0) > 0 && (
                          <span>{t.subtask_done}/{t.subtask_total} subtasks{pct === 100 ? ' ✓' : ''}</span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => void deleteTask(t.id)} style={{ background: 'none', border: 'none', color: '#c62828', fontSize: 16, cursor: 'pointer' }}>×</button>
                  </div>
                </div>
                {isExpanded && (
                  <TaskDetail taskId={t.id} onChanged={loadAll} />
                )}
              </Fragment>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {showWizard && (
        <AITaskWizard groups={groups} onCreated={() => { void loadAll(); }} onClose={() => setShowWizard(false)} />
      )}
      {showManual && (
        <ManualTaskModal groups={groups} onClose={() => setShowManual(false)} onSaved={() => { setShowManual(false); void loadAll(); }} />
      )}
      {showAddGroup && (
        <AddGroupModal onClose={() => setShowAddGroup(false)} onSaved={() => { setShowAddGroup(false); void loadAll(); }} />
      )}
    </div>
  );
}

// ── Task Detail (subtasks + reminders + notes) ──────────────────────────

function TaskDetail({ taskId, onChanged }: { taskId: string; onChanged: () => void }) {
  const [data, setData] = useState<{ task: PlanTask; subtasks: PlanSubtask[]; reminders: PlanReminder[] } | null>(null);
  const [newSub, setNewSub] = useState('');
  const [newReminderAt, setNewReminderAt] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { const r = await planTasksApi.getTask(taskId); setData(r.data); }
    catch (e: any) { setErr(e?.response?.data?.error ?? 'Load failed.'); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [taskId]);

  async function toggleSub(s: PlanSubtask) {
    try { await planTasksApi.updateSubtask(taskId, s.id, { done: !s.done }); await load(); onChanged(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Failed.'); }
  }
  async function addSub() {
    if (!newSub.trim()) return;
    try { await planTasksApi.addSubtask(taskId, { title: newSub.trim() }); setNewSub(''); await load(); onChanged(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Failed.'); }
  }
  async function removeSub(sid: string) {
    try { await planTasksApi.deleteSubtask(taskId, sid); await load(); onChanged(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Failed.'); }
  }
  async function addReminder() {
    if (!newReminderAt) return;
    try { await planTasksApi.addReminder(taskId, { remind_at: new Date(newReminderAt).toISOString() }); setNewReminderAt(''); await load(); onChanged(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Failed.'); }
  }
  async function dismissRem(rid: string) {
    try { await planTasksApi.dismissReminder(taskId, rid); await load(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Failed.'); }
  }

  if (!data) return <div style={{ padding: 14, color: '#64748b', fontSize: 12 }}>Loading…</div>;
  if (err) return <div style={{ padding: 14, color: '#c62828', fontSize: 12 }}>{err}</div>;

  return (
    <div style={{ padding: 14, background: '#f8fafc', borderRadius: 10, marginLeft: 28, border: '1px solid #e2e8f0' }}>
      {data.task.notes && (
        <div style={{ marginBottom: 12, padding: 10, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, color: '#475569', whiteSpace: 'pre-wrap' }}>
          {data.task.notes}
        </div>
      )}

      {/* Subtasks */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
        Subtasks ({data.subtasks.filter(s => s.done).length}/{data.subtasks.length})
      </div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 12 }}>
        {data.subtasks.length === 0 && <div style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 12 }}>No subtasks.</div>}
        {data.subtasks.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid #f1f5f9' }}>
            <input type="checkbox" checked={s.done} onChange={() => void toggleSub(s)} style={{ accentColor: '#2e7d32' }} />
            <span style={{ flex: 1, fontSize: 13, color: s.done ? '#94a3b8' : '#1e293b', textDecoration: s.done ? 'line-through' : 'none' }}>{s.title}</span>
            <button onClick={() => void removeSub(s.id)} style={{ background: 'none', border: 'none', color: '#c62828', cursor: 'pointer', fontSize: 14 }}>×</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, padding: '7px 10px' }}>
          <input style={{ ...field, padding: '5px 8px' }} value={newSub} onChange={e => setNewSub(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addSub(); }} placeholder="+ Add subtask" />
          <button onClick={() => void addSub()} style={ghostBtn}>Add</button>
        </div>
      </div>

      {/* Reminders */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
        Reminders
      </div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        {data.reminders.filter(r => !r.dismissed).length === 0 && <div style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 12 }}>No active reminders.</div>}
        {data.reminders.filter(r => !r.dismissed).map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 12, color: '#1e293b', flex: 1 }}>
              ⏰ {new Date(r.remind_at).toLocaleString()}
              {r.message && <span style={{ color: '#64748b' }}> — {r.message}</span>}
            </span>
            <button onClick={() => void dismissRem(r.id)} style={ghostBtn}>Dismiss</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, padding: '7px 10px' }}>
          <input type="datetime-local" style={{ ...field, padding: '5px 8px' }} value={newReminderAt} onChange={e => setNewReminderAt(e.target.value)} />
          <button onClick={() => void addReminder()} style={ghostBtn}>+ Add</button>
        </div>
      </div>
    </div>
  );
}

// ── Manual task modal ───────────────────────────────────────────────────

function ManualTaskModal({ groups, onClose, onSaved }: { groups: PlanTaskGroup[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<PlanTask>>({ priority: 'Medium' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!form.title?.trim()) { setErr('Title required.'); return; }
    setSaving(true); setErr(null);
    try {
      await planTasksApi.createTask({
        title: form.title.trim(),
        category: form.category || null,
        priority: form.priority ?? 'Medium',
        due_date: form.due_date || null,
        notes: form.notes || null,
        group_id: form.group_id || null,
      });
      onSaved();
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Save failed.'); }
    finally { setSaving(false); }
  }
  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>New Task</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Title *</label>
            <input style={field} value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} />
          </div>
          <div><label style={lbl}>Category</label><input style={field} value={form.category ?? ''} onChange={e => setForm({ ...form, category: e.target.value })} /></div>
          <div><label style={lbl}>Priority</label>
            <select style={field} value={form.priority ?? 'Medium'} onChange={e => setForm({ ...form, priority: e.target.value as PlanTask['priority'] })}>
              <option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
            </select>
          </div>
          <div><label style={lbl}>Due date</label><input type="date" style={field} value={form.due_date ?? ''} onChange={e => setForm({ ...form, due_date: e.target.value || null })} /></div>
          <div><label style={lbl}>Group</label>
            <select style={field} value={form.group_id ?? ''} onChange={e => setForm({ ...form, group_id: e.target.value || null })}>
              <option value="">— None —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={lbl}>Notes</label>
            <textarea style={{ ...field, minHeight: 60, resize: 'vertical' }} value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        {err && <div style={{ color: '#c62828', fontSize: 12, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving} style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

function AddGroupModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#1565c0');
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!name.trim()) { setErr('Name required.'); return; }
    try { await planTasksApi.createGroup({ name: name.trim(), color }); onSaved(); }
    catch (e: any) { setErr(e?.response?.data?.error ?? 'Failed.'); }
  }
  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...card, maxWidth: 420 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>New Group</div>
        <label style={lbl}>Name</label>
        <input style={field} value={name} onChange={e => setName(e.target.value)} autoFocus />
        <label style={{ ...lbl, marginTop: 10 }}>Color</label>
        <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ ...field, height: 36, padding: 4 }} />
        {err && <div style={{ color: '#c62828', fontSize: 12, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => void submit()} style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const card: React.CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 540, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
const field: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit', color: '#1e293b' };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
const ghostBtn: React.CSSProperties = { padding: '7px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer' };
const filter: React.CSSProperties = { padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#fff', color: '#475569' };
