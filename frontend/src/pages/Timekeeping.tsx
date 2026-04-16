import { useState } from 'react';

interface Timesheet {
  id: number;
  staff: string;
  facility: string;
  weekOf: string;
  hours: number;
  submitted: string;
  verified: boolean;
}

const INITIAL_TIMESHEETS: Timesheet[] = [
  {
    id: 1,
    staff: 'Sarah Mitchell',
    facility: 'Mercy Hospital',
    weekOf: 'Apr 1–7',
    hours: 36,
    submitted: 'Apr 8',
    verified: false,
  },
  {
    id: 2,
    staff: 'Marcus Green',
    facility: "St. Luke's Medical",
    weekOf: 'Apr 1–7',
    hours: 40,
    submitted: 'Apr 8',
    verified: true,
  },
  {
    id: 3,
    staff: 'Diana Patel',
    facility: 'Valley Clinic',
    weekOf: 'Apr 1–7',
    hours: 38,
    submitted: 'Apr 7',
    verified: true,
  },
  {
    id: 4,
    staff: 'James Torres',
    facility: "St. Luke's Medical",
    weekOf: 'Apr 1–7',
    hours: 32,
    submitted: 'Apr 9',
    verified: false,
  },
];

const STAFF_OPTIONS = ['Sarah Mitchell', 'Marcus Green', 'Diana Patel', 'James Torres', 'Angela Reyes', 'Kevin Park'];
const FACILITY_OPTIONS = ['Mercy Hospital', "St. Luke's Medical", 'Valley Clinic', 'Harris Health System', 'Riverside MC'];
const HOURLY_RATE = 35;

const EMPTY_FORM = {
  staff: STAFF_OPTIONS[0],
  facility: FACILITY_OPTIONS[0],
  weekOf: '',
  hours: '',
  notes: '',
};

export default function Timekeeping() {
  const [timesheets, setTimesheets] = useState<Timesheet[]>(INITIAL_TIMESHEETS);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  function verify(id: number) {
    setTimesheets((prev) => prev.map((t) => t.id === id ? { ...t, verified: true } : t));
  }

  function handleSubmit() {
    if (!form.weekOf || !form.hours) return;
    const newSheet: Timesheet = {
      id: Date.now(),
      staff: form.staff,
      facility: form.facility,
      weekOf: form.weekOf,
      hours: Number(form.hours),
      submitted: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      verified: false,
    };
    setTimesheets((prev) => [...prev, newSheet]);
    setForm({ ...EMPTY_FORM });
  }

  const verifiedSheets = timesheets.filter((t) => t.verified);
  const pendingSheets = timesheets.filter((t) => !t.verified);
  const totalVerifiedHours = verifiedSheets.reduce((s, t) => s + t.hours, 0);
  const estimatedPayroll = totalVerifiedHours * HOURLY_RATE;

  function exportExcel() {
    alert('Export started — downloading timekeeping_Apr2026.xlsx');
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>⏱️ Timekeeping Audit</h1>
            <p>Verify all timesheets before payroll runs</p>
          </div>
        </div>
      </div>

      {/* Pending Timesheet Approvals */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3>Pending Timesheet Approvals</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className={pendingSheets.length > 0 ? 'tw' : 'tgr'}>
              {pendingSheets.length} pending
            </span>
            <button className="btn btn-ghost btn-sm" type="button" onClick={exportExcel}>
              📊 Export Excel
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Staff</th>
                <th>Facility</th>
                <th>Week Of</th>
                <th>Hours</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {timesheets.map((t) => (
                <tr
                  key={t.id}
                  style={
                    t.verified
                      ? { background: 'rgba(46,204,113,0.05)' }
                      : undefined
                  }
                >
                  <td>
                    <strong>{t.staff}</strong>
                  </td>
                  <td className="t2">{t.facility}</td>
                  <td className="t2">{t.weekOf}</td>
                  <td>
                    <strong>{t.hours}h</strong>
                  </td>
                  <td className="t3">{t.submitted}</td>
                  <td>
                    {t.verified ? (
                      <span className="tg">Verified</span>
                    ) : (
                      <span className="tw">Pending audit</span>
                    )}
                  </td>
                  <td>
                    {t.verified ? (
                      <span style={{ color: 'var(--t3)', fontSize: 13 }}>—</span>
                    ) : (
                      <button
                        className="btn btn-sm"
                        type="button"
                        style={{ background: 'var(--pr)', color: '#fff' }}
                        onClick={() => verify(t.id)}
                      >
                        Verify
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Submit New Timesheet */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3>Submit New Timesheet</h3>
        </div>
        <div className="pnb">
          <div className="grid-2" style={{ gap: 14, marginBottom: 14 }}>
            <div className="form-group">
              <label className="form-label">Staff Member</label>
              <select
                className="form-select"
                value={form.staff}
                onChange={(e) => setForm({ ...form, staff: e.target.value })}
              >
                {STAFF_OPTIONS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Facility</label>
              <select
                className="form-select"
                value={form.facility}
                onChange={(e) => setForm({ ...form, facility: e.target.value })}
              >
                {FACILITY_OPTIONS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Week Of</label>
              <input
                className="form-input"
                type="date"
                value={form.weekOf}
                onChange={(e) => setForm({ ...form, weekOf: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Hours Worked</label>
              <input
                className="form-input"
                type="number"
                min={0}
                max={168}
                placeholder="e.g. 36"
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              className="form-textarea"
              placeholder="Optional notes — overtime, call shifts, adjustments..."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={handleSubmit}
          >
            Submit Timesheet
          </button>
        </div>
      </div>

      {/* Payroll Summary */}
      <div className="pn">
        <div className="pnh">
          <h3>💰 Payroll Summary</h3>
          <span className="tb">Week of Apr 1–7</span>
        </div>
        <div className="pnb">
          <div className="grid-3" style={{ gap: 16 }}>
            <div className="sc" style={{ borderTop: '3px solid var(--ac)' }}>
              <div className="sc-icon" style={{ background: 'rgba(46,204,113,0.1)', color: 'var(--ac)' }}>⏱️</div>
              <div className="sc-label">Total Verified Hours</div>
              <div className="sc-value">{totalVerifiedHours}h</div>
              <div className="sc-sub">Across {verifiedSheets.length} verified timesheet{verifiedSheets.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="sc" style={{ borderTop: '3px solid var(--pr)' }}>
              <div className="sc-icon" style={{ background: 'rgba(26,95,122,0.1)', color: 'var(--pr)' }}>💵</div>
              <div className="sc-label">Estimated Payroll</div>
              <div className="sc-value">${estimatedPayroll.toLocaleString()}</div>
              <div className="sc-sub">At ${HOURLY_RATE}/hr placeholder rate</div>
            </div>
            <div className="sc" style={{ borderTop: `3px solid ${pendingSheets.length > 0 ? 'var(--wn)' : 'var(--tgr)'}` }}>
              <div
                className="sc-icon"
                style={{
                  background: pendingSheets.length > 0 ? 'rgba(243,156,18,0.1)' : 'rgba(113,128,150,0.1)',
                  color: pendingSheets.length > 0 ? 'var(--wn)' : 'var(--t3)',
                }}
              >
                📋
              </div>
              <div className="sc-label">Timesheets Pending</div>
              <div
                className="sc-value"
                style={{ color: pendingSheets.length > 0 ? 'var(--wn)' : 'var(--t1)' }}
              >
                {pendingSheets.length}
              </div>
              <div className="sc-sub">
                {pendingSheets.length === 0 ? 'All timesheets verified' : 'Awaiting verification'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
