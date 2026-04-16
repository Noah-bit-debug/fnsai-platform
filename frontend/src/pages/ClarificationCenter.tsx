import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ClarificationQuestion {
  id: string;
  question: string;
  why_asked?: string;
  context: 'workflow' | 'document' | 'reminder' | 'suggestion';
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'answered' | 'dismissed';
  answer?: string;
  answered_by?: string;
  answered_at?: string;
  dismissed_at?: string;
  dismissed_by?: string;
  created_at: string;
}

type TabType = 'pending' | 'answered' | 'dismissed' | 'all';

// ─── Constants ────────────────────────────────────────────────────────────────
const PRIORITY_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  high:   { label: 'High',   color: '#991b1b', bg: '#fee2e2', dot: '#ef4444' },
  medium: { label: 'Medium', color: '#854d0e', bg: '#fef9c3', dot: '#f59e0b' },
  low:    { label: 'Low',    color: '#374151', bg: '#f1f5f9', dot: '#94a3b8' },
};

const CONTEXT_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  workflow:   { label: 'Workflow',   color: '#1d4ed8', bg: '#eff6ff', icon: '⚙️'  },
  document:   { label: 'Document',   color: '#166534', bg: '#dcfce7', icon: '📄'  },
  reminder:   { label: 'Reminder',   color: '#7c3aed', bg: '#f3e8ff', icon: '🔔'  },
  suggestion: { label: 'Suggestion', color: '#0e7490', bg: '#ecfeff', icon: '💡'  },
};

const TABS: { value: TabType; label: string }[] = [
  { value: 'pending',   label: 'Pending'   },
  { value: 'answered',  label: 'Answered'  },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'all',       label: 'All'       },
];

const CONTEXT_OPTIONS = ['workflow', 'document', 'reminder', 'suggestion'] as const;

type SortKey = 'priority' | 'created_at';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function inp(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%', padding: '9px 14px', border: '1px solid #e8edf2',
    borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c',
    boxSizing: 'border-box', background: '#fff', ...extra,
  };
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 2000,
      background: type === 'success' ? '#166534' : '#991b1b',
      color: '#fff', borderRadius: 10, padding: '12px 20px',
      fontSize: 14, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', gap: 10, maxWidth: 380,
    }}>
      <span>{type === 'success' ? '✅' : '❌'}</span>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
    </div>
  );
}

// ─── Generate Questions Modal ─────────────────────────────────────────────────
function GenerateQuestionsModal({ onClose, onGenerated }: { onClose: () => void; onGenerated: () => void }) {
  const [form, setForm] = useState({ context: 'workflow' as typeof CONTEXT_OPTIONS[number], context_data: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleGenerate = async () => {
    if (!form.context_data.trim()) { setErr('Context data is required.'); return; }
    setSaving(true);
    setErr(null);
    try {
      await api.post('/clarification/generate', { context: form.context, context_data: form.context_data.trim() });
      onGenerated();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to generate questions.');
    } finally {
      setSaving(false);
    }
  };

  const ctxMeta = CONTEXT_META[form.context];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>Generate Clarification Questions</div>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>
          AI will analyze the context you provide and generate targeted clarification questions.
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Context Type</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {CONTEXT_OPTIONS.map((c) => {
              const m = CONTEXT_META[c];
              const active = form.context === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, context: c }))}
                  style={{
                    border: `1px solid ${active ? m.color : '#e8edf2'}`,
                    borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                    background: active ? m.bg : '#f8fafc',
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 20 }}>{m.icon}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: active ? m.color : '#374151' }}>{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Preview */}
        <div style={{ background: ctxMeta.bg, border: `1px solid ${ctxMeta.color}30`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{ctxMeta.icon}</span>
          <div style={{ fontSize: 13, color: ctxMeta.color, fontWeight: 600 }}>
            Generating questions for: {ctxMeta.label} context
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
            Context Data *
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>Describe the situation in detail</span>
          </label>
          <textarea
            style={{ ...inp(), height: 110, resize: 'vertical' }}
            value={form.context_data}
            onChange={set('context_data')}
            placeholder={form.context === 'workflow'
              ? 'e.g. We are trying to onboard 3 new ICU nurses but they are missing their BLS certifications...'
              : form.context === 'document'
              ? 'e.g. Staff member Jane Doe submitted an employment application with inconsistent employment dates...'
              : form.context === 'reminder'
              ? 'e.g. A reminder was scheduled for credential expiry but we are not sure which credentials to prioritize...'
              : 'e.g. The AI suggested filling the open shift with a per-diem worker but we need more info...'
            }
          />
        </div>

        {err && <div style={{ color: '#991b1b', fontSize: 13, marginBottom: 12, background: '#fee2e2', borderRadius: 8, padding: '8px 12px' }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={handleGenerate} disabled={saving} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
            {saving ? '⏳ Generating...' : '🤖 Generate Questions'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Question Card ────────────────────────────────────────────────────────────
function QuestionCard({
  question,
  onAnswer,
  onDismiss,
}: {
  question: ClarificationQuestion;
  onAnswer: (id: string, answer: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [answerText, setAnswerText] = useState('');
  const [whyOpen, setWhyOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const pm = PRIORITY_META[question.priority] ?? PRIORITY_META.low;
  const cm = CONTEXT_META[question.context]   ?? CONTEXT_META.workflow;

  const handleSubmit = async () => {
    if (!answerText.trim()) return;
    setSubmitting(true);
    await onAnswer(question.id, answerText.trim());
    setSubmitting(false);
  };

  return (
    <div style={{
      background: '#fff', borderRadius: 14, border: '1px solid #e8edf2',
      overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      borderLeft: `4px solid ${pm.dot}`,
    }}>
      <div style={{ padding: '18px 20px' }}>
        {/* Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {/* Priority */}
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: pm.bg, color: pm.color, borderRadius: 8, padding: '3px 10px',
            fontSize: 12, fontWeight: 700,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: pm.dot, display: 'inline-block' }} />
            {pm.label} Priority
          </span>
          {/* Context */}
          <span style={{ background: cm.bg, color: cm.color, borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
            {cm.icon} {cm.label}
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
            {fmtDate(question.created_at)}
          </span>
        </div>

        {/* Question text */}
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', lineHeight: 1.5, marginBottom: 10 }}>
          {question.question}
        </div>

        {/* Why asked — collapsible */}
        {question.why_asked && (
          <div style={{ marginBottom: 14 }}>
            <button
              onClick={() => setWhyOpen((v) => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#64748b', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: whyOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
              Why was this asked?
            </button>
            {whyOpen && (
              <div style={{ marginTop: 8, background: '#f8fafc', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                {question.why_asked}
              </div>
            )}
          </div>
        )}

        {/* Pending: answer + dismiss */}
        {question.status === 'pending' && (
          <div style={{ marginTop: 8 }}>
            <textarea
              style={{ ...inp(), height: 80, resize: 'vertical', marginBottom: 10 }}
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              placeholder="Type your answer here..."
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSubmit}
                disabled={submitting || !answerText.trim()}
                style={{
                  background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8,
                  padding: '8px 18px', cursor: (submitting || !answerText.trim()) ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: 13, opacity: (submitting || !answerText.trim()) ? 0.6 : 1,
                  transition: 'opacity 0.2s',
                }}
              >
                {submitting ? 'Submitting...' : '✅ Submit Answer'}
              </button>
              <button
                onClick={() => onDismiss(question.id)}
                style={{ background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Answered */}
        {question.status === 'answered' && question.answer && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px', marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
              ✅ Answer
            </div>
            <div style={{ fontSize: 14, color: '#1a2b3c', lineHeight: 1.6 }}>{question.answer}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>
              Answered{question.answered_by ? ` by ${question.answered_by}` : ''} · {fmtDate(question.answered_at)}
            </div>
          </div>
        )}

        {/* Dismissed */}
        {question.status === 'dismissed' && (
          <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 10, padding: '10px 14px', marginTop: 4 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
              Dismissed {question.dismissed_at ? `on ${fmtDate(question.dismissed_at)}` : ''}
              {question.dismissed_by ? ` by ${question.dismissed_by}` : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ tab }: { tab: TabType }) {
  const msgs: Record<TabType, { icon: string; title: string; body: string }> = {
    pending:   { icon: '✅', title: 'All caught up!',         body: 'No pending questions right now. Check back later or generate new ones.' },
    answered:  { icon: '💬', title: 'No answered questions',  body: 'Questions you answer will appear here for reference.' },
    dismissed: { icon: '🗑️',  title: 'Nothing dismissed',     body: 'Questions you dismiss will appear here.' },
    all:       { icon: '❓', title: 'No questions yet',       body: 'Generate clarification questions to see them here.' },
  };
  const m = msgs[tab];
  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', padding: '56px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 44, marginBottom: 14 }}>{m.icon}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>{m.title}</div>
      <p style={{ fontSize: 14, color: '#64748b', maxWidth: 360, margin: '0 auto' }}>{m.body}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ClarificationCenter() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [sortBy, setSortBy] = useState<SortKey>('priority');
  const [showGenerate, setShowGenerate] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['clarification-questions'],
    queryFn: () => api.get<{ questions: ClarificationQuestion[] }>('/clarification/questions'),
    refetchInterval: 20000,
  });

  const questions: ClarificationQuestion[] = data?.data?.questions ?? [];
  const pendingCount = questions.filter((q) => q.status === 'pending').length;

  // Optimistic answer mutation
  const answerMutation = useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: string }) =>
      api.post(`/clarification/questions/${id}/answer`, { answer }),
    onMutate: async ({ id, answer }) => {
      await queryClient.cancelQueries({ queryKey: ['clarification-questions'] });
      const prev = queryClient.getQueryData(['clarification-questions']);
      queryClient.setQueryData(['clarification-questions'], (old: any) => {
        if (!old?.data?.questions) return old;
        return {
          ...old,
          data: {
            ...old.data,
            questions: old.data.questions.map((q: ClarificationQuestion) =>
              q.id === id
                ? { ...q, status: 'answered', answer, answered_at: new Date().toISOString() }
                : q
            ),
          },
        };
      });
      return { prev };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clarification-questions'] });
      showToast('Answer submitted successfully.');
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['clarification-questions'], ctx.prev);
      showToast(e?.response?.data?.error ?? 'Failed to submit answer.', 'error');
    },
  });

  // Optimistic dismiss mutation
  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.post(`/clarification/questions/${id}/dismiss`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['clarification-questions'] });
      const prev = queryClient.getQueryData(['clarification-questions']);
      queryClient.setQueryData(['clarification-questions'], (old: any) => {
        if (!old?.data?.questions) return old;
        return {
          ...old,
          data: {
            ...old.data,
            questions: old.data.questions.map((q: ClarificationQuestion) =>
              q.id === id
                ? { ...q, status: 'dismissed', dismissed_at: new Date().toISOString() }
                : q
            ),
          },
        };
      });
      return { prev };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clarification-questions'] });
      showToast('Question dismissed.');
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['clarification-questions'], ctx.prev);
      showToast(e?.response?.data?.error ?? 'Failed to dismiss.', 'error');
    },
  });

  // Filter + sort
  const filtered = questions
    .filter((q) => activeTab === 'all' ? true : q.status === activeTab)
    .sort((a, b) => {
      if (sortBy === 'priority') {
        const diff = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
        if (diff !== 0) return diff;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const tabCounts: Record<TabType, number> = {
    pending:   questions.filter((q) => q.status === 'pending').length,
    answered:  questions.filter((q) => q.status === 'answered').length,
    dismissed: questions.filter((q) => q.status === 'dismissed').length,
    all:       questions.length,
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>❓ Clarification Center</h1>
                {pendingCount > 0 && (
                  <span style={{
                    background: '#ef4444', color: '#fff', borderRadius: 12, padding: '2px 10px',
                    fontSize: 13, fontWeight: 700, lineHeight: 1.4,
                  }}>
                    {pendingCount}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>Review and answer AI-generated clarification questions</p>
            </div>
          </div>
          <button
            onClick={() => setShowGenerate(true)}
            style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
          >
            🤖 Generate Questions
          </button>
        </div>
      </div>

      {/* Tabs + sort */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e8edf2' }}>
          {/* Tab buttons */}
          <div style={{ display: 'flex', flex: 1 }}>
            {TABS.map((tab) => {
              const count = tabCounts[tab.value];
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  style={{
                    padding: '12px 20px', border: 'none', cursor: 'pointer', fontSize: 14,
                    fontWeight: activeTab === tab.value ? 700 : 500,
                    color: activeTab === tab.value ? '#1565c0' : '#64748b',
                    background: activeTab === tab.value ? '#eff6ff' : 'transparent',
                    borderBottom: activeTab === tab.value ? '2px solid #1565c0' : '2px solid transparent',
                    display: 'flex', alignItems: 'center', gap: 7,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                  {count > 0 && (
                    <span style={{
                      background: tab.value === 'pending' && count > 0 ? '#ef4444' : activeTab === tab.value ? '#1565c0' : '#e8edf2',
                      color: (tab.value === 'pending' && count > 0) || activeTab === tab.value ? '#fff' : '#374151',
                      borderRadius: 12, padding: '0px 7px', fontSize: 11, fontWeight: 700,
                    }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Sort control */}
          <div style={{ padding: '8px 16px', borderLeft: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              style={{ border: '1px solid #e8edf2', borderRadius: 7, padding: '4px 10px', fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer', outline: 'none' }}
            >
              <option value="priority">Priority</option>
              <option value="created_at">Date Created</option>
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <div style={{ fontSize: 14, color: '#64748b' }}>Loading questions...</div>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState tab={activeTab} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filtered.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              onAnswer={(id, answer) => answerMutation.mutate({ id, answer })}
              onDismiss={(id) => dismissMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Summary line */}
      {!isLoading && filtered.length > 0 && (
        <div style={{ fontSize: 13, color: '#64748b', textAlign: 'right', marginTop: 12 }}>
          {filtered.length} question{filtered.length !== 1 ? 's' : ''}
        </div>
      )}

      {showGenerate && (
        <GenerateQuestionsModal
          onClose={() => setShowGenerate(false)}
          onGenerated={() => queryClient.invalidateQueries({ queryKey: ['clarification-questions'] })}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
