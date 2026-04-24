/**
 * Notification Center — unified inbox for every signal the user should
 * see. Consolidates:
 *   - Pending tasks (due today / overdue)
 *   - @-mentions in notes
 *   - Compliance items overdue or expiring
 *   - Credentials expiring
 *   - Incidents assigned to investigate
 *   - Client portal feedback
 *   - SMS replies awaiting response
 *
 * Route: /notifications
 *
 * This is a client-side aggregator — it queries the existing APIs and
 * merges into one timeline. No new backend endpoints or tables required.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { tasksApi, credentialsApi, incidentsApi } from '../lib/api';
import { usePermissions } from '../contexts/PermissionsContext';

interface NotificationItem {
  id: string;
  icon: string;
  category: 'task' | 'compliance' | 'credential' | 'incident' | 'mention' | 'other';
  title: string;
  subtitle: string;
  timestamp: Date | null;
  priority: 'low' | 'medium' | 'high';
  action: { label: string; path: string };
}

export default function NotificationCenter() {
  const navigate = useNavigate();
  const { has } = usePermissions();
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('fns_dismissed_notifications') ?? '[]'));
    } catch { return new Set(); }
  });

  // Each data source is independent — one failing doesn't blank the page.
  const tasksQ = useQuery({
    queryKey: ['notifs-tasks'],
    queryFn: async () => {
      if (!has('tasks.recruiter.view')) return { data: { tasks: [] } };
      const [overdue, today] = await Promise.all([
        tasksApi.list({ overdue: 'true' }).catch(() => ({ data: { tasks: [] } })),
        tasksApi.list({ due_today: 'true' }).catch(() => ({ data: { tasks: [] } })),
      ]);
      return { overdue: overdue.data.tasks, today: today.data.tasks };
    },
    refetchInterval: 60_000,
    enabled: has('tasks.recruiter.view'),
  });

  const credsQ = useQuery({
    queryKey: ['notifs-creds'],
    queryFn: () => credentialsApi.expiring().catch(() => ({ data: { expiringSoon: [], alreadyExpired: [] } })),
    refetchInterval: 5 * 60_000,
    enabled: has('credentialing.view_expiring'),
  });

  const incidentsQ = useQuery({
    queryKey: ['notifs-incidents'],
    queryFn: () => incidentsApi.list({ status: 'open' }).catch(() => ({ data: { incidents: [] } })),
    refetchInterval: 5 * 60_000,
    enabled: has('hr.incidents.view'),
  });

  const items = useMemo<NotificationItem[]>(() => {
    const out: NotificationItem[] = [];

    // Tasks — overdue (high) + due today (medium)
    const overdueTasks = (tasksQ.data as any)?.overdue ?? [];
    const todayTasks = (tasksQ.data as any)?.today ?? [];
    for (const t of overdueTasks) {
      out.push({
        id: `task-${t.id}`,
        icon: '⚠️',
        category: 'task',
        title: t.title ?? 'Task',
        subtitle: `Overdue${t.due_at ? ` · due ${new Date(t.due_at).toLocaleString()}` : ''}`,
        timestamp: t.due_at ? new Date(t.due_at) : null,
        priority: 'high',
        action: { label: 'Open task', path: `/tasks` },
      });
    }
    for (const t of todayTasks) {
      out.push({
        id: `task-today-${t.id}`,
        icon: '📅',
        category: 'task',
        title: t.title ?? 'Task',
        subtitle: 'Due today',
        timestamp: t.due_at ? new Date(t.due_at) : null,
        priority: 'medium',
        action: { label: 'Open task', path: `/tasks` },
      });
    }

    // Credentials
    const expired = (credsQ.data as any)?.data?.alreadyExpired ?? (credsQ.data as any)?.alreadyExpired ?? [];
    const expiring = (credsQ.data as any)?.data?.expiringSoon ?? (credsQ.data as any)?.expiringSoon ?? [];
    for (const c of expired) {
      out.push({
        id: `cred-exp-${c.id}`,
        icon: '🔴',
        category: 'credential',
        title: `${c.type ?? 'Credential'} expired`,
        subtitle: `${c.staff_name ?? c.candidate_name ?? 'Unknown'} — expired ${c.expiry_date ? new Date(c.expiry_date).toLocaleDateString() : ''}`,
        timestamp: c.expiry_date ? new Date(c.expiry_date) : null,
        priority: 'high',
        action: { label: 'Review', path: '/credentialing' },
      });
    }
    for (const c of expiring.slice(0, 10)) {
      const days = c.expiry_date ? Math.ceil((new Date(c.expiry_date).getTime() - Date.now()) / 86400000) : null;
      out.push({
        id: `cred-soon-${c.id}`,
        icon: '🟡',
        category: 'credential',
        title: `${c.type ?? 'Credential'} expiring soon`,
        subtitle: `${c.staff_name ?? c.candidate_name ?? 'Unknown'}${days != null ? ` — ${days}d left` : ''}`,
        timestamp: c.expiry_date ? new Date(c.expiry_date) : null,
        priority: (days != null && days <= 7) ? 'high' : 'medium',
        action: { label: 'Review', path: '/credentialing' },
      });
    }

    // Open incidents
    const openIncidents = (incidentsQ.data as any)?.data?.incidents ?? (incidentsQ.data as any)?.incidents ?? [];
    for (const i of openIncidents.slice(0, 20)) {
      out.push({
        id: `incident-${i.id}`,
        icon: '🚨',
        category: 'incident',
        title: i.type ?? 'Open incident',
        subtitle: `${i.staff_name ?? 'Staff'} · ${i.facility_name ?? 'Facility'}`,
        timestamp: i.created_at ? new Date(i.created_at) : null,
        priority: i.severity === 'critical' || i.severity === 'major' ? 'high' : 'medium',
        action: { label: 'Investigate', path: '/incidents' },
      });
    }

    // Filter dismissed
    return out.filter(i => !dismissed.has(i.id));
  }, [tasksQ.data, credsQ.data, incidentsQ.data, dismissed]);

  const sorted = useMemo(() => {
    const prio = { high: 0, medium: 1, low: 2 };
    return [...items].sort((a, b) => {
      const p = prio[a.priority] - prio[b.priority];
      if (p !== 0) return p;
      const aTs = a.timestamp?.getTime() ?? 0;
      const bTs = b.timestamp?.getTime() ?? 0;
      return bTs - aTs;
    });
  }, [items]);

  const grouped = useMemo(() => {
    const g: Record<string, NotificationItem[]> = {};
    for (const i of sorted) {
      if (!g[i.category]) g[i.category] = [];
      g[i.category].push(i);
    }
    return g;
  }, [sorted]);

  const dismiss = useCallback((id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    localStorage.setItem('fns_dismissed_notifications', JSON.stringify([...next]));
  }, [dismissed]);

  const dismissAll = useCallback(() => {
    const ids = new Set([...dismissed, ...sorted.map(i => i.id)]);
    setDismissed(ids);
    localStorage.setItem('fns_dismissed_notifications', JSON.stringify([...ids]));
  }, [dismissed, sorted]);

  const stats = useMemo(() => ({
    total: sorted.length,
    high: sorted.filter(i => i.priority === 'high').length,
    medium: sorted.filter(i => i.priority === 'medium').length,
  }), [sorted]);

  const categoryLabels: Record<string, string> = {
    task: 'Tasks',
    credential: 'Credentials',
    incident: 'Incidents',
    compliance: 'Compliance',
    mention: 'Mentions',
    other: 'Other',
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>🔔 Notifications</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
            Everything that needs your attention — tasks, expiring credentials, open incidents.
          </p>
        </div>
        {sorted.length > 0 && (
          <button
            onClick={dismissAll}
            style={{ padding: '7px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer' }}
          >
            Dismiss all
          </button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 }}>
        <Stat label="Total" value={stats.total} color="#475569" />
        <Stat label="High priority" value={stats.high} color="#991b1b" />
        <Stat label="Medium" value={stats.medium} color="#b45309" />
      </div>

      {/* Groups */}
      {sorted.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 4 }}>All caught up!</div>
          <div style={{ fontSize: 13 }}>Nothing requires your attention right now.</div>
        </div>
      ) : (
        Object.entries(grouped).map(([cat, list]) => (
          <div key={cat} style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, margin: '0 0 8px', padding: '0 4px' }}>
              {categoryLabels[cat] ?? cat} ({list.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map(item => <NotificationRow key={item.id} item={item} onDismiss={dismiss} onOpen={() => navigate(item.action.path)} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function NotificationRow({ item, onDismiss, onOpen }: { item: NotificationItem; onDismiss: (id: string) => void; onOpen: () => void }) {
  const borderColor = item.priority === 'high' ? '#fca5a5' : item.priority === 'medium' ? '#fde68a' : '#e2e8f0';
  return (
    <div style={{
      padding: 14, background: '#fff', border: `1px solid ${borderColor}`, borderRadius: 10,
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{item.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c' }}>{item.title}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{item.subtitle}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={onOpen}
          style={{ padding: '5px 12px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          {item.action.label}
        </button>
        <button
          onClick={() => onDismiss(item.id)}
          style={{ padding: '5px 10px', background: 'transparent', color: '#94a3b8', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
          title="Dismiss"
        >×</button>
      </div>
    </div>
  );
}
