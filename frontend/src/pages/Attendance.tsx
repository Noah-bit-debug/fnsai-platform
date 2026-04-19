import { useState, useEffect } from 'react';

interface AttendanceEntry {
  id: string;
  date: string;
  staff_name: string;
  staff_role: string;
  clock_in: string;
  clock_out: string;
  break_minutes: number;
  total_hours: number;
  notes: string;
  status: 'present' | 'late' | 'absent' | 'half_day' | 'pto' | 'sick';
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  present:  { label: 'Present',   color: '#166534', bg: '#dcfce7' },
  late:     { label: 'Late',      color: '#854d0e', bg: '#fef9c3' },
  absent:   { label: 'Absent',    color: '#991b1b', bg: '#fee2e2' },
  half_day: { label: 'Half Day',  color: '#1d4ed8', bg: '#dbeafe' },
  pto:      { label: 'PTO',       color: '#7c3aed', bg: '#ede9fe' },
  sick:     { label: 'Sick',      color: '#6b7280', bg: '#f3f4f6' },
};

const LS_KEY = 'fns_attendance_log';

function calcHours(clockIn: string, clockOut: string, breakMin: number): number {
  if (!clockIn || !clockOut) return 0;
  const [ih, im] = clockIn.split(':').map(Number);
  const [oh, om] = clockOut.split(':').map(Number);
  const totalMin = (oh * 60 + om) - (ih * 60 + im) - breakMin;
  return Math.max(0, Math.round(totalMin / 6) / 10);
}

// Returns YYYY-MM-DD in the user's LOCAL timezone. Previously we used
// `new Date().toISOString().slice(0, 10)` which returns UTC — after ~7 PM
// CDT that would roll the date forward by a day, so "today" defaulted to
// tomorrow.
const todayLocal = (): string => new Date().toLocaleDateString('en-CA');

const EMPTY_FORM: Partial<AttendanceEntry> = {
  date: todayLocal(),
  staff_name: '',
  staff_role: '',
  clock_in: '08:00',
  clock_out: '17:00',
  break_minutes: 30,
  status: 'present',
  notes: '',
};

export default function Attendance() {
  const [entries, setEntries] = useState<AttendanceEntry[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Partial<AttendanceEntry>>(EMPTY_FORM);
  const [filterDate, setFilterDate] = useState(todayLocal());
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    try {
      setEntries(JSON.parse(localStorage.getItem(LS_KEY) ?? '[]'));
    } catch {}
  }, []);

  const save = (updated: AttendanceEntry[]) => {
    setEntries(updated);
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const totalHours = calcHours(form.clock_in ?? '', form.clock_out ?? '', form.break_minutes ?? 0);
    const entry: AttendanceEntry = {
      id: Date.now().toString(),
      date: form.date ?? todayLocal(),
      staff_name: form.staff_name ?? '',
      staff_role: form.staff_role ?? '',
      clock_in: form.clock_in ?? '',
      clock_out: form.clock_out ?? '',
      break_minutes: form.break_minutes ?? 0,
      total_hours: totalHours,
      notes: form.notes ?? '',
      status: form.status ?? 'present',
    };
    save([entry, ...entries]);
    setShowModal(false);
    setForm(EMPTY_FORM);
  };

  const handleDelete = (id: string) => {
    if (!confirm('Remove this attendance record?')) return;
    save(entries.filter(e => e.id !== id));
  };

  const filtered = entries.filter(e => {
    if (filterDate && e.date !== filterDate) return false;
    if (filterStatus && e.status !== filterStatus) return false;
    if (search && !e.staff_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    present: entries.filter(e => e.date === filterDate && e.status === 'present').length,
    late:    entries.filter(e => e.date === filterDate && e.status === 'late').length,
    absent:  entries.filter(e => e.date === filterDate && e.status === 'absent').length,
    pto:     entries.filter(e => e.date === filterDate && ['pto','sick'].includes(e.status)).length,
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid #e8edf2',
    borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>📅 Attendance Log</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Manual attendance tracking for staff members</p>
          </div>
          <button onClick={() => setShowModal(true)}
            style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            + Log Attendance
          </button>
        </div>
      </div>

      {/* Daily Snapshot */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Present',     value: stats.present, color: '#166534', bg: '#dcfce7', icon: '✅' },
          { label: 'Late',        value: stats.late,    color: '#854d0e', bg: '#fef9c3', icon: '⏰' },
          { label: 'Absent',      value: stats.absent,  color: '#991b1b', bg: '#fee2e2', icon: '❌' },
          { label: 'PTO / Sick',  value: stats.pto,     color: '#7c3aed', bg: '#ede9fe', icon: '🏖' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '16px 20px', border: `1px solid ${s.color}22` }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: s.color, fontWeight: 600, marginTop: 4 }}>{s.icon} {s.label}</div>
            <div style={{ fontSize: 11, color: `${s.color}88`, marginTop: 2 }}>
              {new Date(filterDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Date</label>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13 }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Status</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13 }}>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Search</label>
          <input type="text" placeholder="Search by staff name..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <button onClick={() => { setFilterDate(''); setFilterStatus(''); setSearch(''); }}
            style={{ padding: '8px 14px', background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151' }}>
            Clear
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>📅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>No attendance records</div>
            <div style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>
              {entries.length === 0 ? 'Log your first attendance entry to get started.' : 'No records match your filters.'}
            </div>
            {entries.length === 0 && (
              <button onClick={() => setShowModal(true)} style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                + Log Attendance
              </button>
            )}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e8edf2' }}>
                {['Date', 'Staff Member', 'Role', 'Clock In', 'Clock Out', 'Hours', 'Status', 'Notes', ''].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const sm = STATUS_META[e.status];
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 14px', fontSize: 13, color: '#374151', fontWeight: 500 }}>
                      {new Date(e.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 14, fontWeight: 700, color: '#1a2b3c' }}>{e.staff_name}</td>
                    <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b' }}>{e.staff_role || '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, color: '#374151', fontFamily: 'monospace' }}>{e.clock_in || '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, color: '#374151', fontFamily: 'monospace' }}>{e.clock_out || '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 700, color: '#1a2b3c' }}>
                      {e.total_hours > 0 ? `${e.total_hours}h` : '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ background: sm.bg, color: sm.color, borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>{sm.label}</span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.notes || '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <button onClick={() => handleDelete(e.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontSize: 12, fontWeight: 600 }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {filtered.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#64748b', textAlign: 'right' }}>
          {filtered.length} record{filtered.length !== 1 ? 's' : ''}
          {filtered.length > 0 && (
            <span style={{ marginLeft: 16 }}>
              Total hours: {filtered.reduce((sum, e) => sum + e.total_hours, 0).toFixed(1)}h
            </span>
          )}
        </div>
      )}

      {/* Add Attendance Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
             onClick={() => setShowModal(false)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 520, width: '92%', maxHeight: '90vh', overflowY: 'auto' }}
               onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: '#1a2b3c' }}>Log Attendance</h3>
            <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Date *</label>
                  <input type="date" required value={form.date ?? ''} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} style={inp} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Status *</label>
                  <select required value={form.status ?? 'present'} onChange={e => setForm(p => ({ ...p, status: e.target.value as any }))} style={{ ...inp, height: 38 }}>
                    {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Staff Name *</label>
                  <input type="text" required placeholder="Full name" value={form.staff_name ?? ''} onChange={e => setForm(p => ({ ...p, staff_name: e.target.value }))} style={inp} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Role</label>
                  <input type="text" placeholder="e.g. RN, LPN" value={form.staff_role ?? ''} onChange={e => setForm(p => ({ ...p, staff_role: e.target.value }))} style={inp} />
                </div>
              </div>
              {['present', 'late', 'half_day'].includes(form.status ?? 'present') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Clock In</label>
                    <input type="time" value={form.clock_in ?? '08:00'} onChange={e => setForm(p => ({ ...p, clock_in: e.target.value }))} style={inp} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Clock Out</label>
                    <input type="time" value={form.clock_out ?? '17:00'} onChange={e => setForm(p => ({ ...p, clock_out: e.target.value }))} style={inp} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Break (min)</label>
                    <input type="number" min={0} max={120} value={form.break_minutes ?? 30} onChange={e => setForm(p => ({ ...p, break_minutes: Number(e.target.value) }))} style={inp} />
                  </div>
                </div>
              )}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Notes</label>
                <textarea rows={2} value={form.notes ?? ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes..." style={{ ...inp, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: '10px 20px', background: '#f1f5f9', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
                <button type="submit" style={{ padding: '10px 20px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Save Record</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
