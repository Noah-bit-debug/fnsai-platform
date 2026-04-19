import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Integration {
  id: string;
  name: string;
  type: 'quickbooks' | 'onedrive' | 'teams' | 'outlook' | 'sharepoint' | 'custom';
  status: 'connected' | 'syncing' | 'error' | 'disconnected';
  sync_frequency?: string;
  last_synced_at?: string;
  error_message?: string;
  item_count?: number;
  created_at: string;
}

interface SyncLog {
  id: string;
  integration_id: string;
  status: 'success' | 'error' | 'partial';
  message: string;
  records_synced?: number;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPE_META: Record<string, { icon: string; label: string; description: string; color: string }> = {
  quickbooks: { icon: '💹', label: 'QuickBooks', description: 'Accounting, Billing & Payroll', color: '#2ca01c' },
  onedrive:   { icon: '🗂️',  label: 'OneDrive',   description: 'File Storage & Document Sync',  color: '#0078d4' },
  teams:      { icon: '💬',  label: 'Teams',       description: 'Team Messaging & Meetings',     color: '#5b5fc7' },
  outlook:    { icon: '📧',  label: 'Outlook',     description: 'Email & Calendar Integration',  color: '#0072c6' },
  sharepoint: { icon: '📋',  label: 'SharePoint',  description: 'Document Management & Portals', color: '#038387' },
  custom:     { icon: '🔧',  label: 'Custom',      description: 'Custom API Integration',        color: '#7c3aed' },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  connected:    { label: 'Connected',    color: '#166534', bg: '#dcfce7' },
  syncing:      { label: 'Syncing',      color: '#854d0e', bg: '#fef9c3' },
  error:        { label: 'Error',        color: '#991b1b', bg: '#fee2e2' },
  disconnected: { label: 'Disconnected', color: '#374151', bg: '#f1f5f9' },
};

const HEALTH_COLORS: Record<string, string> = {
  connected: '#22c55e',
  syncing:   '#f59e0b',
  error:     '#ef4444',
  disconnected: '#d1d5db',
};

const FREQ_OPTIONS = [
  { value: '15min',  label: 'Every 15 minutes' },
  { value: '1hour',  label: 'Every hour' },
  { value: '6hours', label: 'Every 6 hours' },
  { value: 'daily',  label: 'Once a day' },
  { value: 'manual', label: 'Manual only' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d?: string) {
  if (!d) return 'Never';
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

function inp(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%', padding: '9px 14px', border: '1px solid #e8edf2',
    borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c',
    boxSizing: 'border-box', background: '#fff', ...extra,
  };
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 2000,
      background: type === 'success' ? '#166534' : '#991b1b',
      color: '#fff', borderRadius: 10, padding: '12px 20px',
      fontSize: 14, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', gap: 10, maxWidth: 360,
    }}>
      <span>{type === 'success' ? '✅' : '❌'}</span>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: '#374151', bg: '#f1f5f9' };
  return (
    <span style={{
      background: m.bg, color: m.color, borderRadius: 8, padding: '3px 10px',
      fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {m.label}
    </span>
  );
}

// ─── Health Bar ───────────────────────────────────────────────────────────────
function HealthBar({ status }: { status: string }) {
  const pct = status === 'connected' ? 100 : status === 'syncing' ? 65 : status === 'error' ? 20 : 0;
  const color = HEALTH_COLORS[status] ?? '#d1d5db';
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Connection Health</span>
        <span style={{ fontSize: 11, color, fontWeight: 700 }}>{pct}%</span>
      </div>
      <div style={{ height: 5, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

// ─── Connect Modal ────────────────────────────────────────────────────────────
function ConnectModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [form, setForm] = useState({ type: 'quickbooks', name: '', sync_frequency: '1hour' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    setSaving(true);
    setErr(null);
    try {
      await api.post('/integrations', { ...form, name: form.name.trim() });
      onConnected();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to connect integration.');
    } finally {
      setSaving(false);
    }
  };

  const meta = TYPE_META[form.type];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>Connect Integration</div>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>Link an external service to sync data automatically.</p>

        {/* Type selector */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Integration Type</label>
          <select style={inp()} value={form.type} onChange={set('type')}>
            {Object.entries(TYPE_META).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
        </div>

        {/* Preview card */}
        <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 32 }}>{meta.icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1a2b3c' }}>{meta.label}</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{meta.description}</div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Connection Name *</label>
          <input style={inp()} value={form.name} onChange={set('name')} placeholder={`e.g. ${meta.label} – Main`} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Sync Frequency</label>
          <select style={inp()} value={form.sync_frequency} onChange={set('sync_frequency')}>
            {FREQ_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {err && <div style={{ color: '#991b1b', fontSize: 13, marginBottom: 12, background: '#fee2e2', borderRadius: 8, padding: '8px 12px' }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Connecting...' : '🔌 Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sync Logs Panel ──────────────────────────────────────────────────────────
function SyncLogsPanel({ integrationId, name }: { integrationId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['integration-logs', integrationId],
    queryFn: () => api.get<{ logs: SyncLog[] }>(`/integrations/${integrationId}/logs`),
    enabled: open,
  });
  const logs: SyncLog[] = data?.data?.logs ?? [];

  const logColor = (s: string) =>
    s === 'success' ? '#166534' : s === 'error' ? '#991b1b' : '#854d0e';
  const logBg = (s: string) =>
    s === 'success' ? '#dcfce7' : s === 'error' ? '#fee2e2' : '#fef9c3';

  return (
    <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 12, paddingTop: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#64748b', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
        Sync Logs
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {isLoading ? (
            <div style={{ fontSize: 12, color: '#64748b', padding: '4px 0' }}>Loading logs...</div>
          ) : logs.length === 0 ? (
            <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>No sync logs yet for {name}.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {logs.slice(0, 5).map((log) => (
                <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12 }}>
                  <span style={{ background: logBg(log.status), color: logColor(log.status), borderRadius: 6, padding: '2px 7px', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {log.status}
                  </span>
                  <span style={{ color: '#374151', flex: 1 }}>{log.message}</span>
                  <span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(log.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Integration Card ─────────────────────────────────────────────────────────
function IntegrationCard({
  integration,
  onSync,
  onDisconnect,
  syncing,
}: {
  integration: Integration;
  onSync: (id: string) => void;
  onDisconnect: (id: string, name: string) => void;
  syncing: boolean;
}) {
  const meta = TYPE_META[integration.type] ?? TYPE_META.custom;
  const isQB = integration.type === 'quickbooks';

  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      border: isQB ? `2px solid ${meta.color}` : '1px solid #e8edf2',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      boxShadow: isQB ? `0 4px 20px ${meta.color}22` : '0 1px 4px rgba(0,0,0,0.04)',
      position: 'relative',
      transition: 'box-shadow 0.2s',
    }}>
      {isQB && (
        <div style={{ position: 'absolute', top: 12, right: 12, background: meta.color, color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
          Recommended
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: `${meta.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, flexShrink: 0,
        }}>
          {meta.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1a2b3c', marginBottom: 2 }}>{integration.name}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{meta.description}</div>
          <Badge status={integration.status} />
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#64748b', marginBottom: 4 }}>
        <span>🔄 Last sync: <strong style={{ color: '#374151' }}>{fmtDate(integration.last_synced_at)}</strong></span>
        {integration.item_count != null && (
          <span>📦 Items: <strong style={{ color: '#374151' }}>{integration.item_count.toLocaleString()}</strong></span>
        )}
      </div>

      {integration.error_message && (
        <div style={{ background: '#fee2e2', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: '#991b1b', marginTop: 6, marginBottom: 4 }}>
          ⚠️ {integration.error_message}
        </div>
      )}

      <HealthBar status={integration.status} />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          onClick={() => onSync(integration.id)}
          disabled={syncing || integration.status === 'disconnected'}
          style={{
            flex: 1, background: '#eff6ff', color: '#1565c0', border: 'none', borderRadius: 8,
            padding: '7px 0', cursor: (syncing || integration.status === 'disconnected') ? 'not-allowed' : 'pointer',
            fontWeight: 600, fontSize: 13, opacity: (syncing || integration.status === 'disconnected') ? 0.6 : 1,
            transition: 'opacity 0.2s',
          }}
        >
          {syncing ? '⏳ Syncing...' : '🔄 Sync Now'}
        </button>
        <button
          onClick={() => onDisconnect(integration.id, integration.name)}
          style={{
            flex: 1, background: '#fef2f2', color: '#c62828', border: 'none', borderRadius: 8,
            padding: '7px 0', cursor: 'pointer', fontWeight: 600, fontSize: 13,
          }}
        >
          ✖ Disconnect
        </button>
      </div>

      <SyncLogsPanel integrationId={integration.id} name={integration.name} />
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', padding: '56px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 44, marginBottom: 14 }}>🔌</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>No integrations connected yet</div>
      <p style={{ fontSize: 14, color: '#64748b', maxWidth: 400, margin: '0 auto 24px' }}>
        Connect your tools to sync data automatically and keep everything in one place.
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 28 }}>
        {Object.values(TYPE_META).map((m) => (
          <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#374151' }}>
            <span style={{ fontSize: 18 }}>{m.icon}</span> {m.label}
          </div>
        ))}
      </div>
      <button
        onClick={onConnect}
        style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}
      >
        + Connect Your First Integration
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Integrations() {
  const queryClient = useQueryClient();
  const [showConnect, setShowConnect] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.get<{ integrations: Integration[] }>('/integrations'),
    refetchInterval: 30000,
  });

  const integrations: Integration[] = data?.data?.integrations ?? [];

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/integrations/${id}/sync`),
    onMutate: (id) => setSyncingId(id),
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      queryClient.invalidateQueries({ queryKey: ['integration-logs', id] });
      showToast('Sync triggered successfully.');
      setSyncingId(null);
    },
    onError: (e: any) => {
      showToast(e?.response?.data?.error ?? 'Sync failed.', 'error');
      setSyncingId(null);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/integrations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      showToast('Integration disconnected.');
    },
    onError: (e: any) => showToast(e?.response?.data?.error ?? 'Failed to disconnect.', 'error'),
  });

  const handleDisconnect = (id: string, name: string) => {
    if (!confirm(`Disconnect "${name}"? This will stop all syncing.`)) return;
    disconnectMutation.mutate(id);
  };

  const stats = {
    total:     integrations.length,
    connected: integrations.filter((i) => i.status === 'connected' || i.status === 'syncing').length,
    errors:    integrations.filter((i) => i.status === 'error').length,
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>🔌 Integrations</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Manage connected services and data sync</p>
          </div>
          <button
            onClick={() => setShowConnect(true)}
            style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
          >
            + Connect Integration
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Integrations', value: stats.total,     color: '#1565c0', icon: '🔌' },
          { label: 'Connected',          value: stats.connected, color: '#166534', icon: '✅' },
          { label: 'Sync Errors',        value: stats.errors,    color: '#991b1b', icon: '⚠️' },
        ].map(({ label, value, color, icon }) => (
          <div key={label} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 28 }}>{icon}</div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600, marginTop: 3 }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        // Skeleton cards — match the real card grid so layout doesn't jump
        // when data arrives.
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 18 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                background: '#fff',
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                padding: 18,
                minHeight: 140,
                animation: 'skeleton-pulse 1.2s ease-in-out infinite',
                opacity: 0.6,
              }}
            >
              <div style={{ height: 18, width: '55%', background: '#e2e8f0', borderRadius: 4, marginBottom: 12 }} />
              <div style={{ height: 12, width: '90%', background: '#f1f5f9', borderRadius: 4, marginBottom: 6 }} />
              <div style={{ height: 12, width: '70%', background: '#f1f5f9', borderRadius: 4 }} />
            </div>
          ))}
          <style>{`@keyframes skeleton-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.85; } }`}</style>
        </div>
      ) : integrations.length === 0 ? (
        <EmptyState onConnect={() => setShowConnect(true)} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 18 }}>
          {integrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              onSync={(id) => syncMutation.mutate(id)}
              onDisconnect={handleDisconnect}
              syncing={syncingId === integration.id}
            />
          ))}
        </div>
      )}

      {showConnect && (
        <ConnectModal
          onClose={() => setShowConnect(false)}
          onConnected={() => queryClient.invalidateQueries({ queryKey: ['integrations'] })}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
