/**
 * Phase 4.4 — Workforce Scheduling
 *
 * Week-view calendar + shift editor. Shows scheduled shifts per staff
 * per day for the visible week, with coverage counters in the header.
 * Click a day cell to add a shift; click an existing shift to edit.
 *
 * Deliberately simple:
 *   * 7-column grid (one column per day in the current week)
 *   * rows = staff members who have at least one shift in the window,
 *     plus an "unassigned" row for shifts without a staff_id (future)
 *   * Navigate prev/next week with arrows or jump to today
 *   * Filter by facility to cut the list down
 */
import { useEffect, useMemo, useState } from 'react';
import { schedulingApi, staffApi, facilitiesApi, WorkShift, ShiftCoverageDay, Staff, Facility } from '../lib/api';

const STATUS_COLORS: Record<WorkShift['status'], string> = {
  scheduled: '#1565c0',
  confirmed: '#2e7d32',
  completed: '#64748b',
  cancelled: '#c62828',
  no_show:   '#e65100',
};

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0 = Sunday
  x.setDate(x.getDate() - day);
  return x;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
// Format as YYYY-MM-DD using *local* components. Using .toISOString() would
// shift the date by the UTC offset — e.g. midnight local time in UTC+2
// would become the previous day's date.
function fmtISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtShortDay(d: Date): string { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' }); }
function fmtTime(iso: string): string { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return iso; } }

export default function Scheduling() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [facilityFilter, setFacilityFilter] = useState<string>('');
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [coverage, setCoverage] = useState<ShiftCoverageDay[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<WorkShift> | null>(null);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  async function loadAll() {
    setLoading(true); setError(null);
    const from = fmtISODate(weekStart);
    const to = fmtISODate(addDays(weekStart, 7));
    try {
      const [sRes, cRes, stRes, fRes] = await Promise.all([
        schedulingApi.listShifts({ from, to, facility_id: facilityFilter || undefined }),
        schedulingApi.coverage({ from, to, facility_id: facilityFilter || undefined }),
        staffApi.list(),
        facilitiesApi.list(),
      ]);
      setShifts(sRes.data.shifts);
      setCoverage(cRes.data.coverage);
      setStaff(stRes.data.staff);
      setFacilities(fRes.data.facilities);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, [weekStart, facilityFilter]);

  const staffRows = useMemo(() => {
    const ids = new Set<string>();
    shifts.forEach(s => ids.add(s.staff_id));
    return staff.filter(s => ids.has(s.id));
  }, [staff, shifts]);

  function shiftsFor(staffId: string, day: Date): WorkShift[] {
    const dayISO = fmtISODate(day);
    return shifts.filter(s => s.staff_id === staffId && s.start_time.slice(0, 10) === dayISO);
  }
  function coverageFor(day: Date): ShiftCoverageDay | undefined {
    return coverage.find(c => c.day.slice(0, 10) === fmtISODate(day));
  }

  async function saveShift(data: Partial<WorkShift>, existing?: WorkShift) {
    try {
      if (existing) {
        await schedulingApi.updateShift(existing.id, data);
      } else {
        await schedulingApi.createShift(data);
      }
      setEditing(null);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Save failed.');
    }
  }
  async function deleteShift(id: string) {
    if (!confirm('Delete this shift?')) return;
    try { await schedulingApi.deleteShift(id); await loadAll(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Delete failed.'); }
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>📅 Scheduling</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>Week starting {weekStart.toLocaleDateString()}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#fff' }}
            value={facilityFilter}
            onChange={e => setFacilityFilter(e.target.value)}
          >
            <option value="">All facilities</option>
            {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} style={navBtnStyle}>‹</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} style={ghostBtnStyle}>Today</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} style={navBtnStyle}>›</button>
          <button
            onClick={() => setEditing({ status: 'scheduled', start_time: new Date().toISOString(), end_time: new Date(Date.now() + 8 * 3600 * 1000).toISOString() })}
            style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            + New Shift
          </button>
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        {/* Header row */}
        <div style={gridStyle}>
          <div style={headerCellStyle}>Staff</div>
          {weekDays.map(d => {
            const cov = coverageFor(d);
            return (
              <div key={d.toISOString()} style={headerCellStyle}>
                <div>{fmtShortDay(d)}</div>
                {cov && <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginTop: 2 }}>{cov.total} shifts · {cov.confirmed} confirmed</div>}
              </div>
            );
          })}
        </div>

        {loading ? (
          <div style={{ padding: 36, textAlign: 'center', color: '#64748b' }}>Loading…</div>
        ) : staffRows.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🗓️</div>
            <div style={{ fontSize: 14, color: '#1a2b3c', fontWeight: 600, marginBottom: 4 }}>No shifts scheduled this week</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Click "+ New Shift" above to get started.</div>
          </div>
        ) : staffRows.map(s => (
          <div key={s.id} style={gridStyle}>
            <div style={{ padding: 10, borderRight: '1px solid #f1f5f9', fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>
              {s.first_name} {s.last_name}
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>{s.role ?? ''}</div>
            </div>
            {weekDays.map(d => {
              const daily = shiftsFor(s.id, d);
              return (
                <div key={d.toISOString()} style={{ padding: 6, borderRight: '1px solid #f1f5f9', minHeight: 72 }}>
                  {daily.map(sh => (
                    <div
                      key={sh.id}
                      onClick={() => setEditing(sh)}
                      style={{
                        padding: '5px 7px', marginBottom: 4, borderRadius: 6, cursor: 'pointer',
                        background: STATUS_COLORS[sh.status] + '18',
                        borderLeft: `3px solid ${STATUS_COLORS[sh.status]}`,
                        fontSize: 11,
                      }}
                      title={`${sh.facility_name ?? ''} • ${sh.notes ?? ''}`}
                    >
                      <div style={{ fontWeight: 600, color: STATUS_COLORS[sh.status] }}>{fmtTime(sh.start_time)} – {fmtTime(sh.end_time)}</div>
                      <div style={{ color: '#475569' }}>{sh.role ?? sh.staff_role ?? ''}</div>
                      {sh.facility_name && <div style={{ color: '#94a3b8', fontSize: 10 }}>{sh.facility_name}</div>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {editing && (
        <ShiftModal
          initial={editing}
          staff={staff}
          facilities={facilities}
          onClose={() => setEditing(null)}
          onSave={saveShift}
          onDelete={editing.id ? () => deleteShift(editing.id!) : undefined}
        />
      )}
    </div>
  );
}

// ── Shift Modal ───────────────────────────────────────────────────────────

interface ShiftModalProps {
  initial: Partial<WorkShift>;
  staff: Staff[];
  facilities: Facility[];
  onClose: () => void;
  onSave: (data: Partial<WorkShift>, existing?: WorkShift) => Promise<void>;
  onDelete?: () => void;
}
function ShiftModal({ initial, staff, facilities, onClose, onSave, onDelete }: ShiftModalProps) {
  const existing = initial as WorkShift | undefined;
  const isEdit = !!initial.id;
  const [form, setForm] = useState<Partial<WorkShift>>({
    staff_id: initial.staff_id,
    facility_id: initial.facility_id,
    role: initial.role,
    start_time: initial.start_time?.slice(0, 16),
    end_time: initial.end_time?.slice(0, 16),
    hourly_rate: initial.hourly_rate,
    status: initial.status ?? 'scheduled',
    notes: initial.notes,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!form.staff_id) { setErr('Pick a staff member.'); return; }
    if (!form.start_time || !form.end_time) { setErr('Start and end required.'); return; }
    setSaving(true); setErr(null);
    try {
      const payload: Partial<WorkShift> = {
        ...form,
        start_time: new Date(form.start_time as string).toISOString(),
        end_time: new Date(form.end_time as string).toISOString(),
        hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
      };
      await onSave(payload, isEdit ? existing : undefined);
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Save failed.'); }
    finally { setSaving(false); }
  }

  return (
    <div style={modalOverlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{isEdit ? 'Edit Shift' : 'New Shift'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Labeled label="Staff *">
            <select style={fieldSt} value={form.staff_id ?? ''} onChange={e => setForm({ ...form, staff_id: e.target.value })}>
              <option value="">— Select —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
            </select>
          </Labeled>
          <Labeled label="Facility">
            <select style={fieldSt} value={form.facility_id ?? ''} onChange={e => setForm({ ...form, facility_id: e.target.value || null })}>
              <option value="">— None —</option>
              {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Labeled>
          <Labeled label="Start *">
            <input type="datetime-local" style={fieldSt} value={form.start_time ?? ''} onChange={e => setForm({ ...form, start_time: e.target.value })} />
          </Labeled>
          <Labeled label="End *">
            <input type="datetime-local" style={fieldSt} value={form.end_time ?? ''} onChange={e => setForm({ ...form, end_time: e.target.value })} />
          </Labeled>
          <Labeled label="Role">
            <input style={fieldSt} value={form.role ?? ''} onChange={e => setForm({ ...form, role: e.target.value })} placeholder="RN / LVN / CNA" />
          </Labeled>
          <Labeled label="Hourly rate ($)">
            <input type="number" min={0} step="0.01" style={fieldSt} value={form.hourly_rate ?? ''} onChange={e => setForm({ ...form, hourly_rate: e.target.value ? Number(e.target.value) : null })} />
          </Labeled>
          <Labeled label="Status">
            <select style={fieldSt} value={form.status ?? 'scheduled'} onChange={e => setForm({ ...form, status: e.target.value as WorkShift['status'] })}>
              <option value="scheduled">Scheduled</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No-show</option>
            </select>
          </Labeled>
        </div>
        <Labeled label="Notes">
          <textarea rows={2} style={{ ...fieldSt, resize: 'vertical' }} value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </Labeled>
        {err && <div style={{ color: '#c62828', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          {onDelete && <button onClick={onDelete} style={{ ...ghostBtnStyle, color: '#c62828' }}>Delete</button>}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
            <button onClick={() => void submit()} disabled={saving} style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</label>
      {children}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '180px repeat(7, 1fr)',
  borderBottom: '1px solid #f1f5f9',
};
const headerCellStyle: React.CSSProperties = {
  padding: '10px 8px', fontSize: 11, fontWeight: 700, color: '#64748b',
  textTransform: 'uppercase', letterSpacing: 0.4, borderRight: '1px solid #f1f5f9',
  background: '#f8fafc',
};
const fieldSt: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff',
  fontFamily: 'inherit', color: '#1e293b',
};
const navBtnStyle: React.CSSProperties = {
  padding: '8px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0',
  borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#475569',
};
const ghostBtnStyle: React.CSSProperties = {
  padding: '8px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0',
  borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#475569',
};
const modalOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
};
const modalCard: React.CSSProperties = {
  background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 540,
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '92vh', overflowY: 'auto',
};
