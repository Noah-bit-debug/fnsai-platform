import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ActionItemState { done: boolean; }

type TaskCategory = 'Recruiting' | 'HR' | 'Credentialing' | 'Onboarding' | 'Operations' | 'Business Dev' | 'General';
type TaskPriority = 'High' | 'Medium' | 'Low';

interface CustomTask {
  id: string;
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  dueDate: string;
  notes: string;
  done: boolean;
  createdAt: string;
  groupId?: string; // optional: belongs to a named category group
}

interface TaskGroup {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

const STORAGE_KEY      = 'fns_action_tasks';
const GROUPS_STORAGE   = 'fns_action_groups';

const GROUP_PALETTE = ['#1565c0','#6a1b9a','#00695c','#c62828','#e65100','#2e7d32','#01579b','#37474f','#4a148c','#006064'];

const CATEGORY_COLORS: Record<TaskCategory, string> = {
  Recruiting:    '#1565c0',
  HR:            '#6a1b9a',
  Credentialing: '#00695c',
  Onboarding:    '#e65100',
  Operations:    '#37474f',
  'Business Dev': '#2e7d32',
  General:       '#546e7a',
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  High:   '#c62828',
  Medium: '#e65100',
  Low:    '#2e7d32',
};

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ background: color, color: '#fff', borderRadius: 10, padding: '3px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

// ─── Add Category Modal ────────────────────────────────────────────────────────
function AddCategoryModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, color: string) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_PALETTE[0]);
  const [err, setErr] = useState('');

  function submit() {
    if (!name.trim()) { setErr('Category name is required.'); return; }
    onSave(name.trim(), color);
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>Add Task Category</div>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>Create a named group to organize your tasks.</p>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Category Name *</label>
          <input
            autoFocus value={name} onChange={e => { setName(e.target.value); setErr(''); }}
            placeholder="e.g. Client Outreach, Compliance Tasks…"
            style={{ width: '100%', padding: '9px 14px', border: `1px solid ${err ? '#fca5a5' : '#e8edf2'}`, borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box' }}
          />
          {err && <div style={{ color: '#c62828', fontSize: 12, marginTop: 4 }}>{err}</div>}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>Color</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {GROUP_PALETTE.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{
                width: 28, height: 28, borderRadius: '50%', background: c, border: color === c ? '3px solid #1a2b3c' : '2px solid transparent',
                cursor: 'pointer', outline: 'none', boxSizing: 'border-box',
              }} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={submit} style={{ background: color, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>+ Add Category</button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Task Modal ─────────────────────────────────────────────────────────
const EMPTY_TASK: Omit<CustomTask, 'id' | 'done' | 'createdAt'> = {
  title: '', category: 'General', priority: 'Medium', dueDate: '', notes: '', groupId: undefined,
};

function CreateTaskModal({ onClose, onSave, groups }: {
  onClose: () => void;
  onSave: (task: Omit<CustomTask, 'id' | 'done' | 'createdAt'>) => void;
  groups: TaskGroup[];
}) {
  const [form, setForm] = useState(EMPTY_TASK);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  function submit() {
    if (!form.title.trim()) { setErr('Task title is required.'); return; }
    onSave(form);
    onClose();
  }

  const inp: React.CSSProperties = { width: '100%', padding: '9px 14px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box' };
  const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Create Task</div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Task Title *</label>
          <input style={inp} value={form.title} onChange={set('title')} placeholder="e.g. Follow up with Memorial Health" autoFocus />
        </div>

        {groups.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Task Group (optional)</label>
            <select style={inp} value={form.groupId ?? ''} onChange={e => setForm(f => ({ ...f, groupId: e.target.value || undefined }))}>
              <option value="">— No group (General) —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Category</label>
            <select style={inp} value={form.category} onChange={set('category')}>
              {Object.keys(CATEGORY_COLORS).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Priority</label>
            <select style={inp} value={form.priority} onChange={set('priority')}>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Due Date (optional)</label>
          <input style={inp} type="date" value={form.dueDate} onChange={set('dueDate')} />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={lbl}>Notes</label>
          <textarea style={{ ...inp, height: 80, resize: 'vertical' }} value={form.notes} onChange={set('notes')} placeholder="Additional context…" />
        </div>

        {err && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={submit} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Save Task</button>
        </div>
      </div>
    </div>
  );
}

// ─── Task Card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, onToggle, onDelete, fmtDate }: {
  task: CustomTask;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  fmtDate: (d: string) => string | null;
}) {
  return (
    <div className={`action-item ai-med${task.done ? ' ai-done' : ''}`} style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="ai-title" style={{ textDecoration: task.done ? 'line-through' : 'none', opacity: task.done ? 0.6 : 1 }}>
            {task.title}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge label={task.category} color={CATEGORY_COLORS[task.category]} />
            <Badge label={task.priority} color={PRIORITY_COLORS[task.priority]} />
            {task.dueDate && <span style={{ fontSize: 12, color: '#64748b' }}>Due: {fmtDate(task.dueDate)}</span>}
          </div>
          {task.notes && <div className="ai-desc" style={{ marginTop: 6 }}>{task.notes}</div>}
        </div>
      </div>
      <div className="ai-footer">
        {!task.done ? (
          <>
            <button className="btn btn-gh btn-sm" onClick={() => onToggle(task.id)}>Mark done</button>
            <button onClick={() => onDelete(task.id)} style={{ background: '#fef2f2', color: '#c62828', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Delete</button>
          </>
        ) : (
          <>
            <span className="tag tg">✓ Completed</span>
            <button onClick={() => onDelete(task.id)} style={{ background: '#fef2f2', color: '#c62828', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Remove</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ActionPlan() {
  const navigate = useNavigate();

  const [items, setItems] = useState<Record<string, ActionItemState>>({
    realtime: { done: false }, workersComp: { done: false }, profLiability: { done: false },
    epli: { done: false }, bankeasy: { done: false }, loc: { done: false },
    timeline: { done: false }, incident: { done: false }, timekeeping: { done: false },
    docLogs: { done: false }, facilityContract: { done: false },
    employmentContract: { done: false }, perDiem: { done: false },
  });

  const [customTasks,      setCustomTasks]      = useState<CustomTask[]>([]);
  const [groups,           setGroups]           = useState<TaskGroup[]>([]);
  const [showCreateModal,  setShowCreateModal]  = useState(false);
  const [showCategoryModal,setShowCategoryModal]= useState(false);
  const [tasksLoaded,      setTasksLoaded]      = useState(false);
  const [showLaunchChecklist, setShowLaunchChecklist] = useState(false);
  const [addTaskForGroup,  setAddTaskForGroup]  = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCustomTasks(JSON.parse(raw));
      const grpRaw = localStorage.getItem(GROUPS_STORAGE);
      if (grpRaw) setGroups(JSON.parse(grpRaw));
    } catch { /* ignore */ }
    setTasksLoaded(true);
  }, []);

  useEffect(() => {
    if (!tasksLoaded) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customTasks));
  }, [customTasks, tasksLoaded]);

  useEffect(() => {
    if (!tasksLoaded) return;
    localStorage.setItem(GROUPS_STORAGE, JSON.stringify(groups));
  }, [groups, tasksLoaded]);

  const toggle = (key: string) => setItems(prev => ({ ...prev, [key]: { done: !prev[key].done } }));

  function addCustomTask(data: Omit<CustomTask, 'id' | 'done' | 'createdAt'>) {
    setCustomTasks(prev => [...prev, { ...data, id: `ct${Date.now()}`, done: false, createdAt: new Date().toISOString() }]);
  }

  function addGroup(name: string, color: string) {
    setGroups(prev => [...prev, { id: `grp${Date.now()}`, name, color, createdAt: new Date().toISOString() }]);
  }

  function toggleCustomTask(id: string) { setCustomTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t)); }
  function deleteCustomTask(id: string) { if (!confirm('Delete this task?')) return; setCustomTasks(prev => prev.filter(t => t.id !== id)); }
  function deleteGroup(id: string) {
    if (!confirm('Delete this category and all its tasks?')) return;
    setGroups(prev => prev.filter(g => g.id !== id));
    setCustomTasks(prev => prev.filter(t => t.groupId !== id));
  }

  function fmtDate(d: string) {
    if (!d) return null;
    try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return d; }
  }

  const renderFooter = (key: string, buttons: React.ReactNode) => {
    if (items[key].done) return <div className="ai-footer"><span className="tag tg">✓ Completed</span></div>;
    return <div className="ai-footer">{buttons}<button className="btn btn-gh btn-sm" onClick={() => toggle(key)}>Mark done</button></div>;
  };

  // Tasks with no group
  const ungroupedTasks = customTasks.filter(t => !t.groupId);
  const pendingCount   = ungroupedTasks.filter(t => !t.done).length;
  const completedCount = ungroupedTasks.filter(t => t.done).length;

  return (
    <div>
      {/* Header */}
      <div className="ph">
        <div>
          <div className="pt">Action Plan &amp; Tasks</div>
          <div className="ps">Manage tasks, follow-ups, and action items across departments.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-gh" onClick={() => setShowCategoryModal(true)}>+ Add Category</button>
          <button className="btn btn-pr" onClick={() => setShowCreateModal(true)}>+ Create Task</button>
        </div>
      </div>

      {/* ── Named Category Groups ─────────────────────────────────────────────── */}
      {groups.map(group => {
        const groupTasks = customTasks.filter(t => t.groupId === group.id);
        const gPending   = groupTasks.filter(t => !t.done).length;
        const gDone      = groupTasks.filter(t => t.done).length;
        return (
          <div key={group.id} className="pn" style={{ marginBottom: '1.5rem', borderTop: `3px solid ${group.color}` }}>
            <div className="pnh">
              <span style={{ color: group.color, fontWeight: 700 }}>📁 {group.name}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {gPending > 0 && <span className="tag tw">{gPending} pending</span>}
                {gDone > 0 && <span className="tag tg">{gDone} done</span>}
                <button className="btn btn-pr btn-sm" onClick={() => { setAddTaskForGroup(group.id); setShowCreateModal(true); }}>+ Add Task</button>
                <button onClick={() => deleteGroup(group.id)} style={{ background: '#fef2f2', color: '#c62828', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>✕</button>
              </div>
            </div>
            <div className="pnb">
              {groupTasks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b' }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>📋</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>No tasks in this category</div>
                  <div style={{ fontSize: 13 }}>Click "+ Add Task" to add items here.</div>
                </div>
              ) : (
                groupTasks.map(task => (
                  <TaskCard key={task.id} task={task} onToggle={toggleCustomTask} onDelete={deleteCustomTask} fmtDate={fmtDate} />
                ))
              )}
            </div>
          </div>
        );
      })}

      {/* ── General / Ungrouped Tasks ─────────────────────────────────────────── */}
      <div className="pn" style={{ marginBottom: '1.5rem' }}>
        <div className="pnh">
          <span>My Custom Tasks</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {pendingCount > 0 && <span className="tag tw">{pendingCount} pending</span>}
            {completedCount > 0 && <span className="tag tg">{completedCount} done</span>}
            <button className="btn btn-pr btn-sm" onClick={() => { setAddTaskForGroup(null); setShowCreateModal(true); }}>+ Add</button>
          </div>
        </div>
        <div className="pnb">
          {ungroupedTasks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748b' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📝</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No custom tasks yet</div>
              <div style={{ fontSize: 13 }}>Click "+ Create Task" above to add your own action items.</div>
            </div>
          ) : (
            ungroupedTasks.map(task => (
              <TaskCard key={task.id} task={task} onToggle={toggleCustomTask} onDelete={deleteCustomTask} fmtDate={fmtDate} />
            ))
          )}
        </div>
      </div>

      {/* ── Launch Checklist (collapsible) ────────────────────────────────────── */}
      <div className="pn" style={{ marginBottom: '1.5rem' }}>
        <button
          className="pnh"
          onClick={() => setShowLaunchChecklist(v => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        >
          <span>🚀 Launch Checklist <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b', marginLeft: 6 }}>30–60 day operational build-out</span></span>
          <span style={{ fontSize: 11, color: '#94a3b8', transition: 'transform 0.2s', transform: showLaunchChecklist ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>▼</span>
        </button>

        {showLaunchChecklist && (
          <div className="pnb" style={{ paddingTop: 16 }}>
            <div className="cg2">
              {/* LEFT COLUMN */}
              <div>
                <div className="pn" style={{ marginBottom: '1rem' }}>
                  <div className="pnh"><span>Step 1 — Immediate Actions</span><span className="tag td">Urgent</span></div>
                  <div className="pnb">
                    <div className={`action-item ai-urgent${items.realtime.done ? ' ai-done' : ''}`}>
                      <div className="ai-title">Send RealTime email — post-renewal</div>
                      <div className="ai-desc">Formal notice to RealTime that renewal has occurred. Establish updated terms, confirm staffing continuity, and set expectations for the transition period. This is <strong>OVERDUE</strong>.</div>
                      {renderFooter('realtime', <button className="btn btn-pr btn-sm" onClick={() => navigate('/ai-assistant')}>✦ Draft with AI</button>)}
                    </div>
                  </div>
                </div>

                <div className="pn" style={{ marginBottom: '1rem' }}>
                  <div className="pnh"><span>Step 2 — Insurance Coverage</span><span className="tag tw">Required</span></div>
                  <div className="pnb">
                    {[
                      { key: 'workersComp', title: "Workers' Compensation Insurance", desc: "Required in all states where staff are deployed. Must be in place before placing any workers." },
                      { key: 'profLiability', title: 'Professional Liability / E&O Insurance', desc: 'Errors & Omissions coverage protects against claims of negligent placement or staffing decisions.' },
                      { key: 'epli', title: 'EPLI — Employment Practices Liability', desc: 'Covers claims of discrimination, wrongful termination, harassment by or against staff you place.' },
                    ].map((item, i) => (
                      <div key={item.key} className={`action-item ai-high${items[item.key].done ? ' ai-done' : ''}`} style={{ marginTop: i > 0 ? '0.75rem' : 0 }}>
                        <div className="ai-title">{item.title}</div>
                        <div className="ai-desc">{item.desc}</div>
                        {renderFooter(item.key, <button className="btn btn-wn btn-sm" onClick={() => navigate('/insurance')}>Get quotes</button>)}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pn" style={{ marginBottom: '1rem' }}>
                  <div className="pnh"><span>Step 3 — Funding &amp; Banking</span><span className="tag tb">Important</span></div>
                  <div className="pnb">
                    <div className={`action-item ai-med${items.bankeasy.done ? ' ai-done' : ''}`}>
                      <div className="ai-title">Activate BankEasy Business Account</div>
                      <div className="ai-desc">Complete identity verification and link your EIN. Required for payroll processing and client invoicing.</div>
                      {renderFooter('bankeasy', <button className="btn btn-ac btn-sm" onClick={() => navigate('/funding')}>View account</button>)}
                    </div>
                    <div className={`action-item ai-med${items.loc.done ? ' ai-done' : ''}`} style={{ marginTop: '0.75rem' }}>
                      <div className="ai-title">Establish Line of Credit (LOC)</div>
                      <div className="ai-desc">30–60 day float gap between paying staff weekly and receiving client payment. A $50k–$150k LOC is recommended.</div>
                      {renderFooter('loc', <button className="btn btn-ac btn-sm" onClick={() => navigate('/funding')}>View LOC status</button>)}
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN */}
              <div>
                <div className="pn" style={{ marginBottom: '1rem' }}>
                  <div className="pnh"><span>Step 4 — Transition Timeline</span><span className="tag tb">Planning</span></div>
                  <div className="pnb">
                    <div className={`action-item ai-med${items.timeline.done ? ' ai-done' : ''}`}>
                      <div className="ai-title">Execute 30–60 Day Transition Plan</div>
                      <div className="ai-desc">Follow the structured checklist: insurance by day 7, banking by day 10, contracts updated by day 21, full operational independence by day 60.</div>
                      {renderFooter('timeline', <button className="btn btn-ac btn-sm" onClick={() => navigate('/timeline')}>View timeline</button>)}
                    </div>
                  </div>
                </div>

                <div className="pn" style={{ marginBottom: '1rem' }}>
                  <div className="pnh"><span>Step 5 — Internal Controls</span><span className="tag tgr">Operational</span></div>
                  <div className="pnb">
                    {[
                      { key: 'incident', title: 'Set Up Incident Reporting System', desc: 'Document all workplace incidents, near-misses, and complaints. Required for Workers\' Comp claims and legal protection.' },
                      { key: 'timekeeping', title: 'Establish Timekeeping & Payroll Records', desc: 'Accurate time records protect against wage disputes and are required for FLSA compliance. Use a dedicated system, not spreadsheets.' },
                      { key: 'docLogs', title: 'Organize Document & Compliance Logs', desc: 'Maintain organized files for I-9s, licenses, certifications, and background checks for every placed employee.' },
                    ].map((item, i) => (
                      <div key={item.key} className={`action-item ai-med${items[item.key].done ? ' ai-done' : ''}`} style={{ marginTop: i > 0 ? '0.75rem' : 0 }}>
                        <div className="ai-title">{item.title}</div>
                        <div className="ai-desc">{item.desc}</div>
                        {renderFooter(item.key, <button className="btn btn-gh btn-sm" onClick={() => navigate('/documents')}>View docs</button>)}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pn" style={{ marginBottom: '1rem' }}>
                  <div className="pnh"><span>Step 6 — Contracts &amp; Agreements</span><span className="tag tp">Legal</span></div>
                  <div className="pnb">
                    {[
                      { key: 'facilityContract', title: 'Update Facility Service Agreements', desc: 'All client contracts must reflect your company name, updated indemnification language, and current insurance certificate numbers.' },
                      { key: 'employmentContract', title: 'Update Staff Employment Contracts', desc: 'Employee agreements need updated employer entity name, at-will language, and non-solicitation clauses.' },
                      { key: 'perDiem', title: 'Review Per Diem & Travel Agreements', desc: 'Ensure per diem rates comply with IRS guidelines and that travel reimbursement policies are clearly documented.' },
                    ].map((item, i) => (
                      <div key={item.key} className={`action-item ai-med${items[item.key].done ? ' ai-done' : ''}`} style={{ marginTop: i > 0 ? '0.75rem' : 0 }}>
                        <div className="ai-title">{item.title}</div>
                        <div className="ai-desc">{item.desc}</div>
                        {renderFooter(item.key, <button className="btn btn-pu btn-sm" onClick={() => navigate('/contracts')}>View contracts</button>)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCategoryModal && (
        <AddCategoryModal onClose={() => setShowCategoryModal(false)} onSave={addGroup} />
      )}
      {showCreateModal && (
        <CreateTaskModal
          groups={groups}
          onClose={() => { setShowCreateModal(false); setAddTaskForGroup(null); }}
          onSave={(data) => addCustomTask({ ...data, groupId: addTaskForGroup ?? data.groupId })}
        />
      )}
    </div>
  );
}
