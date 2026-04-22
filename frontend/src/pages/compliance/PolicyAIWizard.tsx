import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api, { policyAiApi, type ParsedPolicy } from '../../lib/api';
import { useToast } from '../../components/ToastHost';
import { extractApiError } from '../../lib/apiErrors';

/**
 * Phase 2.3 — Policy AI wizard.
 *
 * Upload a policy PDF/DOCX → Claude parses it into structured fields →
 * admin reviews + edits → clicks Save to create the policy.
 *
 * 4 steps:
 *   1. Upload: pick a file
 *   2. Parsing: spinner while Claude works
 *   3. Review: form pre-filled with AI output, fully editable
 *   4. Save: POST to /compliance/policies, then redirect to the record
 */

type Step = 'upload' | 'parsing' | 'review';

export default function PolicyAIWizard() {
  const nav = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedPolicy>({});
  const [saving, setSaving] = useState(false);
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [rewriting, setRewriting] = useState(false);

  const onPick = (f: File | null) => {
    setFile(f);
  };

  const doParse = async () => {
    if (!file) return;
    setStep('parsing');
    try {
      const res = await policyAiApi.parse(file);
      setParsed(res.data.parsed);
      setStep('review');
    } catch (e) {
      toast.error(extractApiError(e, 'AI parse failed'));
      setStep('upload');
    }
  };

  const doRewrite = async () => {
    if (!parsed.content || !rewriteInstruction.trim()) return;
    setRewriting(true);
    try {
      const res = await policyAiApi.rewrite({
        title: parsed.title, content: parsed.content, instruction: rewriteInstruction,
      });
      setParsed((p) => ({ ...p, content: res.data.revised_content }));
      setRewriteInstruction('');
      toast.success('Policy revised');
    } catch (e) {
      toast.error(extractApiError(e, 'Rewrite failed'));
    } finally { setRewriting(false); }
  };

  const doSave = async () => {
    if (!parsed.title?.trim() || !parsed.content?.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setSaving(true);
    try {
      // Use existing /compliance/policies POST — ParsedPolicy maps to it
      const res = await api.post<{ id: string }>('/compliance/policies', {
        title: parsed.title,
        content: parsed.content,
        version: parsed.suggested_version ?? '1.0',
        expiration_days: parsed.suggested_expiration_days ?? null,
        require_signature: parsed.require_signature ?? true,
        status: 'draft',
        applicable_roles: parsed.applicable_roles ?? [],
      });
      toast.success('Policy created from AI parse');
      nav(`/compliance/policies`);
    } catch (e) {
      toast.error(extractApiError(e, 'Save failed'));
    } finally { setSaving(false); }
  };

  const upd = <K extends keyof ParsedPolicy>(k: K, v: ParsedPolicy[K]) =>
    setParsed((p) => ({ ...p, [k]: v }));

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>
        <Link to="/compliance-admin" style={{ color: 'var(--t3)', textDecoration: 'none' }}>Compliance Admin</Link> ›{' '}
        <span style={{ color: 'var(--t2)' }}>AI Policy Wizard</span>
      </div>

      <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>
        ✦ Create policy from document
      </h1>
      <p style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 20, maxWidth: 720 }}>
        Upload a policy document (PDF, DOCX, or TXT). Claude extracts the title, body, and suggested settings —
        you review and edit before saving. Useful for importing policies you already have in existing files.
      </p>

      {/* Step 1 — Upload */}
      {step === 'upload' && (
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 32, textAlign: 'center' }}>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: '2px dashed var(--bd)', borderRadius: 12, padding: 40,
              cursor: 'pointer', background: file ? 'var(--sf2)' : 'var(--sf)',
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
              {file ? file.name : 'Click to upload a policy document'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--t3)' }}>PDF, DOCX, or TXT — max 15MB</div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              style={{ display: 'none' }}
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </div>
          {file && (
            <button
              onClick={() => void doParse()}
              style={{ marginTop: 16, padding: '10px 20px', background: 'var(--pr)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              ✦ Parse with AI
            </button>
          )}
        </div>
      )}

      {/* Step 2 — Parsing */}
      {step === 'parsing' && (
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✦</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t1)' }}>AI is reading the policy…</div>
          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 8 }}>This usually takes 10–30 seconds.</div>
        </div>
      )}

      {/* Step 3 — Review */}
      {step === 'review' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {parsed.summary && (
            <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>✦ AI summary</div>
              <div style={{ fontSize: 13, color: '#1e1b4b' }}>{parsed.summary}</div>
            </div>
          )}

          <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 20, display: 'grid', gap: 14 }}>
            <Field label="Title *">
              <input value={parsed.title ?? ''} onChange={(e) => upd('title', e.target.value)} style={inp} />
            </Field>

            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="Version">
                <input value={parsed.suggested_version ?? '1.0'} onChange={(e) => upd('suggested_version', e.target.value)} style={inp} />
              </Field>
              <Field label="Expires after (days)">
                <input type="number" min={0} value={parsed.suggested_expiration_days ?? ''}
                  onChange={(e) => upd('suggested_expiration_days', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="365" style={inp} />
              </Field>
              <Field label="Category (AI guess)">
                <input value={parsed.category_guess ?? ''} onChange={(e) => upd('category_guess', e.target.value)} style={inp} />
              </Field>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t2)' }}>
              <input type="checkbox" checked={parsed.require_signature ?? true}
                onChange={(e) => upd('require_signature', e.target.checked)} />
              Require signature on this policy
            </label>

            <Field label="Applicable roles (comma-separated, empty = all)">
              <input value={(parsed.applicable_roles ?? []).join(', ')}
                onChange={(e) => upd('applicable_roles', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                placeholder="RN, LPN, CNA" style={inp} />
            </Field>

            <Field label="Content (Markdown) *">
              <textarea value={parsed.content ?? ''} onChange={(e) => upd('content', e.target.value)}
                rows={16} style={{ ...inp, fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }} />
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                {(parsed.content ?? '').length.toLocaleString()} characters
              </div>
            </Field>
          </div>

          {/* AI rewrite box */}
          <div style={{ background: 'linear-gradient(135deg, #eef2ff, #faf5ff)', border: '1px solid #c7d2fe', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#4f46e5' }}>✦ Ask AI to revise</span>
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>"make more formal", "add disciplinary action", "simplify the language"</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={rewriteInstruction} onChange={(e) => setRewriteInstruction(e.target.value)}
                placeholder="Instruction for the revision…"
                style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, outline: 'none', background: 'var(--sf)' }} />
              <button onClick={() => void doRewrite()} disabled={rewriting || !rewriteInstruction.trim()}
                style={{ padding: '8px 14px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: rewriting ? 0.6 : 1 }}>
                {rewriting ? 'Revising…' : 'Revise'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setStep('upload')}
              style={{ padding: '10px 16px', background: 'var(--sf2)', border: '1px solid var(--bd)', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              ← Start over
            </button>
            <button onClick={() => void doSave()} disabled={saving}
              style={{ padding: '10px 20px', background: 'var(--pr)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Create policy (draft)'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, outline: 'none', background: 'var(--sf)' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  );
}
