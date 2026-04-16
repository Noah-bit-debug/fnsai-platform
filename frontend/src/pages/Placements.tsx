import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { placementsApi, jobsApi, Placement, Job } from '../lib/api';
import QueryState, { EmptyCta } from '../components/QueryState';

type TabKey = 'active' | 'pending' | 'open_reqs';

const PRIORITY_COLOR: Record<Job['priority'], string> = {
  urgent: '#dc2626',
  high: '#f59e0b',
  normal: '#6b7280',
  low: '#9ca3af',
};

const STATUS_LABEL: Record<Placement['status'], string> = {
  active: 'Active',
  pending: 'Pending',
  unfilled: 'Unfilled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_CLASS: Record<Placement['status'], string> = {
  active: 'tg',
  pending: 'tw',
  unfilled: 'tgr',
  completed: 'tb',
  cancelled: 'td',
};

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

export default function Placements() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('active');

  // Two backing queries: placements (active + pending) and open jobs (requisitions)
  const placementsQ = useQuery({
    queryKey: ['placements-legacy'],
    queryFn: () => placementsApi.list(),
  });

  const jobsQ = useQuery({
    queryKey: ['placements-legacy-open-jobs'],
    queryFn: () => jobsApi.list({ status: 'open' }),
  });

  const allPlacements: Placement[] = placementsQ.data?.data?.placements ?? [];
  const openJobs: Job[] = jobsQ.data?.data?.jobs ?? [];

  const active = useMemo(() => allPlacements.filter((p) => p.status === 'active'), [allPlacements]);
  const pending = useMemo(() => allPlacements.filter((p) => p.status === 'pending'), [allPlacements]);

  const counts = {
    active: active.length,
    pending: pending.length,
    open_reqs: openJobs.length,
  };

  return (
    <div>
      <div className="ph">
        <div>
          <div className="pt">📋 Placements</div>
          <div className="ps">Active assignments, pending starts, and open requisitions</div>
        </div>
        <button className="btn btn-pr" onClick={() => navigate('/jobs/new')}>
          + New Job
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['active', 'pending', 'open_reqs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`filter-btn ${activeTab === tab ? 'active' : ''}`}
          >
            {tab === 'active' && 'Active'}
            {tab === 'pending' && 'Pending'}
            {tab === 'open_reqs' && 'Open Requisitions'}
            <span style={{ opacity: 0.6, marginLeft: 6 }}>{counts[tab]}</span>
          </button>
        ))}
      </div>

      {activeTab === 'active' && (
        <QueryState
          isLoading={placementsQ.isLoading}
          error={placementsQ.error}
          isEmpty={active.length === 0}
          empty={
            <EmptyCta
              title="No active placements yet"
              subtitle="Placements appear here when a candidate moves to the 'Placed' stage on the Kanban board — or once you mark a pending placement as active."
              ctaLabel="Open Kanban"
              onCta={() => navigate('/kanban')}
            />
          }
          onRetry={() => void placementsQ.refetch()}
        >
          <div className="pn">
            <div className="pnh">
              <h3>Active Placements</h3>
              <span className="tag tg">{active.length} active</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Staff / Candidate</th>
                    <th>Role</th>
                    <th>Facility</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((p) => (
                    <PlacementRow key={p.id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </QueryState>
      )}

      {activeTab === 'pending' && (
        <QueryState
          isLoading={placementsQ.isLoading}
          error={placementsQ.error}
          isEmpty={pending.length === 0}
          empty={
            <EmptyCta
              title="No pending placements"
              subtitle="Pending placements are created when a candidate is offered a role but hasn't started yet."
            />
          }
          onRetry={() => void placementsQ.refetch()}
        >
          <div className="pn">
            <div className="pnh">
              <h3>Pending Placements</h3>
              <span className="tag tw">{pending.length} pending</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Staff / Candidate</th>
                    <th>Role</th>
                    <th>Facility</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => (
                    <PlacementRow key={p.id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </QueryState>
      )}

      {activeTab === 'open_reqs' && (
        <QueryState
          isLoading={jobsQ.isLoading}
          error={jobsQ.error}
          isEmpty={openJobs.length === 0}
          empty={
            <EmptyCta
              title="No open requisitions"
              subtitle="Create a job to start filling a new position."
              ctaLabel="Create Job"
              onCta={() => navigate('/jobs/new')}
            />
          }
          onRetry={() => void jobsQ.refetch()}
        >
          <div className="pn">
            <div className="pnh">
              <h3>Open Requisitions</h3>
              <span className="tag tw">{openJobs.length} open</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Role</th>
                    <th>Client / Facility</th>
                    <th>Positions</th>
                    <th>Priority</th>
                    <th>Start</th>
                  </tr>
                </thead>
                <tbody>
                  {openJobs.map((j) => (
                    <tr key={j.id} onClick={() => navigate(`/jobs/${j.id}`)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{j.title}</div>
                        {j.job_code && (
                          <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>{j.job_code}</div>
                        )}
                      </td>
                      <td>
                        {j.profession ?? '—'}
                        {j.specialty && <div style={{ fontSize: 11, color: 'var(--t3)' }}>{j.specialty}</div>}
                      </td>
                      <td>
                        <div>{j.client_name ?? '—'}</div>
                        {j.facility_name && <div style={{ fontSize: 11, color: 'var(--t3)' }}>{j.facility_name}</div>}
                      </td>
                      <td>{j.positions ?? 1}</td>
                      <td>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: `${PRIORITY_COLOR[j.priority]}20`,
                            color: PRIORITY_COLOR[j.priority],
                            textTransform: 'uppercase',
                          }}
                        >
                          {j.priority}
                        </span>
                      </td>
                      <td>{fmtDate(j.start_date ?? undefined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </QueryState>
      )}
    </div>
  );
}

function PlacementRow({ p }: { p: Placement }) {
  const name =
    [p.first_name, p.last_name].filter(Boolean).join(' ') ||
    (p.staff_id ? `Staff ${p.staff_id.slice(0, 8)}` : 'Unfilled');
  const contractLabel: Record<Placement['contract_status'], string> = {
    signed: 'Signed',
    pending_esign: 'Awaiting signature',
    expired: 'Expired',
    not_sent: 'Not sent',
  };
  const contractClass: Record<Placement['contract_status'], string> = {
    signed: 'tg',
    pending_esign: 'tw',
    expired: 'td',
    not_sent: 'tgr',
  };
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{name}</div>
      </td>
      <td>{p.role}</td>
      <td>{p.facility_name ?? '—'}</td>
      <td>{fmtDate(p.start_date ?? undefined)}</td>
      <td>{fmtDate(p.end_date ?? undefined)}</td>
      <td>
        <span className={`tag ${STATUS_CLASS[p.status]}`} style={{ marginRight: 6 }}>
          {STATUS_LABEL[p.status]}
        </span>
        <span className={`tag ${contractClass[p.contract_status]}`}>{contractLabel[p.contract_status]}</span>
      </td>
    </tr>
  );
}
