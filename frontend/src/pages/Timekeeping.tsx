/**
 * Phase 4.4 — Timekeeping (wired to real backend)
 *
 * Replaces the previous pure-mock page. Uses the existing timesheets
 * table and /api/v1/timekeeping endpoints (POST to submit, GET to list,
 * POST /:id/verify to approve/dispute). Same visual concept as before
 * (list of timesheets + submit form) but the data now persists.
 */
import { useEffect, useMemo, useState } from 'react';
import { timekeepingApi, staffApi, facilitiesApi, Timesheet, Staff, Facility } from '../lib/api';

const STATUS_COLORS: Record<Timesheet['status'], string> = {
  pending: '#e65100', verified: '#2e7d32', approved: '#1565c0', disputed: '#c62828',
};

function fmtDate(iso?: string | null): string { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(); } catch { return iso; } }

export default function Timekeeping() {
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [form, setForm] = useState<{ staff_id: string; facility_id: string; week_start: string; hours_worked: string }>({
    staff_id: '', facility_id: '', week_start: '', hours_worked: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true); setError(null);
    // Fire the three calls independently so one failure doesn't blank
    // the other two. Previously we used Promise.all which meant any one
    // 500 silently cleared the facilities + staff dropdowns. Now each
    // call settles on its own and we log which ones failed.
    const [tRes, sRes, fRes] = await Promise.allSettled([
      timekeepingApi.list(statusFilter ? { status: statusFilter } : undefined),
      staffApi.list(),
      facilitiesApi.list(),
    ]);

    const errs: string[] = [];
    if (tRes.status === 'fulfilled') setTimesheets(tRes.value.data.timesheets);
    else { errs.push(`timesheets: ${(tRes.reason as any)?.response?.data?.error ?? (tRes.reason as any)?.message ?? 'failed'}`); console.error('[timekeeping] list failed:', tRes.reason); }

    if (sRes.status === 'fulfilled') setStaff(sRes.value.data.staff);
    else { errs.push(`staff: ${(sRes.reason as any)?.response?.data?.error ?? 'failed'}`); console.error('[timekeeping] staff failed:', sRes.reason); }

    if (fRes.status === 'fulfilled') {
      setFacilities(fRes.value.data.facilities);
      console.log('[timekeeping] loaded', fRes.value.data.facilities.length, 'facilities');
    } else {
      errs.push(`facilities: ${(fRes.reason as any)?.response?.data?.error ?? 'failed'}`);
      console.error('[timekeeping] facilities failed:', fRes.reason);
    }

    if (errs.length > 0) setError(errs.join('; '));
    setLoading(false);
  }
  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, [statusFilter]);

  async function submitTimesheet() {
    setFormErr(null);
    // Phase 4.4 QA fix — facility is no longer required (matches
    // Incidents + Scheduling patterns). Staff, week, hours are the
    // only true minimums for a meaningful timesheet.
    if (!form.staff_id || !form.week_start || !form.hours_worked) {
      setFormErr('Staff, week, and hours are required.'); return;
    }
    setSubmitting(true);
    try {
      await timekeepingApi.submit({
        staff_id: form.staff_id,
        facility_id: form.facility_id || undefined,
        week_start: form.week_start,
        hours_worked: Number(form.hours_worked),
      });
      setForm({ staff_id: '', facility_id: '', week_start: '', hours_worked: '' });
      await loadAll();
    } catch (e: any) {
      setFormErr(e?.response?.data?.error ?? 'Submit failed.');
    } finally { setSubmitting(false); }
  }

  async function verify(id: string, status: 'verified' | 'disputed' | 'approved') {
    const notes = status === 'disputed' ? (prompt('Dispute reason:') ?? undefined) : undefined;
    try { await timekeepingApi.verify(id, status, notes); await loadAll(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Verify failed.'); }
  }

  const byStatus = useMemo(() => ({
    pending:  timesheets.filter(t => t.status === 'pending').length,
    verified: timesheets.filter(t => t.status === 'verified').length,
    approved: timesheets.filter(t => t.status === 'approved').length,
    disputed: timesheets.filter(t => t.status === 'disputed').length,
  }), [timesheets]);

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>⏰ Timekeeping</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>Weekly timesheets and verification</p>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { label: 'Pending',  n: byStatus.pending,  c: '#e65100' },
          { label: 'Verified', n: byStatus.verified, c: '#2e7d32' },
          { label: 'Approved', n: byStatus.approved, c: '#1565c0' },
          { label: 'Disputed', n: byStatus.disputed, c: '#c62828' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.c }}>{s.n}</div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {/* Submit form */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#1a2b3c' }}>Submit Timesheet</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <select style={field} value={form.staff_id} onChange={e => setForm({ ...form, staff_id: e.target.value })}>
            <option value="">— Staff —</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
          </select>
          <select style={field} value={form.facility_id} onChange={e => setForm({ ...form, facility_id: e.target.value })}>
            <option value="">— Facility (optional) —</option>
            {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <input type="date" style={field} value={form.week_start} onChange={e => setForm({ ...form, week_start: e.target.value })} title="Week start date" />
          <input type="number" step="0.25" min={0} max={168} placeholder="Hours worked" style={field} value={form.hours_worked} onChange={e => setForm({ ...form, hours_worked: e.target.value })} />
        </div>
        {formErr && <div style={{ color: '#c62828', fontSize: 12, marginTop: 8 }}>{formErr}</div>}
        <button onClick={() => void submitTimesheet()} disabled={submitting}
          style={{ marginTop: 10, padding: '8px 18px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['', 'pending', 'verified', 'approved', 'disputed'].map(s => (
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

      {/* List */}
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>
      : timesheets.length === 0 ? <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
          <div style={{ fontSize: 14, color: '#1a2b3c', fontWeight: 600 }}>No timesheets</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Submit one above to get started.</div>
        </div>
      : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              {['Staff', 'Facility', 'Week of', 'Hours', 'Status', 'Submitted', 'Actions'].map(h =>
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {timesheets.map(t => (
                <tr key={t.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={td}>{t.first_name} {t.last_name}</td>
                  <td style={td}>{t.facility_name}</td>
                  <td style={td}>{fmtDate(t.week_start)}</td>
                  <td style={td}>{t.hours_worked ?? '—'}h</td>
                  <td style={td}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, background: STATUS_COLORS[t.status] + '22', color: STATUS_COLORS[t.status], fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                      {t.status}
                    </span>
                  </td>
                  <td style={{ ...td, fontSize: 12, color: '#64748b' }}>{fmtDate(t.created_at)}</td>
                  <td style={td}>
                    {t.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button onClick={() => void verify(t.id, 'verified')} style={{ ...actionBtn, background: '#2e7d32' }}>Verify</button>
                        <button onClick={() => void verify(t.id, 'disputed')} style={{ ...actionBtn, background: '#c62828' }}>Dispute</button>
                      </div>
                    )}
                    {t.status === 'verified' && (
                      <button onClick={() => void verify(t.id, 'approved')} style={{ ...actionBtn, background: '#1565c0' }}>Approve</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const field: React.CSSProperties = { padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff', color: '#1e293b' };
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: '#1e293b' };
const actionBtn: React.CSSProperties = { padding: '5px 11px', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' };
