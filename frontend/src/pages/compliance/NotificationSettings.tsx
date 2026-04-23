import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobRecord {
  job_name: string;
  status: string;
  records_processed: number;
  records_affected: number;
  started_at: string;
  completed_at: string | null;
}

interface Toast {
  id: number;
  message: string;
  success: boolean;
}

// ─── Setting definitions ──────────────────────────────────────────────────────

const TOGGLE_SETTINGS = [
  { key: 'notify_new_assignment',   label: 'New Assignment Emails',      description: 'Send email when item is assigned' },
  { key: 'notify_passed',           label: 'Exam Passed Email',           description: 'Notify user when they pass an exam' },
  { key: 'notify_failed',           label: 'Exam Failed Email',           description: 'Notify user when they fail an exam' },
  { key: 'notify_all_attempts_used',label: 'All Attempts Used Alert',     description: 'Alert user + supervisor when all attempts exhausted' },
  { key: 'notify_expired',          label: 'Expiration Emails',           description: 'Notify when certification expires' },
  { key: 'auto_renew_yearly',       label: 'Auto-Renew Yearly Items',     description: 'Automatically re-assign yearly items on expiration' },
  { key: 'auto_renew_bi_annual',    label: 'Auto-Renew Bi-Annual Items',  description: 'Automatically re-assign bi-annual items' },
];

const NUMBER_SETTINGS = [
  { key: 'notify_due_soon_days',             label: 'Due Date Reminder (days before)',          description: 'Send reminder X days before due date' },
  { key: 'notify_expiring_soon_days',        label: 'Expiring Soon Warning (days before)',      description: 'Send expiring soon notice X days before expiration' },
  { key: 'notify_reminder_frequency_days',   label: 'Reminder Frequency (days between)',        description: 'Days between repeated reminders' },
];

// ─── Toggle Switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      role="switch"
      aria-checked={checked}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? 'var(--ac, #3b82f6)' : '#cbd5e1',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </div>
  );
}

// ─── Toast component ──────────────────────────────────────────────────────────

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div
          key={t.id}
          style={{
            background: t.success ? '#16a34a' : '#dc2626',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            maxWidth: 320,
            animation: 'fadeInUp 0.2s ease',
          }}
        >
          {t.message}
        </div>
      ))}
      <style>{`@keyframes fadeInUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 12,
      padding: '20px 24px',
      marginBottom: 20,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NotificationSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = useRef(0);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ─── Toast helper ────────────────────────────────────────────────────────────

  const showToast = useCallback((message: string, success: boolean) => {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev, { id, message, success }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // ─── Fetch settings ───────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ settings: Record<string, string> }>('/compliance/jobs/settings');
        setSettings(res.data.settings ?? {});
        setLoadError(false);
      } catch {
        // Backend endpoint may not exist yet — use empty defaults but flag the error
        setSettings({});
        setLoadError(true);
      } finally {
        setLoadingSettings(false);
      }
    })();
  }, []);

  // ─── Fetch job history ────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async () => {
    try {
      const res = await api.get<{ jobs: JobRecord[] }>('/compliance/jobs/status');
      setJobs(res.data.jobs ?? []);
    } catch {
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // ─── Track pending changes locally (for batch Save) ──────────────────────────

  const markChanged = useCallback((key: string, value: string) => {
    setPendingChanges(prev => ({ ...prev, [key]: value }));
  }, []);

  // ─── Save all pending changes at once ────────────────────────────────────────

  const handleSaveAll = useCallback(async () => {
    if (Object.keys(pendingChanges).length === 0) {
      showToast('No changes to save', true);
      return;
    }
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(pendingChanges).map(([key, value]) =>
          api.patch('/compliance/jobs/settings', { key, value })
        )
      );
      setPendingChanges({});
      showToast('Settings saved', true);
    } catch {
      showToast('Failed to save some settings', false);
    } finally {
      setSaving(false);
    }
  }, [pendingChanges, showToast]);

  // ─── Toggle handler ───────────────────────────────────────────────────────────

  const handleToggle = useCallback((key: string, val: boolean) => {
    const strVal = val ? 'true' : 'false';
    setSettings(prev => ({ ...prev, [key]: strVal }));
    markChanged(key, strVal);
  }, [markChanged]);

  // ─── Number input handler ──────────────────────────────────────────────────────

  const handleNumberChange = useCallback((key: string, val: string) => {
    setSettings(prev => ({ ...prev, [key]: val }));
    markChanged(key, val);
    clearTimeout(debounceTimers.current[key]);
  }, [markChanged]);

  // ─── Job runner ───────────────────────────────────────────────────────────────

  const runJob = useCallback(async (label: string, endpoint: string) => {
    setRunningJob(label);
    try {
      const res = await api.post<Record<string, unknown>>(endpoint);
      const data = res.data;
      const summary = Object.entries(data)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
        .join(', ');
      showToast(summary || 'Job completed', true);
      fetchJobs();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Job failed';
      showToast(msg, false);
    } finally {
      setRunningJob(null);
    }
  }, [showToast, fetchJobs]);

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function getBoolSetting(key: string): boolean {
    const v = settings[key];
    if (v === undefined) return true; // default on
    return v === 'true' || v === '1';
  }

  function getNumSetting(key: string, fallback: number): string {
    return settings[key] ?? String(fallback);
  }

  function formatDate(s: string | null) {
    if (!s) return '—';
    try { return new Date(s).toLocaleString(); } catch { return s; }
  }

  function formatDuration(start: string, end: string | null) {
    if (!end) return '—';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const statusColor: Record<string, string> = {
    completed: '#22c55e',
    failed:    '#ef4444',
    running:   '#3b82f6',
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  const hasPending = Object.keys(pendingChanges).length > 0;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1a2b3c' }}>Notification Settings</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            Configure automated compliance notifications
          </div>
        </div>
        <button
          onClick={handleSaveAll}
          disabled={saving}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: hasPending ? '#3b82f6' : '#e2e8f0',
            color: hasPending ? '#fff' : '#94a3b8',
            fontSize: 14,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            transition: 'background 0.2s',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {saving && (
            <span style={{
              width: 13,
              height: 13,
              border: '2px solid #e2e8f0',
              borderTopColor: '#fff',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
              display: 'inline-block',
            }} />
          )}
          💾 Save Settings{hasPending ? ` (${Object.keys(pendingChanges).length})` : ''}
        </button>
      </div>

      {/* Warning banner when load failed */}
      {loadError && (
        <div style={{
          background: '#fefce8',
          border: '1px solid #fde047',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 20,
          fontSize: 13,
          color: '#713f12',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span>
            Could not load settings from server — using defaults.
            Settings will be saved when you click <strong>Save Settings</strong>.
          </span>
        </div>
      )}

      {/* Section 1: Notification Types */}
      <Card title="Notification Types">
        {loadingSettings ? (
          // Skeleton rows while loading
          Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '11px 0',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div style={{ flex: 1, marginRight: 16 }}>
                <div style={{
                  height: 14,
                  width: `${50 + (i % 3) * 20}%`,
                  borderRadius: 6,
                  background: '#f8fafc',
                  marginBottom: 6,
                }} />
                <div style={{
                  height: 11,
                  width: '60%',
                  borderRadius: 6,
                  background: '#fff',
                }} />
              </div>
              <div style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                background: '#f8fafc',
                flexShrink: 0,
              }} />
            </div>
          ))
        ) : (
          TOGGLE_SETTINGS.map(s => (
            <div
              key={s.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '11px 0',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div style={{ flex: 1, marginRight: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>{s.label}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.description}</div>
              </div>
              <Toggle
                checked={getBoolSetting(s.key)}
                onChange={val => handleToggle(s.key, val)}
              />
            </div>
          ))
        )}
      </Card>

      {/* Section 2: Reminder Timing */}
      <Card title="Reminder Timing">
        {loadingSettings ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '11px 0',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div style={{ flex: 1, marginRight: 16 }}>
                <div style={{ height: 14, width: '55%', borderRadius: 6, background: '#f8fafc', marginBottom: 6 }} />
                <div style={{ height: 11, width: '40%', borderRadius: 6, background: '#fff' }} />
              </div>
              <div style={{ width: 72, height: 34, borderRadius: 7, background: '#f8fafc' }} />
            </div>
          ))
        ) : (
          NUMBER_SETTINGS.map(s => (
            <div
              key={s.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '11px 0',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div style={{ flex: 1, marginRight: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>{s.label}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.description}</div>
              </div>
              <input
                type="number"
                min={1}
                max={365}
                value={getNumSetting(s.key, 7)}
                onChange={e => handleNumberChange(s.key, e.target.value)}
                style={{
                  width: 72,
                  padding: '6px 10px',
                  borderRadius: 7,
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#1a2b3c',
                  fontSize: 14,
                  textAlign: 'center',
                  outline: 'none',
                }}
              />
            </div>
          ))
        )}
      </Card>

      {/* Section 3: Job Controls */}
      <Card title="Manual Job Execution">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { label: '🔄 Run All Jobs',               endpoint: '/compliance/jobs/run-all' },
            { label: '⚠️ Process Expirations',        endpoint: '/compliance/jobs/expire' },
            { label: '📧 Send Due-Soon Reminders',    endpoint: '/compliance/jobs/notify-due-soon' },
            { label: '📤 Process Notification Queue', endpoint: '/compliance/jobs/process-notifications' },
          ].map(job => (
            <div key={job.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: '1 1 180px' }}>
              <button
                onClick={() => runJob(job.label, job.endpoint)}
                disabled={runningJob === job.label}
                style={{
                  width: '100%',
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  background: 'transparent',
                  color: '#1e293b',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: runningJob === job.label ? 'not-allowed' : 'pointer',
                  opacity: runningJob === job.label ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'background 0.15s',
                }}
              >
                {runningJob === job.label && (
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      border: '2px solid #e2e8f0',
                      borderTopColor: '#1565c0',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                      display: 'inline-block',
                    }}
                  />
                )}
                {job.label}
              </button>
            </div>
          ))}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </Card>

      {/* Section 4: Job History */}
      <Card title="Job Execution History">
        {loadingJobs ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</div>
        ) : jobs.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No job history available.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  {['Job Name', 'Status', 'Processed', 'Affected', 'Last Run', 'Duration'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((j, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '9px 10px', color: '#1e293b' }}>{j.job_name}</td>
                    <td style={{ padding: '9px 10px' }}>
                      <span style={{
                        background: `${statusColor[j.status] ?? '#94a3b8'}22`,
                        color: statusColor[j.status] ?? '#94a3b8',
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 500,
                      }}>
                        {j.status}
                      </span>
                    </td>
                    <td style={{ padding: '9px 10px', color: '#374151' }}>{j.records_processed ?? '—'}</td>
                    <td style={{ padding: '9px 10px', color: '#374151' }}>{j.records_affected ?? '—'}</td>
                    <td style={{ padding: '9px 10px', color: '#475569', whiteSpace: 'nowrap' }}>{formatDate(j.started_at)}</td>
                    <td style={{ padding: '9px 10px', color: '#475569' }}>{formatDuration(j.started_at, j.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ToastContainer toasts={toasts} />
    </div>
  );
}
