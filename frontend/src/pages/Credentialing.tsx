import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { credentialsApi, Credential } from '../lib/api';
import QueryState, { EmptyCta } from '../components/QueryState';

type StatusFilter = '' | Credential['status'];

function statusClass(s: Credential['status']): string {
  switch (s) {
    case 'valid':          return 'tg';
    case 'expiring':
    case 'expiring_soon':  return 'tw';
    case 'expired':        return 'td';
    case 'pending':        return 'tb';
    case 'missing':
    default:               return 'tgr';
  }
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86400000);
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export default function Credentialing() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [search, setSearch] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['credentials-list', statusFilter],
    queryFn: () => credentialsApi.list(statusFilter ? { status: statusFilter } : undefined),
  });

  const expiringQ = useQuery({
    queryKey: ['credentials-expiring'],
    queryFn: () => credentialsApi.expiring(),
  });

  const credentials: Credential[] = data?.data?.credentials ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return credentials;
    return credentials.filter((c) => {
      const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim().toLowerCase();
      return (
        name.includes(q) ||
        (c.type ?? '').toLowerCase().includes(q) ||
        (c.issuer ?? '').toLowerCase().includes(q)
      );
    });
  }, [credentials, search]);

  const expiringCount = (expiringQ.data?.data?.expiringSoon?.length ?? 0) +
                       (expiringQ.data?.data?.alreadyExpired?.length ?? 0);

  return (
    <div>
      <div className="ph">
        <div>
          <div className="pt">🏅 Credentialing</div>
          <div className="ps">Staff credentials, licenses, and certifications</div>
        </div>
        <button
          className="btn btn-pr"
          onClick={() => navigate('/staff')}
          title="Upload a credential from any staff profile"
        >
          Manage from staff →
        </button>
      </div>

      {expiringCount > 0 && (
        <div
          className="ab ab-w"
          style={{ marginBottom: 16, cursor: 'pointer' }}
          onClick={() => setStatusFilter('expiring_soon')}
        >
          ⚠ <strong>{expiringCount} credential{expiringCount === 1 ? '' : 's'} expiring or expired</strong> — click to filter
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by staff name, credential type, or issuer…"
          style={{
            flex: '1 1 280px',
            minWidth: 200,
            padding: '8px 12px',
            border: '1px solid var(--bd)',
            borderRadius: 6,
            fontSize: 13,
            outline: 'none',
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--bd)',
            borderRadius: 6,
            fontSize: 13,
            background: 'var(--sf)',
            minWidth: 150,
          }}
        >
          <option value="">All statuses</option>
          <option value="valid">Valid</option>
          <option value="expiring_soon">Expiring soon</option>
          <option value="expiring">Expiring</option>
          <option value="expired">Expired</option>
          <option value="pending">Pending</option>
          <option value="missing">Missing</option>
        </select>
      </div>

      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={filtered.length === 0}
        empty={
          <EmptyCta
            title={credentials.length === 0 ? 'No credentials on file yet' : 'No credentials match those filters'}
            subtitle={
              credentials.length === 0
                ? 'Credentials are attached to staff members. Add one from any staff profile.'
                : 'Try clearing the search or changing the status filter.'
            }
            ctaLabel={credentials.length === 0 ? 'Open Staff' : undefined}
            onCta={credentials.length === 0 ? () => navigate('/staff') : undefined}
          />
        }
        onRetry={() => void refetch()}
      >
        <div className="pn">
          <div className="pnh">
            <h3>Credentials ({filtered.length})</h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Type</th>
                  <th>Issuer</th>
                  <th>Expiry</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const days = daysUntil(c.expiry_date);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/staff/${c.staff_id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div style={{ fontWeight: 600 }}>
                          {c.first_name} {c.last_name}
                        </div>
                      </td>
                      <td>{c.type}</td>
                      <td style={{ color: 'var(--t3)' }}>{c.issuer ?? '—'}</td>
                      <td>
                        {fmtDate(c.expiry_date)}
                        {days != null && days >= 0 && days <= 60 && (
                          <span style={{ fontSize: 11, color: days <= 14 ? '#b45309' : 'var(--t3)', marginLeft: 8 }}>
                            ({days}d)
                          </span>
                        )}
                        {days != null && days < 0 && (
                          <span style={{ fontSize: 11, color: '#991b1b', marginLeft: 8 }}>
                            ({Math.abs(days)}d overdue)
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`tag ${statusClass(c.status)}`}>{c.status.replace('_', ' ')}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </QueryState>
    </div>
  );
}
