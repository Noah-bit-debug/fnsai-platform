/**
 * Phase 5.2 — AI Guided Task Wizard
 *
 * Like AIGuidedInterview for incidents but optimized for task creation:
 *   1. User types a one-line goal ("I need to set up workers' comp")
 *   2. AI asks 3-6 refining questions one at a time
 *   3. AI drafts a full task: title + category + priority + due date +
 *      subtasks + notes + a suggested reminder date
 *   4. User reviews, edits any field, clicks Create → task is saved
 *      (with its subtasks + reminder) via the standard CRUD endpoints.
 *
 * Manual mode is always available — the parent page's "Create Task"
 * button still opens the plain form. This modal is strictly additive.
 */
import { useEffect, useState } from 'react';
import { planTasksApi, PlanAIDraftResult, PlanTaskGroup } from '../../lib/api';

type QA = { question: string; answer: string };
type Stage = 'goal' | 'asking' | 'drafting' | 'review' | 'saving' | 'error';

interface Props {
  groups: PlanTaskGroup[];
  onCreated: () => void;
  onClose: () => void;
}

export default function AITaskWizard({ groups, onCreated, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('goal');
  const [goal, setGoal] = useState('');
  const [pairs, setPairs] = useState<QA[]>([]);
  const [currentQ, setCurrentQ] = useState('');
  const [currentA, setCurrentA] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<PlanAIDraftResult | null>(null);
  const [editedSubtasks, setEditedSubtasks] = useState<string[]>([]);
  const [groupId, setGroupId] = useState<string>('');
  const [reminderOn, setReminderOn] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function startInterview() {
    if (goal.trim().length < 3) { setError('Type a goal first.'); return; }
    setError(null);
    await fetchNextQuestion([]);
  }

  async function fetchNextQuestion(answers: QA[]) {
    setLoading(true); setError(null);
    try {
      const { data } = await planTasksApi.aiNextQuestion({ goal, answers });
      if (data.done || !data.question) {
        await fetchDraft(answers);
      } else {
        setCurrentQ(data.question); setCurrentA(''); setStage('asking');
      }
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'AI unavailable.');
      setStage('error');
    } finally { setLoading(false); }
  }

  async function fetchDraft(answers: QA[]) {
    setStage('drafting'); setLoading(true); setError(null);
    try {
      const { data } = await planTasksApi.aiDraft({ goal, answers });
      setDraft(data);
      setEditedSubtasks(data.subtasks);
      setStage('review');
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'AI unavailable.');
      setStage('error');
    } finally { setLoading(false); }
  }

  function submitAnswer() {
    if (!currentA.trim()) return;
    const next = [...pairs, { question: currentQ, answer: currentA.trim() }];
    setPairs(next);
    void fetchNextQuestion(next);
  }
  function finishEarly() {
    const next = currentA.trim()
      ? [...pairs, { question: currentQ, answer: currentA.trim() }]
      : pairs;
    if (next.length === 0) { setError('Answer at least one question before drafting.'); return; }
    setPairs(next);
    void fetchDraft(next);
  }

  async function saveTask() {
    if (!draft) return;
    setStage('saving'); setError(null);
    try {
      // 1. Create task
      const t = await planTasksApi.createTask({
        title: draft.title,
        category: draft.category,
        priority: draft.priority,
        due_date: draft.due_date,
        notes: draft.notes,
        group_id: groupId || null,
      });
      const taskId = t.data.id;

      // 2. Create subtasks
      for (const st of editedSubtasks.filter(s => s.trim())) {
        await planTasksApi.addSubtask(taskId, { title: st.trim() });
      }

      // 3. Create reminder if enabled + there's a due date + suggested days
      if (reminderOn && draft.due_date && draft.suggested_reminder_days != null) {
        const due = new Date(draft.due_date + 'T09:00:00');
        due.setDate(due.getDate() - draft.suggested_reminder_days);
        await planTasksApi.addReminder(taskId, {
          remind_at: due.toISOString(),
          message: `Reminder: ${draft.title} due ${draft.due_date}`,
        });
      }

      onCreated();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Save failed.');
      setStage('review');
    }
  }

  // Focus the answer field when a new question arrives
  useEffect(() => {
    if (stage === 'asking' && currentQ) {
      const t = document.getElementById('ai-task-answer-input');
      if (t) (t as HTMLTextAreaElement).focus();
    }
  }, [stage, currentQ]);

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 22 }}>✦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>AI Task Wizard</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {stage === 'goal' && 'What are you trying to get done?'}
              {stage === 'asking' && 'Answer a few questions — skip to manual anytime.'}
              {stage === 'drafting' && 'Drafting your task…'}
              {stage === 'review' && 'Review + edit before saving.'}
              {stage === 'saving' && 'Saving task and subtasks…'}
              {stage === 'error' && 'Something went wrong.'}
            </div>
          </div>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>

        {error && (
          <div style={errBox}>
            {error}
          </div>
        )}

        {/* Stage 1: goal */}
        {stage === 'goal' && (
          <>
            <label style={lbl}>Goal</label>
            <textarea
              autoFocus
              style={{ ...field, minHeight: 80, resize: 'vertical' }}
              value={goal}
              onChange={e => setGoal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void startInterview(); }}
              placeholder="e.g. Set up workers' comp insurance for new staff by end of May"
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <button onClick={onClose} style={ghostBtn}>Cancel</button>
              <button onClick={() => void startInterview()} disabled={!goal.trim() || loading} style={primaryBtn}>
                {loading ? 'Thinking…' : 'Start ✦'}
              </button>
            </div>
          </>
        )}

        {/* Stage 2: Q&A */}
        {stage === 'asking' && (
          <>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>
              Question {pairs.length + 1} · {pairs.length === 0 ? 'just starting' : `${pairs.length} answered`}
            </div>
            <div style={{ padding: 14, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>AI asks</div>
              <div style={{ fontSize: 14, color: '#1e293b' }}>{loading ? 'Thinking…' : currentQ}</div>
            </div>
            <textarea
              id="ai-task-answer-input"
              style={{ ...field, minHeight: 80, resize: 'vertical' }}
              value={currentA}
              onChange={e => setCurrentA(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitAnswer(); }}
              placeholder="Your answer…"
              disabled={loading}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <button onClick={onClose} style={ghostBtn}>Skip to manual</button>
              <div style={{ display: 'flex', gap: 8 }}>
                {pairs.length >= 2 && (
                  <button onClick={finishEarly} style={ghostBtn} disabled={loading} title="Draft now with the answers I've given">Draft now</button>
                )}
                <button onClick={submitAnswer} disabled={!currentA.trim() || loading} style={primaryBtn}>Next →</button>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
              Tip: Ctrl+Enter to submit. AI stops asking once it has enough.
            </div>
          </>
        )}

        {/* Stage 3: drafting */}
        {stage === 'drafting' && (
          <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>
            Generating task with subtasks…
          </div>
        )}

        {/* Stage 4: review */}
        {stage === 'review' && draft && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Title</label>
                <input style={field} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
              </div>
              <div>
                <label style={lbl}>Category</label>
                <input style={field} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} />
              </div>
              <div>
                <label style={lbl}>Priority</label>
                <select style={field} value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as PlanAIDraftResult['priority'] })}>
                  <option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Due date</label>
                <input type="date" style={field} value={draft.due_date ?? ''} onChange={e => setDraft({ ...draft, due_date: e.target.value || null })} />
              </div>
              <div>
                <label style={lbl}>Group</label>
                <select style={field} value={groupId} onChange={e => setGroupId(e.target.value)}>
                  <option value="">— No group —</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Notes</label>
                <textarea style={{ ...field, minHeight: 60, resize: 'vertical' }} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Subtasks ({editedSubtasks.length})</label>
                {editedSubtasks.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                    <input style={{ ...field, flex: 1 }} value={s} onChange={e => {
                      const next = [...editedSubtasks]; next[i] = e.target.value; setEditedSubtasks(next);
                    }} />
                    <button onClick={() => setEditedSubtasks(editedSubtasks.filter((_, j) => j !== i))} style={{ ...ghostBtn, color: '#c62828' }}>×</button>
                  </div>
                ))}
                <button onClick={() => setEditedSubtasks([...editedSubtasks, ''])} style={{ ...ghostBtn, marginTop: 4 }}>+ Add step</button>
              </div>
              {draft.due_date && draft.suggested_reminder_days != null && (
                <label style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#475569', cursor: 'pointer', padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                  <input type="checkbox" checked={reminderOn} onChange={e => setReminderOn(e.target.checked)} />
                  Create a reminder {draft.suggested_reminder_days} day{draft.suggested_reminder_days !== 1 ? 's' : ''} before due date
                </label>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
              <button onClick={() => void fetchDraft(pairs)} style={ghostBtn} disabled={loading}>Regenerate</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onClose} style={ghostBtn}>Discard</button>
                <button onClick={() => void saveTask()} style={primaryBtn} disabled={!draft.title.trim()}>
                  Create task
                </button>
              </div>
            </div>
          </>
        )}

        {stage === 'saving' && (
          <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>Saving…</div>
        )}

        {stage === 'error' && (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ color: '#c62828', marginBottom: 10 }}>{error}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setStage('goal')} style={ghostBtn}>Start over</button>
              <button onClick={onClose} style={ghostBtn}>Skip to manual</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const card: React.CSSProperties = { background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
const field: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit', color: '#1e293b' };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
const primaryBtn: React.CSSProperties = { padding: '9px 18px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '7px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer' };
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: 'pointer' };
const errBox: React.CSSProperties = { padding: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, fontSize: 12, marginBottom: 10 };
