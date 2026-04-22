import { useState, useEffect } from 'react';
import { docTypesApi, type DocType } from '../../lib/api';
import { useToast } from '../../components/ToastHost';
import { extractApiError } from '../../lib/apiErrors';

/**
 * Phase 2.2 — Admin tool for managing document types.
 *
 * Lets admins add/edit/disable the document types the AI credential reviewer
 * recognizes. Editing `prompt_hints` here directly changes how Claude reviews
 * uploaded docs on candidate profiles without a code deploy.
 *
 * Examples of what an admin would add here:
 *   - "Respirator Fit Test" with hints about which models and expiration
 *   - "State X RN License" with specific formatting expected
 *   - "Flu Shot Declination" with ADA-compliant language check
 */

type FormState = Partial<DocType> & { _key_input?: string };

export default function DocTypesAdmin() {
  const toast = useToast();
  const [types, setTypes] = useState<DocType[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all' | 'inactive'>('active');
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await docTypesApi.list({ active: filter === 'all' ? 'all' : filter === 'active' ? 'true' : 'false' });
      setTypes(res.data.doc_types);
    } catch (e) {
      toast.error(extractApiError(e, 'Failed to load doc types'));
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filter]);

  const openNew = () => setEditing({
    key: '', label: '', description: '', prompt_hints: '',
    issuing_bodies: [], required_fields: [], applicable_roles: [],
    expires_months: null, category: 'nursing', active: true,
  });

  const openEdit = (t: DocType) => setEditing({ ...t });

  const save = async () => {
    if (!editing) return;
    const d = editing;
    if (!d.key?.trim() || !d.label?.trim() || !d.prompt_hints?.trim()) {
      toast.error('key, label, and prompt_hints are required');
      return;
    }
    setSaving(true);
    try {
      if (d.id) {
        await docTypesApi.update(d.id, {
          label: d.label, description: d.description, prompt_hints: d.prompt_hints,
          issuing_bodies: d.issuing_bodies, expires_months: d.expires_months,
          category: d.category, required_fields: d.required_fields,
          applicable_roles: d.applicable_roles, active: d.active,
        });
        toast.success(`Updated "${d.label}"`);
      } else {
        await docTypesApi.create({
          key: d.key, label: d.label, description: d.description, prompt_hints: d.prompt_hints,
          issuing_bodies: d.issuing_bodies, expires_months: d.expires_months,
          category: d.category, required_fields: d.required_fields,
          applicable_roles: d.applicable_roles, active: d.active,
        });
        toast.success(`Created "${d.label}"`);
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(extractApiError(e, 'Save failed'));
    } finally { setSaving(false); }
  };

  const deactivate = async (t: DocType) => {
    if (!confirm(`Deactivate "${t.label}"? Existing documents referencing this type will keep working; it just won't appear in new-document pickers.`)) return;
    try {
      await docTypesApi.remove(t.id);
      toast.success(`Deactivated "${t.label}"`);
      await load();
    } catch (e) {
      toast.error(extractApiError(e, 'Deactivate failed'));
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>Document Types</h1>
          <p style={{ fontSize: 13, color: 'var(--t3)', marginTop: 4, maxWidth: 720 }}>
            These are the credential types the AI document reviewer recognizes. Edit <code>prompt_hints</code> here
            to tell Claude exactly what "valid" looks like for each type — no code deploy needed. Admins can add new
            types on the fly (e.g. "Respirator Fit Test"), and the new-document picker on candidate profiles picks
            them up immediately.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)}
            style={{ padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, background: 'var(--sf)' }}>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
            <option value="all">All</option>
          </select>
          <button onClick={openNew} style={btnPrimary}>+ New Type</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>
      ) : types.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)', background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px dashed var(--bd)' }}>
          No document types found.
        </div>
      ) : (
        <div style={{ background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--sf2)', textAlign: 'left' }}>
                <th style={th}>Key</th>
                <th style={th}>Label</th>
                <th style={th}>Category</th>
                <th style={th}>Expires (mo)</th>
                <th style={th}>Issuing bodies</th>
                <th style={th}>Status</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--bd)' }}>
                  <td style={td}><code style={{ fontSize: 12, color: 'var(--pr)' }}>{t.key}</code></td>
                  <td style={td}><strong>{t.label}</strong>{t.description && <div style={{ fontSize: 11, color: 'var(--t3)' }}>{t.description.slice(0, 80)}</div>}</td>
                  <td style={td}>{t.category ?? '—'}</td>
                  <td style={td}>{t.expires_months ?? '—'}</td>
                  <td style={td}>{t.issuing_bodies.length > 0 ? t.issuing_bodies.join(', ') : '—'}</td>
                  <td style={td}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: t.active ? '#d1fae5' : '#f1f5f9', color: t.active ? '#065f46' : '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {t.active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td style={td}>
                    <button onClick={() => openEdit(t)} style={linkBtn}>Edit</button>
                    {t.active && <button onClick={() => void deactivate(t)} style={{ ...linkBtn, color: '#c62828' }}>Deactivate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditorModal state={editing} setState={setEditing} onSave={save} saving={saving} />}
    </div>
  );
}

// ─── Editor modal ───────────────────────────────────────────────────────────
function EditorModal({ state, setState, onSave, saving }: {
  state: FormState; setState: (s: FormState | null) => void; onSave: () => void; saving: boolean;
}) {
  const isEdit = !!state.id;
  const upd = <K extends keyof FormState>(k: K, v: FormState[K]) => setState({ ...state, [k]: v });
  const csv = (arr: string[] | undefined) => (arr ?? []).join(', ');
  const parseCsv = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);

  return (
    <div style={modalBg} onClick={() => setState(null)}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)', marginBottom: 16 }}>
          {isEdit ? `Edit: ${state.label}` : 'New document type'}
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Key (slug, lowercase, underscores only) *">
            <input value={state.key ?? ''} onChange={(e) => upd('key', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              disabled={isEdit} placeholder="e.g. respirator_fit_test" style={inp} />
          </Field>

          <Field label="Label (shown to users) *">
            <input value={state.label ?? ''} onChange={(e) => upd('label', e.target.value)} placeholder="Respirator Fit Test" style={inp} />
          </Field>

          <Field label="Description (short help text)">
            <input value={state.description ?? ''} onChange={(e) => upd('description', e.target.value)} style={inp} />
          </Field>

          <Field label="AI prompt hints (what the AI should look for) *">
            <textarea value={state.prompt_hints ?? ''} onChange={(e) => upd('prompt_hints', e.target.value)}
              rows={5} placeholder="Fit test certificate from OSHA-recognized tester. Must include: tested respirator model, fit test method (qualitative/quantitative), pass/fail, test date within last 12 months, tester name + credentials."
              style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} />
          </Field>

          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Category">
              <select value={state.category ?? ''} onChange={(e) => upd('category', e.target.value || null)} style={inp}>
                <option value="">—</option>
                {['nursing', 'employment', 'training', 'legal', 'safety'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Typical validity (months)">
              <input type="number" min={0} value={state.expires_months ?? ''}
                onChange={(e) => upd('expires_months', e.target.value ? Number(e.target.value) : null)}
                placeholder="24 for BLS, 12 for TB" style={inp} />
            </Field>
          </div>

          <Field label="Accepted issuing bodies (comma-separated, leave empty for no restriction)">
            <input value={csv(state.issuing_bodies)} onChange={(e) => upd('issuing_bodies', parseCsv(e.target.value))}
              placeholder="American Heart Association, American Red Cross" style={inp} />
          </Field>

          <Field label="Required fields the AI should verify (comma-separated)">
            <input value={csv(state.required_fields)} onChange={(e) => upd('required_fields', parseCsv(e.target.value))}
              placeholder="cardholder_name, issue_date, expiry_date" style={inp} />
          </Field>

          <Field label="Applies to roles (comma-separated, leave empty for all)">
            <input value={csv(state.applicable_roles)} onChange={(e) => upd('applicable_roles', parseCsv(e.target.value))}
              placeholder="RN, LPN, CNA" style={inp} />
          </Field>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t2)' }}>
            <input type="checkbox" checked={state.active ?? true} onChange={(e) => upd('active', e.target.checked)} />
            Active (appears in new-document picker)
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={() => setState(null)} style={btnSecondary}>Cancel</button>
          <button onClick={onSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const th: React.CSSProperties = { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: 'var(--t1)', verticalAlign: 'top' };
const btnPrimary: React.CSSProperties = { padding: '8px 16px', background: 'var(--pr)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'var(--sf2)', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { padding: '4px 8px', background: 'none', border: 'none', color: 'var(--pr)', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, outline: 'none', background: 'var(--sf)' };
const modalBg: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modalBox: React.CSSProperties = { background: 'var(--sf)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  );
}
