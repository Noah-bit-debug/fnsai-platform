/**
 * Phase 4.4 — RFP inbox tab
 *
 * Inbox-style list of uploaded RFPs. Upload a PDF/DOCX/TXT → the backend
 * extracts text, generates an AI summary, and stores everything. From
 * any RFP row the user can "Draft bid from RFP" which spins up a bid
 * in the Bids tab with the checklist/notes pre-filled.
 */
import { useEffect, useState } from 'react';
import { bdApi, BDRfp } from '../../lib/api';

const STATUS_COLORS: Record<BDRfp['status'], string> = {
  new:      '#1565c0',
  reviewed: '#6d28d9',
  drafted:  '#2e7d32',
  declined: '#c62828',
  expired:  '#64748b',
};
function fmtDate(iso?: string | null): string { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(); } catch { return iso; } }

export default function RFPsTab() {
  const [rfps, setRfps] = useState<BDRfp[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showUpload, setShowUpload] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await bdApi.listRfps(statusFilter ? { status: statusFilter } : undefined);
      setRfps(r.data.rfps);
    } catch (e: any) { setErr(e?.response?.data?.error ?? e?.message ?? 'Load failed.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [statusFilter]);

  async function draftBid(id: string) {
    if (!confirm('Draft a bid from this RFP? The AI will create a new bid with a tailored checklist.')) return;
    try {
      const r = await bdApi.draftBidFromRfp(id);
      alert(`Bid drafted: "${r.data.bid.title}". Switch to the Bids tab to review.`);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Draft failed.');
    }
  }
  async function del(id: string) {
    if (!confirm('Delete this RFP?')) return;
    try { await bdApi.deleteRfp(id); await load(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Delete failed.'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, padding: '16px 20px', alignItems: 'center' }}>
        <select style={select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="drafted">Drafted</option>
          <option value="declined">Declined</option>
          <option value="expired">Expired</option>
        </select>
        <span style={{ flex: 1 }} />
        <button onClick={() => setShowUpload(true)}
          style={{ padding: '9px 18px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          + Upload RFP
        </button>
      </div>

      {err && <div style={{ margin: '0 20px 12px', background: '#fef2f2', color: '#991b1b', padding: 10, borderRadius: 8, fontSize: 13 }}>{err}</div>}

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>
      : rfps.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📥</div>
          <div style={{ fontSize: 14, color: '#1a2b3c', fontWeight: 600 }}>No RFPs yet</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Upload an RFP document and the AI will summarize it. You can then draft a bid directly from the summary.</div>
        </div>
      ) : (
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rfps.map(r => (
            <div key={r.id} style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c' }}>{r.title ?? r.file_name ?? 'Untitled RFP'}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 10, background: STATUS_COLORS[r.status] + '22', color: STATUS_COLORS[r.status], fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      {r.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                    {r.client_name ?? 'No client'} · Received {fmtDate(r.received_at)} {r.due_date && `· Due ${fmtDate(r.due_date)}`}
                  </div>
                  {r.parsed_summary ? (
                    <div style={{ padding: 10, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#6d28d9', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>✦ AI Summary</div>
                      <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{r.parsed_summary}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>AI summary not available (text extraction failed or file was too short).</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                  {r.status !== 'drafted' && (
                    <button onClick={() => void draftBid(r.id)} style={{ padding: '6px 12px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      ✦ Draft bid
                    </button>
                  )}
                  <button onClick={() => void del(r.id)} style={ghostBtn}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); void load(); }} />}
    </div>
  );
}

function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!file) { setErr('Pick a file.'); return; }
    setUploading(true); setErr(null);
    try {
      await bdApi.uploadRfp(file, title.trim() || undefined, clientName.trim() || undefined);
      onUploaded();
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Upload failed.'); }
    finally { setUploading(false); }
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 480 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>Upload RFP</div>
        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>File (PDF / DOCX / TXT) *</label>
          <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>Title (optional)</label>
          <input style={field} value={title} onChange={e => setTitle(e.target.value)} placeholder="Defaults to file name" />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>Client name (optional)</label>
          <input style={field} value={clientName} onChange={e => setClientName(e.target.value)} />
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
          The AI will extract text and write a short summary. Takes ~10–20 seconds.
        </div>
        {err && <div style={{ color: '#c62828', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => void submit()} disabled={uploading || !file}
            style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: !file ? 0.5 : 1 }}>
            {uploading ? 'Uploading + parsing…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

const select: React.CSSProperties = { padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#fff', color: '#1e293b' };
const field: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit' };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
const ghostBtn: React.CSSProperties = { padding: '5px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, color: '#475569', cursor: 'pointer' };
