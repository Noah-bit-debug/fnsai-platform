import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { jobsApi, clientsOrgsApi, type Job, type ClientOrg } from '../../lib/api';
import { useToast } from '../../components/ToastHost';

/**
 * Phase 1.2C — Edit Job page.
 *
 * Rather than rebuild all 25+ fields the new-job form has, this is a
 * lightweight editor covering the fields most commonly changed after
 * posting: title, status, priority, pay (range), bill rate, shift,
 * positions, description. For anything deeper (client reassignment,
 * geo/lat-lng, AI-generated ad, etc.) you can extend this later, or
 * fall back to hitting PUT /jobs/:id directly via API.
 *
 * Backend: PUT /jobs/:id accepts any subset of jobSchema fields via
 * jobUpdateSchema (partial + refine on pay range) so this page only
 * sends the fields the user actually changed. Existing submissions,
 * requirements, and history are preserved — PUT is a partial update.
 */
export default function JobEdit() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();

  const [clients, setClients] = useState<ClientOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: '',
    status: 'open' as Job['status'],
    priority: 'normal' as Job['priority'],
    client_id: '',
    profession: '',
    specialty: '',
    city: '',
    state: '',
    job_type: '',
    shift: '',
    positions: '1',
    pay_rate_min: '',
    pay_rate_max: '',
    bill_rate: '',
    description: '',
  });

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const [jobRes, cliRes] = await Promise.all([
          jobsApi.get(id),
          clientsOrgsApi.list({ status: 'active' }).catch(() => ({ data: { clients: [] } })),
        ]);
        const j = jobRes.data.job;
        setForm({
          title: j.title ?? '',
          status: j.status,
          priority: j.priority,
          client_id: j.client_id ?? '',
          profession: j.profession ?? '',
          specialty: j.specialty ?? '',
          city: j.city ?? '',
          state: j.state ?? '',
          job_type: j.job_type ?? '',
          shift: j.shift ?? '',
          positions: String(j.positions ?? 1),
          pay_rate_min: j.pay_rate_min != null ? String(j.pay_rate_min) : '',
          pay_rate_max: j.pay_rate_max != null ? String(j.pay_rate_max) : '',
          bill_rate: j.bill_rate != null ? String(j.bill_rate) : '',
          description: j.description ?? '',
        });
        setClients(cliRes.data.clients ?? []);
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { error?: string } }; message?: string };
        setError(ax?.response?.data?.error ?? ax?.message ?? 'Failed to load job');
      } finally { setLoading(false); }
    })();
  }, [id]);

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const patch: Partial<Job> = {
        title: form.title.trim(),
        status: form.status,
        priority: form.priority,
        client_id: form.client_id || null,
        profession: form.profession || null,
        specialty: form.specialty || null,
        city: form.city || null,
        state: form.state || null,
        job_type: form.job_type || null,
        shift: form.shift || null,
        positions: Number(form.positions) || 1,
        pay_rate_min: form.pay_rate_min ? Number(form.pay_rate_min) : null,
        pay_rate_max: form.pay_rate_max ? Number(form.pay_rate_max) : null,
        bill_rate: form.bill_rate ? Number(form.bill_rate) : null,
        description: form.description || null,
      };
      await jobsApi.update(id, patch);
      toast.success('Job updated');
      nav(`/jobs/${id}`);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string; details?: unknown } }; message?: string };
      toast.error(ax?.response?.data?.error ?? ax?.message ?? 'Failed to update job');
    } finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>;
  if (error) return <div style={{ padding: 24, color: '#b91c1c' }}>{error}</div>;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>
        <Link to="/jobs" style={{ color: 'var(--t3)', textDecoration: 'none' }}>Jobs</Link> ›{' '}
        <Link to={`/jobs/${id}`} style={{ color: 'var(--t3)', textDecoration: 'none' }}>Detail</Link> ›{' '}
        <span style={{ color: 'var(--t2)' }}>Edit</span>
      </div>
      <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>Edit Job</h1>
      <form onSubmit={onSubmit} style={{ background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)', padding: 20, display: 'grid', gap: 14 }}>
        <Field label="Title *">
          <input value={form.title} onChange={(e) => set('title', e.target.value)} style={inputStyle} required />
        </Field>
        <Row>
          <Field label="Status">
            <select value={form.status} onChange={(e) => set('status', e.target.value as Job['status'])} style={inputStyle}>
              {['draft', 'open', 'on_hold', 'filled', 'closed', 'cancelled'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={form.priority} onChange={(e) => set('priority', e.target.value as Job['priority'])} style={inputStyle}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </Field>
          <Field label="Client">
            <select value={form.client_id} onChange={(e) => set('client_id', e.target.value)} style={inputStyle}>
              <option value="">— none —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Profession">
            <select value={form.profession} onChange={(e) => set('profession', e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {['RN','LPN','LVN','CNA','RT','NP','PA','Other'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Specialty"><input value={form.specialty} onChange={(e) => set('specialty', e.target.value)} style={inputStyle} /></Field>
          <Field label="Shift">
            <select value={form.shift} onChange={(e) => set('shift', e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {['days','nights','evenings','rotating','pm','noc'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="City"><input value={form.city} onChange={(e) => set('city', e.target.value)} style={inputStyle} /></Field>
          <Field label="State"><input value={form.state} onChange={(e) => set('state', e.target.value)} style={inputStyle} /></Field>
          <Field label="Positions"><input type="number" min="1" value={form.positions} onChange={(e) => set('positions', e.target.value)} style={inputStyle} /></Field>
        </Row>
        <Row>
          <Field label="Pay min ($/hr)"><input type="number" step="0.01" value={form.pay_rate_min} onChange={(e) => set('pay_rate_min', e.target.value)} style={inputStyle} /></Field>
          <Field label="Pay max ($/hr)"><input type="number" step="0.01" value={form.pay_rate_max} onChange={(e) => set('pay_rate_max', e.target.value)} style={inputStyle} /></Field>
          <Field label="Bill rate ($/hr)"><input type="number" step="0.01" value={form.bill_rate} onChange={(e) => set('bill_rate', e.target.value)} style={inputStyle} /></Field>
        </Row>
        <Field label="Description">
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} style={{ ...inputStyle, height: 120, resize: 'vertical' }} />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => nav(`/jobs/${id}`)}
            style={{ padding: '8px 16px', background: 'var(--sf2)', border: '1px solid var(--bd)', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            Cancel
          </button>
          <button type="submit" disabled={saving}
            style={{ padding: '8px 16px', background: 'var(--pr)', color: '#fff', border: 'none', borderRadius: 6, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{children}</div>;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, outline: 'none', background: 'var(--sf)',
};
