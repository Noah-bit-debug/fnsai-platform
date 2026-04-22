import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackingPolicy {
  tracking_mode: 'scheduled' | 'browser_profile';
  schedule_start: string;
  schedule_end: string;
  idle_threshold_minutes: number;
  auto_deduct_idle: boolean;
  notify_employee_on_idle: boolean;
  require_manager_review: boolean;
  allow_page_title: boolean;
  show_domain_in_reports: boolean;
  data_retention_days: number;
  employee_consent_required: boolean;
  approved_domains: string[];
  excluded_domains: string[];
  overrides: PolicyOverride[];
  consent_status: ConsentEntry[];
}

interface DomainEntry {
  id: string;
  domain: string;
  classification: 'work' | 'neutral' | 'excluded' | 'non_work';
  label: string;
  ai_suggested: boolean;
  admin_approved: boolean;
}

interface PolicyOverride {
  id: string;
  scope_type: 'user' | 'team';
  scope_label: string;
  mode: string;
  schedule: string;
  idle_threshold: number;
}

interface ConsentEntry {
  employee_name: string;
  status: 'consented' | 'pending' | 'declined';
}

interface AISuggestion {
  domain: string;
  classification: DomainEntry['classification'];
  label: string;
  reason: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      style={{
        width: 44, height: 24, borderRadius: 12, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: value ? '#1565c0' : '#cbd5e1', position: 'relative', flexShrink: 0, transition: 'background 0.2s',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: value ? 23 : 3, width: 18, height: 18,
        background: '#fff', borderRadius: '50%', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

const CLASS_COLORS: Record<DomainEntry['classification'], { bg: string; color: string }> = {
  work:       { bg: '#dcfce7', color: '#15803d' },
  neutral:    { bg: '#fef9c3', color: '#a16207' },
  excluded:   { bg: '#fee2e2', color: '#b91c1c' },
  non_work:   { bg: '#f1f5f9', color: '#475569' },
};

function ClassBadge({ cls }: { cls: DomainEntry['classification'] }) {
  const cfg = CLASS_COLORS[cls] ?? CLASS_COLORS.neutral;
  return (
    <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>
      {cls.replace('_', ' ')}
    </span>
  );
}

function ConsentBadge({ status }: { status: ConsentEntry['status'] }) {
  const map = { consented: { bg: '#dcfce7', color: '#15803d', label: 'Consented' }, pending: { bg: '#fef9c3', color: '#a16207', label: 'Pending' }, declined: { bg: '#fee2e2', color: '#b91c1c', label: 'Declined' } };
  const cfg = map[status];
  return <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>{cfg.label}</span>;
}

function AddDomainModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [domain, setDomain] = useState('');
  const [classification, setClassification] = useState<DomainEntry['classification']>('work');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!domain.trim()) { setErr('Domain is required.'); return; }
    setSaving(true); setErr(null);
    try {
      await api.post('/time-tracking/domains', { domain: domain.trim(), classification, label: label.trim() });
      onAdded();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to add domain.');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1a2b3c', marginBottom: 18 }}>Add Domain</div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Domain *</label>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. github.com" style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Classification</label>
          <select value={classification} onChange={(e) => setClassification(e.target.value as DomainEntry['classification'])} style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14 }}>
            <option value="work">Work</option>
            <option value="neutral">Neutral</option>
            <option value="excluded">Excluded</option>
            <option value="non_work">Non-Work</option>
          </select>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Label (optional)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Code Collaboration" style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
        </div>
        {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 14, color: '#374151', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Adding...' : 'Add Domain'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddOverrideModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ scope_type: 'user' as 'user' | 'team', scope_label: '', mode: 'scheduled', schedule: '', idle_threshold: 10 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.scope_label.trim()) { setErr('Scope name is required.'); return; }
    setSaving(true); setErr(null);
    try {
      await api.post('/time-tracking/policy/overrides', form);
      onAdded();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to save override.');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1a2b3c', marginBottom: 18 }}>Add Policy Override</div>
        {[
          { label: 'Scope Type', key: 'scope_type' as const, type: 'select' as const, opts: [['user','User'],['team','Team']] },
          { label: 'User / Team Name', key: 'scope_label' as const, type: 'input' as const, placeholder: 'e.g. John Smith' },
          { label: 'Mode', key: 'mode' as const, type: 'select' as const, opts: [['scheduled','Scheduled Hours'],['browser_profile','Browser Profile']] },
          { label: 'Schedule (e.g. 9:00–17:00)', key: 'schedule' as const, type: 'input' as const, placeholder: '09:00–17:00' },
        ].map(({ label, key, type, opts, placeholder }: any) => (
          <div key={key} style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>{label}</label>
            {type === 'select'
              ? <select value={(form as any)[key]} onChange={set(key)} style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14 }}>
                  {opts.map(([v, l]: string[]) => <option key={v} value={v}>{l}</option>)}
                </select>
              : <input value={(form as any)[key]} onChange={set(key)} placeholder={placeholder} style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
            }
          </div>
        ))}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Idle Threshold (min)</label>
          <input type="number" min={1} max={60} value={form.idle_threshold} onChange={(e) => setForm((f) => ({ ...f, idle_threshold: +e.target.value }))} style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
        </div>
        {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 14, color: '#374151', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : 'Save Override'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DisclosureModal({ onClose }: { onClose: () => void }) {
  const template = `EMPLOYEE DISCLOSURE — BROWSER ACTIVITY METADATA TRACKING

Effective as of your first day of employment with this organization, your employer uses the FNS AI Time Tracking system to monitor browser activity metadata during your scheduled work hours.

WHAT IS TRACKED:
- Domains visited (e.g., "github.com") — page content is NOT recorded
- Active vs idle time within your browser session
- Session start and end times

WHAT IS NOT TRACKED:
- Page titles or content (unless your administrator has enabled page title tracking with your consent)
- Keystrokes, screen recordings, or personal messages

PURPOSE:
This data is used solely for payroll, productivity analytics, and compliance purposes within Frontline Healthcare Staffing.

RETENTION:
Data is retained per the organization's data retention policy (default: 90 days).

CONSENT:
By continuing to use company systems, you acknowledge this disclosure. If you have questions, please contact your manager or HR.`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Employee Disclosure Template</div>
        <pre style={{ background: '#f8fafc', borderRadius: 10, padding: 16, fontSize: 12, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap', border: '1px solid #e2e8f0' }}>
          {template}
        </pre>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={() => navigator.clipboard.writeText(template)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
            Copy Text
          </button>
          <button onClick={onClose} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TimeTrackingAdmin() {
  const queryClient = useQueryClient();

  const { data: policyData, isLoading: policyLoading } = useQuery<{ data: TrackingPolicy }>({
    queryKey: ['tracking-policy'],
    queryFn: () => api.get('/time-tracking/policy/all'),
  });

  const { data: domainsData, isLoading: domainsLoading } = useQuery<{ data: { domains: DomainEntry[] } }>({
    queryKey: ['tracking-domains'],
    queryFn: () => api.get('/time-tracking/domains'),
  });

  const [policy, setPolicy] = useState<Partial<TrackingPolicy>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [showAddOverride, setShowAddOverride] = useState(false);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);

  useEffect(() => {
    if (policyData?.data) setPolicy(policyData.data);
  }, [policyData]);

  const setPol = <K extends keyof TrackingPolicy>(k: K, v: TrackingPolicy[K]) =>
    setPolicy((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true); setSaveMsg(null);
    try {
      await api.put('/time-tracking/policy', policy);
      setSaveMsg('Policy saved successfully.');
      queryClient.invalidateQueries({ queryKey: ['tracking-policy'] });
    } catch (e: any) {
      setSaveMsg(e?.response?.data?.error ?? 'Failed to save policy.');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 4000);
    }
  };

  const handleAiSuggest = async () => {
    setAiSuggesting(true); setAiSuggestions([]);
    try {
      const res = await api.post('/time-tracking/domains/ai-suggest', {});
      setAiSuggestions(res.data?.suggestions ?? []);
    } catch {
      setAiSuggestions([]);
    } finally { setAiSuggesting(false); }
  };

  const handleApproveSuggestion = async (s: AISuggestion) => {
    try {
      await api.post('/time-tracking/domains', { domain: s.domain, classification: s.classification, label: s.label, admin_approved: true });
      setAiSuggestions((prev) => prev.filter((x) => x.domain !== s.domain));
      queryClient.invalidateQueries({ queryKey: ['tracking-domains'] });
    } catch {}
  };

  const handleDeleteDomain = async (id: string) => {
    if (!confirm('Remove this domain?')) return;
    try {
      await api.delete(`/time-tracking/domains/${id}`);
      queryClient.invalidateQueries({ queryKey: ['tracking-domains'] });
    } catch {}
  };

  const handleDeleteOverride = async (id: string) => {
    if (!confirm('Remove this override?')) return;
    try {
      await api.delete(`/time-tracking/policy/overrides/${id}`);
      queryClient.invalidateQueries({ queryKey: ['tracking-policy'] });
    } catch {}
  };

  const domains = domainsData?.data?.domains ?? [];
  const overrides = (policy as TrackingPolicy).overrides ?? [];
  const consentStatus = (policy as TrackingPolicy).consent_status ?? [];

  const card = (children: React.ReactNode) => (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e8edf2', padding: 24, marginBottom: 22 }}>
      {children}
    </div>
  );

  const sectionTitle = (title: string, action?: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c' }}>{title}</div>
      {action}
    </div>
  );

  const row = (label: string, desc: string, control: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c' }}>{label}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{desc}</div>
      </div>
      <div style={{ marginLeft: 24, flexShrink: 0 }}>{control}</div>
    </div>
  );

  if (policyLoading) return (
    <div style={{ textAlign: 'center', padding: 80, color: '#64748b', fontSize: 14 }}>
      <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#1565c0', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
      Loading policy...
    </div>
  );

  return (
    <div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>⚙ Time Tracking Policy</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Configure tracking rules, privacy settings, and domain classifications</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {saveMsg && (
              <span style={{ fontSize: 13, fontWeight: 600, color: saveMsg.includes('success') ? '#16a34a' : '#dc2626' }}>{saveMsg}</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontWeight: 600, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving...' : 'Save Policy'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Global Policy ── */}
      {card(
        <>
          {sectionTitle('Global Policy')}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Tracking Mode</div>
            <div style={{ display: 'flex', gap: 16 }}>
              {([['scheduled', 'Scheduled Hours'], ['browser_profile', 'Browser Profile']] as const).map(([val, lbl]) => (
                <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: '#374151' }}>
                  <input
                    type="radio" name="tracking_mode" value={val}
                    checked={policy.tracking_mode === val}
                    onChange={() => setPol('tracking_mode', val)}
                    style={{ accentColor: '#1565c0' }}
                  />
                  {lbl}
                </label>
              ))}
            </div>
          </div>

          {policy.tracking_mode === 'scheduled' && (
            <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Schedule Start</label>
                <input type="time" value={policy.schedule_start ?? '09:00'} onChange={(e) => setPol('schedule_start', e.target.value)} style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Schedule End</label>
                <input type="time" value={policy.schedule_end ?? '17:00'} onChange={(e) => setPol('schedule_end', e.target.value)} style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14 }} />
              </div>
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>
              Idle Threshold: <span style={{ color: '#1565c0' }}>{policy.idle_threshold_minutes ?? 10} minutes</span>
            </label>
            <input
              type="range" min={1} max={60} value={policy.idle_threshold_minutes ?? 10}
              onChange={(e) => setPol('idle_threshold_minutes', +e.target.value)}
              style={{ width: '100%', accentColor: '#1565c0' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
              <span>1 min</span><span>30 min</span><span>60 min</span>
            </div>
          </div>

          {row('Auto-Deduct Idle', 'Automatically subtract idle time from active duration', <Toggle value={!!policy.auto_deduct_idle} onChange={(v) => setPol('auto_deduct_idle', v)} />)}
          {row('Notify Employee on Idle', 'Alert employees when an idle period is detected', <Toggle value={!!policy.notify_employee_on_idle} onChange={(v) => setPol('notify_employee_on_idle', v)} />)}
          {row('Require Manager Review for Exceptions', 'Flag sessions with large discrepancies for manager approval', <Toggle value={!!policy.require_manager_review} onChange={(v) => setPol('require_manager_review', v)} />)}
        </>
      )}

      {/* ── Privacy Controls ── */}
      {card(
        <>
          {sectionTitle('Privacy Controls')}
          {row('Allow Page Title Tracking', 'Record page titles in addition to domains', <Toggle value={!!policy.allow_page_title} onChange={(v) => setPol('allow_page_title', v)} />)}
          {row('Show Domain in Reports', 'Include domain names in manager reports', <Toggle value={policy.show_domain_in_reports !== false} onChange={(v) => setPol('show_domain_in_reports', v)} />)}
          {row('Employee Consent Required', 'Employees must consent before tracking begins', <Toggle value={true} onChange={() => {}} disabled />)}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>Data Retention Period</label>
            <select
              value={policy.data_retention_days ?? 90}
              onChange={(e) => setPol('data_retention_days', +e.target.value)}
              style={{ padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, minWidth: 180 }}
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>1 year</option>
            </select>
          </div>
        </>
      )}

      {/* ── Domain Classification Manager ── */}
      {card(
        <>
          {sectionTitle('Domain Classification Manager',
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAiSuggest}
                disabled={aiSuggesting}
                style={{ background: aiSuggesting ? '#e2e8f0' : '#7c3aed', color: aiSuggesting ? '#64748b' : '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 600, fontSize: 13, cursor: aiSuggesting ? 'not-allowed' : 'pointer' }}
              >
                {aiSuggesting ? 'Suggesting...' : '🤖 AI Suggest Domains'}
              </button>
              <button
                onClick={() => setShowAddDomain(true)}
                style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
              >
                + Add Domain
              </button>
            </div>
          )}

          {/* AI Suggestions */}
          {aiSuggestions.length > 0 && (
            <div style={{ background: '#f5f3ff', borderRadius: 12, border: '1px solid #ddd6fe', padding: 16, marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9', marginBottom: 12 }}>AI Suggestions — Review Each</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {aiSuggestions.map((s) => (
                  <div key={s.domain} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', borderRadius: 10, padding: '10px 14px', gap: 12 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13, color: '#1a2b3c' }}>{s.domain}</span>
                      <ClassBadge cls={s.classification} />
                      <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>{s.reason}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => handleApproveSuggestion(s)} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Approve</button>
                      <button onClick={() => setAiSuggestions((p) => p.filter((x) => x.domain !== s.domain))} style={{ background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 7, padding: '5px 12px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {domainsLoading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 13 }}>Loading domains...</div>
          ) : domains.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 13 }}>No domains configured. Add domains or use AI Suggest.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Domain', 'Classification', 'Label', 'AI Suggested', 'Approved', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {domains.map((d, i) => (
                  <tr key={d.id} style={{ borderTop: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>{d.domain}</td>
                    <td style={{ padding: '10px 12px' }}><ClassBadge cls={d.classification} /></td>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>{d.label || '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: d.ai_suggested ? '#7c3aed' : '#94a3b8' }}>{d.ai_suggested ? '🤖 Yes' : '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: d.admin_approved ? '#16a34a' : '#94a3b8' }}>{d.admin_approved ? '✓ Yes' : '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <button onClick={() => handleDeleteDomain(d.id)} style={{ background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '4px 10px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* ── User / Team Overrides ── */}
      {card(
        <>
          {sectionTitle('User / Team Overrides',
            <button onClick={() => setShowAddOverride(true)} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              + Add Override
            </button>
          )}
          {overrides.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 28, color: '#94a3b8', fontSize: 13 }}>No overrides set. Global policy applies to all users.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Scope', 'Mode', 'Schedule', 'Idle Threshold', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overrides.map((ov, i) => (
                  <tr key={ov.id} style={{ borderTop: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: '#1a2b3c' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, background: ov.scope_type === 'user' ? '#eff6ff' : '#f0fdf4', color: ov.scope_type === 'user' ? '#1d4ed8' : '#15803d', borderRadius: 6, padding: '2px 7px', marginRight: 7 }}>
                        {ov.scope_type === 'user' ? 'User' : 'Team'}
                      </span>
                      {ov.scope_label}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151', textTransform: 'capitalize' }}>{ov.mode.replace('_', ' ')}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>{ov.schedule || '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>{ov.idle_threshold} min</td>
                    <td style={{ padding: '10px 12px' }}>
                      <button onClick={() => handleDeleteOverride(ov.id)} style={{ background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '4px 10px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* ── Consent & Compliance ── */}
      {card(
        <>
          {sectionTitle('Consent & Compliance')}
          <div style={{ background: '#fff7ed', borderRadius: 10, border: '1px solid #fed7aa', padding: '14px 18px', marginBottom: 18, fontSize: 13, color: '#9a3412', lineHeight: 1.6 }}>
            Employees must be informed that browser activity metadata is being tracked during work hours. A disclosure must be provided before tracking begins, and consent must be recorded. This organization is responsible for compliance with applicable privacy laws.
          </div>
          <div style={{ marginBottom: 18 }}>
            <button onClick={() => setShowDisclosure(true)} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#374151' }}>
              📄 Download Disclosure Template
            </button>
          </div>
          {consentStatus.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>Employee Consent Status</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {consentStatus.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>{c.employee_name}</span>
                    <ConsentBadge status={c.status} />
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {showAddDomain && <AddDomainModal onClose={() => setShowAddDomain(false)} onAdded={() => queryClient.invalidateQueries({ queryKey: ['tracking-domains'] })} />}
      {showAddOverride && <AddOverrideModal onClose={() => setShowAddOverride(false)} onAdded={() => queryClient.invalidateQueries({ queryKey: ['tracking-policy'] })} />}
      {showDisclosure && <DisclosureModal onClose={() => setShowDisclosure(false)} />}
    </div>
  );
}
