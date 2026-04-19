import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { incidentsApi, staffApi, facilitiesApi, Incident, Staff, Facility } from '../lib/api';
import QueryState, { EmptyCta } from '../components/QueryState';

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function statusTag(s: Incident['status']): string {
  switch (s) {
    case 'open':         return 'td';
    case 'under_review': return 'tw';
    case 'resolved':
    case 'closed':       return 'tg';
  }
}

function statusLabel(s: Incident['status']): string {
  switch (s) {
    case 'open':         return 'Open';
    case 'under_review': return 'Under review';
    case 'resolved':     return 'Resolved';
    case 'closed':       return 'Closed';
  }
}

interface FormState {
  staff_id: string;
  facility_id: string;
  type: string;
  description: string;
  date: string;
  workers_comp_claim: boolean;
}

const INCIDENT_TYPES = [
  'Workplace injury',
  'Patient complaint',
  'Misconduct allegation',
  'Documentation issue',
  'Contract dispute',
  'Other',
];

const EMPTY_FORM: FormState = {
  staff_id: '',
  facility_id: '',
  type: INCIDENT_TYPES[0],
  description: '',
  date: '',
  workers_comp_claim: false,
};

export default function Incidents() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => incidentsApi.list(),
  });

  // Pull real staff + facilities to power the form dropdowns (no more hardcoded names)
  const staffQ = useQuery({
    queryKey: ['incidents-staff-options'],
    queryFn: () => staffApi.list(),
  });
  const facilityQ = useQuery({
    queryKey: ['incidents-facility-options'],
    queryFn: () => facilitiesApi.list(),
  });

  const incidents: Incident[] = data?.data?.incidents ?? [];
  const open = incidents.filter((i) => i.status === 'open' || i.status === 'under_review');
  const closed = incidents.filter((i) => i.status === 'resolved' || i.status === 'closed');

  const staff: Staff[] = staffQ.data?.data?.staff ?? [];
  const facilities: Facility[] = facilityQ.data?.data?.facilities ?? [];

  const createMut = useMutation({
    mutationFn: (payload: Partial<Incident>) => incidentsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      setForm({ ...EMPTY_FORM });
      setSubmitError(null);
    },
    onError: (e: { response?: { data?: { error?: string } }; message?: string }) => {
      setSubmitError(e?.response?.data?.error ?? e?.message ?? 'Failed to submit');
    },
  });

  const resolveMut = useMutation({
    mutationFn: (id: string) => incidentsApi.update(id, { status: 'resolved' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['incidents'] }),
  });

  const handleSubmit = () => {
    if (!form.staff_id) { setSubmitError('Select a staff member'); return; }
    if (!form.description.trim()) { setSubmitError('Description is required'); return; }
    createMut.mutate({
      staff_id: form.staff_id,
      facility_id: form.facility_id || undefined,
      type: form.type,
      description: form.description.trim(),
      date: form.date || new Date().toLocaleDateString("en-CA"),
      workers_comp_claim: form.workers_comp_claim,
    });
  };

  return (
    <div>
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

      {/* Open + Under-review Incidents */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3>Open Incidents</h3>
          <span className={`tag ${open.length > 0 ? 'td' : 'tgr'}`}>{open.length} open</span>
        </div>
        <div className="pnb" style={{ padding: open.length === 0 && !isLoading && !error ? 0 : 0 }}>
          <QueryState
            isLoading={isLoading}
            error={error}
            isEmpty={open.length === 0}
            empty={
              <EmptyCta
                title="No open incidents"
                subtitle="Incidents submitted through the form below will appear here. All clear."
              />
            }
            onRetry={() => void refetch()}
          >
            <div>
              {open.map((inc) => {
                const name = [inc.first_name, inc.last_name].filter(Boolean).join(' ') || 'Unknown';
                return (
                  <div key={inc.id} style={{ padding: '16px 18px', borderBottom: '1px solid var(--sf3)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 14 }}>{inc.type}</strong>
                          <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
                          <span style={{ fontSize: 13, color: 'var(--t2)' }}>{name}</span>
                          <span style={{ color: 'var(--t3)', fontSize: 12 }}>{fmtDate(inc.date)}</span>
                          <span className={`tag ${statusTag(inc.status)}`}>{statusLabel(inc.status)}</span>
                          {inc.workers_comp_claim && <span className="tag tb">Workers&apos; comp</span>}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 10 }}>
                          {inc.description}
                        </div>
                        {inc.facility_name && (
                          <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10 }}>
                            Facility: {inc.facility_name}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-sm"
                        type="button"
                        style={{ background: 'var(--ac)', color: '#fff' }}
                        onClick={() => resolveMut.mutate(inc.id)}
                        disabled={resolveMut.isPending}
                      >
                        {resolveMut.isPending ? 'Resolving…' : 'Mark Resolved'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </QueryState>
        </div>
      </div>

      {/* Report New Incident */}
      <div className="pn" id="incident-form-panel" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3>Log New Incident</h3>
        </div>
        <div className="pnb">
          {submitError && (
            <div className="ab ab-w" style={{ marginBottom: 14 }}>{submitError}</div>
          )}
          <div className="grid-2" style={{ gap: 14, marginBottom: 14 }}>
            <div className="form-group">
              <label className="form-label">Staff Member *</label>
              <select
                className="form-select"
                value={form.staff_id}
                onChange={(e) => setForm({ ...form, staff_id: e.target.value })}
              >
                <option value="">— select —</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.first_name} {s.last_name} {s.role ? `(${s.role})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Incident Type</label>
              <select
                className="form-select"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {INCIDENT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Facility</label>
              <select
                className="form-select"
                value={form.facility_id}
                onChange={(e) => setForm({ ...form, facility_id: e.target.value })}
              >
                <option value="">— none —</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
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
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', paddingTop: 22 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--t2)' }}>
                <input
                  type="checkbox"
                  checked={form.workers_comp_claim}
                  onChange={(e) => setForm({ ...form, workers_comp_claim: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--pr)' }}
                />
                Workers&apos; compensation claim filed
              </label>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description *</label>
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
            disabled={createMut.isPending || staffQ.isLoading}
          >
            {createMut.isPending ? 'Submitting…' : 'Submit Report'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            style={{ marginLeft: 8, color: 'var(--pu)' }}
            onClick={() => navigate('/ai-assistant')}
          >
            ✦ Ask AI What to Include
          </button>
        </div>
      </div>

      {/* Closed/Resolved Incidents */}
      <div className="pn">
        <div className="pnh">
          <h3>Closed / Resolved</h3>
          <span className="tag tg">{closed.length} resolved</span>
        </div>
        <div className="pnb" style={{ padding: closed.length === 0 ? 24 : 0 }}>
          {closed.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: '24px 0' }}>
              No resolved incidents yet. Resolved incidents will appear here.
            </div>
          ) : (
            closed.map((inc) => {
              const name = [inc.first_name, inc.last_name].filter(Boolean).join(' ') || 'Unknown';
              return (
                <div key={inc.id} style={{ padding: '14px 18px', borderBottom: '1px solid var(--sf3)', opacity: 0.75 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{inc.type}</strong>
                    <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
                    <span style={{ fontSize: 13, color: 'var(--t2)' }}>{name}</span>
                    <span style={{ color: 'var(--t3)', fontSize: 12 }}>{fmtDate(inc.date)}</span>
                    <span className={`tag ${statusTag(inc.status)}`}>{statusLabel(inc.status)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 4 }}>{inc.description}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
