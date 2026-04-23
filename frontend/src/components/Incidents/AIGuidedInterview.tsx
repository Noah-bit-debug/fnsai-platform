/**
 * Phase 4.1 — AI-Guided Incident Interview
 *
 * A modal that walks the user through 4-6 targeted questions about an
 * incident, then asks Claude to produce a clean narrative the user can
 * paste into the Description field on the Incidents form.
 *
 * Design rules (per the Phase 4 notes):
 *   - "AI asks questions to guide user"           → one-at-a-time Q&A loop
 *   - "Allow switching to manual editing"         → "Skip to manual" on every step
 *   - "Manual editing always available"           → the textarea on the parent
 *                                                   form is never disabled; this
 *                                                   modal only writes to it when
 *                                                   the user explicitly accepts
 *                                                   the draft.
 *
 * State machine:
 *   idle → asking → answering → asking → …  → drafting → review → done
 *
 * At every step the user can press "Skip to manual" which closes the
 * modal without touching the description. The existing form continues
 * to work as it did before.
 */
import { useEffect, useState } from 'react';
import { incidentsApi } from '../../lib/api';

type QAPair = { question: string; answer: string };
type Stage = 'asking' | 'drafting' | 'review' | 'error';

interface Props {
  /** Incident type (workplace injury, patient complaint, …) selected on the parent form. */
  type: string;
  /** Optional — passed in for context so the AI can use names in the narrative. */
  staffName?: string | null;
  facilityName?: string | null;
  date?: string | null;
  /** Invoked when the user accepts the AI's generated description. The parent
   *  pastes it into the textarea — the user can still edit it freely after. */
  onAccept: (description: string) => void;
  /** Close the modal without writing anything. */
  onClose: () => void;
}

export default function AIGuidedInterview({ type, staffName, facilityName, date, onAccept, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('asking');
  const [pairs, setPairs] = useState<QAPair[]>([]);
  const [currentQ, setCurrentQ] = useState<string>('');
  const [currentA, setCurrentA] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Kick off by asking for the first question.
  useEffect(() => {
    void fetchNextQuestion([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchNextQuestion(answers: QAPair[]) {
    setLoading(true);
    setError(null);
    try {
      const { data } = await incidentsApi.aiNextQuestion({
        type,
        staff_name: staffName ?? null,
        facility_name: facilityName ?? null,
        answers,
      });
      if (data.done || !data.question) {
        // No more questions — generate the narrative.
        await fetchDraft(answers);
      } else {
        setCurrentQ(data.question);
        setCurrentA('');
        setStage('asking');
      }
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'AI is unavailable.');
      setStage('error');
    } finally {
      setLoading(false);
    }
  }

  async function fetchDraft(answers: QAPair[]) {
    setStage('drafting');
    setLoading(true);
    setError(null);
    try {
      const { data } = await incidentsApi.aiDraft({
        type,
        staff_name: staffName ?? null,
        facility_name: facilityName ?? null,
        date: date ?? null,
        answers,
      });
      setDraft(data.description);
      setStage('review');
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'AI is unavailable.');
      setStage('error');
    } finally {
      setLoading(false);
    }
  }

  function submitAnswer() {
    if (!currentA.trim()) return;
    const next: QAPair[] = [...pairs, { question: currentQ, answer: currentA.trim() }];
    setPairs(next);
    void fetchNextQuestion(next);
  }

  function finishEarly() {
    // "I've said enough" — skip asking, go straight to draft with what we have.
    if (pairs.length === 0 && currentA.trim()) {
      const next = [...pairs, { question: currentQ, answer: currentA.trim() }];
      setPairs(next);
      void fetchDraft(next);
      return;
    }
    if (pairs.length === 0) return; // not enough info yet
    void fetchDraft(pairs);
  }

  const modalStyle: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20,
  };
  const cardStyle: React.CSSProperties = {
    background: '#fff', borderRadius: 14, padding: 24, width: '100%',
    maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    display: 'flex', flexDirection: 'column', gap: 16,
  };
  const primaryBtn: React.CSSProperties = {
    padding: '9px 18px', background: '#6a1b9a', color: '#fff',
    border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13,
    cursor: 'pointer',
  };
  const ghostBtn: React.CSSProperties = {
    padding: '9px 16px', background: '#f1f5f9', color: '#475569',
    border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600,
    fontSize: 13, cursor: 'pointer',
  };

  return (
    <div style={modalStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={cardStyle}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>✦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>AI Guided Incident Report</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {stage === 'review'
                ? 'Review the draft below. You can edit it after pasting, or discard.'
                : 'Answer a few short questions. Skip to manual at any time.'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>

        {/* Progress strip */}
        {stage === 'asking' && (
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
            Question {pairs.length + 1} of up to 8 · {pairs.length === 0 ? 'just starting' : `${pairs.length} answered`}
          </div>
        )}

        {/* Error */}
        {stage === 'error' && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 12, borderRadius: 8, fontSize: 13 }}>
            <strong>AI failed:</strong> {error}
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button onClick={() => void fetchNextQuestion(pairs)} style={ghostBtn}>Retry</button>
              <button onClick={onClose} style={ghostBtn}>Skip to manual</button>
            </div>
          </div>
        )}

        {/* Asking */}
        {stage === 'asking' && (
          <>
            <div style={{ padding: '14px 16px', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', letterSpacing: 0.4, marginBottom: 6 }}>AI ASKS</div>
              <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 500 }}>
                {loading ? 'Thinking…' : currentQ}
              </div>
            </div>
            <textarea
              value={currentA}
              onChange={e => setCurrentA(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitAnswer(); }}
              placeholder="Type your answer here…"
              style={{
                width: '100%', minHeight: 90, padding: 12, border: '1.5px solid #e2e8f0',
                borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
              disabled={loading}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <button onClick={onClose} style={ghostBtn} disabled={loading}>
                ← Skip to manual
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {pairs.length >= 2 && (
                  <button
                    onClick={finishEarly}
                    style={ghostBtn}
                    disabled={loading}
                    title="Stop asking and draft the report with the answers I've given."
                  >
                    Draft now
                  </button>
                )}
                <button
                  onClick={submitAnswer}
                  style={{ ...primaryBtn, opacity: !currentA.trim() || loading ? 0.5 : 1 }}
                  disabled={!currentA.trim() || loading}
                >
                  Next →
                </button>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Tip: Ctrl+Enter to submit. The AI will stop asking on its own once it has enough facts.
            </div>
          </>
        )}

        {/* Drafting */}
        {stage === 'drafting' && (
          <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
            Generating report draft…
          </div>
        )}

        {/* Review */}
        {stage === 'review' && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', letterSpacing: 0.4 }}>
              AI-GENERATED DRAFT ({pairs.length} answer{pairs.length !== 1 ? 's' : ''} used)
            </div>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              style={{
                width: '100%', minHeight: 180, padding: 12, border: '1.5px solid #e2e8f0',
                borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit',
                boxSizing: 'border-box', lineHeight: 1.5,
              }}
            />
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              You can tweak it here, or edit it again after pasting into the form.
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button onClick={onClose} style={ghostBtn}>Discard</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => void fetchDraft(pairs)}
                  style={ghostBtn}
                  disabled={loading}
                  title="Ask the AI to try the narrative again."
                >
                  Regenerate
                </button>
                <button
                  onClick={() => { onAccept(draft); onClose(); }}
                  style={primaryBtn}
                  disabled={!draft.trim()}
                >
                  Use this description
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
