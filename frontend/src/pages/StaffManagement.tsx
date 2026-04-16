import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { staffApi, Staff } from '../lib/api';

const ROLES = ['RN', 'LPN', 'LVN', 'CNA', 'RT', 'NP', 'PA', 'Other'];
const STATUSES = ['active', 'available', 'onboarding', 'inactive', 'terminated'];

function statusTag(status: string) {
  const map: Record<string, string> = {
    active:     'tg',
    available:  'tb',
    onboarding: 'tw',
    inactive:   'tgr',
    terminated: 'td',
  };
  return map[status] ?? 'tgr';
}

const EMPTY_FORM: Partial<Staff> = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  role: undefined,
  specialty: '',
  status: 'onboarding',
  notes: '',
};

export default function StaffManagement() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch]           = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterRole, setFilterRole]   = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [form, setForm]               = useState<Partial<Staff>>(EMPTY_FORM);
  const [formError, setFormError]     = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['staff', filterStatus, filterRole, search],
    queryFn: () =>
      staffApi.list({
        status: filterStatus || undefined,
        role:   filterRole   || undefined,
        search: search       || undefined,
      }),
    select: (r) => r.data,
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Staff>) => staffApi.create(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff'] });
      setShowModal(false);
      setForm(EMPTY_FORM);
      setFormError(null);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.error ??
        err?.response?.data?.message ??
        err?.message ??
        'Failed to create staff member. Please try again.';
      setFormError(String(msg));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => staffApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff'] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.first_name?.trim()) { setFormError('First name is required.'); return; }
    if (!form.last_name?.trim())  { setFormError('Last name is required.'); return; }

    const payload: Partial<Staff> = {
      first_name: form.first_name.trim(),
      last_name:  form.last_name.trim(),
      status:     form.status ?? 'onboarding',
    };
    if (form.email?.trim())    payload.email     = form.email.trim();
    if (form.phone?.trim())    payload.phone     = form.phone.trim();
    if (form.role)             payload.role      = form.role;
    if (form.specialty?.trim()) payload.specialty = form.specialty.trim();
    if (form.notes?.trim())    payload.notes     = form.notes.trim();

    createMutation.mutate(payload);
  }

  function openModal() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setFormError(null);
    setForm(EMPTY_FORM);
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>👥 Staff Management</h1>
            <p>Manage your healthcare professionals — {data?.total ?? 0} staff members</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" type="button" title="Export to Excel">
              📊 Export
            </button>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={openModal}
            >
              + Add Staff
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="search-wrap">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="m11 11 3 3" />
          </svg>
          <input
            className="search-input"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="form-select"
          style={{ width: 'auto', padding: '6px 28px 6px 10px' }}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

        <select
          className="form-select"
          style={{ width: 'auto', padding: '6px 28px 6px 10px' }}
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
        >
          <option value="">All Roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="pn">
        {isLoading ? (
          <div className="loading-overlay"><div className="spinner" /></div>
        ) : !data?.staff?.length ? (
          <div className="empty-state">
            <div className="empty-state-icon">👥</div>
            <h3>No staff members found</h3>
            <p>Add your first healthcare professional to get started.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Specialty</th>
                  <th>Facility</th>
                  <th>Status</th>
                  <th>Credential Alerts</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.first_name} {s.last_name}</div>
                      {s.email && (
                        <div style={{ fontSize: 11, color: 'var(--t3)' }}>{s.email}</div>
                      )}
                    </td>
                    <td>
                      {s.role
                        ? <span className="tag tb">{s.role}</span>
                        : <span className="tag tgr">—</span>
                      }
                    </td>
                    <td className="t3">{s.specialty ?? '—'}</td>
                    <td className="t2">{s.facility_name ?? '—'}</td>
                    <td>
                      <span className={`tag ${statusTag(s.status)}`}>
                        {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                      </span>
                    </td>
                    <td>
                      {(s as Staff & { expiring_credentials?: number }).expiring_credentials
                        ? (
                          <span className="tag tw">
                            ⚠ {(s as Staff & { expiring_credentials?: number }).expiring_credentials}
                          </span>
                        )
                        : <span className="tag tg">✓ OK</span>
                      }
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => nav(`/staff/${s.id}`)}>View</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          style={{ color: 'var(--dg)' }}
                          onClick={() => {
                            if (confirm(`Deactivate ${s.first_name} ${s.last_name}?`)) {
                              deleteMutation.mutate(s.id);
                            }
                          }}
                        >
                          Deactivate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Staff Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Staff Member</h3>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                type="button"
                onClick={closeModal}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">

                {/* Server / validation error banner */}
                {formError && (
                  <div style={{
                    background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
                    padding: '10px 14px', marginBottom: 16, color: '#c62828',
                    fontSize: 13, fontWeight: 500,
                  }}>
                    ⚠ {formError}
                  </div>
                )}

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">First Name *</label>
                    <input
                      className="form-input"
                      required
                      value={form.first_name ?? ''}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Last Name *</label>
                    <input
                      className="form-input"
                      required
                      value={form.last_name ?? ''}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input
                      className="form-input"
                      type="email"
                      value={form.email ?? ''}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Phone</label>
                    <input
                      className="form-input"
                      value={form.phone ?? ''}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Role</label>
                    <select
                      className="form-select"
                      value={form.role ?? ''}
                      onChange={(e) => setForm({ ...form, role: (e.target.value as Staff['role']) || undefined })}
                    >
                      <option value="">Select role…</option>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Status</label>
                    <select
                      className="form-select"
                      value={form.status ?? 'onboarding'}
                      onChange={(e) => setForm({ ...form, status: e.target.value as Staff['status'] })}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Specialty</label>
                  <input
                    className="form-input"
                    placeholder="e.g., ICU, Med-Surg, Pediatrics"
                    value={form.specialty ?? ''}
                    onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea
                    className="form-textarea"
                    value={form.notes ?? ''}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Any relevant notes about this staff member…"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? 'Saving…' : 'Add Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
