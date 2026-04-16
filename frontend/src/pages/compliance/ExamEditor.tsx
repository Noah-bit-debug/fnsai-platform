import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────

interface Answer {
  id?: string;
  answer_text: string;
  is_correct: boolean;
  sort_order: number;
}

interface Question {
  id?: string;
  question_text: string;
  question_type: 'multiple_choice' | 'true_false';
  sort_order: number;
  answers: Answer[];
  _editing?: boolean;
}

interface Category {
  id: string;
  level: number;
  name: string;
  parent_id: string | null;
}

interface ExamForm {
  title: string;
  description: string;
  instructions: string;
  passing_score: number;
  max_attempts: number;
  expiration_type: 'one_time' | 'yearly' | 'bi_annual';
  time_limit: string;
  ceus: string;
  question_count: number;
  randomize_questions: boolean;
  status: 'draft' | 'published' | 'archived';
  applicable_roles: string[];
  cat1_id: string;
  cat2_id: string;
  cat3_id: string;
}

// ─── Constants ────────────────────────────────────────────────

const ALL_ROLES = [
  'RN',
  'LVN/LPN',
  'CNA',
  'CMA',
  'Allied Health',
  'PCA/PCT',
  'Nursing Aide',
  'Non-Clinical',
];

const EMPTY_FORM: ExamForm = {
  title: '',
  description: '',
  instructions: '',
  passing_score: 80,
  max_attempts: 3,
  expiration_type: 'yearly',
  time_limit: '',
  ceus: '',
  question_count: 10,
  randomize_questions: true,
  status: 'draft',
  applicable_roles: [],
  cat1_id: '',
  cat2_id: '',
  cat3_id: '',
};

function emptyMultipleChoice(): Question {
  return {
    question_text: '',
    question_type: 'multiple_choice',
    sort_order: 0,
    answers: [
      { answer_text: '', is_correct: true,  sort_order: 0 },
      { answer_text: '', is_correct: false, sort_order: 1 },
      { answer_text: '', is_correct: false, sort_order: 2 },
      { answer_text: '', is_correct: false, sort_order: 3 },
    ],
  };
}

function emptyTrueFalse(): Question {
  return {
    question_text: '',
    question_type: 'true_false',
    sort_order: 0,
    answers: [
      { answer_text: 'True',  is_correct: true,  sort_order: 0 },
      { answer_text: 'False', is_correct: false, sort_order: 1 },
    ],
  };
}

// ─── Shared styles ────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 12px',
  fontSize: 14,
  border: '1px solid #e2e8f0',
  borderRadius: 7,
  color: '#1e293b',
  background: '#ffffff',
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

const sectionStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '24px 28px',
  marginBottom: 20,
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#374151',
  margin: '0 0 20px 0',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

// ─── QuestionForm sub-component ───────────────────────────────

interface QuestionFormProps {
  initial: Question;
  onSave: (q: Question) => void;
  onCancel: () => void;
}

function QuestionForm({ initial, onSave, onCancel }: QuestionFormProps) {
  const [q, setQ] = useState<Question>(() => ({
    ...initial,
    answers: initial.answers.map((a) => ({ ...a })),
  }));

  function setType(type: 'multiple_choice' | 'true_false') {
    if (type === 'true_false') {
      setQ((prev) => ({
        ...prev,
        question_type: 'true_false',
        answers: [
          { answer_text: 'True',  is_correct: true,  sort_order: 0 },
          { answer_text: 'False', is_correct: false, sort_order: 1 },
        ],
      }));
    } else {
      setQ((prev) => ({
        ...prev,
        question_type: 'multiple_choice',
        answers: [
          { answer_text: '', is_correct: true,  sort_order: 0 },
          { answer_text: '', is_correct: false, sort_order: 1 },
          { answer_text: '', is_correct: false, sort_order: 2 },
          { answer_text: '', is_correct: false, sort_order: 3 },
        ],
      }));
    }
  }

  function setCorrect(idx: number) {
    setQ((prev) => ({
      ...prev,
      answers: prev.answers.map((a, i) => ({ ...a, is_correct: i === idx })),
    }));
  }

  function setAnswerText(idx: number, text: string) {
    setQ((prev) => ({
      ...prev,
      answers: prev.answers.map((a, i) => (i === idx ? { ...a, answer_text: text } : a)),
    }));
  }

  function handleSave() {
    if (!q.question_text.trim()) {
      alert('Question text is required.');
      return;
    }
    if (q.question_type === 'multiple_choice') {
      const filled = q.answers.filter((a) => a.answer_text.trim());
      if (filled.length < 2) {
        alert('Please fill in at least 2 answer choices.');
        return;
      }
    }
    onSave({ ...q, _editing: false });
  }

  return (
    <div
      style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 9,
        padding: '18px 20px',
        marginTop: 12,
      }}
    >
      {/* Question text */}
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Question Text *</label>
        <textarea
          rows={3}
          value={q.question_text}
          onChange={(e) => setQ((prev) => ({ ...prev, question_text: e.target.value }))}
          placeholder="Enter the question…"
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
      </div>

      {/* Type */}
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Question Type</label>
        <select
          value={q.question_type}
          onChange={(e) => setType(e.target.value as 'multiple_choice' | 'true_false')}
          style={{ ...selectStyle, width: 'auto', minWidth: 200 }}
        >
          <option value="multiple_choice">Multiple Choice</option>
          <option value="true_false">True / False</option>
        </select>
      </div>

      {/* Answers */}
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>
          {q.question_type === 'true_false' ? 'Correct Answer' : 'Answer Choices (select the correct one)'}
        </label>

        {q.question_type === 'true_false' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {q.answers.map((ans, idx) => (
              <label
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  fontSize: 14,
                  color: '#1e293b',
                  padding: '8px 12px',
                  borderRadius: 7,
                  border: '1px solid #e2e8f0',
                  background: ans.is_correct ? '#eff6ff' : '#ffffff',
                }}
              >
                <input
                  type="radio"
                  name="tf_correct"
                  checked={ans.is_correct}
                  onChange={() => setCorrect(idx)}
                  style={{ accentColor: '#2563eb', cursor: 'pointer' }}
                />
                {ans.answer_text}
              </label>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {q.answers.map((ans, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 7,
                  border: '1px solid #e2e8f0',
                  background: ans.is_correct ? '#eff6ff' : '#ffffff',
                }}
              >
                <input
                  type="radio"
                  name="mc_correct"
                  checked={ans.is_correct}
                  onChange={() => setCorrect(idx)}
                  style={{ accentColor: '#2563eb', cursor: 'pointer', flexShrink: 0 }}
                />
                <input
                  type="text"
                  value={ans.answer_text}
                  onChange={(e) => setAnswerText(idx, e.target.value)}
                  placeholder={`Choice ${String.fromCharCode(65 + idx)}`}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: 13,
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    color: '#1e293b',
                    background: 'transparent',
                    outline: 'none',
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '7px 18px',
            fontSize: 13,
            color: '#475569',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 7,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          style={{
            padding: '7px 18px',
            fontSize: 13,
            fontWeight: 600,
            background: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: 7,
            cursor: 'pointer',
          }}
        >
          Save Question
        </button>
      </div>
    </div>
  );
}

// ─── QuestionCard sub-component ───────────────────────────────

interface QuestionCardProps {
  question: Question;
  index: number;
  examId: string | undefined;
  onUpdate: (q: Question) => void;
  onDelete: () => void;
}

function QuestionCard({ question, index, examId, onUpdate, onDelete }: QuestionCardProps) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm('Delete this question? This cannot be undone.')) return;

    // If exam exists in DB and question has an id, call the API
    if (examId && question.id) {
      setDeleting(true);
      try {
        await api.delete(`/compliance/exams/${examId}/questions/${question.id}`);
      } catch (e: any) {
        alert(e.response?.data?.error || e.message);
        setDeleting(false);
        return;
      }
    }
    onDelete();
  }

  async function handleSaveEdit(updated: Question) {
    if (examId && question.id) {
      try {
        await api.put(
          `/compliance/exams/${examId}/questions/${question.id}`,
          {
            question_text: updated.question_text,
            question_type: updated.question_type,
            sort_order: updated.sort_order,
          }
        );
        // Note: answer editing for existing exams is complex (add/update/delete per answer).
        // We send the full answer list for the question here.
        for (const ans of updated.answers) {
          if (ans.id) {
            await api.put(
              `/compliance/exams/${examId}/questions/${question.id}/answers/${ans.id}`,
              { answer_text: ans.answer_text, is_correct: ans.is_correct, sort_order: ans.sort_order }
            );
          }
        }
      } catch (e: any) {
        alert(e.response?.data?.error || e.message);
        return;
      }
    }
    onUpdate({ ...updated, _editing: false });
    setEditing(false);
  }

  const typeBadgeStyle: React.CSSProperties = {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 10,
    background: question.question_type === 'multiple_choice' ? '#dbeafe' : '#fef3c7',
    color: question.question_type === 'multiple_choice' ? '#1d4ed8' : '#b45309',
  };

  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 9,
        padding: '16px 18px',
        marginBottom: 10,
        background: '#ffffff',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: editing ? 0 : 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#94a3b8',
              minWidth: 28,
              paddingTop: 2,
            }}
          >
            Q{index + 1}
          </span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 6px 0', fontSize: 14, color: '#1e293b', fontWeight: 500 }}>
              {question.question_text || <em style={{ color: '#94a3b8' }}>No question text</em>}
            </p>
            <span style={typeBadgeStyle}>
              {question.question_type === 'multiple_choice' ? 'Multiple Choice' : 'True / False'}
            </span>
          </div>
        </div>

        {!editing && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setEditing(true)}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                color: '#2563eb',
                background: '#ffffff',
                border: '1px solid #2563eb',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                color: '#dc2626',
                background: '#ffffff',
                border: '1px solid #dc2626',
                borderRadius: 6,
                cursor: deleting ? 'not-allowed' : 'pointer',
                opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        )}
      </div>

      {/* Answer list (read mode) */}
      {!editing && (
        <div style={{ marginLeft: 38 }}>
          {question.answers.map((ans, ai) => (
            <div
              key={ai}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: ans.is_correct ? '#16a34a' : '#64748b',
                marginTop: 4,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: `2px solid ${ans.is_correct ? '#16a34a' : '#cbd5e1'}`,
                  background: ans.is_correct ? '#16a34a' : 'transparent',
                  flexShrink: 0,
                  display: 'inline-block',
                }}
              />
              {ans.answer_text || <em style={{ color: '#94a3b8' }}>(empty)</em>}
              {ans.is_correct && (
                <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Correct</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <QuestionForm
          initial={question}
          onSave={handleSaveEdit}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function ExamEditor() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<ExamForm>(EMPTY_FORM);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [newQuestionDraft, setNewQuestionDraft] = useState<Question>(emptyMultipleChoice());

  const cat1Items = categories.filter((c) => c.level === 1);
  const cat2Items = categories.filter(
    (c) => c.level === 2 && String(c.parent_id) === form.cat1_id
  );
  const cat3Items = categories.filter(
    (c) => c.level === 3 && String(c.parent_id) === form.cat2_id
  );

  // Fetch categories
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/compliance/categories');
        setCategories(Array.isArray(res.data) ? res.data : (res.data.categories ?? []));
      } catch {
        // non-fatal
      }
    })();
  }, []);

  // Fetch exam if editing
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get(`/compliance/exams/${id}`);
        const exam = res.data?.exam ?? res.data;
        setForm({
          title:               exam.title ?? '',
          description:         exam.description ?? '',
          instructions:        exam.instructions ?? '',
          passing_score:       exam.passing_score ?? 80,
          max_attempts:        exam.max_attempts ?? 3,
          expiration_type:     exam.expiration_type ?? 'yearly',
          time_limit:          exam.time_limit != null ? String(exam.time_limit) : '',
          ceus:                exam.ceus != null ? String(exam.ceus) : '',
          question_count:      exam.question_count ?? 10,
          randomize_questions: exam.randomize_questions ?? true,
          status:              exam.status ?? 'draft',
          applicable_roles:    Array.isArray(exam.applicable_roles) ? exam.applicable_roles : [],
          cat1_id:             exam.cat1_id != null ? String(exam.cat1_id) : '',
          cat2_id:             exam.cat2_id != null ? String(exam.cat2_id) : '',
          cat3_id:             exam.cat3_id != null ? String(exam.cat3_id) : '',
        });

        const rawQuestions: any[] = Array.isArray(exam.questions) ? exam.questions : [];
        setQuestions(
          rawQuestions.map((q: any, qi: number) => ({
            id: q.id ? String(q.id) : undefined,
            question_text: q.question_text ?? '',
            question_type: q.question_type ?? 'multiple_choice',
            sort_order: q.sort_order ?? qi,
            answers: Array.isArray(q.answers)
              ? q.answers.map((a: any, ai: number) => ({
                  id: a.id ? String(a.id) : undefined,
                  answer_text: a.answer_text ?? '',
                  is_correct: Boolean(a.is_correct),
                  sort_order: a.sort_order ?? ai,
                }))
              : [],
          }))
        );
      } catch (e: any) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit]);

  function setField<K extends keyof ExamForm>(key: K, value: ExamForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleRole(role: string) {
    setForm((prev) => ({
      ...prev,
      applicable_roles: prev.applicable_roles.includes(role)
        ? prev.applicable_roles.filter((r) => r !== role)
        : [...prev.applicable_roles, role],
    }));
  }

  // Save questions for an existing exam to the API
  const saveQuestionToApi = useCallback(
    async (examId: string, q: Question): Promise<Question> => {
      const qRes = await api.post(`/compliance/exams/${examId}/questions`, {
        question_text: q.question_text,
        question_type: q.question_type,
        sort_order: q.sort_order,
      });
      const savedQ = qRes.data?.question ?? qRes.data;
      const savedAnswers: Answer[] = [];
      for (const ans of q.answers) {
        const aRes = await api.post(
          `/compliance/exams/${examId}/questions/${savedQ.id}/answers`,
          {
            answer_text: ans.answer_text,
            is_correct: ans.is_correct,
            sort_order: ans.sort_order,
          }
        );
        const savedAns = aRes.data?.answer ?? aRes.data;
        savedAnswers.push({
          id: String(savedAns.id),
          answer_text: savedAns.answer_text,
          is_correct: Boolean(savedAns.is_correct),
          sort_order: savedAns.sort_order,
        });
      }
      return {
        ...q,
        id: String(savedQ.id),
        answers: savedAnswers,
      };
    },
    []
  );

  async function handleAddQuestion(q: Question) {
    const next: Question = { ...q, sort_order: questions.length };

    if (isEdit && id) {
      // Existing exam — persist immediately
      try {
        const saved = await saveQuestionToApi(id, next);
        setQuestions((prev) => [...prev, saved]);
      } catch (e: any) {
        alert(e.response?.data?.error || e.message);
        return;
      }
    } else {
      // New exam — buffer locally
      setQuestions((prev) => [...prev, next]);
    }

    setShowAddQuestion(false);
    setNewQuestionDraft(emptyMultipleChoice());
  }

  function handleUpdateQuestion(index: number, updated: Question) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? updated : q)));
  }

  function handleDeleteQuestion(index: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave(targetStatus: 'draft' | 'published') {
    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      title:               form.title.trim(),
      description:         form.description.trim() || null,
      instructions:        form.instructions.trim() || null,
      passing_score:       form.passing_score,
      max_attempts:        form.max_attempts,
      expiration_type:     form.expiration_type,
      time_limit:          form.time_limit ? parseInt(form.time_limit, 10) : null,
      ceus:                form.ceus ? parseFloat(form.ceus) : null,
      question_count:      form.question_count,
      randomize_questions: form.randomize_questions,
      status:              targetStatus,
      applicable_roles:    form.applicable_roles,
      cat1_id:             form.cat1_id || null,
      cat2_id:             form.cat2_id || null,
      cat3_id:             form.cat3_id || null,
    };

    try {
      if (isEdit && id) {
        await api.put(`/compliance/exams/${id}`, payload);
      } else {
        // Create exam
        const createRes = await api.post('/compliance/exams', payload);
        const newExam = createRes.data?.exam ?? createRes.data;
        const newId = String(newExam.id);

        // Save buffered questions
        for (let i = 0; i < questions.length; i++) {
          await saveQuestionToApi(newId, { ...questions[i], sort_order: i });
        }
      }

      navigate('/compliance/admin/exams');
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', color: '#64748b', fontSize: 14 }}>Loading exam…</div>
    );
  }

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>

        {/* Back + heading */}
        <div style={{ marginBottom: 28 }}>
          <button
            type="button"
            onClick={() => navigate('/compliance/admin/exams')}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              fontSize: 13,
              padding: 0,
              marginBottom: 10,
            }}
          >
            ← Back to Exams
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {isEdit ? 'Edit Exam' : 'New Exam'}
          </h1>
        </div>

        {/* ── Section 1: Exam Details ── */}
        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>Exam Details</h2>

          {/* Title */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              Title <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="e.g. HIPAA Compliance Exam"
              style={inputStyle}
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="Brief description of this exam…"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
          </div>

          {/* Instructions */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Instructions for Test Takers</label>
            <textarea
              rows={3}
              value={form.instructions}
              onChange={(e) => setField('instructions', e.target.value)}
              placeholder="Instructions shown to clinicians before they begin the exam"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
          </div>

          {/* Row: Passing Score + Max Attempts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Passing Score</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.passing_score}
                  onChange={(e) => setField('passing_score', parseInt(e.target.value, 10) || 80)}
                  style={{ ...inputStyle }}
                />
                <span style={{ fontSize: 14, color: '#64748b', whiteSpace: 'nowrap' }}>%</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Max Attempts</label>
              <input
                type="number"
                min={1}
                value={form.max_attempts}
                onChange={(e) => setField('max_attempts', parseInt(e.target.value, 10) || 3)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Row: Expiration Type + Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Expiration Type</label>
              <select
                value={form.expiration_type}
                onChange={(e) =>
                  setField('expiration_type', e.target.value as ExamForm['expiration_type'])
                }
                style={selectStyle}
              >
                <option value="one_time">One Time Only</option>
                <option value="yearly">Yearly</option>
                <option value="bi_annual">Bi-Annual (Every 2 Years)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as ExamForm['status'])}
                style={selectStyle}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          {/* Row: Time Limit + CEUs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Time Limit</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  value={form.time_limit}
                  onChange={(e) => setField('time_limit', e.target.value)}
                  placeholder="Leave blank for no limit"
                  style={inputStyle}
                />
                <span style={{ fontSize: 14, color: '#64748b', whiteSpace: 'nowrap' }}>minutes</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>CEUs</label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={form.ceus}
                onChange={(e) => setField('ceus', e.target.value)}
                placeholder="0"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Row: Questions per attempt + Randomize */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 8 }}>
            <div>
              <label style={labelStyle}>Questions per Attempt</label>
              <input
                type="number"
                min={1}
                value={form.question_count}
                onChange={(e) => setField('question_count', parseInt(e.target.value, 10) || 10)}
                style={inputStyle}
              />
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                How many questions to draw from the bank per attempt.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 28 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  fontSize: 13,
                  color: '#374151',
                  padding: '8px 12px',
                  borderRadius: 7,
                  border: '1px solid #e2e8f0',
                  background: form.randomize_questions ? '#eff6ff' : '#ffffff',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <input
                  type="checkbox"
                  checked={form.randomize_questions}
                  onChange={(e) => setField('randomize_questions', e.target.checked)}
                  style={{ accentColor: '#2563eb', cursor: 'pointer', width: 16, height: 16 }}
                />
                Randomize questions per attempt
              </label>
            </div>
          </div>
        </div>

        {/* ── Applicable Roles ── */}
        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>Applicable Roles</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {ALL_ROLES.map((role) => (
              <label
                key={role}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  color: '#374151',
                  cursor: 'pointer',
                  padding: '8px 12px',
                  borderRadius: 7,
                  border: '1px solid #e2e8f0',
                  background: form.applicable_roles.includes(role) ? '#eff6ff' : '#ffffff',
                }}
              >
                <input
                  type="checkbox"
                  checked={form.applicable_roles.includes(role)}
                  onChange={() => toggleRole(role)}
                  style={{ accentColor: '#2563eb', cursor: 'pointer' }}
                />
                {role}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
            Leave all unchecked to apply to all roles.
          </div>
        </div>

        {/* ── Categories ── */}
        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>Categories</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Role / Modality</label>
              <select
                value={form.cat1_id}
                onChange={(e) => {
                  setField('cat1_id', e.target.value);
                  setField('cat2_id', '');
                  setField('cat3_id', '');
                }}
                style={selectStyle}
              >
                <option value="">— Select —</option>
                {cat1Items.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Specialty</label>
              <select
                value={form.cat2_id}
                onChange={(e) => {
                  setField('cat2_id', e.target.value);
                  setField('cat3_id', '');
                }}
                disabled={!form.cat1_id}
                style={{ ...selectStyle, opacity: form.cat1_id ? 1 : 0.5 }}
              >
                <option value="">— Select —</option>
                {cat2Items.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Sub-Specialty</label>
              <select
                value={form.cat3_id}
                onChange={(e) => setField('cat3_id', e.target.value)}
                disabled={!form.cat2_id}
                style={{ ...selectStyle, opacity: form.cat2_id ? 1 : 0.5 }}
              >
                <option value="">— Select —</option>
                {cat3Items.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Section 2: Question Bank ── */}
        <div style={sectionStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 18,
            }}
          >
            <h2 style={{ ...sectionHeadingStyle, margin: 0 }}>
              Question Bank
              <span
                style={{
                  marginLeft: 10,
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#64748b',
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                ({questions.length} question{questions.length !== 1 ? 's' : ''})
              </span>
            </h2>
            {!showAddQuestion && (
              <button
                type="button"
                onClick={() => {
                  setNewQuestionDraft(emptyMultipleChoice());
                  setShowAddQuestion(true);
                }}
                style={{
                  padding: '7px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 7,
                  cursor: 'pointer',
                }}
              >
                + Add Question
              </button>
            )}
          </div>

          {/* Existing questions */}
          {questions.length === 0 && !showAddQuestion && (
            <div
              style={{
                padding: '24px 0',
                textAlign: 'center',
                color: '#94a3b8',
                fontSize: 14,
                border: '2px dashed #e2e8f0',
                borderRadius: 9,
              }}
            >
              No questions yet. Click "Add Question" to build the question bank.
            </div>
          )}

          {questions.map((q, idx) => (
            <QuestionCard
              key={q.id ?? `new-${idx}`}
              question={q}
              index={idx}
              examId={id}
              onUpdate={(updated) => handleUpdateQuestion(idx, updated)}
              onDelete={() => handleDeleteQuestion(idx)}
            />
          ))}

          {/* Add question inline form */}
          {showAddQuestion && (
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: 4,
                  marginTop: questions.length > 0 ? 8 : 0,
                }}
              >
                Q{questions.length + 1} — New Question
              </div>
              <QuestionForm
                initial={newQuestionDraft}
                onSave={handleAddQuestion}
                onCancel={() => {
                  setShowAddQuestion(false);
                  setNewQuestionDraft(emptyMultipleChoice());
                }}
              />
            </div>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div
            style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '12px 16px',
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingBottom: 40 }}>
          <button
            type="button"
            onClick={() => navigate('/compliance/admin/exams')}
            style={{
              padding: '9px 20px',
              fontSize: 14,
              color: '#475569',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSave('draft')}
            disabled={saving}
            style={{
              padding: '9px 22px',
              fontSize: 14,
              fontWeight: 600,
              background: '#ffffff',
              color: '#2563eb',
              border: '1px solid #2563eb',
              borderRadius: 8,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            type="button"
            onClick={() => handleSave('published')}
            disabled={saving}
            style={{
              padding: '9px 22px',
              fontSize: 14,
              fontWeight: 600,
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save & Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
