/**
 * Pipeline — Move Stage modal (drag-free alternative).
 *
 * QA found the @dnd-kit drag moves were unreliable in the user's
 * browser ("1 of 1 moves failed — reloading pipeline"). This modal
 * gives a click-based alternative that also handles the "actually
 * required for this stage" part: the user can attach a note, upload
 * one or more supporting documents, and see them saved to the
 * candidate before the stage change lands.
 *
 * Flow:
 *   1. Open → select target stage (defaults to "next" stage if known)
 *   2. Optional — type a note for the stage-history audit trail
 *   3. Optional — upload any number of documents:
 *        - pick doc_type (RN License / BLS / etc.) or type custom
 *        - label
 *        - file
 *        Each gets created via POST /candidates/:id/documents then
 *        POST /:docId/review with the file (so AI analysis fires).
 *   4. Submit → all document uploads in parallel, then the stage move
 *   5. Errors surface inline; success closes and refreshes the board
 */
import { useState } from 'react';
import { candidatesApi, PipelineStageColumn, PipelineCandidateCard } from '../../lib/api';

const DOC_TYPE_PRESETS = [
  'RN License', 'LPN License', 'LVN License', 'CNA Certificate',
  'BLS Card', 'ACLS Card', 'PALS Card',
  'TB Test Results', 'Drug Screen', 'Background Check',
  'I-9', 'W-4', 'Direct Deposit',
  'HIPAA Training', 'Resume', 'Other',
];

interface PendingDoc {
  id: string;             // client-side uid
  doc_type: string;
  label: string;
  file: File | null;
  notes?: string;
}

interface Props {
  candidate: PipelineCandidateCard;
  columns: PipelineStageColumn[];
  /** If set, the modal pre-fills this stage as the target (used when
   *  the user explicitly picked "Move to <stage>" from a menu). */
  defaultTargetStage?: string;
  onClose: () => void;
  /** Called after a successful move. Parent typically calls load() to
   *  refresh the board. */
  onMoved: () => void;
}

export default function MoveStageModal({ candidate, columns, defaultTargetStage, onClose, onMoved }: Props) {
  // Guess a sensible default: the column AFTER the candidate's current
  // one, or the user-provided target, or the first column that isn't
  // the current one.
  const currentIdx = columns.findIndex((c) => c.key === candidate.stage);
  const nextGuess =
    defaultTargetStage
    ?? (currentIdx >= 0 && currentIdx < columns.length - 1 ? columns[currentIdx + 1].key : undefined)
    ?? columns.find((c) => c.key !== candidate.stage)?.key
    ?? '';

  const [targetStage, setTargetStage] = useState<string>(nextGuess);
  const [note, setNote] = useState<string>('');
  const [docs, setDocs] = useState<PendingDoc[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  function addDocRow() {
    setDocs((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2), doc_type: 'RN License', label: '', file: null },
    ]);
  }

  function updateDoc(id: string, patch: Partial<PendingDoc>) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function removeDoc(id: string) {
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  async function submit() {
    if (!targetStage) { setError('Pick a target stage.'); return; }
    if (targetStage === candidate.stage) { setError(`Candidate is already in ${targetStage}.`); return; }

    // Validate docs: every row needs label + file if there's any row at all
    const invalid = docs.find((d) => !d.file || !d.label.trim());
    if (invalid) { setError('Every document row needs a label and a file (or remove the row).'); return; }

    setSubmitting(true); setError(null);
    try {
      // 1. Create + upload documents sequentially so we can show progress.
      //    Using parallel would be faster but harder to debug; sequential
      //    is fine for the typical 1-3 docs a user attaches at a time.
      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        setProgress(`Uploading document ${i + 1} of ${docs.length}: ${d.label}`);
        // Create the doc row first
        const createRes = await candidatesApi.addDocument(candidate.id, {
          document_type: d.doc_type as any,  // backend accepts free-text slug
          label: d.label.trim(),
          required: true,
          notes: d.notes || undefined,
        });
        const newDoc = (createRes.data as any)?.document ?? createRes.data;
        const newDocId = String(newDoc?.id ?? '');
        // Upload + AI-review the file
        if (newDocId && d.file) {
          await candidatesApi.reviewDocument(candidate.id, newDocId, d.file);
        }
      }

      // 2. Stage move
      setProgress(`Moving candidate to ${targetStage}…`);
      await candidatesApi.moveStage(candidate.id, targetStage, note.trim() || undefined);

      onMoved();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Move failed.');
    } finally {
      setSubmitting(false);
      setProgress('');
    }
  }

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c' }}>
              Move {candidate.first_name} {candidate.last_name}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Currently in: <strong style={{ color: '#475569' }}>{columnLabel(columns, candidate.stage)}</strong>
              {candidate.role && <> · {candidate.role}</>}
            </div>
          </div>
          <button onClick={onClose} disabled={submitting}
            style={{ background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: submitting ? 'not-allowed' : 'pointer' }}>×</button>
        </div>

        {/* Target stage */}
        <label style={lbl}>Move to</label>
        <select
          style={field}
          value={targetStage}
          onChange={(e) => setTargetStage(e.target.value)}
          disabled={submitting}
        >
          {columns.map((c) => (
            <option key={c.key} value={c.key} disabled={c.key === candidate.stage}>
              {c.label}{c.key === candidate.stage ? ' (current)' : ''}
            </option>
          ))}
        </select>

        {/* Note */}
        <label style={{ ...lbl, marginTop: 12 }}>Note (optional)</label>
        <textarea
          style={{ ...field, minHeight: 60, resize: 'vertical' }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Completed phone screen, verified license with state board"
          disabled={submitting}
        />

        {/* Document uploads */}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ ...lbl, marginBottom: 0 }}>Supporting documents (optional)</label>
          <button
            type="button"
            onClick={addDocRow}
            disabled={submitting}
            style={{ padding: '5px 10px', background: '#eff6ff', color: '#1565c0', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          >
            + Add document
          </button>
        </div>

        {docs.length === 0 && (
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            Attach a license, BLS card, background check, etc. Each file gets AI-reviewed before the move lands.
          </div>
        )}

        {docs.map((d) => (
          <div key={d.id} style={{ marginTop: 10, padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
              <div>
                <label style={innerLbl}>Type</label>
                <select style={innerField} value={d.doc_type}
                  onChange={(e) => updateDoc(d.id, { doc_type: e.target.value })}
                  disabled={submitting}>
                  {DOC_TYPE_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={innerLbl}>Label</label>
                <input style={innerField} value={d.label}
                  placeholder="e.g. TX RN license 12345"
                  onChange={(e) => updateDoc(d.id, { label: e.target.value })}
                  disabled={submitting} />
              </div>
              <button onClick={() => removeDoc(d.id)} disabled={submitting}
                style={{ alignSelf: 'flex-end', padding: '6px 10px', background: 'transparent', color: '#c62828', border: '1px solid #fecaca', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                Remove
              </button>
            </div>
            <div style={{ marginTop: 8 }}>
              <label style={innerLbl}>File</label>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                onChange={(e) => updateDoc(d.id, { file: e.target.files?.[0] ?? null })}
                disabled={submitting}
                style={{ fontSize: 12 }}
              />
              {d.file && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
                  {d.file.name} ({Math.round(d.file.size / 1024)} KB)
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Progress + error */}
        {progress && (
          <div style={{ marginTop: 12, padding: 8, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1565c0', borderRadius: 6, fontSize: 12 }}>
            {progress}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 6, fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={submitting}
            style={{ padding: '8px 16px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={submitting || !targetStage}
            style={{ padding: '8px 18px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Saving…' : `Move to ${columnLabel(columns, targetStage)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function columnLabel(columns: PipelineStageColumn[], key: string): string {
  return columns.find((c) => c.key === key)?.label ?? key;
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
};
const card: React.CSSProperties = {
  background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 560,
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '92vh', overflowY: 'auto',
};
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block',
  marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4,
};
const field: React.CSSProperties = {
  width: '100%', padding: '8px 11px', border: '1.5px solid #e2e8f0', borderRadius: 7,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff',
  fontFamily: 'inherit', color: '#1e293b',
};
const innerLbl: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3,
};
const innerField: React.CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6,
  fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fff',
};
