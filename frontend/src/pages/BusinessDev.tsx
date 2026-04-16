import { useState, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Lead {
  id: string;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  status: 'prospect' | 'qualified' | 'proposal' | 'negotiating' | 'closed' | 'lost';
  source: 'cold_call' | 'referral' | 'website' | 'linkedin' | 'event';
  lastContact: string;
  nextFollowUp: string;
  notes: string;
}

interface Contact {
  id: string;
  name: string;
  title: string;
  company: string;
  email: string;
  phone: string;
  lastContact: string;
  notes: string;
}

interface Followup {
  id: string;
  companyContact: string;
  followUpDate: string;
  type: 'call' | 'email' | 'meeting';
  priority: 'high' | 'medium' | 'low';
  notes: string;
  status: 'pending' | 'done';
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'fns_bizdev_data';

const LEAD_STATUS_COLORS: Record<Lead['status'], string> = {
  prospect:    '#546e7a',
  qualified:   '#1565c0',
  proposal:    '#e65100',
  negotiating: '#f57f17',
  closed:      '#2e7d32',
  lost:        '#c62828',
};

const PRIORITY_COLORS: Record<Followup['priority'], string> = {
  high:   '#c62828',
  medium: '#e65100',
  low:    '#2e7d32',
};

const SOURCE_LABELS: Record<Lead['source'], string> = {
  cold_call: 'Cold Call',
  referral:  'Referral',
  website:   'Website',
  linkedin:  'LinkedIn',
  event:     'Event',
};

const TYPE_COLORS: Record<Followup['type'], string> = {
  call:    '#1565c0',
  email:   '#6a1b9a',
  meeting: '#00695c',
};

const SAMPLE_LEADS: Lead[] = [
  {
    id: 'l1',
    company: 'Memorial Health Network',
    contactName: 'Patricia Walsh',
    phone: '(713) 555-0198',
    email: 'p.walsh@memorialhealth.org',
    status: 'qualified',
    source: 'referral',
    lastContact: '2026-04-08',
    nextFollowUp: '2026-04-15',
    notes: 'Needs 3 RNs for ICU starting May. Budget confirmed.',
  },
  {
    id: 'l2',
    company: 'Sunrise Senior Living',
    contactName: 'Derek Nguyen',
    phone: '(832) 555-0247',
    email: 'd.nguyen@sunriseliving.com',
    status: 'proposal',
    source: 'linkedin',
    lastContact: '2026-04-10',
    nextFollowUp: '2026-04-14',
    notes: 'Sent proposal for 5 CNAs. Follow up on pricing.',
  },
  {
    id: 'l3',
    company: 'Gulf Coast Medical Center',
    contactName: 'Sandra Reyes',
    phone: '(281) 555-0312',
    email: 's.reyes@gulfcoastmed.com',
    status: 'prospect',
    source: 'cold_call',
    lastContact: '2026-04-05',
    nextFollowUp: '2026-04-20',
    notes: 'Initial call done. Decision maker is the DON.',
  },
];

const SAMPLE_CONTACTS: Contact[] = [
  {
    id: 'c1',
    name: 'Patricia Walsh',
    title: 'Director of Nursing',
    company: 'Memorial Health Network',
    email: 'p.walsh@memorialhealth.org',
    phone: '(713) 555-0198',
    lastContact: '2026-04-08',
    notes: 'Key decision maker for temp staffing.',
  },
  {
    id: 'c2',
    name: 'Derek Nguyen',
    title: 'HR Manager',
    company: 'Sunrise Senior Living',
    email: 'd.nguyen@sunriseliving.com',
    phone: '(832) 555-0247',
    lastContact: '2026-04-10',
    notes: 'Prefers email contact.',
  },
];

const SAMPLE_FOLLOWUPS: Followup[] = [
  {
    id: 'f1',
    companyContact: 'Memorial Health Network — Patricia Walsh',
    followUpDate: '2026-04-15',
    type: 'call',
    priority: 'high',
    notes: 'Confirm ICU RN start dates and rates.',
    status: 'pending',
  },
  {
    id: 'f2',
    companyContact: 'Sunrise Senior Living — Derek Nguyen',
    followUpDate: '2026-04-14',
    type: 'email',
    priority: 'high',
    notes: 'Send revised pricing on CNA proposal.',
    status: 'pending',
  },
  {
    id: 'f3',
    companyContact: 'Gulf Coast Medical Center — Sandra Reyes',
    followUpDate: '2026-04-20',
    type: 'meeting',
    priority: 'medium',
    notes: 'Schedule intro meeting with DON.',
    status: 'pending',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%', padding: '9px 14px', border: '1px solid #e8edf2', borderRadius: 8,
    fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box', ...extra,
  };
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background: color, color: '#fff', borderRadius: 10, padding: '3px 10px',
      fontSize: 12, fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function LabelInput({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function fmtDate(d: string) {
  if (!d) return '—';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

// ─── Lead Modal ───────────────────────────────────────────────────────────────
const EMPTY_LEAD: Omit<Lead, 'id'> = {
  company: '', contactName: '', phone: '', email: '',
  status: 'prospect', source: 'cold_call', lastContact: '', nextFollowUp: '', notes: '',
};

function LeadModal({ initial, onClose, onSave }: {
  initial: Omit<Lead, 'id'>;
  onClose: () => void;
  onSave: (data: Omit<Lead, 'id'>) => void;
}) {
  const [form, setForm] = useState<Omit<Lead, 'id'>>(initial);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  function submit() {
    if (!form.company.trim() || !form.contactName.trim()) { setErr('Company and contact name are required.'); return; }
    onSave(form);
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>
          {initial.company ? 'Edit Lead' : 'Add Lead'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <LabelInput label="Company *">
            <input style={inputStyle()} value={form.company} onChange={set('company')} placeholder="Company name" />
          </LabelInput>
          <LabelInput label="Contact Name *">
            <input style={inputStyle()} value={form.contactName} onChange={set('contactName')} placeholder="Full name" />
          </LabelInput>
          <LabelInput label="Email">
            <input style={inputStyle()} type="email" value={form.email} onChange={set('email')} placeholder="email@company.com" />
          </LabelInput>
          <LabelInput label="Phone">
            <input style={inputStyle()} value={form.phone} onChange={set('phone')} placeholder="(555) 000-0000" />
          </LabelInput>
          <LabelInput label="Source">
            <select style={inputStyle()} value={form.source} onChange={set('source')}>
              <option value="cold_call">Cold Call</option>
              <option value="referral">Referral</option>
              <option value="website">Website</option>
              <option value="linkedin">LinkedIn</option>
              <option value="event">Event</option>
            </select>
          </LabelInput>
          <LabelInput label="Status">
            <select style={inputStyle()} value={form.status} onChange={set('status')}>
              <option value="prospect">Prospect</option>
              <option value="qualified">Qualified</option>
              <option value="proposal">Proposal</option>
              <option value="negotiating">Negotiating</option>
              <option value="closed">Closed</option>
              <option value="lost">Lost</option>
            </select>
          </LabelInput>
          <LabelInput label="Last Contact">
            <input style={inputStyle()} type="date" value={form.lastContact} onChange={set('lastContact')} />
          </LabelInput>
          <LabelInput label="Next Follow-up">
            <input style={inputStyle()} type="date" value={form.nextFollowUp} onChange={set('nextFollowUp')} />
          </LabelInput>
        </div>
        <LabelInput label="Notes">
          <textarea style={{ ...inputStyle(), height: 80, resize: 'vertical' }} value={form.notes} onChange={set('notes')} placeholder="Context, requirements, key details..." />
        </LabelInput>
        {err && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={submit} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Save Lead</button>
        </div>
      </div>
    </div>
  );
}

// ─── Contact Modal ────────────────────────────────────────────────────────────
const EMPTY_CONTACT: Omit<Contact, 'id'> = {
  name: '', title: '', company: '', email: '', phone: '', lastContact: '', notes: '',
};

function ContactModal({ initial, onClose, onSave }: {
  initial: Omit<Contact, 'id'>;
  onClose: () => void;
  onSave: (data: Omit<Contact, 'id'>) => void;
}) {
  const [form, setForm] = useState<Omit<Contact, 'id'>>(initial);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  function submit() {
    if (!form.name.trim()) { setErr('Contact name is required.'); return; }
    onSave(form);
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>
          {initial.name ? 'Edit Contact' : 'Add Contact'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <LabelInput label="Full Name *">
            <input style={inputStyle()} value={form.name} onChange={set('name')} placeholder="Full name" />
          </LabelInput>
          <LabelInput label="Title">
            <input style={inputStyle()} value={form.title} onChange={set('title')} placeholder="Director of Nursing" />
          </LabelInput>
          <LabelInput label="Company">
            <input style={inputStyle()} value={form.company} onChange={set('company')} placeholder="Company name" />
          </LabelInput>
          <LabelInput label="Last Contact">
            <input style={inputStyle()} type="date" value={form.lastContact} onChange={set('lastContact')} />
          </LabelInput>
          <LabelInput label="Email">
            <input style={inputStyle()} type="email" value={form.email} onChange={set('email')} placeholder="email@company.com" />
          </LabelInput>
          <LabelInput label="Phone">
            <input style={inputStyle()} value={form.phone} onChange={set('phone')} placeholder="(555) 000-0000" />
          </LabelInput>
        </div>
        <LabelInput label="Notes">
          <textarea style={{ ...inputStyle(), height: 70, resize: 'vertical' }} value={form.notes} onChange={set('notes')} placeholder="Notes about this contact..." />
        </LabelInput>
        {err && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={submit} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Save Contact</button>
        </div>
      </div>
    </div>
  );
}

// ─── Follow-up Modal ──────────────────────────────────────────────────────────
const EMPTY_FOLLOWUP: Omit<Followup, 'id' | 'status'> = {
  companyContact: '', followUpDate: '', type: 'call', priority: 'medium', notes: '',
};

function FollowupModal({ onClose, onSave }: {
  onClose: () => void;
  onSave: (data: Omit<Followup, 'id'>) => void;
}) {
  const [form, setForm] = useState<Omit<Followup, 'id' | 'status'>>(EMPTY_FOLLOWUP);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  function submit() {
    if (!form.companyContact.trim() || !form.followUpDate) { setErr('Company/Contact and date are required.'); return; }
    onSave({ ...form, status: 'pending' });
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Add Follow-up</div>
        <LabelInput label="Company / Contact *">
          <input style={inputStyle()} value={form.companyContact} onChange={set('companyContact')} placeholder="e.g. Memorial Health — Patricia Walsh" />
        </LabelInput>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <LabelInput label="Follow-up Date *">
            <input style={inputStyle()} type="date" value={form.followUpDate} onChange={set('followUpDate')} />
          </LabelInput>
          <LabelInput label="Type">
            <select style={inputStyle()} value={form.type} onChange={set('type')}>
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="meeting">Meeting</option>
            </select>
          </LabelInput>
          <LabelInput label="Priority">
            <select style={inputStyle()} value={form.priority} onChange={set('priority')}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </LabelInput>
        </div>
        <LabelInput label="Notes">
          <textarea style={{ ...inputStyle(), height: 70, resize: 'vertical' }} value={form.notes} onChange={set('notes')} placeholder="What to discuss..." />
        </LabelInput>
        {err && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={submit} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Save Follow-up</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
type Tab = 'leads' | 'contacts' | 'followups';

export default function BusinessDev() {
  const [tab, setTab] = useState<Tab>('leads');

  // Data state
  const [leads, setLeads]       = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Lead UI state
  const [leadSearch, setLeadSearch]       = useState('');
  const [leadStatusFilter, setLeadStatusFilter] = useState('');
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [editingLead, setEditingLead]     = useState<Lead | null>(null);

  // Contact UI state
  const [contactSearch, setContactSearch] = useState('');
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  // Followup UI state
  const [showFollowupModal, setShowFollowupModal] = useState(false);
  const [showAllFollowups, setShowAllFollowups]   = useState(false);
  const [followupSort, setFollowupSort]           = useState<'date' | 'priority'>('date');

  // ── Load from localStorage ────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setLeads(parsed.leads ?? SAMPLE_LEADS);
        setContacts(parsed.contacts ?? SAMPLE_CONTACTS);
        setFollowups(parsed.followups ?? SAMPLE_FOLLOWUPS);
      } else {
        setLeads(SAMPLE_LEADS);
        setContacts(SAMPLE_CONTACTS);
        setFollowups(SAMPLE_FOLLOWUPS);
      }
    } catch {
      setLeads(SAMPLE_LEADS);
      setContacts(SAMPLE_CONTACTS);
      setFollowups(SAMPLE_FOLLOWUPS);
    }
    setInitialized(true);
  }, []);

  // ── Save to localStorage ──────────────────────────────────────────────────
  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ leads, contacts, followups }));
  }, [leads, contacts, followups, initialized]);

  // ── Lead actions ──────────────────────────────────────────────────────────
  function saveLead(data: Omit<Lead, 'id'>, id?: string) {
    if (id) {
      setLeads(prev => prev.map(l => l.id === id ? { ...data, id } : l));
    } else {
      setLeads(prev => [...prev, { ...data, id: `l${Date.now()}` }]);
    }
  }
  function markLeadStatus(id: string, status: Lead['status']) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
  }
  function deleteLead(id: string) {
    if (!confirm('Remove this lead?')) return;
    setLeads(prev => prev.filter(l => l.id !== id));
  }

  // ── Contact actions ────────────────────────────────────────────────────────
  function saveContact(data: Omit<Contact, 'id'>, id?: string) {
    if (id) {
      setContacts(prev => prev.map(c => c.id === id ? { ...data, id } : c));
    } else {
      setContacts(prev => [...prev, { ...data, id: `c${Date.now()}` }]);
    }
  }
  function deleteContact(id: string) {
    if (!confirm('Remove this contact?')) return;
    setContacts(prev => prev.filter(c => c.id !== id));
  }

  // ── Followup actions ───────────────────────────────────────────────────────
  function saveFollowup(data: Omit<Followup, 'id'>) {
    setFollowups(prev => [...prev, { ...data, id: `f${Date.now()}` }]);
  }
  function markFollowupDone(id: string) {
    setFollowups(prev => prev.map(f => f.id === id ? { ...f, status: 'done' } : f));
  }

  // ── Filtered data ─────────────────────────────────────────────────────────
  const filteredLeads = leads
    .filter(l => !leadStatusFilter || l.status === leadStatusFilter)
    .filter(l => !leadSearch || l.company.toLowerCase().includes(leadSearch.toLowerCase()) || l.contactName.toLowerCase().includes(leadSearch.toLowerCase()));

  const filteredContacts = contacts
    .filter(c => !contactSearch || c.name.toLowerCase().includes(contactSearch.toLowerCase()) || c.company.toLowerCase().includes(contactSearch.toLowerCase()));

  const filteredFollowups = followups
    .filter(f => showAllFollowups || f.status === 'pending')
    .sort((a, b) => {
      if (followupSort === 'date') return a.followUpDate.localeCompare(b.followUpDate);
      const pOrder = { high: 0, medium: 1, low: 2 };
      return pOrder[a.priority] - pOrder[b.priority];
    });

  // ── Stats ─────────────────────────────────────────────────────────────────
  const leadStats = {
    total:       leads.length,
    active:      leads.filter(l => ['prospect', 'qualified', 'proposal', 'negotiating'].includes(l.status)).length,
    closed:      leads.filter(l => l.status === 'closed').length,
    lost:        leads.filter(l => l.status === 'lost').length,
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'leads',    label: `Leads (${leads.length})` },
    { key: 'contacts', label: `Contacts (${contacts.length})` },
    { key: 'followups', label: `Follow-ups (${followups.filter(f => f.status === 'pending').length} pending)` },
  ];

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '12px 22px', border: 'none', cursor: 'pointer', fontSize: 14,
    fontWeight: active ? 700 : 500,
    color: active ? '#1565c0' : '#64748b',
    background: active ? '#eff6ff' : 'transparent',
    borderBottom: active ? '2px solid #1565c0' : '2px solid transparent',
  });

  const actionBtn = (color: string): React.CSSProperties => ({
    background: color, color: '#fff', border: 'none', borderRadius: 6,
    padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
  });

  const ghostBtn: React.CSSProperties = {
    background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6,
    padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>💼 Business Development</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Manage leads, contacts, and follow-ups</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => { setShowFollowupModal(true); setTab('followups'); }}
              style={{ background: '#00796b', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              + Add Follow-up
            </button>
            <button
              onClick={() => { setEditingContact(null); setShowContactModal(true); setTab('contacts'); }}
              style={{ background: '#6a1b9a', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              + Add Contact
            </button>
            <button
              onClick={() => { setEditingLead(null); setShowLeadModal(true); setTab('leads'); }}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              + Add Lead
            </button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={tabBtnStyle(tab === t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── LEADS TAB ─────────────────────────────────────────────────────── */}
        {tab === 'leads' && (
          <div>
            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, padding: '20px 20px 0' }}>
              {[
                { label: 'Total Leads',      value: leadStats.total,  color: '#1565c0' },
                { label: 'Active Prospects', value: leadStats.active, color: '#e65100' },
                { label: 'Closed Deals',     value: leadStats.closed, color: '#2e7d32' },
                { label: 'Lost',             value: leadStats.lost,   color: '#c62828' },
              ].map(s => (
                <div key={s.label} style={{ background: '#f8fafc', borderRadius: 10, border: '1px solid #e8edf2', padding: '14px 18px' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Filter bar */}
            <div style={{ display: 'flex', gap: 12, padding: '16px 20px', alignItems: 'center' }}>
              <input
                style={{ ...inputStyle(), maxWidth: 260 }}
                placeholder="Search company or contact..."
                value={leadSearch}
                onChange={e => setLeadSearch(e.target.value)}
              />
              <select
                style={{ ...inputStyle(), maxWidth: 180 }}
                value={leadStatusFilter}
                onChange={e => setLeadStatusFilter(e.target.value)}
              >
                <option value="">All Statuses</option>
                <option value="prospect">Prospect</option>
                <option value="qualified">Qualified</option>
                <option value="proposal">Proposal</option>
                <option value="negotiating">Negotiating</option>
                <option value="closed">Closed</option>
                <option value="lost">Lost</option>
              </select>
              {(leadSearch || leadStatusFilter) && (
                <button onClick={() => { setLeadSearch(''); setLeadStatusFilter(''); }} style={ghostBtn}>Clear</button>
              )}
            </div>

            {/* Leads table */}
            {filteredLeads.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>💼</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>No leads found</div>
                <div style={{ fontSize: 14, color: '#64748b' }}>Add your first lead to start tracking prospects.</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Company', 'Contact', 'Phone', 'Email', 'Status', 'Source', 'Last Contact', 'Next Follow-up', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.map(l => (
                      <tr key={l.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1a2b3c', fontSize: 14 }}>{l.company}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{l.contactName}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>{l.phone || '—'}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>{l.email || '—'}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <Badge label={l.status} color={LEAD_STATUS_COLORS[l.status]} />
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{SOURCE_LABELS[l.source]}</td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDate(l.lastContact)}</td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDate(l.nextFollowUp)}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button onClick={() => { setEditingLead(l); setShowLeadModal(true); }} style={ghostBtn}>Edit</button>
                            {l.status !== 'closed' && l.status !== 'lost' && (
                              <button onClick={() => markLeadStatus(l.id, 'closed')} style={actionBtn('#2e7d32')}>Won</button>
                            )}
                            {l.status !== 'lost' && l.status !== 'closed' && (
                              <button onClick={() => markLeadStatus(l.id, 'lost')} style={actionBtn('#c62828')}>Lost</button>
                            )}
                            <button onClick={() => deleteLead(l.id)} style={{ ...ghostBtn, color: '#c62828' }}>Remove</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── CONTACTS TAB ─────────────────────────────────────────────────── */}
        {tab === 'contacts' && (
          <div>
            <div style={{ display: 'flex', gap: 12, padding: '16px 20px', alignItems: 'center' }}>
              <input
                style={{ ...inputStyle(), maxWidth: 300 }}
                placeholder="Search name or company..."
                value={contactSearch}
                onChange={e => setContactSearch(e.target.value)}
              />
            </div>

            {filteredContacts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>👤</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>No contacts found</div>
                <div style={{ fontSize: 14, color: '#64748b' }}>Add contacts to keep track of key people.</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Name', 'Title', 'Company', 'Email', 'Phone', 'Last Contact', 'Notes', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map(c => (
                      <tr key={c.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1a2b3c', fontSize: 14 }}>{c.name}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{c.title || '—'}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{c.company || '—'}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>{c.email || '—'}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>{c.phone || '—'}</td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDate(c.lastContact)}</td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748b', maxWidth: 180 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.notes || '—'}</div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => { setEditingContact(c); setShowContactModal(true); }} style={ghostBtn}>Edit</button>
                            <button onClick={() => deleteContact(c.id)} style={{ ...ghostBtn, color: '#c62828' }}>Remove</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── FOLLOW-UPS TAB ────────────────────────────────────────────────── */}
        {tab === 'followups' && (
          <div>
            <div style={{ display: 'flex', gap: 12, padding: '16px 20px', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', cursor: 'pointer', fontWeight: 500 }}>
                <input type="checkbox" checked={showAllFollowups} onChange={e => setShowAllFollowups(e.target.checked)} />
                Show completed
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>Sort by:</span>
                <select style={{ ...inputStyle(), maxWidth: 150, padding: '6px 10px' }} value={followupSort} onChange={e => setFollowupSort(e.target.value as 'date' | 'priority')}>
                  <option value="date">Due Date</option>
                  <option value="priority">Priority</option>
                </select>
              </div>
              <span style={{ fontSize: 13, color: '#64748b' }}>
                {filteredFollowups.length} follow-up{filteredFollowups.length !== 1 ? 's' : ''}
              </span>
            </div>

            {filteredFollowups.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>
                  {showAllFollowups ? 'No follow-ups yet' : 'No pending follow-ups'}
                </div>
                <div style={{ fontSize: 14, color: '#64748b' }}>
                  {!showAllFollowups ? 'Toggle "Show completed" to see all.' : 'Add a follow-up to stay on top of leads.'}
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Company / Contact', 'Due Date', 'Type', 'Priority', 'Notes', 'Status', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFollowups.map(f => (
                      <tr key={f.id} style={{ borderTop: '1px solid #f1f5f9', opacity: f.status === 'done' ? 0.6 : 1 }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1a2b3c', fontSize: 14 }}>{f.companyContact}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151', whiteSpace: 'nowrap' }}>{fmtDate(f.followUpDate)}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <Badge label={f.type} color={TYPE_COLORS[f.type]} />
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <Badge label={f.priority} color={PRIORITY_COLORS[f.priority]} />
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748b', maxWidth: 200 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.notes || '—'}</div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <Badge
                            label={f.status}
                            color={f.status === 'done' ? '#2e7d32' : '#e65100'}
                          />
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {f.status === 'pending' && (
                            <button onClick={() => markFollowupDone(f.id)} style={actionBtn('#2e7d32')}>Mark Done</button>
                          )}
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

      {/* Lead Modal */}
      {showLeadModal && (
        <LeadModal
          initial={editingLead ? { ...editingLead } : EMPTY_LEAD}
          onClose={() => { setShowLeadModal(false); setEditingLead(null); }}
          onSave={(data) => saveLead(data, editingLead?.id)}
        />
      )}

      {/* Contact Modal */}
      {showContactModal && (
        <ContactModal
          initial={editingContact ? { ...editingContact } : EMPTY_CONTACT}
          onClose={() => { setShowContactModal(false); setEditingContact(null); }}
          onSave={(data) => saveContact(data, editingContact?.id)}
        />
      )}

      {/* Follow-up Modal */}
      {showFollowupModal && (
        <FollowupModal
          onClose={() => setShowFollowupModal(false)}
          onSave={saveFollowup}
        />
      )}
    </div>
  );
}
