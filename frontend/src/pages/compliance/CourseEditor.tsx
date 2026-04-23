import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { compCoursesApi, complianceExamsApi, type CompCourse, type CompExam } from '../../lib/api';
import { useToast } from '../../components/ToastHost';
import { extractApiError } from '../../lib/apiErrors';

/**
 * Phase 2.6 — Course editor (admin).
 *
 * Creates or edits a training module. A course has markdown content,
 * optional video, optional tail quiz (existing exam), and an attestation
 * flag. Admin fills it out and publishes; staff completes via CourseViewer.
 *
 * Route is /compliance/courses/:id/edit, where :id = 'new' for create.
 */
export default function CourseEditor() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const isNew = !id || id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [exams, setExams] = useState<CompExam[]>([]);

  const [form, setForm] = useState<Partial<CompCourse>>({
    title: '', description: '', content_markdown: '', video_url: '',
    estimated_minutes: 15, require_attestation: true, status: 'draft',
    applicable_roles: [],
  });

  useEffect(() => {
    // Load existing exams for the quiz dropdown
    void complianceExamsApi.list().then((r) => setExams(r.data.exams ?? [])).catch(() => { /* silent */ });

    if (isNew) return;
    void compCoursesApi.get(id!)
      .then((r) => {
        setForm(r.data.course);
        setLoading(false);
      })
      .catch((e) => {
        toast.error(extractApiError(e, 'Failed to load course'));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const upd = <K extends keyof CompCourse>(k: K, v: CompCourse[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (nextStatus?: CompCourse['status']) => {
    if (!form.title?.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      // Strip empty strings to undefined so optional zod validators don't
      // reject "". Backend also normalizes these, but doing it here keeps
      // payloads clean and plays nice with strict validators.
      const clean = (v: string | null | undefined) => v?.trim() || undefined;
      const payload: Partial<CompCourse> = {
        ...form,
        description: clean(form.description) ?? null,
        content_markdown: clean(form.content_markdown) ?? null,
        video_url: clean(form.video_url) ?? null,
        quiz_exam_id: form.quiz_exam_id || null,
        cat1_id: form.cat1_id || null,
        cat2_id: form.cat2_id || null,
        cat3_id: form.cat3_id || null,
        status: nextStatus ?? form.status ?? 'draft',
      };
      if (isNew) {
        const res = await compCoursesApi.create(payload);
        toast.success(`Course created${nextStatus === 'published' ? ' & published' : ''}`);
        nav(`/compliance/admin/courses/${res.data.course.id}/edit`);
      } else {
        await compCoursesApi.update(id!, payload);
        toast.success(`Saved${nextStatus === 'published' ? ' & published' : ''}`);
        if (nextStatus) setForm((f) => ({ ...f, status: nextStatus }));
      }
    } catch (e) {
      toast.error(extractApiError(e, 'Save failed'));
    } finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>
        <Link to="/compliance/admin/courses" style={{ color: 'var(--t3)', textDecoration: 'none' }}>Courses</Link> ›{' '}
        <span style={{ color: 'var(--t2)' }}>{isNew ? 'New course' : form.title ?? 'Edit'}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>
          {isNew ? 'New training course' : 'Edit course'}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
            background: form.status === 'published' ? '#d1fae5' : form.status === 'archived' ? '#f1f5f9' : '#fef3c7',
            color: form.status === 'published' ? '#065f46' : form.status === 'archived' ? '#64748b' : '#92400e',
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>{form.status ?? 'draft'}</span>
          <button onClick={() => void save()} disabled={saving} style={btnSecondary}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          {form.status !== 'published' && (
            <button onClick={() => void save('published')} disabled={saving} style={btnPrimary}>Publish</button>
          )}
          {form.status === 'published' && (
            <button onClick={() => void save('archived')} disabled={saving} style={btnDanger}>Archive</button>
          )}
        </div>
      </div>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 20, display: 'grid', gap: 16 }}>
        <Field label="Title *">
          <input value={form.title ?? ''} onChange={(e) => upd('title', e.target.value)} style={inp} placeholder="e.g. HIPAA Annual Refresher" />
        </Field>

        <Field label="Description (one-line summary for the course list)">
          <input value={form.description ?? ''} onChange={(e) => upd('description', e.target.value)} style={inp} />
        </Field>

        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="Estimated minutes">
            <input type="number" min={0} value={form.estimated_minutes ?? ''}
              onChange={(e) => upd('estimated_minutes', e.target.value ? Number(e.target.value) : null)}
              placeholder="15" style={inp} />
          </Field>
          <Field label="Video URL (optional)">
            <input value={form.video_url ?? ''} onChange={(e) => upd('video_url', e.target.value)}
              placeholder="https://youtube.com/watch?v=..." style={inp} />
          </Field>
        </div>

        <Field label="Training content (Markdown — headers, bullets, bold, etc.)">
          <textarea value={form.content_markdown ?? ''} onChange={(e) => upd('content_markdown', e.target.value)}
            rows={14} placeholder={'# Overview\n\nThis course covers...\n\n## Key points\n\n- Point 1\n- Point 2'}
            style={{ ...inp, fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }} />
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
            {(form.content_markdown ?? '').length.toLocaleString()} characters
          </div>
        </Field>

        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="Tail quiz (optional — requires pass to complete)">
            <select value={form.quiz_exam_id ?? ''} onChange={(e) => upd('quiz_exam_id', e.target.value || null)} style={inp}>
              <option value="">— no quiz —</option>
              {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </Field>
          <Field label="Pass threshold % (if quiz)">
            <input type="number" min={0} max={100} value={form.pass_threshold ?? ''}
              onChange={(e) => upd('pass_threshold', e.target.value ? Number(e.target.value) : null)}
              placeholder="80" style={inp} disabled={!form.quiz_exam_id} />
          </Field>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t2)' }}>
          <input type="checkbox" checked={form.require_attestation ?? true}
            onChange={(e) => upd('require_attestation', e.target.checked)} />
          Require attestation signature ("I read and understand") at completion
        </label>

        <Field label="Applies to roles (comma-separated, leave empty for all)">
          <input
            value={(form.applicable_roles ?? []).join(', ')}
            onChange={(e) => upd('applicable_roles', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
            placeholder="RN, LPN, CNA" style={inp} />
        </Field>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const btnPrimary: React.CSSProperties = { padding: '8px 16px', background: 'var(--pr)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'var(--sf2)', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnDanger: React.CSSProperties = { padding: '8px 16px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, outline: 'none', background: 'var(--sf)' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  );
}
