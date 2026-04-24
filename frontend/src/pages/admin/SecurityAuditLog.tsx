/**
 * Security Audit Log — viewer for the backend audit logs.
 *
 * Two tabs:
 *   - Events: general security_audit_log (permission changes, role
 *     assignments, denials, simulation sessions)
 *   - AI: ai_security_log (AI queries, denials, prompt injection blocks,
 *     topic detection)
 *
 * Top strip shows 24h stats. Filter by user, action, outcome, date.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rbacApi, SecurityEvent, AISecurityEvent } from '../../lib/rbacApi';
import { useToast } from '../../components/ToastHost';

type Tab = 'events' | 'ai';

export default function SecurityAuditLog() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('events');
  const [stats, setStats] = useState<{ permission_denials_24h: number; ai_denials_24h: number; prompt_injections_blocked_24h: number; top_denial_users_7d: any[] } | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [aiEvents, setAIEvents] = useState<AISecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState('');
  const [action, setAction] = useState('');

  const loadStats = useCallback(async () => {
    try {
      const r = await rbacApi.stats();
      setStats(r.data);
    } catch { /* silent */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'events') {
        const params: Record<string, string> = { limit: '200' };
        if (outcome) params.outcome = outcome;
        if (action) params.action = action;
        const r = await rbacApi.listSecurityEvents(params);
        setEvents(r.data.events);
      } else {
        const params: Record<string, string> = { limit: '200' };
        if (outcome) params.outcome = outcome;
        const r = await rbacApi.listAIEvents(params);
        setAIEvents(r.data.events);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to load audit log');
    } finally { setLoading(false); }
  }, [tab, outcome, action, toast]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>🔒 Security Audit Log</h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>Every permission-sensitive event is logged here — append-only, non-editable.</p>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
          <StatCard label="Permission denials (24h)" value={stats.permission_denials_24h} color="#c62828" />
          <StatCard label="AI denials (24h)" value={stats.ai_denials_24h} color="#e65100" />
          <StatCard label="Prompt injections blocked (24h)" value={stats.prompt_injections_blocked_24h} color="#7c2d12" />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 10, borderBottom: '2px solid #e2e8f0' }}>
        {(['events', 'ai'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 18px', background: 'transparent', border: 'none',
              borderBottom: `3px solid ${tab === t ? '#6d28d9' : 'transparent'}`,
              color: tab === t ? '#6d28d9' : '#64748b',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              marginBottom: -2,
            }}
          >
            {t === 'events' ? 'Security events' : 'AI security events'}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <select value={outcome} onChange={e => setOutcome(e.target.value)} style={filter}>
          <option value="">All outcomes</option>
          <option value="allowed">Allowed</option>
          <option value="denied">Denied</option>
          {tab === 'ai' && <option value="injection_blocked">Injection blocked</option>}
          <option value="error">Error</option>
        </select>
        {tab === 'events' && (
          <select value={action} onChange={e => setAction(e.target.value)} style={filter}>
            <option value="">All actions</option>
            <option value="permission.denied">permission.denied</option>
            <option value="role.assigned">role.assigned</option>
            <option value="role.removed">role.removed</option>
            <option value="role.created">role.created</option>
            <option value="role.edited">role.edited</option>
            <option value="role.deleted">role.deleted</option>
            <option value="override.granted">override.granted</option>
            <option value="override.revoked">override.revoked</option>
            <option value="simulation.started">simulation.started</option>
            <option value="simulation.ended">simulation.ended</option>
          </select>
        )}
        <button onClick={() => load()} style={ghostBtn}>Refresh</button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>
      ) : tab === 'events' ? (
        <EventTable events={events} />
      ) : (
        <AIEventTable events={aiEvents} />
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function EventTable({ events }: { events: SecurityEvent[] }) {
  if (events.length === 0) return <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>No events match these filters.</div>;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
            <th style={th}>When</th>
            <th style={th}>User</th>
            <th style={th}>Action</th>
            <th style={th}>Permission</th>
            <th style={th}>Outcome</th>
            <th style={th}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {events.map(e => (
            <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={td}>{new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
              <td style={td}>{e.user_name ?? e.user_email ?? <span style={{ color: '#94a3b8' }}>—</span>}</td>
              <td style={td}><code style={codeTag}>{e.action}</code></td>
              <td style={td}>{e.permission_key ? <code style={codeTag}>{e.permission_key}</code> : <span style={{ color: '#94a3b8' }}>—</span>}</td>
              <td style={td}><OutcomeBadge outcome={e.outcome} /></td>
              <td style={{ ...td, color: '#475569' }}>{e.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AIEventTable({ events }: { events: AISecurityEvent[] }) {
  if (events.length === 0) return <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>No AI events match these filters.</div>;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
            <th style={th}>When</th>
            <th style={th}>User</th>
            <th style={th}>Tool</th>
            <th style={th}>Prompt</th>
            <th style={th}>Topics</th>
            <th style={th}>Outcome</th>
            <th style={th}>Flags</th>
          </tr>
        </thead>
        <tbody>
          {events.map(e => (
            <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={td}>{new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
              <td style={td}>{e.user_name ?? e.user_email ?? <span style={{ color: '#94a3b8' }}>—</span>}</td>
              <td style={td}><code style={codeTag}>{e.tool}</code></td>
              <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.prompt_summary ?? ''}>
                {e.prompt_summary ?? <span style={{ color: '#94a3b8' }}>—</span>}
              </td>
              <td style={td}>
                {(e.detected_topics ?? []).map(t => (
                  <code key={t} style={{ ...codeTag, marginRight: 4 }}>{t}</code>
                ))}
              </td>
              <td style={td}><OutcomeBadge outcome={e.outcome} /></td>
              <td style={td}>
                {(e.injection_flags ?? []).map(f => (
                  <code key={f} style={{ ...codeTag, background: '#fee2e2', color: '#991b1b', marginRight: 4 }}>{f}</code>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    allowed:            { bg: '#dcfce7', color: '#166534' },
    denied:             { bg: '#fee2e2', color: '#991b1b' },
    injection_blocked:  { bg: '#fef2f2', color: '#7f1d1d' },
    partial:            { bg: '#fef3c7', color: '#b45309' },
    error:              { bg: '#f1f5f9', color: '#475569' },
  };
  const s = map[outcome] ?? map.error;
  return (
    <span style={{ fontSize: 10, padding: '2px 8px', background: s.bg, color: s.color, borderRadius: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{outcome.replace('_', ' ')}</span>
  );
}

const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 700, color: '#334155' };
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'top' };
const codeTag: React.CSSProperties = { fontSize: 10, padding: '1px 5px', background: '#f1f5f9', color: '#334155', borderRadius: 3, fontFamily: 'monospace' };
const filter: React.CSSProperties = { padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '7px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer' };
