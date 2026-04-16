import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobsApi, clientsOrgsApi, ClientOrg } from '../../lib/api';

export default function JobNew() {
  const nav = useNavigate();
  const [clients, setClients] = useState<ClientOrg[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    client_id: '',
    profession: 'RN',
    specialty: '',
    city: '',
    state: '',
    job_type: 'travel',
    shift: 'days',
    duration_weeks: 13,
    positions: 1,
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    pay_rate: '',
    bill_rate: '',
    description: '',
  });

  useEffect(() => {
    clientsOrgsApi.list({ status: 'active' }).then((r) => setClients(r.data.clients)).catch(() => { /* ignore */ });
  }, []);

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        title: form.title.trim(),
        client_id: form.client_id || null,
        profession: form.profession || null,
        specialty: form.specialty || null,
        city: form.city || null,
        state: form.state || null,
        job_type: form.job_type || null,
        shift: form.shift || null,
        duration_weeks: form.duration_weeks ? Number(form.duration_weeks) : null,
        positions: Number(form.positions) || 1,
        priority: form.priority,
        pay_rate: form.pay_rate ? Number(form.pay_rate) : null,
        bill_rate: form.bill_rate ? Number(form.bill_rate) : null,
        description: form.description || null,
        status: 'open' as const,
      };
      const res = await jobsApi.create(payload);
      nav(`/jobs/${res.data.job.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create job');
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>New Job</h1>
      {error && <div style={{ padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      <form onSubmit={onSubmit} style={{ background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)', padding: 20, display: 'grid', gap: 14 }}>
        <Field label="Title *">
          <input value={form.title} onChange={(e) => set('title', e.target.value)} style={inputStyle} required />
        </Field>
        <Row>
          <Field label="Client">
            <select value={form.client_id} onChange={(e) => set('client_id', e.target.value)} style={inputStyle}>
              <option value="">— none —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={form.priority} onChange={(e) => set('priority', e.target.value as typeof form.priority)} style={inputStyle}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Profession">
            <select value={form.profession} onChange={(e) => set('profession', e.target.value)} style={inputStyle}>
              {['RN','LPN','LVN','CNA','RT','NP','PA','Other'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Specialty">
            <input value={form.specialty} onChange={(e) => set('specialty', e.target.value)} placeholder="e.g. ICU, ER, Med-Surg" style={inputStyle} />
          </Field>
        </Row>
        <Row>
          <Field label="City"><input value={form.city} onChange={(e) => set('city', e.target.value)} style={inputStyle} /></Field>
          <Field label="State"><input value={form.state} onChange={(e) => set('state', e.target.value)} maxLength={2} style={inputStyle} /></Field>
        </Row>
        <Row>
          <Field label="Job type">
            <select value={form.job_type} onChange={(e) => set('job_type', e.target.value)} style={inputStyle}>
              <option value="travel">Travel</option>
              <option value="local">Local</option>
              <option value="per_diem">Per Diem</option>
              <option value="contract">Contract</option>
              <option value="perm">Permanent</option>
            </select>
          </Field>
          <Field label="Shift">
            <select value={form.shift} onChange={(e) => set('shift', e.target.value)} style={inputStyle}>
              <option value="days">Days</option>
              <option value="nights">Nights</option>
              <option value="pm">PM</option>
              <option value="noc">NOC</option>
              <option value="rotating">Rotating</option>
            </select>
          </Field>
          <Field label="Duration (weeks)">
            <input type="number" value={form.duration_weeks} onChange={(e) => set('duration_weeks', Number(e.target.value))} style={inputStyle} />
          </Field>
          <Field label="Positions">
            <input type="number" min={1} value={form.positions} onChange={(e) => set('positions', Number(e.target.value))} style={inputStyle} />
          </Field>
        </Row>
        <Row>
          <Field label="Pay rate ($/hr)"><input type="number" step="0.01" value={form.pay_rate} onChange={(e) => set('pay_rate', e.target.value)} style={inputStyle} /></Field>
          <Field label="Bill rate ($/hr)"><input type="number" step="0.01" value={form.bill_rate} onChange={(e) => set('bill_rate', e.target.value)} style={inputStyle} /></Field>
        </Row>
        <Field label="Description">
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={5} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
        </Field>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" onClick={() => nav('/jobs')} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={btnPrimary}>
            {saving ? 'Creating…' : 'Create Job'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{label}</span>
      {children}
    </label>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{children}</div>;
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--bd)',
  borderRadius: 6,
  fontSize: 14,
  background: 'var(--sf)',
  outline: 'none',
};

const btnPrimary: React.CSSProperties = {
  background: 'var(--pr)', color: 'var(--sf)', border: 'none', borderRadius: 6,
  padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  background: 'var(--sf2)', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 6,
  padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
