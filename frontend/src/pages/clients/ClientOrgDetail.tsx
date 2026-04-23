import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  clientsOrgsApi,
  ClientOrg,
  ClientContact,
  ClientRequirementTemplate,
} from '../../lib/api';
import ClientPortalManager from '../../components/ClientPortal/ClientPortalManager';

interface FacilityStub { id: string; name: string; type?: string; address?: string }

export default function ClientOrgDetail() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<ClientOrg | null>(null);
  const [facilities, setFacilities] = useState<FacilityStub[]>([]);
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [templates, setTemplates] = useState<ClientRequirementTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<ClientOrg>>({});

  const [addingContact, setAddingContact] = useState(false);
  const [newContact, setNewContact] = useState<Partial<ClientContact>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const res = await clientsOrgsApi.get(id);
      setClient(res.data.client);
      setFacilities(res.data.facilities);
      setContacts(res.data.contacts);
      setTemplates(res.data.requirement_templates);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load client');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const startEdit = () => { if (client) { setDraft(client); setEditing(true); } };
  const saveEdit = async () => {
    if (!id || !client) return;
    try {
      await clientsOrgsApi.update(id, draft);
      setEditing(false);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const addContact = async () => {
    if (!id || !newContact.name) return;
    try {
      await clientsOrgsApi.addContact(id, newContact);
      setAddingContact(false); setNewContact({});
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to add contact');
    }
  };

  const removeContact = async (cid: string) => {
    if (!id) return;
    if (!window.confirm('Remove this contact?')) return;
    try { await clientsOrgsApi.deleteContact(id, cid); await load(); }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Failed'); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>;
  if (error) return <div style={{ padding: 20, color: '#991b1b', background: '#fee2e2', margin: 20, borderRadius: 8 }}>{error}</div>;
  if (!client) return null;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>
        <Link to="/clients-orgs" style={{ color: 'var(--t3)', textDecoration: 'none' }}>Clients</Link> ›{' '}
        <span style={{ color: 'var(--t2)' }}>{client.name}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>{client.name}</h1>
          <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4 }}>
            {client.business_unit && <span>{client.business_unit} · </span>}
            {client.website && <a href={client.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--pr)' }}>{client.website}</a>}
          </div>
        </div>
        {!editing ? (
          <button onClick={startEdit} style={btnSecondary}>Edit</button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setEditing(false)} style={btnSecondary}>Cancel</button>
            <button onClick={saveEdit} style={btnPrimary}>Save</button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Details */}
          <Section title="Details">
            {editing ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <DraftField label="Name" value={draft.name ?? ''} onChange={(v) => setDraft({ ...draft, name: v })} />
                <DraftField label="Website" value={draft.website ?? ''} onChange={(v) => setDraft({ ...draft, website: v })} />
                <DraftField label="Business unit" value={draft.business_unit ?? ''} onChange={(v) => setDraft({ ...draft, business_unit: v })} />
                <DraftField label="Submission format" value={draft.submission_format ?? ''} onChange={(v) => setDraft({ ...draft, submission_format: v })} />
                <DraftField label="Submission format notes" value={draft.submission_format_notes ?? ''} onChange={(v) => setDraft({ ...draft, submission_format_notes: v })} textarea />
                <DraftField label="Notes" value={draft.notes ?? ''} onChange={(v) => setDraft({ ...draft, notes: v })} textarea />
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                <Fact label="Submission format" value={client.submission_format ?? '—'} />
                {client.submission_format_notes && <Fact label="Format notes" value={client.submission_format_notes} />}
                {client.notes && <Fact label="Notes" value={client.notes} />}
                <Fact label="Primary contact" value={client.primary_contact_name ?? '—'} />
              </div>
            )}
          </Section>

          {/* Facilities */}
          <Section title={`Facilities (${facilities.length})`}>
            {facilities.length === 0 ? (
              <div style={{ padding: 16, color: 'var(--t3)', fontSize: 13, textAlign: 'center' }}>
                No facilities linked to this client yet. Link existing facilities via the API or database (UI coming in Phase 3).
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {facilities.map((f) => (
                  <div key={f.id} style={{ padding: 10, background: 'var(--sf2)', borderRadius: 6, display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div>
                      {f.address && <div style={{ fontSize: 11, color: 'var(--t3)' }}>{f.address}</div>}
                    </div>
                    {f.type && <span style={{ fontSize: 10, padding: '2px 8px', background: 'var(--sf3)', borderRadius: 999, color: 'var(--t2)' }}>{f.type}</span>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Requirement templates */}
          <Section title={`Submission & onboarding templates (${templates.length})`}>
            {templates.length === 0 ? (
              <div style={{ padding: 16, color: 'var(--t3)', fontSize: 13, textAlign: 'center' }}>
                No requirement templates. These define default submission/onboarding requirements that new jobs for this client can inherit.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {templates.map((t) => (
                  <div key={t.id} style={{ padding: 12, background: 'var(--sf2)', borderRadius: 6, border: '1px solid var(--bd)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>{t.kind}</span>
                      {t.bundle_title && <span style={{ fontSize: 11, color: 'var(--pr)' }}>Bundle: {t.bundle_title}</span>}
                    </div>
                    {t.ad_hoc?.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--t2)' }}>
                        {t.ad_hoc.map((a, i) => <li key={i}>{a.label}{a.type && <span style={{ color: 'var(--t3)' }}> · {a.type}</span>}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Right rail — contacts */}
        <Section title={`Contacts (${contacts.length})`} action={
          !addingContact ? <button onClick={() => setAddingContact(true)} style={smallBtn}>+ Add</button> : null
        }>
          {addingContact && (
            <div style={{ padding: 10, background: 'var(--sf2)', borderRadius: 6, border: '1px solid var(--bd)', marginBottom: 10, display: 'grid', gap: 6 }}>
              <DraftField label="Name" value={newContact.name ?? ''} onChange={(v) => setNewContact({ ...newContact, name: v })} />
              <DraftField label="Title" value={newContact.title ?? ''} onChange={(v) => setNewContact({ ...newContact, title: v })} />
              <DraftField label="Email" value={newContact.email ?? ''} onChange={(v) => setNewContact({ ...newContact, email: v })} />
              <DraftField label="Phone" value={newContact.phone ?? ''} onChange={(v) => setNewContact({ ...newContact, phone: v })} />
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button onClick={addContact} style={btnPrimary}>Save</button>
                <button onClick={() => { setAddingContact(false); setNewContact({}); }} style={btnSecondary}>Cancel</button>
              </div>
            </div>
          )}
          {contacts.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--t3)', fontSize: 13, textAlign: 'center' }}>No contacts yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {contacts.map((c) => (
                <div key={c.id} style={{ padding: 10, background: 'var(--sf2)', borderRadius: 6, border: '1px solid var(--bd)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {c.name} {c.is_primary && <span style={{ fontSize: 10, padding: '1px 6px', background: 'var(--ac)', color: '#fff', borderRadius: 3, marginLeft: 4 }}>PRIMARY</span>}
                    </div>
                    <button onClick={() => removeContact(c.id)} style={{ background: 'none', border: 'none', color: 'var(--dg)', cursor: 'pointer', fontSize: 11 }}>Remove</button>
                  </div>
                  {c.title && <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.title}</div>}
                  {c.email && <div style={{ fontSize: 12, marginTop: 3 }}><a href={`mailto:${c.email}`} style={{ color: 'var(--pr)', textDecoration: 'none' }}>{c.email}</a></div>}
                  {c.phone && <div style={{ fontSize: 12 }}>{c.phone}</div>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Phase 6.5 — Client portal share links. Scoped to this client
            org so all facilities under it appear in the portal view. */}
        {id && <ClientPortalManager clientId={id} scopeLabel={client?.name ?? 'this client'} />}
      </div>
    </div>
  );
}

// ─── UI bits ────────────────────────────────────────────────────────────────
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--t1)', letterSpacing: 0.3 }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--t1)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  );
}

function DraftField({ label, value, onChange, textarea }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {textarea
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} style={{ padding: '7px 10px', border: '1px solid var(--bd)', borderRadius: 5, fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }} />
        : <input value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '7px 10px', border: '1px solid var(--bd)', borderRadius: 5, fontSize: 13, outline: 'none' }} />
      }
    </label>
  );
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--pr)', color: 'var(--sf)', border: 'none', borderRadius: 6,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: 'var(--sf2)', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 6,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  padding: '5px 10px', background: 'var(--sf2)', color: 'var(--t2)',
  border: '1px solid var(--bd)', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
};
