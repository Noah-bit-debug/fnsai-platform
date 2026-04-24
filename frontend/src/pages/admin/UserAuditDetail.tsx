/**
 * Per-user audit drill-down page.
 *
 * Route: /settings/audit-log/user/:userId
 *
 * Shows everything a specific user did across security + AI logs,
 * merged chronologically. Useful for:
 *   - Security investigations ("what did this user do last week?")
 *   - HR disputes ("prove they accessed that file")
 *   - Access certifications ("show management this user's activity")
 *
 * Data comes from the existing /security-audit/events + /ai-events
 * endpoints, filtered to a single user_id.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { rbacApi, SecurityEvent, AISecurityEvent } from '../../lib/rbacApi';
import { usersApi, OrgUser } from '../../lib/api';
import { useToast } from '../../components/ToastHost';

type MergedEvent =
  | ({ kind: 'security' } & SecurityEvent)
  | ({ kind: 'ai' } & AISecurityEvent);

export default function UserAuditDetail() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [user, setUser] = useState<OrgUser | null>(null);
  const [security, setSecurity] = useState<SecurityEvent[]>([]);
  const [ai, setAI] = useState<AISecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [daysBack, setDaysBack] = useState(30);
  const [outcomeFilter, setOutcomeFilter] = useState<string>('');

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const since = new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString();

      const [uRes, sRes, aRes] = await Promise.all([
        usersApi.list().then(r => r.data.users.find(u => u.id === userId) ?? null).catch(() => null),
        rbacApi.listSecurityEvents({ user_id: userId, from: since, limit: '500', ...(outcomeFilter ? { outcome: outcomeFilter } : {}) }),
        rbacApi.listAIEvents({ user_id: userId, from: since, limit: '500', ...(outcomeFilter ? { outcome: outcomeFilter } : {}) }),
      ]);
      setUser(uRes);
      setSecurity(sRes.data.events);
      setAI(aRes.data.events);
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to load audit detail');
    } finally {
      setLoading(false);
    }
  }, [userId, daysBack, outcomeFilter, toast]);

  useEffect(() => { void load(); }, [load]);

  // Merge both log types into one chronological timeline
  const timeline = useMemo<MergedEvent[]>(() => {
    const merged: MergedEvent[] = [
      ...security.map(e => ({ ...e, kind: 'security' as const })),
      ...ai.map(e => ({ ...e, kind: 'ai' as const })),
    ];
    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return merged;
  }, [security, ai]);

  const stats = useMemo(() => ({
    totalEvents: timeline.length,
    securityCount: security.length,
    aiCount: ai.length,
    denials: timeline.filter(e => e.outcome === 'denied').length,
    injectionsBlocked: ai.filter(e => e.outcome === 'injection_blocked').length,
  }), [timeline, security, ai]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading user audit timeline…</div>;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 14, fontSize: 13 }}>
        <Link to="/settings/audit-log" style={{ color: '#6d28d9', textDecoration: 'none' }}>← Security Audit Log</Link>
        <span style={{ color: '#cbd5e1', margin: '0 8px' }}>/</span>
        <span style={{ color: '#64748b' }}>User timeline</span>
      </div>

      {/* User header */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#1a2b3c' }}>
          {user ? user.name ?? user.email : <span style={{ color: '#94a3b8' }}>Unknown user</span>}
        </h1>
        {user && (
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
            {user.email} · <strong style={{ color: '#334155', textTransform: 'uppercase', letterSpacing: 0.5 }}>{user.role}</strong>
          </p>
        )}
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button
            onClick={() => navigate(`/settings/user-access?user=${userId}`)}
            style={{ padding: '6px 12px', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Manage access
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
        <Stat label={`Total (${daysBack}d)`} value={stats.totalEvents} color="#475569" />
        <Stat label="Security events" value={stats.securityCount} color="#1565c0" />
        <Stat label="AI events" value={stats.aiCount} color="#6d28d9" />
        <Stat label="Denials" value={stats.denials} color="#991b1b" />
        <Stat label="Injections blocked" value={stats.injectionsBlocked} color="#7f1d1d" />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <select value={daysBack} onChange={e => setDaysBack(Number(e.target.value))} style={filter}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
        <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)} style={filter}>
          <option value="">All outcomes</option>
          <option value="allowed">Allowed</option>
          <option value="denied">Denied</option>
          <option value="injection_blocked">Injection blocked</option>
        </select>
      </div>

      {/* Timeline */}
      {timeline.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
          No activity in this time window.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {timeline.map(e => <TimelineRow key={`${e.kind}-${e.id}`} event={e} />)}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function TimelineRow({ event }: { event: MergedEvent }) {
  const isAI = event.kind === 'ai';
  const outcomeColor =
    event.outcome === 'allowed' ? { bg: '#dcfce7', fg: '#166534' }
    : event.outcome === 'denied' ? { bg: '#fee2e2', fg: '#991b1b' }
    : event.outcome === 'injection_blocked' ? { bg: '#fef2f2', fg: '#7f1d1d' }
    : { bg: '#f1f5f9', fg: '#475569' };

  const when = new Date(event.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
      padding: '10px 14px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, padding: '3px 8px',
        borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.4,
        background: isAI ? '#ede9fe' : '#dbeafe',
        color: isAI ? '#6d28d9' : '#1e40af',
        whiteSpace: 'nowrap', marginTop: 2,
      }}>
        {isAI ? '🤖 AI' : '🔒 Security'}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>
            {isAI ? (event as AISecurityEvent).tool : (event as SecurityEvent).action}
          </span>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.4,
            background: outcomeColor.bg, color: outcomeColor.fg,
          }}>
            {event.outcome.replace('_', ' ')}
          </span>
          {isAI && (event as AISecurityEvent).injection_flags?.length ? (
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700, background: '#fee2e2', color: '#991b1b' }}>
              {(event as AISecurityEvent).injection_flags!.join(', ')}
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
          {when}
          {!isAI && (event as SecurityEvent).permission_key && (
            <> · <code style={codeTag}>{(event as SecurityEvent).permission_key}</code></>
          )}
          {!isAI && (event as SecurityEvent).reason && (
            <> · <span>{(event as SecurityEvent).reason}</span></>
          )}
          {isAI && (event as AISecurityEvent).prompt_summary && (
            <> · "<span style={{ fontStyle: 'italic' }}>{(event as AISecurityEvent).prompt_summary}</span>"</>
          )}
        </div>
      </div>
    </div>
  );
}

const filter: React.CSSProperties = { padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' };
const codeTag: React.CSSProperties = { fontSize: 10, padding: '1px 5px', background: '#f1f5f9', color: '#334155', borderRadius: 3, fontFamily: 'monospace' };
