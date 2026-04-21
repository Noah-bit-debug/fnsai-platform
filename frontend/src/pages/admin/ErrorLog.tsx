import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import QueryState from '../../components/QueryState';
import { useToast } from '../../components/ToastHost';
import { useConfirm } from '../../components/ConfirmHost';

interface ErrorEntry {
  id: string;
  timestamp: string;
  source: 'backend' | 'frontend';
  level: 'error' | 'warning';
  message: string;
  stack?: string;
  path?: string;
  method?: string;
  status?: number;
  user_id?: string;
  ip?: string;
  user_agent?: string;
  url?: string;
}

/**
 * Admin view of the in-memory error log. Lightweight — shows the last N
 * errors the backend has buffered, lets admins filter by source/level and
 * drill into a stack trace. Meant as the "what broke in prod just now?"
 * first stop before you'd wire up a real vendor like Sentry.
 */
export default function ErrorLog() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [source, setSource] = useState<string>('');
  const [level, setLevel] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['error-log', source, level],
    queryFn: () => api.get<{ entries: ErrorEntry[]; buffer_size: number; max: number }>(
      '/error-log',
      { params: { source: source || undefined, level: level || undefined, limit: 100 } }
    ),
    refetchInterval: 30_000,
  });

  const clearMut = useMutation({
    mutationFn: () => api.delete('/error-log'),
    onSuccess: () => {
      toast.success('Error log cleared');
      queryClient.invalidateQueries({ queryKey: ['error-log'] });
    },
    onError: () => toast.error('Failed to clear log'),
  });

  const entries = data?.data?.entries ?? [];
  const bufferSize = data?.data?.buffer_size ?? 0;
  const max = data?.data?.max ?? 0;

  const onClear = async () => {
    const ok = await confirm({
      title: 'Clear the error log?',
      description: `This removes all ${bufferSize} entries from the in-memory buffer. They cannot be recovered.`,
      destructive: true,
      confirmLabel: 'Clear log',
    });
    if (ok) clearMut.mutate();
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t1)' }}>Error Log</h1>
          <p style={{ fontSize: 13, color: 'var(--t3)', margin: '4px 0 0' }}>
            Unhandled backend errors + client-side crashes. In-memory ring buffer (last {max} entries),
            auto-refreshes every 30s. Buffer resets on backend redeploy.
          </p>
        </div>
        <button
          onClick={onClear}
          disabled={clearMut.isPending || bufferSize === 0}
          style={{
            padding: '8px 14px',
            background: bufferSize === 0 ? 'var(--sf2)' : '#fee2e2',
            color: bufferSize === 0 ? 'var(--t3)' : '#991b1b',
            border: `1px solid ${bufferSize === 0 ? 'var(--bd)' : '#fecaca'}`,
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: bufferSize === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {clearMut.isPending ? 'Clearing…' : 'Clear log'}
        </button>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Filter</span>
        <select value={source} onChange={e => setSource(e.target.value)} style={filterSt}>
          <option value="">All sources</option>
          <option value="backend">Backend</option>
          <option value="frontend">Frontend</option>
        </select>
        <select value={level} onChange={e => setLevel(e.target.value)} style={filterSt}>
          <option value="">All levels</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
        </select>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>
          {bufferSize} / {max} entries · updated {new Date(dataUpdatedAt).toLocaleTimeString()}
        </span>
      </div>

      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={entries.length === 0}
        empty={
          <div style={{ padding: 30, textAlign: 'center', background: 'var(--sf)', border: '1px dashed var(--bd)', borderRadius: 'var(--br)', color: 'var(--t3)', fontSize: 13 }}>
            ✨ No errors in the buffer. Either nothing is breaking, or the buffer was recently cleared / the backend just redeployed.
          </div>
        }
        onRetry={() => void refetch()}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map(e => (
            <div
              key={e.id}
              style={{
                background: 'var(--sf)',
                border: `1px solid ${e.level === 'error' ? '#fecaca' : '#fcd34d'}`,
                borderLeft: `3px solid ${e.level === 'error' ? '#dc2626' : '#f59e0b'}`,
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                  background: e.source === 'backend' ? '#dbeafe' : '#ede9fe',
                  color:      e.source === 'backend' ? '#1e40af' : '#5b21b6',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  {e.source}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                  background: e.level === 'error' ? '#fee2e2' : '#fef3c7',
                  color:      e.level === 'error' ? '#991b1b' : '#92400e',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  {e.level}
                </span>
                <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.message}
                </span>
                <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>
                  {new Date(e.timestamp).toLocaleString()}
                </span>
              </div>

              {/* Metadata row */}
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {e.method && e.path && <span>{e.method} {e.path}</span>}
                {e.status && <span>→ {e.status}</span>}
                {e.url && <span>URL: {e.url}</span>}
                {e.user_id && <span>User: {e.user_id}</span>}
                {e.ip && <span>IP: {e.ip}</span>}
              </div>

              {expandedId === e.id && e.stack && (
                <pre style={{
                  marginTop: 10,
                  padding: 10,
                  background: 'var(--sf2)',
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: 'var(--t2)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 300,
                  overflowY: 'auto',
                }}>
                  {e.stack}
                </pre>
              )}
            </div>
          ))}
        </div>
      </QueryState>
    </div>
  );
}

const filterSt: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--bd)',
  borderRadius: 6,
  fontSize: 12,
  background: 'var(--sf)',
  minWidth: 120,
};
