/**
 * AI Task Wizard for Recruiter Tasks.
 *
 * Mirrors the Action Plan AITaskWizard pattern (same UX: goal → 3-5
 * questions → reviewable draft → save), but uses the recruiter tasks
 * data shape (task_type enum, due_at timestamp, assigned_to,
 * candidate/job/client entity linking, reminder_minutes_before).
 *
 * The backend endpoints — /tasks/ai-next-question + /tasks/ai-draft —
 * live in backend/src/routes/recruiterTasks.ts and return a draft that
 * the user reviews + edits before hitting Save.
 */
import { useEffect, useState } from 'react';
import { tasksApi, usersApi, OrgUser, RecruiterTaskAIDraftResult } from '../../lib/api';

type QA = { question: string; answer: string };
type Stage = 'goal' | 'asking' | 'drafting' | 'review' | 'saving' | 'error';

interface Props {
  onCreated: () => void;
  onClose: () => void;
  /** Optional pre-filled goal — lets callers (e.g. AI Chat action buttons)
   *  skip past the goal screen. */
  initialGoal?: string;
}

const TASK_TYPES: Array<{ value: RecruiterTaskAIDraftResult['task_type']; label: string; emoji: string }> = [
  { value: 'call',       label: 'Call',       emoji: '📞' },
  { value: 'meeting',    label: 'Meeting',    emoji: '📅' },
  { value: 'email',      label: 'Email',      emoji: '📧' },
  { value: 'sms',        label: 'SMS',        emoji: '💬' },
  { value: 'follow_up',  label: 'Follow-up',  emoji: '🔄' },
  { value: 'todo',       label: 'To-do',      emoji: '📝' },
  { value: 'other',      label: 'Other',      emoji: '•'  },
];

function dateTimeLocalFromISO(iso: string | null): string {
  if (!iso) return '';
  // datetime-local needs "YYYY-MM-DDTHH:MM" (no Z, no seconds) in LOCAL time.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoFromDateTimeLocal(v: string): string | null {
  if (!v) return null;
  // datetime-local gives "YYYY-MM-DDTHH:MM" in the user's local tz; new Date()
  // interprets that as local time, then .toISOString() converts to UTC.
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function RecruiterTaskWizard({ onCreated, onClose, initialGoal }: Props) {
  const [stage, setStage] = useState<Stage>('goal');
  const [goal, setGoal] = useState(initialGoal ?? '');
  const [pairs, setPairs] = useState<QA[]>([]);
  const [currentQ, setCurrentQ] = useState('');
  const [currentA, setCurrentA] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<RecruiterTaskAIDraftResult | null>(null);
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load users once so the review screen can pick an assignee.
  useEffect(() => {
    void usersApi.list().then(r => setUsers(r.data.users)).catch(() => { /* silent */ });
  }, []);

  async function startInterview() {
    if (goal.trim().length < 3) { setError('Type a goal first.'); return; }
    setError(null);
    await fetchNextQuestion([]);
  }

  async function fetchNextQuestion(answers: QA[]) {
    setLoading(true); setError(null);
    try {
      const { data } = await tasksApi.aiNextQuestion({ goal, answers });
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
      const { data } = await tasksApi.aiDraft({ goal, answers });
      setDraft(data);
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
      await tasksApi.create({
        title: draft.title,
        description: draft.description,
        task_type: draft.task_type,
        due_at: draft.due_at,
        assigned_to: assignedTo || null,
        reminder_minutes_before: draft.reminder_minutes_before ?? undefined,
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Save failed.');
      setStage('review');
    }
  }

  // Focus the answer field when a new question arrives.
  useEffect(() => {
    if (stage === 'asking' && currentQ) {
      const t = document.getElementById('rec-task-answer-input');
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
              {stage === 'goal' && 'What recruiting task do you need to set up?'}
              {stage === 'asking' && 'Answer a few quick questions — skip to manual anytime.'}
              {stage === 'drafting' && 'Drafting your task…'}
              {stage === 'review' && 'Review + edit before saving.'}
              {stage === 'saving' && 'Saving task…'}
              {stage === 'error' && 'Something went wrong.'}
            </div>
          </div>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>

        {error && <div style={errBox}>{error}</div>}

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
              placeholder="e.g. Follow up with Sarah Chen after her phone screen tomorrow afternoon"
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
              id="rec-task-answer-input"
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
            Generating task draft…
          </div>
        )}

        {/* Stage 4: review */}
        {stage === 'review' && draft && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {/* Functional setDraft everywhere so in-flight re-renders
                  don't drop edits — same pattern as ActionPlan's wizard. */}
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Title</label>
                <input style={field} value={draft.title} onChange={e => setDraft(prev => prev ? ({ ...prev, title: e.target.value }) : prev)} />
              </div>
              <div>
                <label style={lbl}>Type</label>
                <select style={field} value={draft.task_type} onChange={e => setDraft(prev => prev ? ({ ...prev, task_type: e.target.value as RecruiterTaskAIDraftResult['task_type'] }) : prev)}>
                  {TASK_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={lbl}>Due</label>
                <input
                  type="datetime-local"
                  style={field}
                  value={dateTimeLocalFromISO(draft.due_at)}
                  onChange={e => setDraft(prev => prev ? ({ ...prev, due_at: isoFromDateTimeLocal(e.target.value) }) : prev)}
                />
              </div>
              <div>
                <label style={lbl}>Assign to</label>
                <select style={field} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={lbl}>Remind me</label>
                <select
                  style={field}
                  value={draft.reminder_minutes_before ?? ''}
                  onChange={e => setDraft(prev => prev ? ({ ...prev, reminder_minutes_before: e.target.value ? Number(e.target.value) : null }) : prev)}
                >
                  <option value="">None</option>
                  <option value="15">15 min before</option>
                  <option value="60">1 hour before</option>
                  <option value="1440">1 day before</option>
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Description</label>
                <textarea style={{ ...field, minHeight: 70, resize: 'vertical' }} value={draft.description} onChange={e => setDraft(prev => prev ? ({ ...prev, description: e.target.value }) : prev)} />
              </div>
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
