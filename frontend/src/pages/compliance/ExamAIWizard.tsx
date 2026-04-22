import { useState, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { examsAiApi, type GeneratedExamQuestion } from '../../lib/api';
import { useToast } from '../../components/ToastHost';
import { extractApiError } from '../../lib/apiErrors';

/**
 * Phase 2.4 — Exam AI generator + Excel importer.
 *
 * Two modes on the same screen:
 *   1. AI generate — enter a topic, Claude produces N questions, you review/edit
 *   2. Excel import — upload .xlsx with columns (Question, Type, A, B, C, D, Correct)
 *                     parsed client-side by SheetJS, normalized to the same shape
 *                     the AI mode produces
 *
 * Both modes converge on the same review table. User clicks Save, which
 * POSTs to /bulk-import. Backend validates and inserts in a transaction.
 *
 * Route: /compliance/exams/:id/ai-wizard (examId must already exist)
 */
export default function ExamAIWizard() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();

  const [mode, setMode] = useState<'pick' | 'ai' | 'excel' | 'review'>('pick');

  // AI mode
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [aiBusy, setAiBusy] = useState(false);

  // Excel mode
  const fileRef = useRef<HTMLInputElement>(null);

  // Review mode (shared)
  const [questions, setQuestions] = useState<GeneratedExamQuestion[]>([]);
  const [saving, setSaving] = useState(false);

  const doAi = async () => {
    if (!id) return;
    if (!topic.trim()) { toast.error('Topic is required'); return; }
    setAiBusy(true);
    try {
      const res = await examsAiApi.generate(id, { topic, count, difficulty });
      setQuestions(res.data.questions);
      setMode('review');
    } catch (e) {
      toast.error(extractApiError(e, 'AI generation failed'));
    } finally { setAiBusy(false); }
  };

  const downloadTemplate = () => {
    const template = [
      ['Question', 'Type', 'A', 'B', 'C', 'D', 'Correct', 'Explanation'],
      ['What is the minimum BLS ratio for healthcare providers?', 'multiple_choice', '15:2', '30:2', '5:1', '30:1', 'B', 'Adult BLS uses 30 compressions to 2 breaths.'],
      ['ACLS is required for all nursing roles.', 'true_false', 'True', 'False', '', '', 'B', 'Only ICU/ER typically requires ACLS.'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');
    XLSX.writeFile(wb, 'exam_template.xlsx');
  };

  const parseExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

        const parsed: GeneratedExamQuestion[] = rows.map((r) => {
          const qText = String(r.Question ?? r.question ?? '').trim();
          const typeStr = String(r.Type ?? r.type ?? 'multiple_choice').toLowerCase();
          const qType: GeneratedExamQuestion['question_type'] =
            typeStr.includes('true') || typeStr === 'tf' ? 'true_false' : 'multiple_choice';

          const answerCols = qType === 'true_false' ? ['A', 'B'] : ['A', 'B', 'C', 'D'];
          const correctLetter = String(r.Correct ?? r.correct ?? '').trim().toUpperCase();

          const answers = answerCols.map((col) => {
            const text = String(r[col] ?? (r as any)[col.toLowerCase()] ?? '').trim();
            return { answer_text: text, is_correct: col === correctLetter };
          }).filter(a => a.answer_text);

          return {
            question_text: qText,
            question_type: qType,
            explanation: String(r.Explanation ?? r.explanation ?? '') || undefined,
            answers,
          };
        }).filter(q => q.question_text && q.answers.length >= 2);

        if (parsed.length === 0) {
          toast.error('No valid rows found. Use the template — columns: Question, Type, A, B, C, D, Correct.');
          return;
        }

        setQuestions(parsed);
        setMode('review');
        toast.success(`Parsed ${parsed.length} question${parsed.length === 1 ? '' : 's'} from Excel`);
      } catch (err) {
        console.error(err);
        toast.error('Failed to parse Excel file. Check format matches the template.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const doSave = async () => {
    if (!id) return;
    if (questions.length === 0) { toast.error('No questions to save'); return; }
    setSaving(true);
    try {
      const res = await examsAiApi.bulkImport(id, questions);
      toast.success(`Saved ${res.data.inserted_count} question${res.data.inserted_count === 1 ? '' : 's'}${res.data.skipped_count > 0 ? `, skipped ${res.data.skipped_count}` : ''}`);
      if (res.data.skipped_count > 0) {
        alert(`Skipped ${res.data.skipped_count}:\n\n${res.data.skipped.join('\n')}`);
      }
      nav(`/compliance/exams/${id}`);
    } catch (e) {
      toast.error(extractApiError(e, 'Save failed'));
    } finally { setSaving(false); }
  };

  const updQ = (i: number, patch: Partial<GeneratedExamQuestion>) =>
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const removeQ = (i: number) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  const updAnswer = (qi: number, ai: number, patch: Partial<GeneratedExamQuestion['answers'][number]>) =>
    setQuestions((qs) => qs.map((q, qidx) => qidx !== qi ? q : {
      ...q,
      answers: q.answers.map((a, aidx) => aidx === ai ? { ...a, ...patch } : (
        // If marking this one correct and it's multiple_choice, unmark others
        patch.is_correct ? { ...a, is_correct: false } : a
      )),
    }));

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>
        <Link to={`/compliance/exams/${id}`} style={{ color: 'var(--t3)', textDecoration: 'none' }}>Exam</Link> ›{' '}
        <span style={{ color: 'var(--t2)' }}>AI / Excel import</span>
      </div>

      <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>
        Bulk add questions
      </h1>

      {mode === 'pick' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✦</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', marginBottom: 6 }}>AI-generate</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>Describe the topic; AI creates N questions for you to review.</div>
            <button onClick={() => setMode('ai')} style={btnPrimary}>Start AI mode →</button>
          </div>
          <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', marginBottom: 6 }}>Excel import</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>Upload .xlsx with your questions. Use the template if you don't have one.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={downloadTemplate} style={btnSecondary}>Download template</button>
              <button onClick={() => setMode('excel')} style={btnPrimary}>Upload Excel →</button>
            </div>
          </div>
        </div>
      )}

      {mode === 'ai' && (
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 24, display: 'grid', gap: 14 }}>
          <Field label="Topic">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} style={inp}
              placeholder="e.g. HIPAA privacy rule basics for nursing staff" />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="How many questions?">
              <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} style={inp} />
            </Field>
            <Field label="Difficulty">
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as any)} style={inp}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setMode('pick')} style={btnSecondary}>← Back</button>
            <button onClick={() => void doAi()} disabled={aiBusy} style={btnPrimary}>
              {aiBusy ? 'Generating…' : '✦ Generate with AI'}
            </button>
          </div>
        </div>
      )}

      {mode === 'excel' && (
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 32, textAlign: 'center' }}>
          <div style={{ border: '2px dashed var(--bd)', borderRadius: 12, padding: 40, cursor: 'pointer' }}
            onClick={() => fileRef.current?.click()}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 14, color: 'var(--t2)' }}>Click to upload an Excel file (.xlsx)</div>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) parseExcel(f); }} />
          <div style={{ marginTop: 16 }}>
            <button onClick={() => setMode('pick')} style={btnSecondary}>← Back</button>
          </div>
        </div>
      )}

      {mode === 'review' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 6, padding: 10, color: '#065f46', fontSize: 13 }}>
            ✓ {questions.length} question{questions.length === 1 ? '' : 's'} ready. Review below, then click <strong>Save all</strong>. You can edit, remove, or reorder.
          </div>

          {questions.map((q, i) => (
            <div key={i} style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 14 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', background: 'var(--sf2)', padding: '2px 8px', borderRadius: 999 }}>#{i + 1}</span>
                <select value={q.question_type} onChange={(e) => updQ(i, { question_type: e.target.value as any })}
                  style={{ ...inp, width: 'auto', padding: '4px 8px', fontSize: 12 }}>
                  <option value="multiple_choice">Multiple choice</option>
                  <option value="true_false">True/false</option>
                </select>
                <button onClick={() => removeQ(i)} style={{ marginLeft: 'auto', padding: '4px 8px', background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  Remove
                </button>
              </div>
              <textarea value={q.question_text} onChange={(e) => updQ(i, { question_text: e.target.value })}
                rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical', marginBottom: 10 }} />
              <div style={{ display: 'grid', gap: 4 }}>
                {q.answers.map((a, ai) => (
                  <div key={ai} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="radio" name={`correct-${i}`} checked={a.is_correct}
                      onChange={() => updAnswer(i, ai, { is_correct: true })} />
                    <input value={a.answer_text} onChange={(e) => updAnswer(i, ai, { answer_text: e.target.value })}
                      style={{ ...inp, flex: 1 }} />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setMode('pick')} style={btnSecondary}>← Start over</button>
            <button onClick={() => void doSave()} disabled={saving} style={btnPrimary}>
              {saving ? 'Saving…' : `Save all ${questions.length} questions`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, outline: 'none', background: 'var(--sf)' };
const btnPrimary: React.CSSProperties = { padding: '8px 16px', background: 'var(--pr)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'var(--sf2)', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  );
}
