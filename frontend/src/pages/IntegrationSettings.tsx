import { useQuery } from '@tanstack/react-query';
import { integrationsStatusApi, IntegrationStatus } from '../lib/api';
import QueryState from '../components/QueryState';
import Breadcrumbs from '../components/Breadcrumbs';

export default function IntegrationSettings() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['integration-settings'],
    queryFn: () => integrationsStatusApi.status(),
  });

  const integrations: IntegrationStatus[] = data?.data?.integrations ?? [];
  const connectedCount = integrations.filter((i) => i.connected).length;
  const missingCount = integrations.length - connectedCount;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      <Breadcrumbs crumbs={[
        { label: 'Settings', to: '/settings/users' },
        { label: 'Integrations' },
      ]} />
      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>Integrations</h1>
      <p style={{ color: 'var(--t3)', fontSize: 13, margin: '0 0 20px' }}>
        Status for every third-party service this platform talks to. Connection status is read from the
        environment variables on the backend — if an integration shows as "Not configured" here, the
        corresponding env vars aren't set on Railway (or wherever the backend runs).
      </p>

      {!isLoading && !error && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <Kpi label="Connected" value={connectedCount} color="#10b981" />
          <Kpi label="Not configured" value={missingCount} color="#9ca3af" />
          <Kpi label="Total" value={integrations.length} color="#3b82f6" />
        </div>
      )}

      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={integrations.length === 0}
        onRetry={() => void refetch()}
      >
        <div style={{ display: 'grid', gap: 10 }}>
          {integrations.map((i) => (
            <IntegrationCard key={i.key} integration={i} />
          ))}
        </div>
      </QueryState>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        background: 'var(--sf)',
        borderRadius: 'var(--br)',
        border: '1px solid var(--bd)',
        padding: '10px 16px',
        borderLeft: `3px solid ${color}`,
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

function IntegrationCard({ integration: i }: { integration: IntegrationStatus }) {
  return (
    <div
      style={{
        background: 'var(--sf)',
        borderRadius: 'var(--br)',
        border: `1px solid ${i.connected ? 'var(--bd)' : '#fcd34d'}`,
        padding: 16,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 16,
        alignItems: 'start',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{i.name}</span>
          <StatusBadge connected={i.connected} />
        </div>
        {i.description && (
          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>{i.description}</div>
        )}
        <div style={{ fontSize: 11, color: 'var(--t3)' }}>
          <strong>Required env:</strong>{' '}
          {i.required_env.map((e, idx) => (
            <span key={e}>
              <code style={{ background: 'var(--sf2)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>{e}</code>
              {idx < i.required_env.length - 1 && ' '}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
        {i.docs_url && (
          <a
            href={i.docs_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 12px',
              background: 'var(--sf2)',
              border: '1px solid var(--bd)',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--t2)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Open provider ↗
          </a>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 999,
        background: connected ? '#d1fae5' : '#f1f5f9',
        color: connected ? '#065f46' : '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: connected ? '#10b981' : '#94a3b8',
        }}
      />
      {connected ? 'Connected' : 'Not configured'}
    </span>
  );
}
