import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationPrefsApi, NotificationPrefs } from '../../lib/api';
import QueryState from '../../components/QueryState';
import { useToast } from '../../components/ToastHost';

/**
 * Full per-user notification preferences page. Replaces the old
 * "Coming Soon" placeholder. Auto-saves on toggle change with a 600 ms
 * debounce, so users don't have to hunt for a Save button.
 */
export default function NotificationPrefsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => notificationPrefsApi.get(),
    staleTime: 60_000,
  });

  // Local draft — seeded from server, diffs saved back on debounce.
  const [draft, setDraft] = useState<Partial<NotificationPrefs>>({});

  useEffect(() => {
    if (data?.data?.prefs) setDraft(data.data.prefs);
  }, [data?.data?.prefs]);

  const saveMut = useMutation({
    mutationFn: (patch: Partial<NotificationPrefs>) => notificationPrefsApi.save(patch),
    onSuccess: (res) => {
      queryClient.setQueryData(['notification-prefs'], { data: { prefs: res.data.prefs } });
    },
    onError: (e: { response?: { data?: { error?: string } }; message?: string }) => {
      toast.error(e?.response?.data?.error ?? e?.message ?? 'Failed to save preferences');
    },
  });

  // Debounced save — every field change schedules a save in 600 ms, and
  // subsequent changes within that window replace the pending save.
  useEffect(() => {
    if (!data?.data?.prefs) return; // initial load guard
    const handle = window.setTimeout(() => {
      // Only send the fields that actually differ from the server copy.
      const server = data.data.prefs as unknown as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft)) {
        if (v !== undefined && v !== server[k]) patch[k] = v;
      }
      if (Object.keys(patch).length > 0) saveMut.mutate(patch as Partial<NotificationPrefs>);
    }, 600);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const set = <K extends keyof NotificationPrefs>(k: K, v: NotificationPrefs[K]) =>
    setDraft(prev => ({ ...prev, [k]: v }));

  return (
    <div style={{ padding: '24px 32px', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t1)' }}>Notification Preferences</h1>
        <p style={{ fontSize: 13, color: 'var(--t3)', margin: '4px 0 0' }}>
          Control how and when you receive system notifications. Changes save automatically.
          {saveMut.isPending && (
            <span style={{ marginLeft: 8, color: 'var(--pr)', fontWeight: 600 }}>· Saving…</span>
          )}
          {saveMut.isSuccess && !saveMut.isPending && (
            <span style={{ marginLeft: 8, color: 'var(--ac)', fontWeight: 600 }}>· Saved</span>
          )}
        </p>
      </div>

      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Channels ──────────────────────────────────────── */}
          <Card title="Channels" subtitle="Which delivery methods can be used at all">
            <ToggleRow
              label="Email"
              description="Used for digests, contracts to sign, and alert summaries"
              checked={!!draft.email_enabled}
              onChange={v => set('email_enabled', v)}
            />
            <ToggleRow
              label="SMS"
              description="Used for time-sensitive alerts and approval requests. Disabled without ClerkChat configured."
              checked={!!draft.sms_enabled}
              onChange={v => set('sms_enabled', v)}
            />
            <ToggleRow
              label="In-app"
              description="Bell icon in the top bar and the alerts list on the dashboard"
              checked={!!draft.inapp_enabled}
              onChange={v => set('inapp_enabled', v)}
              last
            />
          </Card>

          {/* ── Categories ────────────────────────────────────── */}
          <Card title="Categories" subtitle="Fine-grained control over what you're notified about">
            <ToggleRow
              label="Credential expirations"
              description="Staff credential / license expiring within 30 days"
              checked={!!draft.notify_credential_expiry}
              onChange={v => set('notify_credential_expiry', v)}
            />
            <ToggleRow
              label="Missing documents"
              description="Candidate or staff missing a required document for placement"
              checked={!!draft.notify_missing_document}
              onChange={v => set('notify_missing_document', v)}
            />
            <ToggleRow
              label="Compliance assignments"
              description="New policies, exams, or bundles assigned to you"
              checked={!!draft.notify_compliance_assign}
              onChange={v => set('notify_compliance_assign', v)}
            />
            <ToggleRow
              label="Placement changes"
              description="A candidate is placed, a placement status changes, or a contract is signed"
              checked={!!draft.notify_placement_change}
              onChange={v => set('notify_placement_change', v)}
            />
            <ToggleRow
              label="Task reminders"
              description="Recruiter tasks that are due or overdue"
              checked={!!draft.notify_task_reminder}
              onChange={v => set('notify_task_reminder', v)}
            />
            <ToggleRow
              label="Submission updates"
              description="Candidate submissions change stage (interview → offer → placed, etc.)"
              checked={!!draft.notify_submission_update}
              onChange={v => set('notify_submission_update', v)}
            />
            <ToggleRow
              label="SMS approval requests"
              description="Outbound SMS needing a supervisor approval before sending"
              checked={!!draft.notify_sms_approval}
              onChange={v => set('notify_sms_approval', v)}
            />
            <ToggleRow
              label="System announcements"
              description="Product updates, new features, scheduled maintenance"
              checked={!!draft.notify_system_announcement}
              onChange={v => set('notify_system_announcement', v)}
              last
            />
          </Card>

          {/* ── Digest schedule ───────────────────────────────── */}
          <Card title="Digest" subtitle="Summary email schedule. Doesn't affect time-sensitive alerts.">
            <div style={rowStyle}>
              <div style={labelBlock}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Schedule</div>
                <div style={{ fontSize: 12, color: 'var(--t3)' }}>Pick how often you want a roll-up email</div>
              </div>
              <select
                value={draft.digest_schedule ?? 'daily'}
                onChange={e => set('digest_schedule', e.target.value as NotificationPrefs['digest_schedule'])}
                style={inputStyle}
              >
                <option value="off">Off</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            {(draft.digest_schedule ?? 'daily') !== 'off' && (
              <div style={{ ...rowStyle, borderBottom: 'none' }}>
                <div style={labelBlock}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Delivery time</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)' }}>What time of day to send the digest (your local time)</div>
                </div>
                <input
                  type="time"
                  value={(draft.digest_time_of_day ?? '08:00').slice(0, 5)}
                  onChange={e => set('digest_time_of_day', e.target.value + ':00')}
                  style={inputStyle}
                />
              </div>
            )}
          </Card>

          {/* ── Quiet hours ───────────────────────────────────── */}
          <Card title="Quiet hours" subtitle="Pause non-urgent notifications during a time window. Urgent items always fire.">
            <ToggleRow
              label="Enable quiet hours"
              description="Defer non-urgent emails and SMS until quiet hours end"
              checked={!!draft.quiet_hours_enabled}
              onChange={v => set('quiet_hours_enabled', v)}
              last={!draft.quiet_hours_enabled}
            />
            {draft.quiet_hours_enabled && (
              <div style={{ display: 'flex', gap: 16, padding: '12px 0' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Start</div>
                  <input
                    type="time"
                    value={(draft.quiet_start ?? '22:00').slice(0, 5)}
                    onChange={e => set('quiet_start', e.target.value + ':00')}
                    style={{ ...inputStyle, width: '100%' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>End</div>
                  <input
                    type="time"
                    value={(draft.quiet_end ?? '07:00').slice(0, 5)}
                    onChange={e => set('quiet_end', e.target.value + ':00')}
                    style={{ ...inputStyle, width: '100%' }}
                  />
                </div>
              </div>
            )}
          </Card>
        </div>
      </QueryState>
    </div>
  );
}

// ─── UI bits ────────────────────────────────────────────────────────────────
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)', padding: 20 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ToggleRow({
  label, description, checked, onChange, last,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <div style={{ ...rowStyle, borderBottom: last ? 'none' : '1px solid var(--sf3)' }}>
      <div style={labelBlock}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{description}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 36, height: 20,
        borderRadius: 10,
        border: 'none',
        background: checked ? 'var(--pr)' : '#cbd5e1',
        cursor: 'pointer',
        transition: 'background 0.15s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16, height: 16,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 0',
  borderBottom: '1px solid var(--sf3)',
  gap: 16,
};
const labelBlock: React.CSSProperties = { flex: 1, minWidth: 0 };
const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--bd)',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--sf)',
  outline: 'none',
  minWidth: 100,
};
