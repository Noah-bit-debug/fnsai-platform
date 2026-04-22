import { useState, useEffect } from 'react';
import { remindersApi, Reminder } from '../lib/api';

const STATUS_COLORS: Record<string, string> = {
  scheduled:  '#1565c0',
  sent:       '#2e7d32',
  overdue:    '#c62828',
  completed:  '#00695c',
  failed:     '#e65100',
  cancelled:  '#546e7a',
};

const TYPE_COLORS: Record<string, string> = {
  email: '#1565c0',
  sms:   '#6a1b9a',
  both:  '#00695c',
};

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

function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { width: '100%', padding: '9px 14px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box', ...extra };
}

const FILTER_TABS = ['all', 'scheduled', 'sent', 'overdue'] as const;

// ─── New Reminder Modal ───────────────────────────────────────────────────────
function NewReminderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    type: 'email' as 'email' | 'sms' | 'both',
    recipient_name: '',
    recipient_email: '',
    recipient_phone: '',
    subject: '',
    message: '',
    scheduled_at: '',
    trigger_type: 'manual' as Reminder['trigger_type'],
    candidate_id: '' as string,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Phase 1.6B+C — AI-assisted drafting.
  const [candidates, setCandidates] = useState<Array<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null }>>([]);
  const [aiTopic, setAiTopic] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    // Load a compact candidate list for the picker. Keep it best-effort —
    // users can still fill the form manually if this fails.
    import('../lib/api').then(({ candidatesApi }) =>
      candidatesApi.list({ status: 'active' }).then((r: any) => {
        const cs = r?.data?.candidates ?? [];
        setCandidates(cs.map((c: any) => ({
          id: c.id, first_name: c.first_name, last_name: c.last_name,
          email: c.email, phone: c.phone,
        })));
      }).catch(() => { /* silent */ })
    );
  }, []);

  // When a candidate is picked, auto-fill name / email / phone from the
  // record so the user doesn't have to retype. They can still override.
  const onPickCandidate = (id: string) => {
    setForm((f) => ({ ...f, candidate_id: id }));
    const c = candidates.find((x) => x.id === id);
    if (!c) return;
    setForm((f) => ({
      ...f,
      candidate_id: id,
      recipient_name: `${c.first_name} ${c.last_name}`,
      recipient_email: c.email ?? f.recipient_email,
      recipient_phone: c.phone ?? f.recipient_phone,
    }));
  };

  const onAiDraft = async () => {
    setAiBusy(true);
    setErr(null);
    try {
      const res = await remindersApi.aiDraft({
        candidate_id: form.candidate_id || null,
        topic: aiTopic.trim() || undefined,
        type: form.type,
      });
      setForm((f) => ({
        ...f,
        subject: res.data.subject || f.subject,
        message: res.data.message || f.message,
      }));
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'AI draft failed.');
    } finally { setAiBusy(false); }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.subject.trim() || !form.message.trim()) { setErr('Subject and message are required.'); return; }
    setSaving(true);
    setErr(null);
    try {
      await remindersApi.create({
        type: form.type,
        candidate_id: form.candidate_id || undefined,
        recipient_name: form.recipient_name || undefined,
        recipient_email: form.recipient_email || undefined,
        recipient_phone: form.recipient_phone || undefined,
        subject: form.subject.trim(),
        message: form.message.trim(),
        scheduled_at: form.scheduled_at || undefined,
        trigger_type: form.trigger_type,
        status: 'scheduled',
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to create reminder.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>New Reminder</div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Type</label>
          <select style={inputStyle()} value={form.type} onChange={set('type')}>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="both">Both</option>
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Trigger</label>
          <select style={inputStyle()} value={form.trigger_type} onChange={set('trigger_type')}>
            <option value="manual">Manual</option>
            <option value="missing_document">Missing Document</option>
            <option value="incomplete_onboarding">Incomplete Onboarding</option>
            <option value="pending_application">Pending Application</option>
            <option value="credential_expiry">Credential Expiry</option>
          </select>
        </div>

        {/* Phase 1.6C — pick a candidate to auto-fill recipient + let AI
            tailor the message to what they specifically need. */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
            About a candidate? (optional)
          </label>
          <select style={inputStyle()} value={form.candidate_id} onChange={(e) => onPickCandidate(e.target.value)}>
            <option value="">— no specific candidate —</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select>
        </div>

        {/* Phase 1.6B — AI draft button. If a candidate is selected, the
            backend pulls their missing docs / stale stage details into the
            prompt so the message is actually specific. Topic is optional. */}
        <div style={{ marginBottom: 14, padding: 10, background: 'linear-gradient(135deg, #eef2ff, #faf5ff)', borderRadius: 8, border: '1px solid #c7d2fe' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#4f46e5' }}>✦ AI Draft</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {form.candidate_id ? 'uses the selected candidate\'s specific gaps' : 'tell the AI what the reminder is about'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={{ ...inputStyle(), flex: 1 }}
              placeholder={form.candidate_id ? 'Optional: e.g. "remind about BLS renewal"' : 'e.g. "follow up on pending I-9"'}
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
            />
            <button
              type="button"
              onClick={onAiDraft}
              disabled={aiBusy}
              style={{ padding: '8px 14px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: aiBusy ? 'not-allowed' : 'pointer', opacity: aiBusy ? 0.7 : 1, whiteSpace: 'nowrap' }}
            >
              {aiBusy ? 'Drafting…' : 'Draft with AI'}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Recipient Name</label>
          <input style={inputStyle()} value={form.recipient_name} onChange={set('recipient_name')} placeholder="Full name" />
        </div>

        {(form.type === 'email' || form.type === 'both') && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Recipient Email</label>
            <input style={inputStyle()} type="email" value={form.recipient_email} onChange={set('recipient_email')} placeholder="name@example.com" />
          </div>
        )}

        {(form.type === 'sms' || form.type === 'both') && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Recipient Phone</label>
            <input style={inputStyle()} value={form.recipient_phone} onChange={set('recipient_phone')} placeholder="(555) 000-0000" />
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Subject *</label>
          <input style={inputStyle()} value={form.subject} onChange={set('subject')} placeholder="Reminder: Missing Documents" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Message *</label>
          <textarea style={{ ...inputStyle(), height: 100, resize: 'vertical' }} value={form.message} onChange={set('message')} placeholder="Hi [Name], please..." />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Schedule At (optional)</label>
          <input style={inputStyle()} type="datetime-local" value={form.scheduled_at} onChange={set('scheduled_at')} />
        </div>

        {err && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14 }}>
            {saving ? 'Creating...' : 'Create Reminder'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Reminders() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<typeof FILTER_TABS[number]>('all');
  const [showNew, setShowNew] = useState(false);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);

  const fetchReminders = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = filterTab !== 'all' ? { status: filterTab } : undefined;
      const res = await remindersApi.list(params);
      setReminders(res.data?.reminders ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load reminders.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReminders(); }, [filterTab]);

  const handleSendNow = async (id: string) => {
    try {
      await remindersApi.send(id);
      await fetchReminders();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Failed to send reminder.');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this reminder?')) return;
    try {
      await remindersApi.cancel(id);
      await fetchReminders();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Failed to cancel reminder.');
    }
  };

  const handleAutoGenerate = async () => {
    setAutoGenerating(true);
    setAutoMsg(null);
    try {
      const res = await remindersApi.autoGenerate();
      setAutoMsg(`Generated ${res.data.generated} reminder${res.data.generated !== 1 ? 's' : ''}.`);
      await fetchReminders();
    } catch (e: any) {
      setAutoMsg(e?.response?.data?.error ?? 'Failed to auto-generate.');
    } finally {
      setAutoGenerating(false);
      setTimeout(() => setAutoMsg(null), 4000);
    }
  };

  const counts = {
    scheduled: reminders.filter((r) => r.status === 'scheduled').length,
    sent:      reminders.filter((r) => r.status === 'sent' || r.status === 'completed').length,
    overdue:   reminders.filter((r) => r.status === 'overdue').length,
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>Reminders</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>
              Manage candidate and onboarding reminders.{' '}
              <span style={{ color: '#475569' }}>
                <strong>Auto-Generate</strong> scans every active candidate for known gaps
                (missing documents, stale stages, overdue tasks) and creates a reminder for
                each so nothing falls through the cracks. Safe to re-run — it skips any
                reminder that already exists.
              </span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {autoMsg && <span style={{ fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>{autoMsg}</span>}
            <button
              onClick={handleAutoGenerate}
              disabled={autoGenerating}
              title="Scans every active candidate for missing docs, stalled stages, and overdue tasks, then creates a reminder for each. Skips ones that already exist, so safe to re-run."
              style={{ background: '#00796b', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: autoGenerating ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: autoGenerating ? 0.7 : 1 }}
            >
              {autoGenerating ? 'Generating...' : '✨ Auto-Generate'}
            </button>
            <button
              onClick={() => setShowNew(true)}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              + New Reminder
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Scheduled', value: counts.scheduled, color: '#1565c0' },
          { label: 'Sent / Completed', value: counts.sent, color: '#2e7d32' },
          { label: 'Overdue', value: counts.overdue, color: '#c62828' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '18px 22px' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2' }}>
          {FILTER_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              style={{
                padding: '12px 22px', border: 'none', cursor: 'pointer', fontSize: 14,
                fontWeight: filterTab === tab ? 700 : 500,
                color: filterTab === tab ? '#1565c0' : '#64748b',
                background: filterTab === tab ? '#eff6ff' : 'transparent',
                borderBottom: filterTab === tab ? '2px solid #1565c0' : '2px solid transparent',
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>Loading...</div>
        ) : reminders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔔</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>No reminders</div>
            <div style={{ fontSize: 14, color: '#64748b' }}>
              {filterTab !== 'all' ? 'No reminders in this category.' : 'Create your first reminder or use Auto-Generate.'}
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Type', 'Trigger', 'Recipient', 'Subject', 'Status', 'Date', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reminders.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <Badge label={r.type} color={TYPE_COLORS[r.type] ?? '#546e7a'} />
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>
                    {r.trigger_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>
                    <div style={{ fontWeight: 600 }}>{r.recipient_name ?? r.candidate_name ?? '—'}</div>
                    {r.recipient_email && <div style={{ fontSize: 12, color: '#64748b' }}>{r.recipient_email}</div>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151', maxWidth: 200 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subject}</div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <Badge label={r.status} color={STATUS_COLORS[r.status] ?? '#546e7a'} />
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                    {r.sent_at
                      ? new Date(r.sent_at).toLocaleDateString()
                      : r.scheduled_at
                      ? new Date(r.scheduled_at).toLocaleDateString()
                      : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {r.status === 'scheduled' && (
                        <button
                          onClick={() => handleSendNow(r.id)}
                          style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                        >
                          Send Now
                        </button>
                      )}
                      {(r.status === 'scheduled' || r.status === 'overdue') && (
                        <button
                          onClick={() => handleCancel(r.id)}
                          style={{ background: '#fef2f2', color: '#c62828', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && reminders.length > 0 && (
        <div style={{ fontSize: 13, color: '#64748b', textAlign: 'right' }}>
          {reminders.length} reminder{reminders.length !== 1 ? 's' : ''}
        </div>
      )}

      {showNew && (
        <NewReminderModal
          onClose={() => setShowNew(false)}
          onCreated={fetchReminders}
        />
      )}
    </div>
  );
}
