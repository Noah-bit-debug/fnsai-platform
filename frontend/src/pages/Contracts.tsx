/**
 * Phase 4.4 — Contracts with versioning
 *
 * Replaces the earlier mock "does our template have indemnification"
 * page with a real contract tracker backed by bd_contracts +
 * bd_contract_versions. Each contract can have N versions; uploading a
 * new version auto-increments current_version and kicks off an AI
 * terms-summary refresh in the background.
 *
 * Features:
 *   * List with status filter + expiration alerts strip at the top
 *   * Create / edit contract metadata
 *   * Upload a new version (PDF / DOCX / TXT) per contract
 *   * Download any past version
 *   * AI-generated terms summary displayed in the detail view
 */
import { Fragment, useEffect, useState } from 'react';
import { bdApi, facilitiesApi, BDContract, BDContractVersion, BDContractAlert, Facility } from '../lib/api';

const STATUS_COLORS: Record<BDContract['status'], string> = {
  draft: '#64748b', active: '#2e7d32', expired: '#c62828', terminated: '#991b1b',
};

function fmtDate(iso?: string | null): string { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(); } catch { return iso; } }
function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function Contracts() {
  const [contracts, setContracts] = useState<BDContract[]>([]);
  const [alerts, setAlerts] = useState<BDContractAlert[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BDContract | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true); setError(null);
    try {
      const [cRes, aRes, fRes] = await Promise.all([
        bdApi.listContracts(statusFilter ? { status: statusFilter } : undefined),
        bdApi.contractsAlerts(),
        facilitiesApi.list(),
      ]);
      setContracts(cRes.data.contracts);
      setAlerts(aRes.data.alerts);
      setFacilities(fRes.data.facilities);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load.');
    } finally { setLoading(false); }
  }
  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, [statusFilter]);

  async function deleteContract(id: string) {
    if (!confirm('Delete this contract and all versions?')) return;
    try { await bdApi.deleteContract(id); await loadAll(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Delete failed.'); }
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>📝 Contracts</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>Client contracts with version history + AI summaries</p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true); }}
          style={{ padding: '9px 18px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          + New Contract
        </button>
      </div>

      {/* Alerts strip */}
      {alerts.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', letterSpacing: 0.4, marginBottom: 6, textTransform: 'uppercase' }}>Expiration alerts</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {alerts.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span style={{ color: a.alert_level === 'expired' ? '#991b1b' : '#92400e', fontWeight: 600 }}>
                  {a.alert_level === 'expired' ? '●' : '⚠'}
                </span>
                <span style={{ color: '#374151' }}>{a.title}</span>
                <span style={{ color: '#64748b' }}>— {a.alert_level === 'expired' ? `expired ${fmtDate(a.expiration_date)}` : `expires ${fmtDate(a.expiration_date)}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['', 'draft', 'active', 'expired', 'terminated'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              border: '1px solid #e2e8f0', borderRadius: 8,
              background: statusFilter === s ? '#1565c0' : '#fff',
              color: statusFilter === s ? '#fff' : '#64748b', cursor: 'pointer',
            }}>
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>
      : contracts.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
          <div style={{ fontSize: 14, color: '#1a2b3c', fontWeight: 600 }}>No contracts yet</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Track client contracts with version history and AI term summaries.</div>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              {['Title', 'Client', 'Facility', 'Status', 'Version', 'Value', 'Effective', 'Expires', 'Actions'].map(h =>
                <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {contracts.map(c => {
                const isExpanded = expandedId === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer', background: isExpanded ? '#f8fafc' : '#fff' }} onClick={() => setExpandedId(isExpanded ? null : c.id)}>
                      <td style={{ ...td, fontWeight: 600, color: '#1a2b3c' }}>
                        <span style={{ color: '#94a3b8', marginRight: 6 }}>{isExpanded ? '▼' : '▶'}</span>
                        {c.title}
                      </td>
                      <td style={td}>{c.client_name ?? '—'}</td>
                      <td style={td}>{c.facility_name ?? '—'}</td>
                      <td style={td}>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: STATUS_COLORS[c.status] + '22', color: STATUS_COLORS[c.status], fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{c.status}</span>
                        {c.expiring_soon && <span style={{ marginLeft: 6, fontSize: 10, color: '#92400e', fontWeight: 700 }}>⚠ SOON</span>}
                      </td>
                      <td style={td}>v{c.current_version} ({c.version_count ?? 0} file{(c.version_count ?? 0) !== 1 ? 's' : ''})</td>
                      <td style={td}>{fmtMoney(c.total_value)}</td>
                      <td style={{ ...td, fontSize: 12, color: '#64748b' }}>{fmtDate(c.effective_date)}</td>
                      <td style={{ ...td, fontSize: 12, color: c.expiring_soon ? '#92400e' : '#64748b', fontWeight: c.expiring_soon ? 600 : 400 }}>{fmtDate(c.expiration_date)}</td>
                      <td style={td} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button onClick={() => { setEditing(c); setShowModal(true); }} style={ghostBtn}>Edit</button>
                          <button onClick={() => void deleteContract(c.id)} style={{ ...ghostBtn, color: '#c62828' }}>Delete</button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} style={{ padding: 0, background: '#f8fafc' }}>
                          <ContractDetail id={c.id} onChanged={loadAll} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ContractModal
          initial={editing}
          facilities={facilities}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={() => { loadAll(); setShowModal(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

// ── Detail (expanded row) ─────────────────────────────────────────────────

function ContractDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [data, setData] = useState<{ contract: BDContract; versions: BDContractVersion[] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [changes, setChanges] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { const r = await bdApi.getContract(id); setData(r.data); }
    catch (e: any) { setErr(e?.response?.data?.error ?? 'Failed to load.'); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [id]);

  async function upload() {
    if (!file) { setErr('Pick a file first.'); return; }
    setUploading(true); setErr(null);
    try {
      await bdApi.uploadContractVersion(id, file, changes);
      setFile(null); setChanges('');
      await load();
      onChanged();
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Upload failed.'); }
    finally { setUploading(false); }
  }

  async function downloadVersion(vid: string, name: string | null) {
    try {
      const res = await fetch(`/api/v1/bd/contracts/${id}/versions/${vid}/file`, {
        headers: { Authorization: `Bearer ${await (window as any).Clerk?.session?.getToken?.() ?? ''}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name ?? 'contract';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { alert('Download failed.'); }
  }

  if (!data) return <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>Loading detail…</div>;
  const { contract, versions } = data;

  return (
    <div style={{ padding: 20 }}>
      {contract.terms_summary && (
        <div style={{ padding: 14, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>✦ AI Terms Summary</div>
          <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{contract.terms_summary}</div>
        </div>
      )}
      {contract.notes && (
        <div style={{ fontSize: 12, color: '#475569', marginBottom: 14, padding: 10, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <strong style={{ color: '#1e293b' }}>Notes:</strong> {contract.notes}
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>Version History</div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
        {versions.length === 0 ? <div style={{ padding: 14, color: '#94a3b8', fontSize: 13 }}>No versions uploaded yet.</div>
        : versions.map(v => (
          <div key={v.id} style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1565c0', minWidth: 40 }}>v{v.version}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#1e293b' }}>{v.file_name ?? 'Untitled'}</div>
              {v.changes_summary && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{v.changes_summary}</div>}
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{fmtDate(v.created_at)}</div>
            </div>
            <button onClick={() => void downloadVersion(v.id, v.file_name ?? null)} style={ghostBtn}>Download</button>
          </div>
        ))}
      </div>

      {/* Upload new version */}
      <div style={{ padding: 12, background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>Upload new version</div>
        <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ marginBottom: 8 }} />
        <input placeholder="What changed? (optional)" style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
          value={changes} onChange={e => setChanges(e.target.value)} />
        {err && <div style={{ color: '#c62828', fontSize: 12, marginBottom: 6 }}>{err}</div>}
        <button onClick={() => void upload()} disabled={uploading || !file}
          style={{ padding: '7px 14px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 600, fontSize: 12, cursor: uploading || !file ? 'default' : 'pointer', opacity: uploading || !file ? 0.5 : 1 }}>
          {uploading ? 'Uploading + parsing…' : 'Upload version'}
        </button>
      </div>
    </div>
  );
}

// ── Create/Edit Modal ─────────────────────────────────────────────────────

function ContractModal({ initial, facilities, onClose, onSaved }: {
  initial: BDContract | null; facilities: Facility[]; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState<Partial<BDContract>>({
    title: initial?.title ?? '',
    client_name: initial?.client_name ?? '',
    facility_id: initial?.facility_id ?? null,
    effective_date: initial?.effective_date ?? null,
    expiration_date: initial?.expiration_date ?? null,
    total_value: initial?.total_value ?? null,
    status: initial?.status ?? 'draft',
    notes: initial?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!form.title?.trim()) { setErr('Title required.'); return; }
    setSaving(true); setErr(null);
    try {
      if (isEdit && initial) await bdApi.updateContract(initial.id, form);
      else await bdApi.createContract(form);
      onSaved();
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Save failed.'); }
    finally { setSaving(false); }
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>{isEdit ? 'Edit Contract' : 'New Contract'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <L label="Title *"><input style={field} value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} /></L>
          <L label="Client name"><input style={field} value={form.client_name ?? ''} onChange={e => setForm({ ...form, client_name: e.target.value })} /></L>
          <L label="Facility"><select style={field} value={form.facility_id ?? ''} onChange={e => setForm({ ...form, facility_id: e.target.value || null })}>
            <option value="">— None —</option>
            {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></L>
          <L label="Status"><select style={field} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as BDContract['status'] })}>
            <option value="draft">Draft</option><option value="active">Active</option>
            <option value="expired">Expired</option><option value="terminated">Terminated</option>
          </select></L>
          <L label="Effective date"><input type="date" style={field} value={form.effective_date ?? ''} onChange={e => setForm({ ...form, effective_date: e.target.value || null })} /></L>
          <L label="Expiration date"><input type="date" style={field} value={form.expiration_date ?? ''} onChange={e => setForm({ ...form, expiration_date: e.target.value || null })} /></L>
          <L label="Total value ($)"><input type="number" min={0} step="0.01" style={field} value={form.total_value ?? ''} onChange={e => setForm({ ...form, total_value: e.target.value ? Number(e.target.value) : null })} /></L>
        </div>
        <L label="Notes"><textarea rows={3} style={{ ...field, resize: 'vertical' }} value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></L>
        {err && <div style={{ color: '#c62828', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving} style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 10 }}>
    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</label>
    {children}
  </div>;
}

const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: '#1e293b' };
const field: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit' };
const ghostBtn: React.CSSProperties = { padding: '5px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, color: '#475569', cursor: 'pointer' };
