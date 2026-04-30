/**
 * ESignTemplates — Browse, create, edit, duplicate & delete templates.
 *
 * PR scope: template-roles rework. Templates now own a PDF + a list
 * of roles (HR, Candidate, …) + a signing_order. The editor lets
 * recruiters define those once per template; later when a real
 * document is sent from this template, the new-document flow asks
 * for one signer (name + email) per role rather than one signer
 * per document.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { esignApi, ESignTemplate, ESignTemplateRole } from '../../lib/api';
import { useToast } from '../../components/ToastHost';

const DEFAULT_ROLES: ESignTemplateRole[] = [
  { key: 'hr',        label: 'HR',        order: 1 },
  { key: 'candidate', label: 'Candidate', order: 2 },
];

const CATEGORY_COLORS: Record<string, string> = {
  Compliance:       '#1565c0',
  HR:               '#2e7d32',
  Legal:            '#6a1b9a',
  Operations:       '#e65100',
  Payroll:          '#00838f',
  'Health Screening': '#ad1457',
  Custom:           '#37474f',
};

const ALL_CATEGORIES = ['Compliance', 'HR', 'Legal', 'Operations', 'Payroll', 'Health Screening', 'Custom'];

function catBadge(cat: string) {
  const color = CATEGORY_COLORS[cat] ?? '#555';
  return (
    <span style={{ background: color + '18', color, border: `1px solid ${color}40`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
      {cat}
    </span>
  );
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

interface TemplateForm {
  name: string;
  description: string;
  category: string;
  content: string;
  fields: string; // JSON string
  roles: ESignTemplateRole[];
  signing_order: 'parallel' | 'sequential';
}

const BLANK_FORM: TemplateForm = {
  name: '', description: '', category: 'Custom', content: '', fields: '[]',
  roles: DEFAULT_ROLES,
  signing_order: 'parallel',
};

function TemplateModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: ESignTemplate | null;
  onSave: (data: TemplateForm, file: File | null) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<TemplateForm>(
    initial
      ? {
          name: initial.name,
          description: initial.description ?? '',
          category: initial.category ?? 'Custom',
          content: (initial as any).content ?? '',
          fields: JSON.stringify((initial as any).fields ?? [], null, 2),
          roles: initial.roles && initial.roles.length > 0
            ? initial.roles.map(r => ({ ...r }))
            : DEFAULT_ROLES.map(r => ({ ...r })),
          signing_order: initial.signing_order ?? 'parallel',
        }
      : { ...BLANK_FORM, roles: DEFAULT_ROLES.map(r => ({ ...r })) }
  );
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const isSystem = !!(initial as any)?.is_system;

  const set = (k: keyof TemplateForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  // Slugify the same way the backend does so the preview key matches
  // what the server will store. See backend/src/services/templateRoles.ts.
  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const updateRole = (idx: number, patch: Partial<ESignTemplateRole>) => {
    setForm(prev => {
      const roles = prev.roles.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      // Keep key in sync with label when the user is editing the label.
      if (patch.label !== undefined) {
        roles[idx].key = slugify(patch.label) || roles[idx].key;
      }
      return { ...prev, roles };
    });
  };
  const addRole = () => {
    setForm(prev => ({
      ...prev,
      roles: [
        ...prev.roles,
        { key: '', label: '', order: prev.roles.length + 1 },
      ],
    }));
  };
  const removeRole = (idx: number) => {
    setForm(prev => {
      const next = prev.roles.filter((_, i) => i !== idx).map((r, i) => ({ ...r, order: i + 1 }));
      return { ...prev, roles: next };
    });
  };
  const moveRole = (idx: number, dir: -1 | 1) => {
    setForm(prev => {
      const next = [...prev.roles];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return { ...prev, roles: next.map((r, i) => ({ ...r, order: i + 1 })) };
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    if (form.roles.length === 0) { setErr('Add at least one signing role.'); return; }
    for (const r of form.roles) {
      if (!r.label.trim()) { setErr('Every role needs a label.'); return; }
    }
    const keys = form.roles.map(r => slugify(r.label));
    if (new Set(keys).size !== keys.length) {
      setErr('Role labels must be unique (case-insensitive).');
      return;
    }
    try {
      JSON.parse(form.fields);
    } catch {
      setErr('Default Fields must be valid JSON.');
      return;
    }
    setSaving(true); setErr(null);
    try { await onSave(form, pdfFile); }
    catch { setErr('Save failed. Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onSubmit={submit} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, fontSize: 16 }}>{initial ? 'Edit Template' : 'New Template'}</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#aaa' }}>×</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {err && <div style={{ background: '#fef2f2', color: '#c62828', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{err}</div>}

          <Field label="Template Name *">
            <input style={inp} value={form.name} onChange={set('name')} placeholder="e.g. HIPAA Authorization Form" required />
          </Field>

          <Field label="Description">
            <input style={inp} value={form.description} onChange={set('description')} placeholder="Brief description of this template" />
          </Field>

          <Field label="Category">
            <select style={inp} value={form.category} onChange={set('category')}>
              {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          {!isSystem && (
            <Field label="PDF File">
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                style={{ ...inp, padding: '7px 10px' } as React.CSSProperties}
              />
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>
                {initial?.file_path
                  ? 'A PDF is attached. Choose a new file to replace it.'
                  : 'Optional. Attach a PDF that signers will fill out.'}
              </div>
            </Field>
          )}

          {/* Roles editor — defines who signs this template by ROLE,
              not by name. Each role gets a stable key (auto-slugged
              from label). The order column matters when signing_order
              is "sequential". */}
          <Field label="Signing Roles">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {form.roles.map((r, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{
                    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%', background: '#e3f2fd', color: '#1565c0', fontWeight: 700, fontSize: 12,
                  }}>{r.order}</span>
                  <input
                    style={{ ...inp, flex: 1 }}
                    value={r.label}
                    onChange={(e) => updateRole(idx, { label: e.target.value })}
                    placeholder="e.g. HR, Candidate, Manager"
                  />
                  <button
                    type="button"
                    onClick={() => moveRole(idx, -1)}
                    disabled={idx === 0}
                    title="Move up"
                    style={{ padding: '6px 9px', background: '#f5f5f5', border: '1px solid #e3e8f0', borderRadius: 6, cursor: idx === 0 ? 'not-allowed' : 'pointer', fontSize: 12, opacity: idx === 0 ? 0.4 : 1 }}
                  >↑</button>
                  <button
                    type="button"
                    onClick={() => moveRole(idx, 1)}
                    disabled={idx === form.roles.length - 1}
                    title="Move down"
                    style={{ padding: '6px 9px', background: '#f5f5f5', border: '1px solid #e3e8f0', borderRadius: 6, cursor: idx === form.roles.length - 1 ? 'not-allowed' : 'pointer', fontSize: 12, opacity: idx === form.roles.length - 1 ? 0.4 : 1 }}
                  >↓</button>
                  <button
                    type="button"
                    onClick={() => removeRole(idx)}
                    title="Remove role"
                    style={{ padding: '6px 9px', background: '#fef2f2', color: '#c62828', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                  >×</button>
                </div>
              ))}
              <button
                type="button"
                onClick={addRole}
                style={{ alignSelf: 'flex-start', padding: '6px 12px', background: '#e3f2fd', color: '#1565c0', border: '1px solid #bbdefb', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              >+ Add role</button>
            </div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 5 }}>
              Each document sent from this template will collect a signer (name + email) for every role.
            </div>
          </Field>

          <Field label="Signing Order">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['parallel', 'sequential'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, signing_order: v }))}
                  style={{
                    padding: '8px 14px',
                    background: form.signing_order === v ? '#1565c0' : '#fff',
                    color: form.signing_order === v ? '#fff' : '#555',
                    border: '1.5px solid ' + (form.signing_order === v ? '#1565c0' : '#e3e8f0'),
                    borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}
                >
                  {v === 'parallel' ? 'Parallel — all sign at once' : 'Sequential — one after another'}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Document Content">
            <textarea
              style={{ ...inp, minHeight: 140, resize: 'vertical' } as React.CSSProperties}
              value={form.content}
              onChange={set('content')}
              placeholder="Paste the document text or instructions here. Signers will see this when signing."
            />
          </Field>

          <Field label="Default Fields (JSON array)">
            <textarea
              style={{ ...inp, minHeight: 80, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' } as React.CSSProperties}
              value={form.fields}
              onChange={set('fields')}
              placeholder='[{"field_type":"signature","label":"Signature","required":true}]'
            />
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>Optional pre-set fields added when this template is used.</div>
          </Field>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }} style={{ padding: '9px 20px', background: '#f5f5f5', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: '9px 24px', background: saving ? '#aaa' : '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13 }}>
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ESignTemplates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<ESignTemplate[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [catFilter, setCatFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState<'all' | 'system' | 'custom'>('all');

  const [modalOpen, setModalOpen]     = useState(false);

  // Phase 3.3 — ?new=1 query param opens the create-template modal on mount.
  // This is how the eSign Dashboard's "+ New Template" button jumps
  // straight into creation without an extra click.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setModalOpen(true);
      // Strip the query so refresh doesn't re-open it unexpectedly
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [editTarget, setEditTarget]   = useState<ESignTemplate | null>(null);
  const [deleting, setDeleting]       = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [actionMenu, setActionMenu]   = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await esignApi.listTemplates();
      setTemplates(res.data?.templates ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Click outside to close action menu
  useEffect(() => {
    const handler = () => setActionMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const filtered = templates.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q);
    const matchCat    = catFilter === 'All' || t.category === catFilter;
    const matchType   = typeFilter === 'all' || (typeFilter === 'system' ? (t as any).is_system : !(t as any).is_system);
    return matchSearch && matchCat && matchType;
  });

  const toast = useToast();

  const handleSave = async (form: TemplateForm, file: File | null) => {
    const payload = {
      name:           form.name,
      description:    form.description,
      category:       form.category,
      content:        form.content,
      fields: JSON.parse(form.fields),
      roles:          form.roles,
      signing_order:  form.signing_order,
    };
    let savedId: string | undefined;
    if (editTarget) {
      const res = await esignApi.updateTemplate(editTarget.id, payload as any);
      savedId = res.data?.template?.id ?? editTarget.id;
    } else {
      const res = await esignApi.createTemplate(payload as any);
      savedId = res.data?.template?.id;
    }
    if (file && savedId) {
      try {
        await esignApi.uploadTemplateFile(savedId, file);
      } catch {
        toast.error('Template saved, but PDF upload failed.');
      }
    }
    setModalOpen(false);
    setEditTarget(null);
    await load();
  };

  const handleDelete = async (id: string) => {
    setConfirmDelete(id);
  };

  const confirmDoDelete = async () => {
    const id = confirmDelete;
    if (!id) return;
    setConfirmDelete(null);
    setDeleting(id);
    try { await esignApi.deleteTemplate(id); await load(); }
    catch { alert('Delete failed.'); }
    finally { setDeleting(null); }
  };

  const handleDuplicate = async (id: string) => {
    setDuplicating(id);
    try { await esignApi.duplicateTemplate(id); await load(); }
    catch { alert('Duplicate failed.'); }
    finally { setDuplicating(null); }
  };

  const useTemplate = (t: ESignTemplate) => {
    navigate('/esign/documents/new', { state: { templateId: t.id, templateName: t.name } });
  };

  const categories = ['All', ...Array.from(new Set(templates.map(t => t.category).filter(Boolean)))];

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h1 className="page-title">Templates</h1>
          <p className="page-subtitle">Reusable document templates for common healthcare workflows</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setModalOpen(true); }}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
        >
          ＋ New Template
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <input
          style={{ padding: '8px 14px', border: '1.5px solid #e3e8f0', borderRadius: 8, fontSize: 13, outline: 'none', width: 220 }}
          placeholder="Search templates…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select style={{ padding: '8px 12px', border: '1.5px solid #e3e8f0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1.5px solid #e3e8f0' }}>
          {(['all', 'system', 'custom'] as const).map(v => (
            <button key={v} onClick={() => setTypeFilter(v)}
              style={{ padding: '7px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: typeFilter === v ? '#1565c0' : '#fff',
                color: typeFilter === v ? '#fff' : '#555' }}>
              {v === 'all' ? 'All' : v === 'system' ? '🏥 System' : '⚙️ Custom'}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: '#aaa', marginLeft: 4 }}>{filtered.length} template{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading templates…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#ccc' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🗂️</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No templates found</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Try adjusting your search or create a new template</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {filtered.map(t => {
            const isSystem = !!(t as any).is_system;
            const color = CATEGORY_COLORS[t.category ?? ''] ?? '#555';
            const isActionOpen = actionMenu === t.id;

            return (
              <div key={t.id} style={{
                background: '#fff', border: '1px solid #e8eaf0', borderRadius: 14, padding: '18px 20px',
                display: 'flex', flexDirection: 'column', gap: 10,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)', position: 'relative',
                transition: 'box-shadow 0.15s',
              }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.09)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)')}
              >
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 4 }}>
                      {catBadge(t.category ?? 'Custom')}
                      {isSystem && (
                        <span style={{ background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>System</span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e', lineHeight: 1.3 }}>{t.name}</div>
                  </div>

                  {/* Actions menu */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={e => { e.stopPropagation(); setActionMenu(isActionOpen ? null : t.id); }}
                      style={{ background: 'none', border: '1px solid #e3e8f0', borderRadius: 6, cursor: 'pointer', padding: '4px 8px', fontSize: 16, color: '#888' }}
                    >⋯</button>
                    {isActionOpen && (
                      <div onClick={e => e.stopPropagation()} style={{
                        position: 'absolute', right: 0, top: 32, background: '#fff', border: '1px solid #e3e8f0',
                        borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.14)', zIndex: 50, minWidth: 160, overflow: 'hidden',
                      }}>
                        {[
                          { label: '📄 Use Template', action: () => { useTemplate(t); setActionMenu(null); } },
                          { label: '📋 Duplicate',    action: () => { handleDuplicate(t.id); setActionMenu(null); }, disabled: duplicating === t.id },
                          ...(!isSystem ? [
                            { label: '✏️ Edit',       action: () => { setEditTarget(t); setModalOpen(true); setActionMenu(null); } },
                            { label: '🗑 Delete',      action: () => { handleDelete(t.id); setActionMenu(null); }, danger: true, disabled: deleting === t.id },
                          ] : []),
                        ].map((item, i) => (
                          <button key={i} onClick={item.action} disabled={item.disabled}
                            style={{
                              display: 'block', width: '100%', padding: '10px 16px', background: 'none', border: 'none',
                              textAlign: 'left', cursor: item.disabled ? 'not-allowed' : 'pointer', fontSize: 13,
                              color: (item as any).danger ? '#c62828' : '#333', fontWeight: 500,
                              opacity: item.disabled ? 0.5 : 1,
                            }}
                            onMouseEnter={e => { if (!item.disabled) (e.currentTarget as HTMLButtonElement).style.background = '#f5f7fa'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Description */}
                {t.description && (
                  <p style={{ fontSize: 12, color: '#666', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>
                    {t.description}
                  </p>
                )}

                {/* Fields count */}
                {(t as any).fields?.length > 0 && (
                  <div style={{ fontSize: 11, color: '#aaa' }}>
                    {(t as any).fields.length} default field{(t as any).fields.length !== 1 ? 's' : ''}
                  </div>
                )}

                {/* Bottom bar */}
                <div style={{ borderTop: '1px solid #f5f5f5', paddingTop: 12, marginTop: 2, display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => useTemplate(t)}
                    style={{ flex: 1, padding: '8px 0', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}
                  >
                    Use Template
                  </button>
                  {!isSystem && (
                    <button
                      onClick={() => { setEditTarget(t); setModalOpen(true); }}
                      style={{ padding: '8px 14px', background: '#f5f7fa', border: '1px solid #e3e8f0', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 12, color: '#555' }}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <TemplateModal
          initial={editTarget}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '28px 32px', maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8 }}>Delete Template?</div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 24 }}>This template will be permanently deleted. This action cannot be undone.</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setConfirmDelete(null)} style={{ padding: '10px 24px', background: '#f5f5f5', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button onClick={confirmDoDelete} style={{ padding: '10px 24px', background: '#c62828', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

const inp: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1.5px solid #e3e8f0', borderRadius: 8,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fafafa', fontFamily: 'inherit',
};
