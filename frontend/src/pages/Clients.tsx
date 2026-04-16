import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Facility {
  id: number;
  name: string;
  type: string;
  activeStaff: number;
  openReqs: number;
  contract: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  specialReqs: string;
}

const INITIAL_FACILITIES: Facility[] = [
  {
    id: 1,
    name: 'Harris Health System',
    type: 'Health System',
    activeStaff: 4,
    openReqs: 2,
    contract: 'Active',
    contactName: 'Patricia Kim',
    contactEmail: 'pkim@harrishealth.org',
    contactPhone: '(713) 566-6400',
    specialReqs: 'NPI required in field 7B of placement form. Background check via CastleBranch only.',
  },
  {
    id: 2,
    name: 'Mercy Hospital',
    type: 'Hospital',
    activeStaff: 3,
    openReqs: 1,
    contract: 'Active',
    contactName: 'David Ruiz',
    contactEmail: 'druiz@mercyhosp.com',
    contactPhone: '(281) 340-2100',
    specialReqs: 'AHCA BLS certification required. Must present original card on day 1.',
  },
  {
    id: 3,
    name: "St. Luke's Medical",
    type: 'Medical Center',
    activeStaff: 2,
    openReqs: 1,
    contract: 'Renewing',
    contactName: 'Angela Torres',
    contactEmail: 'atorres@stlukesmed.com',
    contactPhone: '(832) 355-1000',
    specialReqs: 'Float pool only. Must have 2+ years acute care experience.',
  },
  {
    id: 4,
    name: 'Valley Clinic',
    type: 'Clinic',
    activeStaff: 2,
    openReqs: 0,
    contract: 'Active',
    contactName: 'Marcus Webb',
    contactEmail: 'mwebb@valleyclinic.net',
    contactPhone: '(956) 781-4500',
    specialReqs: 'Spanish-speaking staff preferred. Bilingual documentation required.',
  },
  {
    id: 5,
    name: 'Riverside MC',
    type: 'Medical Center',
    activeStaff: 1,
    openReqs: 1,
    contract: 'Pending',
    contactName: 'Susan Holt',
    contactEmail: 'sholt@riversidemc.org',
    contactPhone: '(409) 899-2100',
    specialReqs: 'Contract pending legal review. Do not place staff until signed.',
  },
];

function contractTag(status: string) {
  if (status === 'Active') return 'tg';
  if (status === 'Renewing') return 'tw';
  if (status === 'Expired') return 'td';
  if (status === 'Pending') return 'tb';
  return 'tgr';
}

const EMPTY_FORM = {
  name: '',
  type: 'Hospital',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  contract: 'Active',
  specialReqs: '',
};

export default function Clients() {
  const navigate = useNavigate();
  const [facilities, setFacilities] = useState<Facility[]>(INITIAL_FACILITIES);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [toast, setToast] = useState<string | null>(null);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [editForm, setEditForm] = useState({ ...EMPTY_FORM });

  function openEdit(f: Facility) {
    setEditingFacility(f);
    setEditForm({
      name: f.name,
      type: f.type,
      contactName: f.contactName,
      contactEmail: f.contactEmail,
      contactPhone: f.contactPhone,
      contract: f.contract,
      specialReqs: f.specialReqs,
    });
  }

  function saveEdit() {
    if (!editingFacility || !editForm.name.trim()) return;
    setFacilities((prev) =>
      prev.map((f) =>
        f.id === editingFacility.id
          ? { ...f, ...editForm }
          : f
      )
    );
    setEditingFacility(null);
    showToast('Facility updated successfully.');
  }

  const totalStaff = facilities.reduce((s, f) => s + f.activeStaff, 0);
  const totalReqs = facilities.reduce((s, f) => s + f.openReqs, 0);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function handleSave() {
    if (!form.name.trim()) return;
    const newFacility: Facility = {
      id: Date.now(),
      name: form.name,
      type: form.type,
      activeStaff: 0,
      openReqs: 0,
      contract: form.contract,
      contactName: form.contactName,
      contactEmail: form.contactEmail,
      contactPhone: form.contactPhone,
      specialReqs: form.specialReqs,
    };
    setFacilities((prev) => [...prev, newFacility]);
    setForm({ ...EMPTY_FORM });
    setShowAddForm(false);
    showToast('Facility added successfully.');
  }

  function toggleRow(id: number) {
    setExpandedRow((prev) => (prev === id ? null : id));
  }

  return (
    <div>
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 24,
            background: 'var(--t1)',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            zIndex: 9999,
            boxShadow: 'var(--sh2)',
          }}
        >
          {toast}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>🤝 Clients &amp; Facilities</h1>
            <p>Manage your facility accounts, contracts, and contacts</p>
          </div>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
          >
            + Add Facility
          </button>
        </div>
      </div>

      {/* Stat Bar */}
      <div className="grid-3" style={{ marginBottom: 20 }}>
        <div className="sc" style={{ borderTop: '3px solid var(--pr)' }}>
          <div className="sc-icon" style={{ background: 'rgba(26,95,122,0.1)', color: 'var(--pr)' }}>🏥</div>
          <div className="sc-label">Active Facilities</div>
          <div className="sc-value">{facilities.length}</div>
          <div className="sc-sub">Total facility accounts</div>
        </div>
        <div className="sc" style={{ borderTop: '3px solid var(--ac)' }}>
          <div className="sc-icon" style={{ background: 'rgba(46,204,113,0.1)', color: 'var(--ac)' }}>👥</div>
          <div className="sc-label">Active Staff</div>
          <div className="sc-value">{totalStaff}</div>
          <div className="sc-sub">Currently placed</div>
        </div>
        <div className="sc" style={{ borderTop: '3px solid var(--wn)' }}>
          <div className="sc-icon" style={{ background: 'rgba(243,156,18,0.1)', color: 'var(--wn)' }}>📋</div>
          <div className="sc-label">Open Requisitions</div>
          <div className="sc-value">{totalReqs}</div>
          <div className="sc-sub">Unfilled positions</div>
        </div>
      </div>

      {/* Facilities Table */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3>Facility Accounts</h3>
          <span className="tgr">{facilities.length} facilities</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Facility</th>
                <th>Type</th>
                <th>Active Staff</th>
                <th>Open Reqs</th>
                <th>Contract</th>
                <th>Contact</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {facilities.map((f) => (
                <>
                  <tr
                    key={f.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleRow(f.id)}
                  >
                    <td>
                      <strong style={{ color: 'var(--pr)' }}>{f.name}</strong>
                    </td>
                    <td className="t2">{f.type}</td>
                    <td>
                      <span className="tg">{f.activeStaff} staff</span>
                    </td>
                    <td>
                      {f.openReqs > 0 ? (
                        <span className="tw">{f.openReqs} open</span>
                      ) : (
                        <span className="tgr">None</span>
                      )}
                    </td>
                    <td>
                      <span className={contractTag(f.contract)}>{f.contract}</span>
                    </td>
                    <td className="t2">{f.contactName}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => window.open(`mailto:${f.contactEmail}`, '_blank')}
                      >
                        📧 Email Contact
                      </button>
                    </td>
                  </tr>
                  {expandedRow === f.id && (
                    <tr key={`${f.id}-detail`} style={{ background: 'var(--sf2)' }}>
                      <td colSpan={7} style={{ padding: '14px 18px' }}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr 1fr',
                            gap: 16,
                            marginBottom: 12,
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', marginBottom: 4 }}>Contact</div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{f.contactName}</div>
                            <div style={{ fontSize: 12, color: 'var(--t2)' }}>{f.contactEmail}</div>
                            <div style={{ fontSize: 12, color: 'var(--t2)' }}>{f.contactPhone}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', marginBottom: 4 }}>Contract Status</div>
                            <span className={contractTag(f.contract)}>{f.contract}</span>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', marginBottom: 4 }}>Special Requirements</div>
                            <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>{f.specialReqs || '—'}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/checklists')}>📋 View Checklist</button>
                          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/placements')}>🔗 View Placements</button>
                          <button className="btn btn-ghost btn-sm" type="button" onClick={(e) => { e.stopPropagation(); openEdit(f); }}>✏️ Edit</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Facility Modal */}
      {editingFacility && (
        <div className="modal-overlay" onClick={() => setEditingFacility(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Facility</h3>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditingFacility(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="grid-2" style={{ gap: 14, marginBottom: 14 }}>
                <div className="form-group">
                  <label className="form-label">Facility Name</label>
                  <input
                    className="form-input"
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select
                    className="form-select"
                    value={editForm.type}
                    onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                  >
                    <option>Hospital</option>
                    <option>Health System</option>
                    <option>Clinic</option>
                    <option>Medical Center</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Contact Name</label>
                  <input
                    className="form-input"
                    type="text"
                    value={editForm.contactName}
                    onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Contact Email</label>
                  <input
                    className="form-input"
                    type="email"
                    value={editForm.contactEmail}
                    onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Contact Phone</label>
                  <input
                    className="form-input"
                    type="tel"
                    value={editForm.contactPhone}
                    onChange={(e) => setEditForm({ ...editForm, contactPhone: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Contract Status</label>
                  <select
                    className="form-select"
                    value={editForm.contract}
                    onChange={(e) => setEditForm({ ...editForm, contract: e.target.value })}
                  >
                    <option>Active</option>
                    <option>Renewing</option>
                    <option>Expired</option>
                    <option>Pending</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Special Requirements</label>
                <textarea
                  className="form-textarea"
                  value={editForm.specialReqs}
                  onChange={(e) => setEditForm({ ...editForm, specialReqs: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" type="button" onClick={() => setEditingFacility(null)}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={saveEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Facility Form */}
      {showAddForm && (
        <div className="pn">
          <div className="pnh">
            <h3>+ Add New Facility</h3>
          </div>
          <div className="pnb">
            <div className="grid-2" style={{ gap: 14, marginBottom: 14 }}>
              <div className="form-group">
                <label className="form-label">Facility Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. Memorial Hermann Northeast"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select
                  className="form-select"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option>Hospital</option>
                  <option>Health System</option>
                  <option>Clinic</option>
                  <option>Medical Center</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Contact Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. Jane Smith"
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Contact Email</label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="e.g. jsmith@facility.com"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Contact Phone</label>
                <input
                  className="form-input"
                  type="tel"
                  placeholder="e.g. (713) 555-1234"
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Contract Status</label>
                <select
                  className="form-select"
                  value={form.contract}
                  onChange={(e) => setForm({ ...form, contract: e.target.value })}
                >
                  <option>Active</option>
                  <option>Renewing</option>
                  <option>Expired</option>
                  <option>Pending</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Special Requirements</label>
              <textarea
                className="form-textarea"
                placeholder="e.g. NPI in field 7B, AHCA BLS only..."
                value={form.specialReqs}
                onChange={(e) => setForm({ ...form, specialReqs: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary btn-sm" type="button" onClick={handleSave}>
                Save Facility
              </button>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => { setShowAddForm(false); setForm({ ...EMPTY_FORM }); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
