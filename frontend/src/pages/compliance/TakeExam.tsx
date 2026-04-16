import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExamAnswer {
  id: string;
  answer_text: string;
}

interface ExamQuestion {
  id: string;
  question_text: string;
  question_type: 'multiple_choice' | 'true_false';
  sort_order: number;
  answers: ExamAnswer[];
}

interface Exam {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  passing_score: number;
  max_attempts: number;
  time_limit_minutes: number | null;
  ceus: number;
}

interface Attempt {
  id: string;
  attempt_number: number;
  score: number | null;
  passed: boolean | null;
  status: string;
  submitted_at: string | null;
  created_at: string;
}

interface CurrentAttempt {
  attempt_id: string;
  attempt_number: number;
  attempts_remaining: number;
  questions: ExamQuestion[];
}

interface Result {
  score: number;
  passed: boolean;
  attempt_number: number;
  attempts_used: number;
  attempts_remaining: number;
  passing_score: number;
  message: string;
}

type Phase = 'loading' | 'info' | 'taking' | 'result';

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TakeExam() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('loading');
  const [exam, setExam] = useState<Exam | null>(null);
  const [myAttempts, setMyAttempts] = useState<Attempt[]>([]);
  const [currentAttempt, setCurrentAttempt] = useState<CurrentAttempt | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitWarning, setSubmitWarning] = useState('');

  // ─── Data fetch on mount ────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    loadExam();
  }, [id]);

  async function loadExam() {
    setPhase('loading');
    setError('');
    try {
      const [examRes, attemptsRes] = await Promise.all([
        api.get(`/compliance/exams/${id}`),
        api.get(`/compliance/exams/${id}/attempts`),
      ]);
      setExam(examRes.data?.exam ?? examRes.data);
      setMyAttempts(attemptsRes.data?.attempts ?? []);
      setPhase('info');
    } catch {
      setError('Failed to load exam. Please try again.');
      setPhase('info');
    }
  }

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const alreadyPassed = myAttempts.some(
    (a) => a.passed === true || a.status === 'passed',
  );
  const attemptsUsed = myAttempts.length;
  const attemptsRemaining =
    exam ? Math.max(0, exam.max_attempts - attemptsUsed) : 0;
  const passedAttempt = myAttempts.find((a) => a.passed === true || a.status === 'passed');

  // ─── Start exam ──────────────────────────────────────────────────────────────

  async function handleStart() {
    if (!id) return;
    setError('');
    try {
      const res = await api.post(`/compliance/exams/${id}/start`);
      const data = res.data;
      setCurrentAttempt({
        attempt_id: data.attempt_id,
        attempt_number: data.attempt_number,
        attempts_remaining: data.attempts_remaining,
        questions: data.questions ?? [],
      });
      setSelectedAnswers({});
      setPhase('taking');
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to start exam.');
    }
  }

  // ─── Select answer ──────────────────────────────────────────────────────────

  function selectAnswer(questionId: string, answerId: string) {
    setSelectedAnswers((prev) => ({ ...prev, [questionId]: answerId }));
    setSubmitWarning('');
  }

  // ─── Submit exam ─────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!currentAttempt || !id) return;
    const questions = currentAttempt.questions;
    const unanswered = questions.filter((q) => !selectedAnswers[q.id]);
    if (unanswered.length > 0) {
      setSubmitWarning(
        `Please answer all questions before submitting. ${unanswered.length} question${unanswered.length > 1 ? 's' : ''} unanswered.`,
      );
      return;
    }

    const confirmMsg = `Submit exam? This will use one of your ${currentAttempt.attempts_remaining + 1} allowed attempts.`;
    if (!window.confirm(confirmMsg)) return;

    setSubmitting(true);
    setError('');
    try {
      const answers = questions.map((q) => ({
        question_id: q.id,
        answer_id: selectedAnswers[q.id],
      }));
      const res = await api.post(`/compliance/exams/${id}/submit`, {
        attempt_id: currentAttempt.attempt_id,
        answers,
      });
      setResult(res.data);
      setPhase('result');
      // Refresh attempts in background
      api.get(`/compliance/exams/${id}/attempts`).then((r) => {
        setMyAttempts(r.data?.attempts ?? []);
      });
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to submit exam.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Progress ────────────────────────────────────────────────────────────────

  const totalQuestions = currentAttempt?.questions.length ?? 0;
  const answeredCount = Object.keys(selectedAnswers).length;
  const progressPct = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  // ─── Render: Loading ─────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748b', fontSize: 16 }}>Loading exam...</div>
      </div>
    );
  }

  // ─── Render: Info ────────────────────────────────────────────────────────────

  if (phase === 'info') {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 24px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {/* Back */}
          <Link
            to="/compliance/my"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#2563eb', textDecoration: 'none', fontSize: 14, marginBottom: 24 }}
          >
            ← My Compliance
          </Link>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', color: '#dc2626', marginBottom: 20, fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* Header card */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 28, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 32 }}>📝</span>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1e293b' }}>{exam?.title ?? 'Exam'}</h1>
            </div>
            {exam?.description && (
              <p style={{ margin: '0 0 16px 0', color: '#475569', fontSize: 15, lineHeight: 1.6 }}>{exam.description}</p>
            )}
            {exam?.instructions && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 16px', color: '#1e40af', fontSize: 14 }}>
                <strong>Instructions:</strong> {exam.instructions}
              </div>
            )}
          </div>

          {/* Info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Passing Score', value: exam ? `${exam.passing_score}%` : '—' },
              { label: 'Max Attempts', value: exam ? String(exam.max_attempts) : '—' },
              { label: 'Time Limit', value: exam?.time_limit_minutes ? `${exam.time_limit_minutes} min` : 'No limit' },
              { label: 'CEUs', value: exam ? (exam.ceus > 0 ? String(exam.ceus) : 'None') : '—' },
            ].map((item) => (
              <div
                key={item.label}
                style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 20px', textAlign: 'center' }}
              >
                <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b' }}>{item.value}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{item.label}</div>
              </div>
            ))}
          </div>

          {/* Past attempts */}
          {myAttempts.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24, marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 600, color: '#1e293b' }}>Past Attempts</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    {['Attempt #', 'Score', 'Status', 'Date'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#64748b', fontWeight: 600, fontSize: 13 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {myAttempts.map((a) => {
                    const passed = a.passed === true || a.status === 'passed';
                    return (
                      <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px', color: '#1e293b' }}>{a.attempt_number}</td>
                        <td style={{ padding: '10px 12px', color: '#1e293b' }}>
                          {a.score !== null ? `${a.score}%` : '—'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 600,
                            background: passed ? '#f0fdf4' : '#fef2f2',
                            color: passed ? '#16a34a' : '#dc2626',
                          }}>
                            {passed ? 'Passed' : 'Failed'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#64748b' }}>{formatDate(a.submitted_at ?? a.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Attempts indicator */}
          {exam && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#475569', fontSize: 14 }}>Attempts remaining</span>
              <span style={{ fontWeight: 700, fontSize: 16, color: attemptsRemaining > 0 ? '#1e293b' : '#dc2626' }}>
                {attemptsRemaining} of {exam.max_attempts}
              </span>
            </div>
          )}

          {/* Status messages */}
          {alreadyPassed && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '16px 20px', marginBottom: 20, color: '#15803d', fontSize: 14 }}>
              <strong>You have already passed this exam.</strong>
              {passedAttempt?.score !== null && passedAttempt?.score !== undefined && (
                <span> Your score: {passedAttempt.score}%</span>
              )}
            </div>
          )}

          {!alreadyPassed && attemptsRemaining === 0 && myAttempts.length > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '16px 20px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
              <strong>You have used all allowed attempts.</strong> Please contact your administrator.
            </div>
          )}

          {/* Start button */}
          <button
            onClick={handleStart}
            disabled={attemptsRemaining === 0}
            style={{
              width: '100%',
              padding: '14px 24px',
              borderRadius: 8,
              border: 'none',
              background: attemptsRemaining === 0 ? '#cbd5e1' : '#2563eb',
              color: '#fff',
              fontSize: 16,
              fontWeight: 600,
              cursor: attemptsRemaining === 0 ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            Begin Exam
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: Taking ──────────────────────────────────────────────────────────

  if (phase === 'taking' && currentAttempt) {
    const questions = currentAttempt.questions;

    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
        {/* Fixed top bar */}
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          <div>
            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 16 }}>{exam?.title}</div>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
              {answeredCount} of {totalQuestions} answered
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Progress bar */}
            <div style={{ width: 160, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${progressPct}%`, height: '100%', background: '#2563eb', borderRadius: 4, transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: 13, color: '#2563eb', fontWeight: 600, minWidth: 36 }}>{progressPct}%</span>
          </div>
        </div>

        {/* Questions list */}
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 24px 140px 24px' }}>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', color: '#dc2626', marginBottom: 20, fontSize: 14 }}>
              {error}
            </div>
          )}

          {questions.map((q, qIdx) => {
            const selected = selectedAnswers[q.id];
            return (
              <div
                key={q.id}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 24,
                  marginBottom: 20,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                }}
              >
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  <span style={{ fontWeight: 700, color: '#2563eb', fontSize: 15, flexShrink: 0 }}>Q{qIdx + 1}.</span>
                  <span style={{ fontSize: 15, color: '#1e293b', lineHeight: 1.6, fontWeight: 500 }}>{q.question_text}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {q.answers.map((ans) => {
                    const isSelected = selected === ans.id;
                    return (
                      <div
                        key={ans.id}
                        onClick={() => selectAnswer(q.id, ans.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '12px 16px',
                          borderRadius: 8,
                          border: isSelected ? '2px solid #2563eb' : '2px solid #e2e8f0',
                          background: isSelected ? '#eff6ff' : '#fff',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          userSelect: 'none',
                        }}
                      >
                        {/* Custom radio circle */}
                        <div style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border: isSelected ? '6px solid #2563eb' : '2px solid #cbd5e1',
                          background: '#fff',
                          flexShrink: 0,
                          transition: 'all 0.15s',
                        }} />
                        <span style={{ fontSize: 14, color: isSelected ? '#1e40af' : '#374151', fontWeight: isSelected ? 500 : 400 }}>
                          {ans.answer_text}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Sticky bottom bar */}
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#fff',
          borderTop: '1px solid #e2e8f0',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
          zIndex: 100,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {totalQuestions - answeredCount > 0 ? (
              <span style={{ color: '#f59e0b', fontSize: 14, fontWeight: 500 }}>
                {totalQuestions - answeredCount} question{totalQuestions - answeredCount > 1 ? 's' : ''} unanswered
              </span>
            ) : (
              <span style={{ color: '#16a34a', fontSize: 14, fontWeight: 500 }}>All questions answered</span>
            )}
            {submitWarning && (
              <span style={{ color: '#dc2626', fontSize: 13 }}>{submitWarning}</span>
            )}
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '12px 28px',
              borderRadius: 8,
              border: 'none',
              background: submitting ? '#93c5fd' : '#2563eb',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting...' : 'Submit Exam'}
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: Result ──────────────────────────────────────────────────────────

  if (phase === 'result' && result) {
    const passed = result.passed;
    const circleColor = passed ? '#16a34a' : '#dc2626';
    const circleBg = passed ? '#f0fdf4' : '#fef2f2';

    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '48px 24px' }}>
        <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
          {/* Score circle */}
          <div style={{
            width: 140,
            height: 140,
            borderRadius: '50%',
            background: circleBg,
            border: `6px solid ${circleColor}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px auto',
          }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: circleColor }}>{result.score}%</span>
          </div>

          {/* Heading */}
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: '0 0 8px 0' }}>
            {passed ? '🎉 Passed!' : 'Not Passed'}
          </h1>

          {/* Result box */}
          <div style={{
            background: passed ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${passed ? '#86efac' : '#fca5a5'}`,
            borderRadius: 10,
            padding: '16px 20px',
            marginBottom: 24,
            color: passed ? '#15803d' : '#dc2626',
            fontSize: 15,
          }}>
            {result.message || (passed
              ? `Congratulations! You scored ${result.score}% and passed with a passing score of ${result.passing_score}%.`
              : `You scored ${result.score}%. The passing score is ${result.passing_score}%.`)}
          </div>

          {/* Details */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', marginBottom: 28 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[
                { label: 'Attempt #', value: String(result.attempt_number) },
                { label: 'Attempts Remaining', value: String(result.attempts_remaining) },
                { label: 'Score', value: `${result.score}%` },
                { label: 'Passing Score', value: `${result.passing_score}%` },
              ].map((item) => (
                <div key={item.label} style={{ textAlign: 'center', padding: '12px 8px', background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>{item.value}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          {passed && (
            <button
              onClick={() => navigate('/compliance/my')}
              style={{ padding: '13px 32px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}
            >
              View My Compliance
            </button>
          )}

          {!passed && result.attempts_remaining > 0 && (
            <button
              onClick={() => {
                setPhase('info');
                setResult(null);
                setCurrentAttempt(null);
                setSelectedAnswers({});
                loadExam();
              }}
              style={{ padding: '13px 32px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}
            >
              Try Again
            </button>
          )}

          {!passed && result.attempts_remaining === 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '16px 20px', color: '#dc2626', fontSize: 14, fontWeight: 500 }}>
              You have used all allowed attempts. Please contact your administrator.
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
