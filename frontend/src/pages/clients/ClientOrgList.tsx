import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clientsOrgsApi, ClientOrg } from '../../lib/api';
import { useRBAC } from '../../contexts/RBACContext';

const STATUS_COLOR: Record<ClientOrg['status'], string> = {
  active: '#10b981', prospect: '#3b82f6', inactive: '#9ca3af', churned: '#ef4444',
};

export default function ClientOrgList() {
  const nav = useNavigate();
  const { can } = useRBAC();
  const [clients, setClients] = useState<ClientOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const params: Record<string, string> = {};
      if (status) params.status = status;
      if (search) params.search = search;
      const res = await clientsOrgsApi.list(params);
      setClients(res.data.clients);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load clients');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const res = await clientsOrgsApi.create({ name: newName.trim() });
      nav(`/clients-orgs/${res.data.client.id}`);
    } catch (err: unknown) {
      // Axios errors come through with the backend's actual error message in
      // response.data.error. Fall back to the generic message otherwise.
      const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
      const msg = axiosErr?.response?.data?.error
        ?? axiosErr?.message
        ?? 'Failed to create client';
      alert(msg);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>Client organizations</h1>
          <div style={{ color: 'var(--t3)', fontSize: 13, marginTop: 4 }}>
            {loading ? 'Loading…' : `${clients.length} client${clients.length === 1 ? '' : 's'}`}
          </div>
        </div>
        {can('candidates_create') && (
          <button onClick={() => setCreating(true)} style={btnPrimary}>+ New Client</button>
        )}
      </div>

      {creating && (
        <form onSubmit={onCreate} style={{ display: 'flex', gap: 8, marginBottom: 14, padding: 12, background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)' }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Client name (e.g. Harris Health)"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 14, outline: 'none' }}
          />
          <button type="submit" style={btnPrimary}>Create</button>
          <button type="button" onClick={() => { setCreating(false); setNewName(''); }} style={btnSecondary}>Cancel</button>
        </form>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <form onSubmit={(e) => { e.preventDefault(); load(); }} style={{ display: 'flex', gap: 6, flex: '1 1 240px' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, outline: 'none' }}
          />
          <button type="submit" style={btnSecondary}>Search</button>
        </form>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, background: 'var(--sf)' }}>
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="prospect">Prospect</option>
          <option value="inactive">Inactive</option>
          <option value="churned">Churned</option>
        </select>
      </div>

      {error && <div style={{ padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>
      ) : clients.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)', background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px dashed var(--bd)' }}>
          No clients yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {clients.map((c) => (
            <div
              key={c.id}
              onClick={() => nav(`/clients-orgs/${c.id}`)}
              style={{
                background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)',
                padding: '14px 18px', cursor: 'pointer',
                display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto',
                gap: 16, alignItems: 'center',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--t1)' }}>{c.name}</div>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {c.business_unit && <span>{c.business_unit}</span>}
                  {c.website && <span>· {c.website}</span>}
                  {c.primary_contact_name && <span>· {c.primary_contact_name}</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--t3)' }}>
                <div style={{ fontWeight: 600, color: 'var(--t1)' }}>{c.facility_count ?? 0}</div>
                <div>facilities</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--t3)' }}>
                <div style={{ fontWeight: 600, color: 'var(--t1)' }}>{c.open_jobs ?? 0}</div>
                <div>open jobs</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: `${STATUS_COLOR[c.status]}20`, color: STATUS_COLOR[c.status], textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {c.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--pr)', color: 'var(--sf)', border: 'none', borderRadius: 'var(--br)',
  padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: 'var(--sf2)', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 6,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
