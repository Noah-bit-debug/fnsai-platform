/**
 * ESignForms — Online forms: list, create, share links, view submissions
 */
import { useState, useEffect } from 'react';
import { esignApi } from '../../lib/api';

interface OnlineForm {
  id: string;
  title: string;
  description?: string;
  share_token: string;
  is_active: boolean;
  submission_count?: number;
  created_at: string;
}

interface Submission {
  id: string;
  submitted_at: string;
  submitter_name?: string;
  submitter_email?: string;
  data: Record<string, any>;
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

function FormModal({ initial, onSave, onClose }: {
  initial?: OnlineForm | null;
  onSave: (data: { title: string; description: string; fields: any[] }) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle]       = useState(initial?.title ?? '');
  const [desc, setDesc]         = useState(initial?.description ?? '');
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr('Title is required'); return; }
    setSaving(true); setErr(null);
    try {
      await onSave({ title: title.trim(), description: desc, fields: [] });
    } catch {
      setErr('Save failed. Please try again.');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onSubmit={submit} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}>
        <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, fontSize: 16 }}>{initial ? 'Edit Form' : 'New Online Form'}</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#aaa' }}>×</button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {err && <div style={{ background: '#fef2f2', color: '#c62828', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{err}</div>}
          <div>
            <label style={labelSt}>Form Title *</label>
            <input style={inpSt} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Employee Contact Form" required />
          </div>
          <div>
            <label style={labelSt}>Description</label>
            <textarea style={{ ...inpSt, minHeight: 80, resize: 'vertical' } as React.CSSProperties} value={desc} onChange={e => setDesc(e.target.value)} placeholder="What is this form for?" />
          </div>
          <div style={{ background: '#f0f7ff', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#1565c0' }}>
            💡 After creating the form, share the link with anyone — they can submit without logging in.
          </div>
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: '9px 18px', background: '#f5f5f5', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: '9px 22px', background: saving ? '#aaa' : '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13 }}>
            {saving ? 'Creating…' : 'Create Form'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Submissions Drawer ───────────────────────────────────────────────────────

function SubmissionsDrawer({ form, onClose }: { form: OnlineForm; onClose: () => void }) {
  const [subs, setSubs]   = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Submission | null>(null);

  useEffect(() => {
    esignApi.getFormSubmissions(form.id)
      .then(r => setSubs(r.data?.submissions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [form.id]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 900, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 460, background: '#fff', height: '100%', display: 'flex', flexDirection: 'column', boxShadow: '-6px 0 30px rgba(0,0,0,0.15)' }}>
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Submissions</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{form.title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#aaa' }}>×</button>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>Loading…</div>
        ) : subs.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#ccc' }}>
            <span style={{ fontSize: 36 }}>📭</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>No submissions yet</span>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {subs.map(s => (
              <div key={s.id}
                onClick={() => setSelected(selected?.id === s.id ? null : s)}
                style={{ padding: '14px 22px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer', background: selected?.id === s.id ? '#f0f7ff' : 'transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.submitter_name ?? 'Anonymous'}</div>
                  <div style={{ fontSize: 11, color: '#aaa' }}>{new Date(s.submitted_at).toLocaleDateString()}</div>
                </div>
                {s.submitter_email && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{s.submitter_email}</div>}

                {/* Expanded data */}
                {selected?.id === s.id && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(s.data ?? {}).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                        <span style={{ color: '#888', minWidth: 100, flexShrink: 0 }}>{k}:</span>
                        <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ESignForms() {
  const [forms, setForms]       = useState<OnlineForm[]>([]);
  const [loading, setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewSubs, setViewSubs] = useState<OnlineForm | null>(null);
  const [copied, setCopied]     = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setForms((await esignApi.listForms()).data?.forms ?? []); }
    catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (data: { title: string; description: string; fields: any[] }) => {
    await esignApi.createForm(data);
    setModalOpen(false);
    await load();
  };

  const copyLink = (shareToken: string, id: string) => {
    const url = `${window.location.origin}/f/${shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const toggleActive = async (form: OnlineForm) => {
    setToggling(form.id);
    try {
      await esignApi.updateForm(form.id, { is_active: !form.is_active });
      await load();
    } catch { /* */ }
    finally { setToggling(null); }
  };

  const shareUrl = (token: string) => `${window.location.origin}/f/${token}`;

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h1 className="page-title">Online Forms</h1>
          <p className="page-subtitle">Shareable forms that anyone can submit — no login required</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
        >
          ＋ New Form
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading forms…</div>
      ) : forms.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#ccc' }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>No forms yet</div>
          <div style={{ fontSize: 13, marginBottom: 20 }}>Create a form and share the link with staff or clients</div>
          <button onClick={() => setModalOpen(true)} style={{ padding: '10px 22px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
            Create First Form
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {forms.map(form => (
            <div key={form.id} style={{ background: '#fff', border: '1px solid #e8eaf0', borderRadius: 14, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>

              {/* Status dot */}
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: form.is_active ? '#2e7d32' : '#ccc', flexShrink: 0 }} title={form.is_active ? 'Active' : 'Inactive'} />

              {/* Info */}
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{form.title}</div>
                {form.description && <div style={{ fontSize: 12, color: '#888', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{form.description}</div>}
                <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>
                  Created {new Date(form.created_at).toLocaleDateString()}
                  {form.submission_count !== undefined && ` · ${form.submission_count} submission${form.submission_count !== 1 ? 's' : ''}`}
                </div>
              </div>

              {/* Share link */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f5f7fa', borderRadius: 8, padding: '6px 10px', flex: '0 0 auto', maxWidth: 260, overflow: 'hidden' }}>
                <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                  {shareUrl(form.share_token)}
                </span>
                <button
                  onClick={() => copyLink(form.share_token, form.id)}
                  style={{ background: copied === form.id ? '#2e7d32' : '#1565c0', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                >
                  {copied === form.id ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => setViewSubs(form)}
                  style={{ padding: '7px 14px', background: '#f0f7ff', border: '1px solid #c8e0fc', borderRadius: 8, color: '#1565c0', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}
                >
                  📊 Submissions
                  {(form.submission_count ?? 0) > 0 && (
                    <span style={{ marginLeft: 5, background: '#1565c0', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                      {form.submission_count}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => toggleActive(form)}
                  disabled={toggling === form.id}
                  style={{ padding: '7px 12px', background: form.is_active ? '#fff8e1' : '#e8f5e9', border: `1px solid ${form.is_active ? '#ffe082' : '#a5d6a7'}`, borderRadius: 8, color: form.is_active ? '#f57c00' : '#2e7d32', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}
                >
                  {toggling === form.id ? '…' : form.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <FormModal onSave={handleCreate} onClose={() => setModalOpen(false)} />
      )}

      {viewSubs && (
        <SubmissionsDrawer form={viewSubs} onClose={() => setViewSubs(null)} />
      )}
    </div>
  );
}

const labelSt: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 };
const inpSt: React.CSSProperties   = { width: '100%', padding: '8px 12px', border: '1.5px solid #e3e8f0', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fafafa', fontFamily: 'inherit' };
