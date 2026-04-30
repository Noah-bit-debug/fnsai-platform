import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { esignApi, ESignTemplate } from '../../lib/api';

type Step = 'upload' | 'signers';

const SIGNER_ROLES = ['Signer', 'Approver', 'Viewer (CC)', 'Witness'];

interface SignerRow { name: string; email: string; role: string; auth_method: string; }

// One row per template-role, keyed by role.key. Used when the chosen
// template defines roles (HR, Candidate, …) so we collect a real signer
// per role instead of asking the user to add arbitrary names.
interface RoleSignerRow { name: string; email: string; auth_method: string; }

export default function ESignDocumentNew() {
  const nav = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');

  // Upload step
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [signingOrder, setSigningOrder] = useState<'parallel' | 'sequential'>('parallel');
  const [expiresDays, setExpiresDays] = useState(30);
  const [selectedTemplate, setSelectedTemplate] = useState<ESignTemplate | null>(null);
  const [templates, setTemplates] = useState<ESignTemplate[]>([]);
  const [templateMode, setTemplateMode] = useState<'upload' | 'template'>('upload');
  const [docId, setDocId] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);

  // Signers step
  const [signers, setSigners] = useState<SignerRow[]>([{ name: '', email: '', role: 'Signer', auth_method: 'email_link' }]);
  // role_signers — used when the chosen template defines roles. Map
  // from role.key → { name, email, auth_method }.
  const [roleSigners, setRoleSigners] = useState<Record<string, RoleSignerRow>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // True iff we're in template-mode AND the template has roles defined.
  // Drives whether step 2 shows the role-mapping panel or the legacy
  // free-form signers panel.
  const useRoleSigners =
    templateMode === 'template' &&
    !!selectedTemplate &&
    Array.isArray(selectedTemplate.roles) &&
    selectedTemplate.roles.length > 0;

  const [searchParams] = useSearchParams();

  useEffect(() => {
    esignApi.listTemplates().then((r) => {
      setTemplates(r.data.templates);
      // Phase 3.2 — pre-select template if passed via ?template=<id>
      // from the SendForESignButton shared picker. Also seeds title,
      // recipient name, and recipient email from query params so the
      // user doesn't have to re-enter them.
      const templateId = searchParams.get('template');
      if (templateId) {
        const t = r.data.templates.find((x) => x.id === templateId);
        if (t) {
          setSelectedTemplate(t);
          setTemplateMode('template');
          setTitle(searchParams.get('title') || t.name);
        }
      }
    }).catch(() => {});

    // Apply query-param seeds regardless of template state
    const qTitle = searchParams.get('title');
    const qName  = searchParams.get('recipient_name');
    const qEmail = searchParams.get('recipient_email');
    if (qTitle) setTitle(qTitle);
    if (qName || qEmail) {
      setSigners([{ name: qName ?? '', email: qEmail ?? '', role: 'Signer', auth_method: 'email_link' }]);
    }

    // Preserve legacy navigation state for backward compat
    const state = location.state as any;
    if (state?.template) { setSelectedTemplate(state.template); setTemplateMode('template'); setTitle(state.template.name); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); if (!title) setTitle(f.name.replace(/\.[^.]+$/, '')); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); if (!title) setTitle(f.name.replace(/\.[^.]+$/, '')); }
  };

  const handleNextStep = async () => {
    setError('');
    if (templateMode === 'upload') {
      if (!file) { setError('Please upload a file or choose a template.'); return; }
      if (!title.trim()) { setError('Please enter a document title.'); return; }
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', title);
        fd.append('message', message);
        fd.append('signing_order', signingOrder);
        const resp = await esignApi.uploadDocument(fd);
        setDocId(resp.data.document.id);
        setStep('signers');
      } catch { setError('Upload failed. Please try again.'); }
      finally { setUploading(false); }
    } else {
      // Template flow — validate template fields
      if (!selectedTemplate) { setError('Please select a template.'); return; }
      if (!title.trim()) { setError('Document title is required.'); return; }
      for (const f of selectedTemplate.fields ?? []) {
        if (f.required && !fieldValues[f.id]) { setError(`"${f.label}" is required.`); return; }
      }
      setStep('signers');
    }
  };

  const handleSend = async () => {
    setError('');
    if (useRoleSigners) {
      const roles = selectedTemplate!.roles ?? [];
      for (const r of roles) {
        const m = roleSigners[r.key];
        if (!m || !m.name.trim()) {
          setError(`Please fill in the ${r.label} signer.`);
          return;
        }
      }
    } else {
      if (signers.filter(s => s.name).length === 0) { setError('Add at least one signer.'); return; }
    }
    setSending(true);
    try {
      const validSigners = signers.filter(s => s.name).map((s, i) => ({ name: s.name, email: s.email || undefined, role: s.role.toLowerCase().replace(/\s.*/, ''), order_index: i, auth_method: s.auth_method }));

      // Two flows. CRITICAL: when a file was uploaded in step 1 the
      // upload endpoint already created a draft document WITH file_path.
      // Previously this branch called createDocument() which created a
      // *second* document (no file_path) and then sendDocument() created
      // a *third*. The user was navigated to the last one, which had no
      // PDF attached — leaving the original uploaded file orphaned and
      // causing the "PDF not available" banner in /prepare. Fix: attach
      // signers to the existing uploaded docId so the file_path is
      // preserved, then route to the field-placement editor.
      let targetDocId: string;
      let returnedSigners: any[] = [];
      let uploadedWithFile = false;
      if (docId) {
        uploadedWithFile = true;
        // Update metadata chosen in step 1 (title/message/order) on the
        // uploaded doc, then add each signer. Keep the doc in 'draft'
        // so the user can place fields on the PDF before sending.
        await esignApi.updateDocument(docId, {
          title,
          message,
          signing_order: signingOrder,
        });
        for (const s of validSigners) {
          const r = await esignApi.addSigner(docId, s);
          returnedSigners.push((r as any).data?.signer ?? r);
        }
        targetDocId = docId;
      } else {
        // Template flow — POST /documents creates the draft with signers
        // attached in one shot. Preserve pre-existing behavior: user lands
        // on the detail page where they can send it.
        // When the template defines roles, send `role_signers` (a
        // role.key → {name,email,auth_method} map) instead of `signers`.
        // The backend resolves it to one row per role.
        const body: Record<string, unknown> = {
          template_id: selectedTemplate!.id,
          title,
          field_values: fieldValues,
          signing_order: signingOrder,
          expires_days: expiresDays,
        };
        if (useRoleSigners) {
          body.role_signers = roleSigners;
        } else {
          body.signers = validSigners;
        }
        const resp = await (esignApi.sendDocument as unknown as (b: any) => Promise<any>)(body);
        targetDocId = resp.data.document.id;
        returnedSigners = resp.data.signers ?? [];
      }
      // For PDF uploads, the natural next step is to place fields — route
      // there. For template docs, route to the detail page as before.
      const dest = uploadedWithFile
        ? `/esign/documents/${targetDocId}/prepare`
        : `/esign/documents/${targetDocId}`;
      nav(dest, { state: { newSigners: returnedSigners } });
    } catch { setError('Failed to send. Please try again.'); }
    finally { setSending(false); }
  };

  const updateSigner = (i: number, field: keyof SignerRow, val: string) => {
    const ns = [...signers];
    ns[i] = { ...ns[i], [field]: val };
    setSigners(ns);
  };

  return (
    <div className="page-wrapper" style={{ maxWidth: 780, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <button onClick={() => step === 'signers' ? setStep('upload') : nav('/esign/documents')} style={{ background: '#f5f5f5', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', color: '#555', fontWeight: 600, fontSize: 13 }}>← Back</button>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>New Document</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#888' }}>{step === 'upload' ? 'Step 1 of 2 — Upload & Configure' : 'Step 2 of 2 — Add Signers'}</p>
        </div>
      </div>

      {/* Progress */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 28, background: '#f0f2f7', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {(['upload', 'signers'] as Step[]).map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderRadius: 8, background: step === s ? '#fff' : 'transparent', boxShadow: step === s ? '0 2px 8px rgba(0,0,0,0.07)' : 'none', transition: 'all 0.15s' }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: step === s ? '#1565c0' : (i === 0 && step !== 'upload') ? '#2e7d32' : '#ccc', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
              {i === 0 && step !== 'upload' ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: 13, fontWeight: step === s ? 700 : 400, color: step === s ? '#1565c0' : '#888' }}>{s === 'upload' ? 'Upload & Configure' : 'Add Signers & Send'}</span>
          </div>
        ))}
      </div>

      {error && <div style={{ background: '#fff3f3', border: '1px solid #fcc', borderRadius: 10, padding: '12px 16px', color: '#c62828', fontSize: 13, marginBottom: 18 }}>{error}</div>}

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Mode selector */}
          <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid #eef' }}>
              {(['upload', 'template'] as const).map((m) => (
                <button key={m} onClick={() => { setTemplateMode(m); setError(''); setSelectedTemplate(null); setFieldValues({}); }}
                  style={{ flex: 1, padding: '14px', border: 'none', cursor: 'pointer', fontWeight: templateMode === m ? 700 : 400, color: templateMode === m ? '#1565c0' : '#666', background: templateMode === m ? '#f5f8ff' : '#fff', borderBottom: `2px solid ${templateMode === m ? '#1565c0' : 'transparent'}`, fontSize: 14 }}>
                  {m === 'upload' ? '📎 Upload File' : '📄 Use Template'}
                </button>
              ))}
            </div>

            <div style={{ padding: 24 }}>
              {templateMode === 'upload' ? (
                <div>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    style={{ border: `2px dashed ${dragging ? '#1565c0' : file ? '#2e7d32' : '#ccc'}`, borderRadius: 12, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', background: dragging ? '#f5f8ff' : file ? '#f1f8f2' : '#fafafa', transition: 'all 0.15s' }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>{file ? '✅' : '☁️'}</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: file ? '#2e7d32' : '#444' }}>
                      {file ? file.name : 'Drop your file here or click to browse'}
                    </div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                      {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'PDF, Word, Excel, PowerPoint, PNG, JPG · Max 50MB'}
                    </div>
                    <input ref={fileInputRef} type="file" style={{ display: 'none' }} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg" onChange={handleFileChange} />
                  </div>
                  {file && <button onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} style={{ marginTop: 8, fontSize: 12, color: '#c62828', background: 'none', border: 'none', cursor: 'pointer' }}>Remove file</button>}
                </div>
              ) : (
                <div>
                  <p style={{ margin: '0 0 14px', fontSize: 13, color: '#555' }}>Choose one of your templates — field values will be filled in automatically</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxHeight: 280, overflow: 'auto' }}>
                    {templates.map((t) => (
                      <div key={t.id} onClick={() => {
                          setSelectedTemplate(t);
                          setTitle(t.name);
                          setError('');
                          const defaults: Record<string, string> = {};
                          (t.fields ?? []).forEach((f: any) => {
                            if (f.type === 'date') defaults[f.id] = new Date().toISOString().split('T')[0];
                          });
                          setFieldValues(defaults);
                          // Inherit the template's signing_order so the
                          // user doesn't have to re-pick it. The control
                          // remains editable below.
                          if (t.signing_order) setSigningOrder(t.signing_order);
                          // Seed an empty role-signer row for each role
                          // so the inputs render in step 2 without an
                          // extra add-row click.
                          if (t.roles && t.roles.length > 0) {
                            const seeded: Record<string, RoleSignerRow> = {};
                            for (const r of t.roles) {
                              seeded[r.key] = { name: '', email: '', auth_method: 'email_link' };
                            }
                            setRoleSigners(seeded);
                          } else {
                            setRoleSigners({});
                          }
                        }}
                        style={{ border: `2px solid ${selectedTemplate?.id === t.id ? '#1565c0' : '#e3e8f0'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', background: selectedTemplate?.id === t.id ? '#f0f4ff' : '#fff', transition: 'all 0.12s' }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>{t.category} · {(t.fields ?? []).length} fields</div>
                      </div>
                    ))}
                  </div>
                  {selectedTemplate && (selectedTemplate.fields ?? []).length > 0 && (
                    <div style={{ marginTop: 20, padding: '16px 18px', background: '#f8f9fc', borderRadius: 12, border: '1px solid #e3e8f0' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#1565c0' }}>Fill in Template Fields</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {(selectedTemplate.fields ?? []).map((f) => (
                          <div key={f.id} style={{ gridColumn: f.type === 'textarea' ? 'span 2' : undefined }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: '#444', display: 'block', marginBottom: 4 }}>{f.label}{f.required && <span style={{ color: '#c62828' }}> *</span>}</label>
                            {f.type === 'select' ? (
                              <select value={fieldValues[f.id] ?? ''} onChange={(e) => setFieldValues({ ...fieldValues, [f.id]: e.target.value })} style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12 }}>
                                <option value="">Select...</option>
                                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : f.type === 'textarea' ? (
                              <textarea value={fieldValues[f.id] ?? ''} onChange={(e) => setFieldValues({ ...fieldValues, [f.id]: e.target.value })} rows={2} style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }} />
                            ) : (
                              <input type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'} value={fieldValues[f.id] ?? ''} onChange={(e) => setFieldValues({ ...fieldValues, [f.id]: e.target.value })} style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12, boxSizing: 'border-box' }} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Document settings */}
          <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: 24 }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700 }}>Document Settings</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Document Title <span style={{ color: '#c62828' }}>*</span></label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter document title..." style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Signing Order</label>
                <select value={signingOrder} onChange={(e) => setSigningOrder(e.target.value as any)} style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
                  <option value="parallel">Parallel — everyone at once</option>
                  <option value="sequential">Sequential — one at a time, in order</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Expires After</label>
                <select value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))} style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Message to Signers (optional)</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Add a personal message that will be shown to signers..." style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleNextStep} disabled={uploading} style={{ padding: '12px 28px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: uploading ? 0.7 : 1 }}>
              {uploading ? 'Uploading...' : 'Next: Add Signers →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Signers ── */}
      {step === 'signers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: 24 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>
              {useRoleSigners ? 'Assign Signers to Roles' : 'Add Signers'}
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#666' }}>
              {useRoleSigners
                ? `This template defines ${selectedTemplate!.roles!.length} role${selectedTemplate!.roles!.length !== 1 ? 's' : ''}. Assign one signer per role.`
                : signingOrder === 'sequential'
                  ? '⚡ Sequential order — signers will receive the document one at a time, in the order listed below.'
                  : '⚡ Parallel — all signers will receive the document at the same time.'}
            </p>

            {useRoleSigners ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[...selectedTemplate!.roles!].sort((a, b) => a.order - b.order).map((role) => {
                  const m = roleSigners[role.key] ?? { name: '', email: '', auth_method: 'email_link' };
                  const update = (patch: Partial<RoleSignerRow>) =>
                    setRoleSigners(prev => ({ ...prev, [role.key]: { ...m, ...patch } }));
                  return (
                    <div key={role.key} style={{ display: 'grid', gridTemplateColumns: signingOrder === 'sequential' ? '28px 120px 1fr 1fr 1fr' : '120px 1fr 1fr 1fr', gap: 8, alignItems: 'center', padding: '12px 14px', border: '1px solid #e8edf5', borderRadius: 10, background: '#fafbff' }}>
                      {signingOrder === 'sequential' && (
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1565c0', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{role.order}</div>
                      )}
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>{role.label}</div>
                      <input placeholder="Full Name *" value={m.name} onChange={(e) => update({ name: e.target.value })} style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12 }} />
                      <input placeholder="Email address" type="email" value={m.email} onChange={(e) => update({ email: e.target.value })} style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12 }} />
                      <select value={m.auth_method} onChange={(e) => update({ auth_method: e.target.value })} style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12 }}>
                        <option value="email_link">Email Link</option>
                        <option value="sms_otp">SMS OTP</option>
                        <option value="access_code">Access Code</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            ) : (
            <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {signers.map((s, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: signingOrder === 'sequential' ? '24px 1fr 1fr 1fr 1fr auto' : '1fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'center', padding: '12px 14px', border: '1px solid #e8edf5', borderRadius: 10, background: '#fafbff' }}>
                  {signingOrder === 'sequential' && (
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#1565c0', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                  )}
                  <input placeholder="Full Name *" value={s.name} onChange={(e) => updateSigner(i, 'name', e.target.value)} style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12 }} />
                  <input placeholder="Email address" type="email" value={s.email} onChange={(e) => updateSigner(i, 'email', e.target.value)} style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12 }} />
                  <select value={s.role} onChange={(e) => updateSigner(i, 'role', e.target.value)} style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12 }}>
                    {SIGNER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={s.auth_method} onChange={(e) => updateSigner(i, 'auth_method', e.target.value)} style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12 }}>
                    <option value="email_link">Email Link</option>
                    <option value="sms_otp">SMS OTP</option>
                    <option value="access_code">Access Code</option>
                  </select>
                  {signers.length > 1 && (
                    <button onClick={() => setSigners(signers.filter((_, j) => j !== i))} style={{ background: '#fee', color: '#c62828', border: '1px solid #fcc', borderRadius: 7, padding: '7px 10px', cursor: 'pointer', fontWeight: 700 }}>×</button>
                  )}
                </div>
              ))}
            </div>

            <button onClick={() => setSigners([...signers, { name: '', email: '', role: 'Signer', auth_method: 'email_link' }])}
              style={{ marginTop: 12, fontSize: 12, color: '#1565c0', background: 'none', border: '1px dashed #1565c0', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontWeight: 600 }}>
              + Add Another Signer
            </button>
            </>
            )}
          </div>

          {/* Summary */}
          <div style={{ background: '#f8f9fc', border: '1px solid #e3e8f0', borderRadius: 12, padding: '16px 20px', fontSize: 13, color: '#555' }}>
            {useRoleSigners
              ? <><strong>{title}</strong> will be sent to <strong>{Object.values(roleSigners).filter(r => r.name).length} of {selectedTemplate!.roles!.length} role{selectedTemplate!.roles!.length !== 1 ? 's' : ''}</strong> and expires in <strong>{expiresDays} days</strong>.</>
              : <><strong>{title}</strong> will be sent to <strong>{signers.filter(s => s.name).length} signer{signers.filter(s => s.name).length !== 1 ? 's' : ''}</strong> and expires in <strong>{expiresDays} days</strong>.</>}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep('upload')} style={{ padding: '12px 22px', border: '1px solid #ddd', borderRadius: 10, background: '#fff', cursor: 'pointer', fontWeight: 600, color: '#555' }}>← Back</button>
            <button onClick={handleSend} disabled={sending} style={{ padding: '12px 28px', background: '#1b5e20', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: sending ? 0.7 : 1 }}>
              {sending
                ? (templateMode === 'upload' ? 'Saving...' : 'Sending...')
                : (templateMode === 'upload' ? '✎ Continue to Place Fields →' : '✉ Send for Signature')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
