/**
 * Phase 4.4 — PTO (Paid Time Off)
 *
 * Two sections on one page:
 *   1. Requests list (pending / approved / denied) with approve/deny/cancel actions
 *   2. Balances grid — each staff member's remaining vacation/sick/personal hours
 *
 * Admins can directly adjust balances (for grants, corrections) via the
 * edit modal. Approving a non-unpaid request auto-deducts hours. Cancelling
 * an approved request restores them.
 */
import { useEffect, useState } from 'react';
import { ptoApi, staffApi, PtoRequest, PtoBalance, Staff } from '../lib/api';

const TYPE_COLORS = { vacation: '#1565c0', sick: '#e65100', personal: '#6a1b9a', unpaid: '#64748b' };
const STATUS_COLORS = { pending: '#e65100', approved: '#2e7d32', denied: '#c62828', cancelled: '#64748b' };

function fmtDate(iso?: string | null): string { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(); } catch { return iso; } }

export default function PTO() {
  const [tab, setTab] = useState<'requests' | 'balances'>('requests');
  const [requests, setRequests] = useState<PtoRequest[]>([]);
  const [balances, setBalances] = useState<PtoBalance[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [editingBalance, setEditingBalance] = useState<PtoBalance | null>(null);

  async function loadAll() {
    setLoading(true); setError(null);
    try {
      const [rRes, bRes, sRes] = await Promise.all([
        ptoApi.listRequests(statusFilter ? { status: statusFilter } : undefined),
        ptoApi.listBalances(),
        staffApi.list(),
      ]);
      setRequests(rRes.data.requests);
      setBalances(bRes.data.balances);
      setStaff(sRes.data.staff);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, [statusFilter]);

  async function approve(id: string) {
    try { await ptoApi.approveRequest(id); await loadAll(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Approve failed.'); }
  }
  async function deny(id: string) {
    const reason = prompt('Denial reason (optional):') ?? undefined;
    try { await ptoApi.denyRequest(id, reason); await loadAll(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Deny failed.'); }
  }
  async function cancel(id: string) {
    if (!confirm('Cancel this request? Approved hours will be restored.')) return;
    try { await ptoApi.cancelRequest(id); await loadAll(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Cancel failed.'); }
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>🏖️ PTO</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>Requests and balances</p>
        </div>
        <button onClick={() => setShowRequestModal(true)}
          style={{ padding: '9px 18px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          + New Request
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #e2e8f0', marginBottom: 18 }}>
        {(['requests', 'balances'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: '10px 20px', background: 'transparent', border: 'none', cursor: 'pointer',
              fontWeight: tab === t ? 700 : 500, fontSize: 14,
              color: tab === t ? '#1565c0' : '#64748b',
              borderBottom: tab === t ? '2px solid #1565c0' : '2px solid transparent',
              marginBottom: -2,
            }}>
            {t === 'requests' ? 'Requests' : 'Balances'}
          </button>
        ))}
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {/* REQUESTS TAB */}
      {tab === 'requests' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['', 'pending', 'approved', 'denied', 'cancelled'].map(s => (
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

          {loading ? <div style={loadingSt}>Loading…</div>
          : requests.length === 0 ? <div style={emptySt}>No requests.</div>
          : (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#f8fafc' }}>
                  {['Staff', 'Type', 'Dates', 'Hours', 'Reason', 'Status', 'Actions'].map(h =>
                    <th key={h} style={thSt}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {requests.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={tdSt}>{r.first_name} {r.last_name}</td>
                      <td style={tdSt}>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: TYPE_COLORS[r.type] + '22', color: TYPE_COLORS[r.type], fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>
                          {r.type}
                        </span>
                      </td>
                      <td style={tdSt}>{fmtDate(r.start_date)} – {fmtDate(r.end_date)}</td>
                      <td style={tdSt}>{r.hours}h</td>
                      <td style={{ ...tdSt, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason ?? '—'}</td>
                      <td style={tdSt}>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: STATUS_COLORS[r.status] + '22', color: STATUS_COLORS[r.status], fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                          {r.status}
                        </span>
                        {r.status === 'denied' && r.denial_reason && <div style={{ fontSize: 10, color: '#991b1b', marginTop: 3 }}>{r.denial_reason}</div>}
                      </td>
                      <td style={tdSt}>
                        {r.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button onClick={() => void approve(r.id)} style={{ ...actionBtn, background: '#2e7d32' }}>Approve</button>
                            <button onClick={() => void deny(r.id)} style={{ ...actionBtn, background: '#c62828' }}>Deny</button>
                          </div>
                        )}
                        {r.status === 'approved' && (
                          <button onClick={() => void cancel(r.id)} style={ghostBtn}>Cancel</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* BALANCES TAB */}
      {tab === 'balances' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              {['Staff', 'Role', 'Vacation', 'Sick', 'Personal', 'Updated', 'Actions'].map(h =>
                <th key={h} style={thSt}>{h}</th>)}
            </tr></thead>
            <tbody>
              {staff.map(s => {
                const bal = balances.find(b => b.staff_id === s.id);
                const vacation = bal?.vacation_hours ?? 0;
                const sick = bal?.sick_hours ?? 0;
                const personal = bal?.personal_hours ?? 0;
                const b: PtoBalance = bal ?? { staff_id: s.id, vacation_hours: 0, sick_hours: 0, personal_hours: 0 };
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={tdSt}>{s.first_name} {s.last_name}</td>
                    <td style={tdSt}>{s.role}</td>
                    <td style={{ ...tdSt, color: vacation < 0 ? '#c62828' : '#1e293b', fontWeight: 600 }}>{Number(vacation).toFixed(1)}h</td>
                    <td style={{ ...tdSt, color: sick < 0 ? '#c62828' : '#1e293b', fontWeight: 600 }}>{Number(sick).toFixed(1)}h</td>
                    <td style={{ ...tdSt, color: personal < 0 ? '#c62828' : '#1e293b', fontWeight: 600 }}>{Number(personal).toFixed(1)}h</td>
                    <td style={{ ...tdSt, fontSize: 12, color: '#64748b' }}>{fmtDate(bal?.updated_at)}</td>
                    <td style={tdSt}>
                      <button onClick={() => setEditingBalance({ ...b, first_name: s.first_name, last_name: s.last_name })} style={ghostBtn}>Adjust</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showRequestModal && (
        <NewRequestModal
          staff={staff}
          onClose={() => setShowRequestModal(false)}
          onSave={async (data) => {
            try { await ptoApi.createRequest(data); await loadAll(); setShowRequestModal(false); }
            catch (e: any) { alert(e?.response?.data?.error ?? 'Create failed.'); }
          }}
        />
      )}
      {editingBalance && (
        <BalanceModal
          initial={editingBalance}
          onClose={() => setEditingBalance(null)}
          onSave={async (data) => {
            try { await ptoApi.updateBalance(editingBalance.staff_id, data); await loadAll(); setEditingBalance(null); }
            catch (e: any) { alert(e?.response?.data?.error ?? 'Save failed.'); }
          }}
        />
      )}
    </div>
  );
}

// ── New Request Modal ───────────────────────────────────────────────────

interface NewReqProps {
  staff: Staff[];
  onClose: () => void;
  onSave: (data: Partial<PtoRequest>) => Promise<void>;
}
function NewRequestModal({ staff, onClose, onSave }: NewReqProps) {
  const [form, setForm] = useState<Partial<PtoRequest>>({ type: 'vacation', hours: 8 });
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!form.staff_id) { setErr('Pick a staff member.'); return; }
    if (!form.start_date || !form.end_date) { setErr('Dates required.'); return; }
    if (!form.hours || form.hours <= 0) { setErr('Hours must be > 0.'); return; }
    await onSave(form);
  }
  return (
    <div style={modalOverlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalCard}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>New PTO Request</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <L label="Staff *"><select style={field} value={form.staff_id ?? ''} onChange={e => setForm({ ...form, staff_id: e.target.value })}>
            <option value="">— Select —</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
          </select></L>
          <L label="Type *"><select style={field} value={form.type} onChange={e => setForm({ ...form, type: e.target.value as PtoRequest['type'] })}>
            <option value="vacation">Vacation</option><option value="sick">Sick</option>
            <option value="personal">Personal</option><option value="unpaid">Unpaid</option>
          </select></L>
          <L label="Start date *"><input type="date" style={field} value={form.start_date ?? ''} onChange={e => setForm({ ...form, start_date: e.target.value })} /></L>
          <L label="End date *"><input type="date" style={field} value={form.end_date ?? ''} onChange={e => setForm({ ...form, end_date: e.target.value })} /></L>
          <L label="Total hours *"><input type="number" step="0.5" min={0} style={field} value={form.hours ?? ''} onChange={e => setForm({ ...form, hours: Number(e.target.value) })} /></L>
        </div>
        <L label="Reason"><textarea rows={2} style={{ ...field, resize: 'vertical' }} value={form.reason ?? ''} onChange={e => setForm({ ...form, reason: e.target.value })} /></L>
        {err && <div style={{ color: '#c62828', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => void submit()} style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Submit Request</button>
        </div>
      </div>
    </div>
  );
}

// ── Balance Adjust Modal ─────────────────────────────────────────────────

function BalanceModal({ initial, onClose, onSave }: {
  initial: PtoBalance; onClose: () => void; onSave: (data: Partial<PtoBalance>) => Promise<void>;
}) {
  const [vac, setVac] = useState(String(initial.vacation_hours ?? 0));
  const [sick, setSick] = useState(String(initial.sick_hours ?? 0));
  const [pers, setPers] = useState(String(initial.personal_hours ?? 0));
  return (
    <div style={modalOverlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalCard}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Adjust balance</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>{initial.first_name} {initial.last_name}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <L label="Vacation hrs"><input type="number" step="0.5" style={field} value={vac} onChange={e => setVac(e.target.value)} /></L>
          <L label="Sick hrs"><input type="number" step="0.5" style={field} value={sick} onChange={e => setSick(e.target.value)} /></L>
          <L label="Personal hrs"><input type="number" step="0.5" style={field} value={pers} onChange={e => setPers(e.target.value)} /></L>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
          Sets absolute values. Approving requests subtracts automatically; cancelling approved requests restores hours.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => void onSave({ vacation_hours: Number(vac), sick_hours: Number(sick), personal_hours: Number(pers) })}
            style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Save
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

const field: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit' };
const thSt: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 };
const tdSt: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: '#1e293b' };
const actionBtn: React.CSSProperties = { padding: '5px 11px', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '5px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, color: '#475569', cursor: 'pointer' };
const loadingSt: React.CSSProperties = { padding: 40, textAlign: 'center', color: '#64748b' };
const emptySt: React.CSSProperties = { padding: 40, textAlign: 'center', color: '#94a3b8' };
const modalOverlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modalCard: React.CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '92vh', overflowY: 'auto' };
