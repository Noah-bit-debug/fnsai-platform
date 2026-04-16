import { useState, useEffect, useRef } from 'react';
import { esignApi, ESignTemplate, ESignDocument } from '../lib/api';
import SignatureCapture from '../components/ESign/SignatureCapture';

type Tab = 'templates' | 'send' | 'pending' | 'completed';

const CATEGORY_COLORS: Record<string, string> = {
  Compliance: '#1565c0',
  HR: '#2e7d32',
  Legal: '#6a1b9a',
  Operations: '#e65100',
  Payroll: '#00838f',
  'Health Screening': '#ad1457',
  Custom: '#37474f',
};

function categoryBadge(cat: string) {
  const color = CATEGORY_COLORS[cat] ?? '#555';
  return (
    <span style={{ background: color + '18', color, border: `1px solid ${color}40`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
      {cat}
    </span>
  );
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    sent: { label: 'Awaiting', color: '#f57c00' },
    partially_signed: { label: 'Partial', color: '#0288d1' },
    completed: { label: 'Completed', color: '#2e7d32' },
    voided: { label: 'Voided', color: '#c62828' },
    draft: { label: 'Draft', color: '#546e7a' },
    expired: { label: 'Expired', color: '#795548' },
  };
  const s = map[status] ?? { label: status, color: '#555' };
  return (
    <span style={{ background: s.color + '18', color: s.color, border: `1px solid ${s.color}40`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

function signerStatusIcon(status: string) {
  if (status === 'signed') return <span style={{ color: '#2e7d32' }}>✓ Signed</span>;
  if (status === 'viewed') return <span style={{ color: '#0288d1' }}>👁 Viewed</span>;
  if (status === 'declined') return <span style={{ color: '#c62828' }}>✗ Declined</span>;
  return <span style={{ color: '#f57c00' }}>⏳ Pending</span>;
}

// ─── Send Document Modal ──────────────────────────────────────────────────────
function SendModal({ template, onClose, onSent }: { template: ESignTemplate; onClose: () => void; onSent: (doc: ESignDocument, signers: any[]) => void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [signers, setSigners] = useState([{ name: '', email: '', role: 'Employee' }]);
  const [expiresDays, setExpiresDays] = useState(30);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async () => {
    for (const f of template.fields ?? []) {
      if (f.required && !fields[f.id]) {
        setError(`"${f.label}" is required`); return;
      }
    }
    if (!signers[0].name) { setError('At least one signer name is required'); return; }
    setSending(true); setError('');
    try {
      const title = `${template.name} — ${fields['employee_name'] ?? fields['candidate_name'] ?? signers[0].name}`;
      const resp = await esignApi.sendDocument({
        template_id: template.id,
        title,
        field_values: fields,
        signers: signers.filter(s => s.name),
        expires_days: expiresDays,
      });
      onSent(resp.data.document, resp.data.signers);
    } catch {
      setError('Failed to send document. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const autofillField = (id: string) => {
    if (id === 'sign_date' || id === 'test_date') return new Date().toISOString().split('T')[0];
    return '';
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 16, width: 600, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid #eee' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{template.name}</h3>
              <div style={{ marginTop: 4 }}>{categoryBadge(template.category)}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888' }}>×</button>
          </div>
        </div>

        <div style={{ padding: '20px 28px' }}>
          <p style={{ fontSize: 13, color: '#555', margin: '0 0 20px' }}>{template.description}</p>

          {/* Document Fields */}
          {(template.fields ?? []).length > 0 && (
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: '#1565c0', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Document Fields</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 24 }}>
                {(template.fields ?? []).map((field) => (
                  <div key={field.id} style={{ gridColumn: field.type === 'textarea' ? 'span 2' : undefined }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 4 }}>
                      {field.label} {field.required && <span style={{ color: '#c62828' }}>*</span>}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        value={fields[field.id] ?? ''}
                        onChange={(e) => setFields({ ...fields, [field.id]: e.target.value })}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}
                      >
                        <option value="">Select...</option>
                        {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        value={fields[field.id] ?? ''}
                        onChange={(e) => setFields({ ...fields, [field.id]: e.target.value })}
                        placeholder={field.placeholder ?? ''}
                        rows={3}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                      />
                    ) : (
                      <input
                        type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                        value={fields[field.id] ?? autofillField(field.id)}
                        onChange={(e) => setFields({ ...fields, [field.id]: e.target.value })}
                        placeholder={field.placeholder ?? ''}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Signers */}
          <h4 style={{ fontSize: 13, fontWeight: 700, color: '#1565c0', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Signers</h4>
          {signers.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input
                placeholder="Full Name *"
                value={s.name}
                onChange={(e) => { const n = [...signers]; n[i].name = e.target.value; setSigners(n); }}
                style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}
              />
              <input
                placeholder="Email (optional)"
                type="email"
                value={s.email}
                onChange={(e) => { const n = [...signers]; n[i].email = e.target.value; setSigners(n); }}
                style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}
              />
              <select
                value={s.role}
                onChange={(e) => { const n = [...signers]; n[i].role = e.target.value; setSigners(n); }}
                style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}
              >
                <option>Employee</option>
                <option>Supervisor</option>
                <option>Witness</option>
                <option>HR Representative</option>
              </select>
              {signers.length > 1 && (
                <button onClick={() => setSigners(signers.filter((_, j) => j !== i))} style={{ background: '#fee', color: '#c62828', border: '1px solid #fcc', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontWeight: 700 }}>×</button>
              )}
            </div>
          ))}
          <button
            onClick={() => setSigners([...signers, { name: '', email: '', role: 'Employee' }])}
            style={{ fontSize: 12, color: '#1565c0', background: 'none', border: '1px dashed #1565c0', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', marginBottom: 20 }}
          >
            + Add Another Signer
          </button>

          {/* Expiry */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#333', display: 'block', marginBottom: 4 }}>Signing Deadline</label>
            <select value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))} style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>

          {error && <div style={{ background: '#fff3f3', border: '1px solid #fcc', borderRadius: 8, padding: '10px 14px', color: '#c62828', fontSize: 13, marginBottom: 12 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '10px 22px', border: '1px solid #ddd', borderRadius: 10, background: '#f5f5f5', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
            <button
              onClick={handleSend}
              disabled={sending}
              style={{ padding: '10px 28px', border: 'none', borderRadius: 10, background: '#1565c0', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14, opacity: sending ? 0.7 : 1 }}
            >
              {sending ? 'Sending...' : '✉ Send for Signature'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Signing Links Modal ──────────────────────────────────────────────────────
function SigningLinksModal({ signers, onClose }: { signers: any[]; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (url: string, name: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(name);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 16, width: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Document Sent!</h3>
          <p style={{ color: '#555', fontSize: 14, margin: '8px 0 0' }}>Share these signing links with each signer</p>
        </div>

        {signers.map((s) => (
          <div key={s.name} style={{ border: '1px solid #e3e8f0', borderRadius: 12, padding: '16px 20px', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{s.name}</div>
            {s.email && <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>📧 {s.email}</div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                readOnly
                value={s.signing_url}
                style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', background: '#f8f9fc' }}
              />
              <button
                onClick={() => copy(s.signing_url, s.name)}
                style={{ padding: '8px 16px', background: copied === s.name ? '#2e7d32' : '#1565c0', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}
              >
                {copied === s.name ? '✓ Copied' : 'Copy Link'}
              </button>
            </div>
          </div>
        ))}

        <div style={{ background: '#fffde7', border: '1px solid #fff176', borderRadius: 10, padding: '12px 16px', marginTop: 8, fontSize: 12, color: '#555' }}>
          💡 <strong>Tip:</strong> Signers don't need an account — they can sign directly from the link in any browser. Links expire after {30} days.
        </div>

        <button
          onClick={onClose}
          style={{ width: '100%', marginTop: 20, padding: '12px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Document Detail Modal ────────────────────────────────────────────────────
function DocDetailModal({ doc, onClose, onRefresh }: { doc: ESignDocument; onClose: () => void; onRefresh: () => void }) {
  const [voiding, setVoiding] = useState(false);
  const [reminderLinks, setReminderLinks] = useState<any[] | null>(null);
  const [downloading, setDownloading] = useState(false);

  const handleVoid = async () => {
    if (!confirm('Are you sure you want to void this document?')) return;
    setVoiding(true);
    try {
      await esignApi.voidDocument(doc.id, 'Voided by administrator');
      onRefresh(); onClose();
    } finally { setVoiding(false); }
  };

  const handleRemind = async () => {
    const resp = await esignApi.remind(doc.id);
    setReminderLinks((resp.data as any).pendingSigners ?? (resp.data as any).signers ?? []);
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const resp = await esignApi.downloadSigned(doc.id);
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${doc.title}_signed.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {reminderLinks && (
        <SigningLinksModal signers={reminderLinks} onClose={() => setReminderLinks(null)} />
      )}
      <div style={{ background: '#fff', borderRadius: 16, width: 580, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{doc.title}</h3>
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              {statusBadge(doc.status)}
              {doc.expires_at && <span style={{ fontSize: 11, color: '#888' }}>Expires {new Date(doc.expires_at).toLocaleDateString()}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        <div style={{ padding: '20px 28px' }}>
          <h4 style={{ fontSize: 12, fontWeight: 700, color: '#1565c0', margin: '0 0 12px', textTransform: 'uppercase' }}>Signers</h4>
          {(doc.signers ?? []).filter(Boolean).map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', border: '1px solid #eef', borderRadius: 10, marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: '#666' }}>{s.email} • {s.role}</div>
                {s.signed_at && <div style={{ fontSize: 11, color: '#2e7d32' }}>Signed {new Date(s.signed_at).toLocaleString()}</div>}
              </div>
              <div>{signerStatusIcon(s.status)}</div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            {doc.status === 'completed' && (
              <button onClick={handleDownload} disabled={downloading} style={{ padding: '10px 18px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                {downloading ? 'Downloading...' : '⬇ Download Signed PDF'}
              </button>
            )}
            {(doc.status === 'sent' || doc.status === 'partially_signed') && (
              <button onClick={handleRemind} style={{ padding: '10px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                🔗 Get Signing Links
              </button>
            )}
            {doc.status !== 'completed' && doc.status !== 'voided' && (
              <button onClick={handleVoid} disabled={voiding} style={{ padding: '10px 18px', background: '#fff', color: '#c62828', border: '1px solid #fcc', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                {voiding ? 'Voiding...' : '✗ Void Document'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ESign Page ──────────────────────────────────────────────────────────
export default function ESign() {
  const [activeTab, setActiveTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<ESignTemplate[]>([]);
  const [documents, setDocuments] = useState<ESignDocument[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<ESignTemplate | null>(null);
  const [sendingLinks, setSendingLinks] = useState<any[] | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<ESignDocument | null>(null);
  const [templateFullData, setTemplateFullData] = useState<ESignTemplate | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tmplResp, docsResp, statsResp] = await Promise.all([
        esignApi.listTemplates(),
        esignApi.listDocuments(),
        esignApi.stats(),
      ]);
      setTemplates(tmplResp.data.templates);
      setDocuments(docsResp.data.documents);
      setStats(statsResp.data.stats);
    } catch { /* backend not connected yet */ }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const openTemplate = async (t: ESignTemplate) => {
    try {
      const resp = await esignApi.getTemplate(t.id);
      setTemplateFullData(resp.data.template);
      setSelectedTemplate(resp.data.template);
    } catch {
      setSelectedTemplate(t);
      setTemplateFullData(t);
    }
  };

  const filteredTemplates = templates.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.category.toLowerCase().includes(search.toLowerCase())
  );

  const pending = documents.filter((d) => d.status === 'sent' || d.status === 'partially_signed');
  const completed = documents.filter((d) => d.status === 'completed');

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'templates', label: '📄 Templates', count: templates.length },
    { id: 'send', label: '✉ Send New' },
    { id: 'pending', label: '⏳ Awaiting', count: pending.length },
    { id: 'completed', label: '✅ Completed', count: completed.length },
  ];

  const groupedTemplates = filteredTemplates.reduce<Record<string, ESignTemplate[]>>((acc, t) => {
    const cat = t.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  return (
    <div className="page-wrapper">
      {/* Send Modal */}
      {selectedTemplate && (
        <SendModal
          template={selectedTemplate}
          onClose={() => { setSelectedTemplate(null); setTemplateFullData(null); }}
          onSent={(doc, signers) => {
            setSelectedTemplate(null);
            setTemplateFullData(null);
            setSendingLinks(signers);
            loadData();
            setActiveTab('pending');
          }}
        />
      )}

      {/* Signing Links Modal */}
      {sendingLinks && (
        <SigningLinksModal signers={sendingLinks} onClose={() => setSendingLinks(null)} />
      )}

      {/* Document Detail Modal */}
      {selectedDoc && (
        <DocDetailModal doc={selectedDoc} onClose={() => setSelectedDoc(null)} onRefresh={loadData} />
      )}

      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">eSign Center</h1>
          <p className="page-subtitle">Send, sign, and manage documents — no third-party service needed</p>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'Awaiting Signatures', value: stats.pending, color: '#f57c00', icon: '⏳' },
            { label: 'Completed', value: stats.completed, color: '#2e7d32', icon: '✅' },
            { label: 'Templates Available', value: String(12 + parseInt(stats.custom_templates ?? '0')), color: '#1565c0', icon: '📄' },
            { label: 'Total Documents', value: stats.total, color: '#6a1b9a', icon: '📋' },
          ].map((s) => (
            <div key={s.label} style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ fontSize: 28 }}>{s.icon}</div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: '#f0f2f7', borderRadius: 12, padding: 4, marginBottom: 24, width: 'fit-content' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '9px 18px', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13,
              background: activeTab === t.id ? '#fff' : 'transparent',
              color: activeTab === t.id ? '#1565c0' : '#555',
              boxShadow: activeTab === t.id ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span style={{ background: activeTab === t.id ? '#1565c0' : '#888', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11 }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading...</div>}

      {/* ── Templates Tab ── */}
      {!loading && activeTab === 'templates' && (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates..."
              style={{ padding: '10px 16px', border: '1px solid #ddd', borderRadius: 10, fontSize: 14, width: 300 }}
            />
            <div style={{ marginLeft: 'auto', fontSize: 13, color: '#666' }}>
              {filteredTemplates.filter(t => t.is_system).length} compliance templates included free
            </div>
          </div>

          {Object.entries(groupedTemplates).map(([category, tmpls]) => (
            <div key={category} style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                {categoryBadge(category)}
                <span style={{ fontSize: 12, color: '#888' }}>{tmpls.length} template{tmpls.length !== 1 ? 's' : ''}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                {tmpls.map((t) => (
                  <div
                    key={t.id}
                    style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', transition: 'all 0.15s', position: 'relative' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#1565c0'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(21,101,192,0.1)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#e3e8f0'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
                  >
                    {t.is_system && (
                      <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 10, background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', borderRadius: 6, padding: '2px 7px', fontWeight: 700 }}>
                        ✓ INCLUDED
                      </span>
                    )}
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, paddingRight: 60 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 14, lineHeight: 1.5 }}>{t.description}</div>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 14 }}>{(t.fields ?? []).length} fillable fields</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => openTemplate(t)}
                        style={{ flex: 1, padding: '8px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                      >
                        ✉ Send for Signature
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await esignApi.duplicateTemplate(t.id);
                          loadData();
                        }}
                        style={{ padding: '8px 12px', background: '#f5f8ff', color: '#1565c0', border: '1px solid #c8d8f5', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                        title="Duplicate & customize"
                      >
                        ⎘ Copy
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {filteredTemplates.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#888' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
              <p>No templates found</p>
            </div>
          )}
        </div>
      )}

      {/* ── Send New Tab ── */}
      {!loading && activeTab === 'send' && (
        <div>
          <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 16, padding: 28 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700 }}>Send a Document for Signature</h3>
            <p style={{ margin: '0 0 24px', color: '#666', fontSize: 14 }}>Choose a template from the list below to send to a staff member or signer</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {templates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => openTemplate(t)}
                  style={{ border: '1px solid #e3e8f0', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, transition: 'all 0.15s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f5f8ff'; (e.currentTarget as HTMLElement).style.borderColor = '#1565c0'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#e3e8f0'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{t.name}</span>
                    {categoryBadge(t.category)}
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>{t.description}</div>
                  <div style={{ fontSize: 11, color: '#1565c0', fontWeight: 600, marginTop: 4 }}>Click to send →</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Pending Tab ── */}
      {!loading && activeTab === 'pending' && (
        <div>
          {pending.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#888', background: '#fff', border: '1px solid #e3e8f0', borderRadius: 16 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
              <p>No documents awaiting signature</p>
              <button onClick={() => setActiveTab('templates')} style={{ marginTop: 8, padding: '10px 22px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
                Send a Document
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pending.map((doc) => {
                const signers = (doc.signers ?? []).filter(Boolean);
                const signedCount = signers.filter(s => s.status === 'signed').length;
                return (
                  <div key={doc.id} onClick={() => setSelectedDoc(doc)} style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: '18px 22px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.15s' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#1565c0'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#e3e8f0'; }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{doc.title}</div>
                      <div style={{ fontSize: 12, color: '#666', display: 'flex', gap: 12 }}>
                        <span>Sent {new Date(doc.created_at).toLocaleDateString()}</span>
                        {doc.expires_at && <span>Expires {new Date(doc.expires_at).toLocaleDateString()}</span>}
                        <span>{signedCount}/{signers.length} signed</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        {signers.map((s) => (
                          <span key={s.id} style={{ fontSize: 11, background: s.status === 'signed' ? '#e8f5e9' : s.status === 'viewed' ? '#e3f2fd' : '#fff8e1', color: s.status === 'signed' ? '#2e7d32' : s.status === 'viewed' ? '#0288d1' : '#f57c00', border: `1px solid ${s.status === 'signed' ? '#a5d6a7' : s.status === 'viewed' ? '#90caf9' : '#ffe082'}`, borderRadius: 6, padding: '2px 8px' }}>
                            {s.name} · {s.status === 'signed' ? '✓' : s.status === 'viewed' ? '👁' : '⏳'}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {statusBadge(doc.status)}
                      <span style={{ color: '#1565c0', fontSize: 18 }}>›</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Completed Tab ── */}
      {!loading && activeTab === 'completed' && (
        <div>
          {completed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#888', background: '#fff', border: '1px solid #e3e8f0', borderRadius: 16 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <p>No completed documents yet</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {completed.map((doc) => (
                <div key={doc.id} onClick={() => setSelectedDoc(doc)} style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: '18px 22px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.15s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#2e7d32'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#e3e8f0'; }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{doc.title}</div>
                    <div style={{ fontSize: 12, color: '#555' }}>
                      Completed {doc.completed_at ? new Date(doc.completed_at).toLocaleDateString() : ''}
                      {' · '}{(doc.signers ?? []).filter(Boolean).length} signer{(doc.signers ?? []).filter(Boolean).length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {statusBadge(doc.status)}
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const resp = await esignApi.downloadSigned(doc.id);
                          const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
                          const a = document.createElement('a');
                          a.href = url; a.download = `${doc.title}_signed.pdf`; a.click();
                          URL.revokeObjectURL(url);
                        } catch {}
                      }}
                      style={{ padding: '6px 14px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                    >
                      ⬇ PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
