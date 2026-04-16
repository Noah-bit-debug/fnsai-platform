import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentsApi } from '../lib/api';

const SCOPE_OPTIONS = [
  { value: 'always', label: 'Always (becomes a rule)', desc: 'Apply this answer every time this situation occurs', color: 'var(--ac)' },
  { value: 'facility_specific', label: 'Facility-Specific', desc: 'Only applies to a particular facility', color: 'var(--pr)' },
  { value: 'staff_type', label: 'Staff Type Only', desc: 'Only for a specific staff role/type', color: 'var(--pu)' },
  { value: 'one_time', label: 'One-Time Exception', desc: 'Only for this specific document', color: 'var(--wn)' },
  { value: 'optional', label: 'Optional/Context-Dependent', desc: 'Depends on circumstances', color: 'var(--t3)' },
];

interface QAQuestion {
  id: string;
  question: string;
  context?: string;
  document_type?: string;
  document_name?: string;
  created_at: string;
}

export default function DocumentQA() {
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['document-qa-pending'],
    queryFn: () => documentsApi.pendingQA(),
    select: (r) => (r.data as { questions: QAQuestion[] }).questions,
  });

  const answerMutation = useMutation({
    mutationFn: ({ id, answer, scope }: { id: string; answer: string; scope: string }) =>
      documentsApi.answerQA(id, answer, scope),
    onSuccess: (_, vars) => {
      setSaved((prev) => new Set([...prev, vars.id]));
      void qc.invalidateQueries({ queryKey: ['document-qa-pending'] });
    },
  });

  const questions = data ?? [];

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>❓ Document Q&amp;A</h1>
            <p>
              AI asks these questions when it encounters uncertain fields during document review —
              your answers teach the AI
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {questions.length > 0 && (
              <span className="tp">{questions.length} pending questions</span>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-overlay"><div className="spinner" /></div>
      ) : !questions.length ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎓</div>
          <h3>No pending questions</h3>
          <p>
            When you upload documents and the AI has questions, they appear here.
            Run the Document Checker to generate questions.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {questions.map((q) => {
            const isSaved = saved.has(q.id);
            const scope = scopes[q.id] ?? 'always';

            return (
              <div key={q.id} className="pn" style={{ borderLeft: `3px solid var(--pu)`, opacity: isSaved ? 0.6 : 1 }}>
                <div className="pnb">
                  {/* Document info */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                    {q.document_type && <span className="tb">{q.document_type}</span>}
                    {q.document_name && (
                      <span style={{ fontSize: 11, color: 'var(--t3)' }}>📄 {q.document_name}</span>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 'auto' }}>
                      {new Date(q.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Question */}
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', marginBottom: 6 }}>
                    ❓ {q.question}
                  </div>
                  {q.context && (
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12, fontStyle: 'italic' }}>
                      Context: {q.context}
                    </div>
                  )}

                  {/* Answer input */}
                  <div className="form-group">
                    <label className="form-label">Your Answer</label>
                    <textarea
                      className="form-textarea"
                      rows={2}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                      placeholder="Type your answer here…"
                      disabled={isSaved}
                    />
                  </div>

                  {/* Scope selector */}
                  <div className="form-group">
                    <label className="form-label">How should AI use this answer?</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {SCOPE_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            padding: '8px 12px',
                            border: `1px solid ${scope === opt.value ? opt.color : 'var(--bd)'}`,
                            borderRadius: 8,
                            cursor: 'pointer',
                            background: scope === opt.value ? `${opt.color}10` : 'var(--sf)',
                            transition: 'all 0.15s',
                            maxWidth: 200,
                          }}
                        >
                          <input
                            type="radio"
                            name={`scope-${q.id}`}
                            value={opt.value}
                            checked={scope === opt.value}
                            onChange={() => setScopes({ ...scopes, [q.id]: opt.value })}
                            disabled={isSaved}
                            style={{ marginTop: 2 }}
                          />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: scope === opt.value ? opt.color : 'var(--t1)' }}>
                              {opt.label}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--t3)' }}>{opt.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {isSaved ? (
                    <div className="tg" style={{ padding: '8px 12px', display: 'inline-flex' }}>
                      ✓ Answer saved — AI has been updated
                    </div>
                  ) : (
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() =>
                        answerMutation.mutate({
                          id: q.id,
                          answer: answers[q.id] ?? '',
                          scope,
                        })
                      }
                      disabled={!answers[q.id]?.trim() || answerMutation.isPending}
                    >
                      {answerMutation.isPending ? 'Saving…' : '💾 Save Answer'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
