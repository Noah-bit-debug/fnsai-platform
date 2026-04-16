import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { facilitiesApi, Facility } from '../lib/api';
import QueryState, { EmptyCta } from '../components/QueryState';

const CONTRACT_TAG: Record<Facility['contract_status'], string> = {
  active: 'tg',
  renewing: 'tw',
  expired: 'td',
  pending: 'tb',
};

const CONTRACT_LABEL: Record<Facility['contract_status'], string> = {
  active: 'Active',
  renewing: 'Renewing',
  expired: 'Expired',
  pending: 'Pending',
};

export default function Clients() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [contractFilter, setContractFilter] = useState<string>('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['facilities-legacy', contractFilter, search],
    queryFn: () =>
      facilitiesApi.list({
        contract_status: contractFilter || undefined,
        search: search.trim() || undefined,
      }),
  });

  const facilities: Facility[] = data?.data?.facilities ?? [];

  return (
    <div>
      <div className="ph">
        <div>
          <div className="pt">🏥 Clients & Facilities</div>
          <div className="ps">All client facilities on contract</div>
        </div>
        <button className="btn btn-pr" onClick={() => navigate('/clients-orgs')}>
          Manage client organizations →
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, contact, or address…"
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
          value={contractFilter}
          onChange={(e) => setContractFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--bd)',
            borderRadius: 6,
            fontSize: 13,
            background: 'var(--sf)',
            minWidth: 150,
          }}
        >
          <option value="">All contracts</option>
          <option value="active">Active</option>
          <option value="renewing">Renewing</option>
          <option value="pending">Pending</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={facilities.length === 0}
        empty={
          <EmptyCta
            title={search || contractFilter ? 'No facilities match those filters' : 'No facilities on file yet'}
            subtitle={
              search || contractFilter
                ? 'Try clearing the search or the contract filter.'
                : 'Head to Client Organizations to create a client and its facilities.'
            }
            ctaLabel={!search && !contractFilter ? 'Create a client' : undefined}
            onCta={!search && !contractFilter ? () => navigate('/clients-orgs') : undefined}
          />
        }
        onRetry={() => void refetch()}
      >
        <div className="pn">
          <div className="pnh">
            <h3>Facilities ({facilities.length})</h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Primary contact</th>
                  <th>Active placements</th>
                  <th>Contract</th>
                </tr>
              </thead>
              <tbody>
                {facilities.map((f) => (
                  <tr
                    key={f.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      // Legacy page has no per-facility detail; jump to the new client-orgs list
                      navigate('/clients-orgs');
                    }}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{f.name}</div>
                      {f.address && <div style={{ fontSize: 11, color: 'var(--t3)' }}>{f.address}</div>}
                    </td>
                    <td>{f.type ?? '—'}</td>
                    <td>
                      {f.contact_name ? (
                        <div>
                          <div style={{ fontWeight: 500 }}>{f.contact_name}</div>
                          {f.contact_email && <div style={{ fontSize: 11, color: 'var(--t3)' }}>{f.contact_email}</div>}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--t3)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <ActiveCount n={f.active_placements ?? 0} />
                    </td>
                    <td>
                      <span className={`tag ${CONTRACT_TAG[f.contract_status]}`}>{CONTRACT_LABEL[f.contract_status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </QueryState>
    </div>
  );
}

function ActiveCount({ n }: { n: number }) {
  return <span style={{ fontWeight: n > 0 ? 600 : 400, color: n > 0 ? 'var(--t1)' : 'var(--t3)' }}>{n}</span>;
}
