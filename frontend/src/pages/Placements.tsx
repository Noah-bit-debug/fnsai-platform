import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Placement {
  id: string;
  staff: string;
  staffId?: string;
  candidateId?: string;
  role: string;
  facility: string;
  start: string;
  end: string;
  contract: string;
  contractClass: string;
  status: string;
  statusClass: string;
}

interface Requisition {
  id: string;
  role: string;
  facility: string;
  shift: string;
  needed: string;
  urgency?: 'asap' | 'soon' | 'flexible';
}

const INITIAL_PLACEMENTS: Placement[] = [
  {
    id: 'p1',
    staff: 'Ana Reyes',
    role: 'RN',
    facility: 'Harris Health System',
    start: 'Apr 14, 2026',
    end: 'Jul 13, 2026',
    contract: 'Signed',
    contractClass: 'tg',
    status: 'active',
    statusClass: 'tg',
  },
  {
    id: 'p2',
    staff: 'James Torres',
    role: 'CNA',
    facility: 'Mercy Hospital',
    start: 'Apr 21, 2026',
    end: 'Jul 20, 2026',
    contract: 'Pending eSign',
    contractClass: 'tw',
    status: 'pending',
    statusClass: 'tw',
  },
  {
    id: 'p3',
    staff: 'Sarah Mitchell',
    role: 'RN',
    facility: "St. Luke's Medical",
    start: 'Apr 7, 2026',
    end: 'Oct 6, 2026',
    contract: 'Signed',
    contractClass: 'tg',
    status: 'active',
    statusClass: 'tg',
  },
  {
    id: 'p4',
    staff: 'Marcus Green',
    role: 'RT',
    facility: 'Valley Clinic',
    start: 'Apr 28, 2026',
    end: 'Jul 27, 2026',
    contract: 'Pending eSign',
    contractClass: 'tw',
    status: 'pending',
    statusClass: 'tw',
  },
  {
    id: 'p5',
    staff: 'Diana Patel',
    role: 'RN',
    facility: 'Harris Health System',
    start: 'Mar 3, 2026',
    end: 'Jun 1, 2026',
    contract: 'Signed',
    contractClass: 'tg',
    status: 'active',
    statusClass: 'tg',
  },
];

const OPEN_REQS: Requisition[] = [
  { id: 'r1', role: 'LPN', facility: 'Mercy Hospital',       shift: 'Day shift, 3x12',  needed: 'ASAP',          urgency: 'asap' },
  { id: 'r2', role: 'CNA', facility: 'Harris Health System', shift: 'Night shift, 5x8', needed: 'May 1, 2026',   urgency: 'soon' },
  { id: 'r3', role: 'RN',  facility: 'Valley Clinic',        shift: 'Day shift, 3x12',  needed: 'Jun 1, 2026',   urgency: 'flexible' },
];

const URGENCY_COLORS: Record<string, string> = {
  asap:     '#c62828',
  soon:     '#e65100',
  flexible: '#2e7d32',
};

const STAFF_OPTIONS = [
  'Ana Reyes', 'James Torres', 'Sarah Mitchell', 'Marcus Green',
  'Diana Patel', 'Lisa Kim', 'Tom Reed', 'Ben Carter',
];
const FACILITY_OPTIONS = [
  'Harris Health System', 'Mercy Hospital', "St. Luke's Medical", 'Valley Clinic', 'Memorial Hospital',
];

interface NewPlacementForm {
  staff: string;
  role: string;
  facility: string;
  start: string;
  end: string;
}

const EMPTY_FORM: NewPlacementForm = { staff: '', role: '', facility: '', start: '', end: '' };

type TabKey = 'active' | 'pending' | 'open_reqs';

export default function Placements() {
  const navigate = useNavigate();
  const [placements, setPlacements] = useState<Placement[]>(INITIAL_PLACEMENTS);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewPlacementForm>(EMPTY_FORM);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('active');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function handleCreate() {
    if (!form.staff || !form.role || !form.facility) return;
    const newP: Placement = {
      id: `p${Date.now()}`,
      staff: form.staff,
      role: form.role,
      facility: form.facility,
      start: form.start || 'TBD',
      end: form.end || 'TBD',
      contract: 'Pending eSign',
      contractClass: 'tw',
      status: 'pending',
      statusClass: 'tw',
    };
    setPlacements((prev) => [...prev, newP]);
    setForm(EMPTY_FORM);
    setShowModal(false);
    showToast(`Placement created for ${newP.staff}`);
  }

  function sendContract(p: Placement) {
    setPlacements((prev) =>
      prev.map((pl) =>
        pl.id === p.id ? { ...pl, contract: 'Sent', contractClass: 'tb' } : pl
      )
    );
    showToast(`Contract sent via Foxit eSign to ${p.staff}`);
  }

  function fillPosition(req: Requisition) {
    setForm({ ...EMPTY_FORM, role: req.role, facility: req.facility });
    setShowModal(true);
  }

  function handleEmployeeClick(p: Placement) {
    if (p.candidateId) {
      navigate(`/candidates/${p.candidateId}`);
    } else if (p.staffId) {
      navigate(`/staff/${p.staffId}`);
    }
    // If no ID available, do nothing (plain display)
  }

  // ── Filtered data ────────────────────────────────────────────────────────
  const activePlacements  = placements.filter(p => p.status === 'active');
  const pendingPlacements = placements.filter(p => p.status === 'pending' || p.status === 'open');

  const tabCounts: Record<TabKey, number> = {
    active:   activePlacements.length,
    pending:  pendingPlacements.length,
    open_reqs: OPEN_REQS.length,
  };

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'active',    label: `Active Employees (${tabCounts.active})` },
    { key: 'pending',   label: `Pending Placements (${tabCounts.pending})` },
    { key: 'open_reqs', label: `Open Requisitions (${tabCounts.open_reqs})` },
  ];

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '12px 22px', border: 'none', cursor: 'pointer', fontSize: 14,
    fontWeight: active ? 700 : 500,
    color: active ? '#1565c0' : '#64748b',
    background: active ? '#eff6ff' : 'transparent',
    borderBottom: active ? '2px solid #1565c0' : '2px solid transparent',
  });

  function renderPlacementsTable(rows: Placement[], isActive: boolean) {
    const employeeHeader = isActive ? 'Employee' : 'Staff';
    if (rows.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>{isActive ? '👩‍⚕️' : '⏳'}</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>
            {isActive ? 'No active employees' : 'No pending placements'}
          </div>
          <div style={{ fontSize: 14, color: '#64748b' }}>
            {isActive ? 'Active placements will appear here.' : 'New placements awaiting contracts will show here.'}
          </div>
        </div>
      );
    }
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{employeeHeader}</th>
              <th>Role</th>
              <th>Facility</th>
              <th>Start</th>
              <th>End</th>
              <th>Contract</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>
                  {(p.candidateId || p.staffId) ? (
                    <button
                      onClick={() => handleEmployeeClick(p)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontWeight: 600, color: '#1565c0', fontSize: 14, padding: 0,
                        textDecoration: 'underline', textUnderlineOffset: 3,
                      }}
                    >
                      {p.staff}
                    </button>
                  ) : (
                    p.staff
                  )}
                </td>
                <td>
                  <span className="tag tgr">{p.role}</span>
                </td>
                <td className="t2">{p.facility}</td>
                <td className="t3">{p.start}</td>
                <td className="t3">{p.end}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`tag ${p.contractClass}`}>{p.contract}</span>
                    {p.contract === 'Pending eSign' && (
                      <button
                        className="btn btn-gh btn-sm"
                        onClick={() => sendContract(p)}
                        style={{ fontSize: '11px', padding: '3px 8px' }}
                      >
                        Send Contract
                      </button>
                    )}
                    {p.contract === 'Sent' && (
                      <span style={{ fontSize: '11px', color: 'var(--t3)' }}>✓ Sent</span>
                    )}
                  </div>
                </td>
                <td>
                  <span className={`tag ${p.statusClass}`}>
                    {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="ph">
        <div>
          <div className="pt">🏥 Placements</div>
          <div className="ps">Manage active employees, pending placements, and open requisitions</div>
        </div>
        <button className="btn btn-pr" onClick={() => { setForm(EMPTY_FORM); setShowModal(true); }}>
          + New Placement
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="ab ab-g" style={{ marginBottom: '16px' }}>
          ✓ {toast}
        </div>
      )}

      {/* Tab bar + content */}
      <div className="pn" style={{ marginBottom: '24px', padding: 0, overflow: 'hidden' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={tabBtnStyle(activeTab === t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Active Employees */}
        {activeTab === 'active' && (
          <div style={{ padding: '4px 0' }}>
            {renderPlacementsTable(activePlacements, true)}
          </div>
        )}

        {/* Tab: Pending Placements */}
        {activeTab === 'pending' && (
          <div style={{ padding: '4px 0' }}>
            {renderPlacementsTable(pendingPlacements, false)}
          </div>
        )}

        {/* Tab: Open Requisitions */}
        {activeTab === 'open_reqs' && (
          <div>
            {OPEN_REQS.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>No open requisitions</div>
                <div style={{ fontSize: 14, color: '#64748b' }}>All positions are currently filled.</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Facility</th>
                      <th>Shift</th>
                      <th>Needed By</th>
                      <th>Urgency</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OPEN_REQS.map((req) => (
                      <tr key={req.id}>
                        <td>
                          <span className="tag tp">{req.role}</span>
                        </td>
                        <td className="t2">{req.facility}</td>
                        <td className="t3">{req.shift}</td>
                        <td className="t3">{req.needed}</td>
                        <td>
                          {req.urgency && (
                            <span style={{
                              background: URGENCY_COLORS[req.urgency],
                              color: '#fff', borderRadius: 10, padding: '3px 10px',
                              fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
                            }}>
                              {req.urgency === 'asap' ? 'ASAP' : req.urgency.charAt(0).toUpperCase() + req.urgency.slice(1)}
                            </span>
                          )}
                        </td>
                        <td>
                          <button className="btn btn-ac btn-sm" onClick={() => fillPosition(req)}>
                            Fill Position
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* New Placement Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Placement</h3>
              <button className="btn btn-gh btn-sm" onClick={() => setShowModal(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label className="fl">Staff Member</label>
                <select
                  className="fi form-select"
                  value={form.staff}
                  onChange={(e) => setForm({ ...form, staff: e.target.value })}
                >
                  <option value="">Select staff…</option>
                  {STAFF_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="fg">
                <label className="fl">Role</label>
                <input
                  className="fi"
                  placeholder="e.g. RN, CNA, LPN"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                />
              </div>
              <div className="fg">
                <label className="fl">Facility</label>
                <select
                  className="fi form-select"
                  value={form.facility}
                  onChange={(e) => setForm({ ...form, facility: e.target.value })}
                >
                  <option value="">Select facility…</option>
                  {FACILITY_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="fg">
                  <label className="fl">Start Date</label>
                  <input
                    className="fi"
                    type="date"
                    value={form.start}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                  />
                </div>
                <div className="fg">
                  <label className="fl">End Date</label>
                  <input
                    className="fi"
                    type="date"
                    value={form.end}
                    onChange={(e) => setForm({ ...form, end: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-gh" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button className="btn btn-pr" onClick={handleCreate}>
                Create Placement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
