import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Incident {
  id: number;
  staff: string;
  type: string;
  facility: string;
  date: string;
  description: string;
  severity: string;
  workersComp: boolean;
  resolved: boolean;
}

const INITIAL_INCIDENTS: Incident[] = [
  {
    id: 1,
    staff: 'James Torres',
    type: 'Workplace injury',
    facility: "St. Luke's Medical",
    date: 'Apr 7, 2026',
    description: 'Minor back strain reported while repositioning patient. Staff self-reported. No emergency treatment required. Under review with risk management.',
    severity: 'Medium',
    workersComp: true,
    resolved: false,
  },
];

const EMPTY_FORM = {
  staff: '',
  type: 'Workplace injury',
  facility: '',
  date: '',
  description: '',
  severity: 'Low',
  workersComp: false,
};

function severityTag(s: string) {
  if (s === 'Critical') return 'td';
  if (s === 'High') return 'tw';
  if (s === 'Medium') return 'tb';
  return 'tgr';
}

export default function Incidents() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState<Incident[]>(INITIAL_INCIDENTS);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const open = incidents.filter((i) => !i.resolved);
  const closed = incidents.filter((i) => i.resolved);

  function handleSubmit() {
    if (!form.staff.trim()) return;
    const newInc: Incident = {
      id: Date.now(),
      staff: form.staff,
      type: form.type,
      facility: form.facility,
      date: form.date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      description: form.description,
      severity: form.severity,
      workersComp: form.workersComp,
      resolved: false,
    };
    setIncidents((prev) => [...prev, newInc]);
    setForm({ ...EMPTY_FORM });
  }

  function markResolved(id: number) {
    setIncidents((prev) => prev.map((i) => i.id === id ? { ...i, resolved: true } : i));
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>⚠️ Incident Reports</h1>
            <p>All workplace incidents formally documented</p>
          </div>
          <button
            className="btn btn-danger btn-sm"
            type="button"
            onClick={() => {
              const el = document.getElementById('incident-form-panel');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            + Report Incident
          </button>
        </div>
      </div>

      {/* Open Incidents */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3>Open Incidents</h3>
          <span className={open.length > 0 ? 'td' : 'tgr'}>{open.length} open</span>
        </div>
        <div className="pnb" style={{ padding: open.length === 0 ? 24 : 0 }}>
          {open.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: '24px 0' }}>
              No open incidents. All clear.
            </div>
          ) : (
            open.map((inc) => (
              <div
                key={inc.id}
                className="incident-item"
                style={{
                  padding: '16px 18px',
                  borderBottom: '1px solid var(--sf3)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <strong style={{ fontSize: 14 }}>{inc.type}</strong>
                      <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
                      <span style={{ fontSize: 13, color: 'var(--t2)' }}>{inc.staff}</span>
                      <span style={{ color: 'var(--t3)', fontSize: 12 }}>{inc.date}</span>
                      <span className="tw">Under review</span>
                      <span className={severityTag(inc.severity)}>{inc.severity}</span>
                      {inc.workersComp && <span className="tb">Workers&apos; comp</span>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 10 }}>
                      {inc.description}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10 }}>
                      Facility: {inc.facility}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" type="button">
                    View Full Report
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    style={{ color: 'var(--pu)', borderColor: 'var(--pu)' }}
                    onClick={() => navigate('/ai-assistant')}
                  >
                    ✦ Ask AI Next Steps
                  </button>
                  <button
                    className="btn btn-sm"
                    type="button"
                    style={{ background: 'var(--ac)', color: '#fff' }}
                    onClick={() => markResolved(inc.id)}
                  >
                    Mark Resolved
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Log New Incident Form */}
      <div className="pn" id="incident-form-panel" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3>Log New Incident</h3>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            style={{ color: 'var(--pu)', borderColor: 'rgba(142,68,173,0.3)' }}
            onClick={() => navigate('/ai-assistant')}
          >
            ✦ Ask AI What to Include
          </button>
        </div>
        <div className="pnb">
          <div className="grid-2" style={{ gap: 14, marginBottom: 14 }}>
            <div className="form-group">
              <label className="form-label">Staff Member</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. James Torres"
                value={form.staff}
                onChange={(e) => setForm({ ...form, staff: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Incident Type</label>
              <select
                className="form-select"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option>Workplace injury</option>
                <option>Patient complaint</option>
                <option>Misconduct allegation</option>
                <option>Documentation issue</option>
                <option>Contract dispute</option>
                <option>Other</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Facility</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. Mercy Hospital"
                value={form.facility}
                onChange={(e) => setForm({ ...form, facility: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input
                className="form-input"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Severity</label>
              <select
                className="form-select"
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
              >
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
                <option>Critical</option>
              </select>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', paddingTop: 22 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--t2)' }}>
                <input
                  type="checkbox"
                  checked={form.workersComp}
                  onChange={(e) => setForm({ ...form, workersComp: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--pr)' }}
                />
                Workers&apos; compensation claim filed
              </label>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              placeholder="Describe what happened, when, where, and who was involved..."
              style={{ minHeight: 100 }}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <button
            className="btn btn-danger btn-sm"
            type="button"
            onClick={handleSubmit}
          >
            Submit Report
          </button>
        </div>
      </div>

      {/* Closed/Resolved Incidents */}
      <div className="pn">
        <div className="pnh">
          <h3>Closed / Resolved</h3>
          <span className="tg">{closed.length} resolved</span>
        </div>
        <div className="pnb" style={{ padding: closed.length === 0 ? 24 : 0 }}>
          {closed.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: '24px 0' }}>
              No resolved incidents yet. Resolved incidents will appear here.
            </div>
          ) : (
            closed.map((inc) => (
              <div
                key={inc.id}
                style={{
                  padding: '14px 18px',
                  borderBottom: '1px solid var(--sf3)',
                  opacity: 0.75,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{inc.type}</strong>
                  <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
                  <span style={{ fontSize: 13, color: 'var(--t2)' }}>{inc.staff}</span>
                  <span style={{ color: 'var(--t3)', fontSize: 12 }}>{inc.date}</span>
                  <span className="tg">Resolved</span>
                  <span className={severityTag(inc.severity)}>{inc.severity}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 4 }}>{inc.description}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
