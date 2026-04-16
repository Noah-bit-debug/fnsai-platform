import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { candidatesApi, placementsApi, pipelineApi, atsReportsApi } from '../../lib/api';
import DailySummaryWidget from '../../components/DailySummaryWidget';

const STAGE_COLORS: Record<string, string> = {
  application: 'var(--pr)',
  interview: '#7c3aed',
  credentialing: 'var(--wn)',
  onboarding: '#0891b2',
  placed: 'var(--ac)',
  rejected: 'var(--dg)',
};

export default function RecruitingDashboard() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const { data: statsData } = useQuery({
    queryKey: ['recruiting-candidate-stats'],
    queryFn: () => candidatesApi.stats(),
  });

  const { data: pipelineData, isLoading: loadingPipeline } = useQuery({
    queryKey: ['recruiting-pipeline'],
    queryFn: () => pipelineApi.overview(),
  });

  const { data: recentCandidates, isLoading: loadingCandidates } = useQuery({
    queryKey: ['recruiting-candidates-recent'],
    queryFn: () => candidatesApi.list({ status: 'active' }),
  });

  const { data: openReqs, isLoading: loadingReqs } = useQuery({
    queryKey: ['recruiting-placements-open'],
    queryFn: () => placementsApi.list({ status: 'unfilled' }),
  });

  // ATS snapshot scoped to the current user
  const [onlyMine, setOnlyMine] = useState(true);
  const { data: atsData, isLoading: loadingAts } = useQuery({
    queryKey: ['recruiting-ats-overview', onlyMine],
    queryFn: () => atsReportsApi.overview(onlyMine ? { me: true } : undefined),
  });
  const ats = atsData?.data;

  const stats = statsData?.data;
  const byStage = stats?.by_stage ?? {};
  const totalCandidates = stats?.total ?? 0;
  const inPipeline = (byStage['application'] ?? 0) + (byStage['interview'] ?? 0) + (byStage['credentialing'] ?? 0);
  const submitted = byStage['credentialing'] ?? 0;
  const interviewed = byStage['interview'] ?? 0;
  const placedThisMonth = byStage['placed'] ?? 0;

  const pipelineStages = pipelineData?.data?.stages ?? {};
  const recentList = (recentCandidates?.data?.candidates ?? []).slice(0, 5);
  const openReqList = openReqs?.data?.placements ?? [];

  const pipelineSummary = [
    { stage: 'Application', key: 'application', icon: '📄', color: 'var(--pr)' },
    { stage: 'Interview', key: 'interview', icon: '🎤', color: '#7c3aed' },
    { stage: 'Credentialing', key: 'credentialing', icon: '📋', color: 'var(--wn)' },
    { stage: 'Onboarding', key: 'onboarding', icon: '🎓', color: '#0891b2' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--t1)' }}>Recruiting Dashboard</h1>
            <p style={{ color: 'var(--t3)', fontSize: 14 }}>{today}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/pipeline')}>
              📊 Pipeline
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate('/candidates/new')}>
              + Add Candidate
            </button>
          </div>
        </div>
      </div>

      {/* Daily Intelligence Widget */}
      <DailySummaryWidget />

      {/* ATS snapshot (per-recruiter) */}
      <div style={{ background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)', padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>ATS snapshot</h3>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              {onlyMine ? 'Filtered to your jobs, submissions, tasks' : 'All team activity'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={() => setOnlyMine(true)}
              style={{ padding: '5px 11px', background: onlyMine ? 'var(--pr)' : 'var(--sf2)', color: onlyMine ? 'var(--sf)' : 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >
              My work
            </button>
            <button
              onClick={() => setOnlyMine(false)}
              style={{ padding: '5px 11px', background: !onlyMine ? 'var(--pr)' : 'var(--sf2)', color: !onlyMine ? 'var(--sf)' : 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >
              Team
            </button>
            <button
              onClick={() => navigate('/ats-reports')}
              style={{ padding: '5px 11px', background: 'transparent', color: 'var(--pr)', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >
              Full reports →
            </button>
          </div>
        </div>

        {loadingAts ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: 12 }}>Loading…</div>
        ) : !ats ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: 12 }}>No data</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
              <AtsKpi label="Open jobs" value={ats.active_jobs_summary.open_jobs ?? 0} accent="#10b981" onClick={() => navigate('/jobs')} subtitle={`${ats.active_jobs_summary.urgent_open ?? 0} urgent`} />
              <AtsKpi label="Placement rate" value={`${ats.submission_to_placement.placement_rate}%`} accent="#059669" subtitle={`${ats.submission_to_placement.placed}/${ats.submission_to_placement.total} (90d)`} />
              <AtsKpi label="Tasks open" value={ats.tasks.open_tasks ?? 0} accent={(ats.tasks.overdue ?? 0) > 0 ? '#ef4444' : '#6b7280'} onClick={() => navigate('/tasks')} subtitle={`${ats.tasks.overdue ?? 0} overdue · ${ats.tasks.due_today ?? 0} today`} />
              <AtsKpi label="Jobs at risk" value={ats.jobs_at_risk.length} accent="#f59e0b" subtitle=">14d, <3 subs" />
            </div>

            {ats.jobs_at_risk.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Jobs at risk ({ats.jobs_at_risk.length})
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {ats.jobs_at_risk.slice(0, 5).map((j) => (
                    <div
                      key={j.id}
                      onClick={() => navigate(`/jobs/${j.id}`)}
                      style={{ padding: 8, background: 'var(--sf2)', borderRadius: 6, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
                    >
                      <div style={{ minWidth: 0, fontSize: 13, color: 'var(--t1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {j.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
                        {j.age_days}d · {j.submission_count} sub{j.submission_count === 1 ? '' : 's'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 5 Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Total Candidates', value: totalCandidates, color: 'var(--pr)', icon: '👥' },
          { label: 'In Pipeline', value: inPipeline, color: '#7c3aed', icon: '🔄' },
          { label: 'Submitted to Clients', value: submitted, color: 'var(--wn)', icon: '📤' },
          { label: 'Interviewed', value: interviewed, color: '#0891b2', icon: '🎤' },
          { label: 'Placed This Month', value: placedThisMonth, color: 'var(--ac)', icon: '✅' },
        ].map((stat) => (
          <div key={stat.label} className="sc" style={{ borderTop: `3px solid ${stat.color}` }}>
            <div className="sc-icon" style={{ background: `${stat.color}18`, color: stat.color }}>{stat.icon}</div>
            <div className="sc-label">{stat.label}</div>
            <div className="sc-value" style={{ color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Pipeline Summary */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3>📊 Pipeline Summary</h3>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/pipeline')}>
            Full Pipeline →
          </button>
        </div>
        <div className="pnb">
          {loadingPipeline ? (
            <div className="spinner" style={{ margin: '24px auto' }} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              {pipelineSummary.map((stage) => {
                const count = (pipelineStages[stage.key] ?? []).length || (byStage[stage.key] ?? 0);
                return (
                  <div
                    key={stage.stage}
                    style={{
                      background: 'var(--sf3)',
                      border: `2px solid ${stage.color}40`,
                      borderRadius: 10,
                      padding: '18px 16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                    }}
                    onClick={() => navigate('/pipeline')}
                  >
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{stage.icon}</div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: stage.color }}>{count}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', marginTop: 4 }}>{stage.stage}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Candidates by Client + Candidates by Job Type */}
      {(() => {
        const allCands = recentCandidates?.data?.candidates ?? [];
        const allPlacements = openReqs?.data?.placements ?? [];

        // By Job Type
        const jtMap: Record<string, { total: number; inPipeline: number; placed: number }> = {};
        allCands.forEach((c: any) => {
          const jt = c.role || 'Unknown';
          if (!jtMap[jt]) jtMap[jt] = { total: 0, inPipeline: 0, placed: 0 };
          jtMap[jt].total++;
          if (['application','interview','credentialing','onboarding'].includes(c.stage)) jtMap[jt].inPipeline++;
          if (c.stage === 'placed') jtMap[jt].placed++;
        });
        const jobTypeRows = Object.entries(jtMap).sort((a, b) => b[1].total - a[1].total).map(([jt, d]) => ({ jobType: jt, ...d }));

        // By Client
        const cMap: Record<string, { submitted: number; interviewed: number; placed: number }> = {};
        allPlacements.forEach((p: any) => {
          const client = p.facility_name || p.client_name || 'Unknown';
          if (!cMap[client]) cMap[client] = { submitted: 0, interviewed: 0, placed: 0 };
          if (p.status === 'filled') cMap[client].placed++;
          else cMap[client].submitted++;
        });
        const clientRows = Object.entries(cMap).sort((a, b) => (b[1].submitted + b[1].placed) - (a[1].submitted + a[1].placed)).map(([client, d]) => ({ client, ...d }));

        const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', color: 'var(--t3)', fontWeight: 600, fontSize: 12, borderBottom: '2px solid var(--bd)' };
        const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--sf3)' };

        return (
          <div className="grid-2" style={{ marginBottom: 20 }}>
            {/* Candidates by Client */}
            <div className="pn">
              <div className="pnh"><h3>🏥 Candidates by Client</h3></div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Client Name', 'Submitted', 'Interviewed', 'Placed'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {clientRows.length === 0 ? (
                      <tr><td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: 'var(--t3)', padding: '28px 12px' }}>No client data yet</td></tr>
                    ) : clientRows.map((row, i) => (
                      <tr key={i}>
                        <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--t1)' }}>{row.client}</td>
                        <td style={{ ...tdStyle, color: 'var(--t2)' }}>{row.submitted || '—'}</td>
                        <td style={{ ...tdStyle, color: 'var(--t2)' }}>{row.interviewed || '—'}</td>
                        <td style={{ ...tdStyle, color: 'var(--ac)', fontWeight: 700 }}>{row.placed || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Candidates by Job Type */}
            <div className="pn">
              <div className="pnh"><h3>💼 Candidates by Job Type</h3></div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Job Type', 'Total', 'In Pipeline', 'Placed This Month'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {jobTypeRows.length === 0 ? (
                      <tr><td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: 'var(--t3)', padding: '28px 12px' }}>No candidate data yet</td></tr>
                    ) : jobTypeRows.map((row, i) => (
                      <tr key={i}>
                        <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--t1)' }}>{row.jobType}</td>
                        <td style={{ ...tdStyle, color: 'var(--t2)' }}>{row.total || '—'}</td>
                        <td style={{ ...tdStyle, color: 'var(--t2)' }}>{row.inPipeline || '—'}</td>
                        <td style={{ ...tdStyle, color: 'var(--ac)', fontWeight: 700 }}>{row.placed || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Row 2: Recent Candidates + Job Orders */}
      <div className="grid-2">
        {/* Recent Candidates */}
        <div className="pn">
          <div className="pnh">
            <h3>👤 Recent Candidates</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/candidates')}>
              View All →
            </button>
          </div>
          <div className="pnb" style={{ padding: '8px 18px' }}>
            {loadingCandidates ? (
              <div className="spinner" style={{ margin: '24px auto' }} />
            ) : recentList.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-icon">👤</div>
                <h3>No candidates yet</h3>
                <p>Add your first candidate to get started.</p>
              </div>
            ) : (
              recentList.map((c) => {
                const days = c.days_since_update ?? Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000);
                return (
                  <div
                    key={c.id}
                    className="action-item"
                    style={{ cursor: 'pointer', marginBottom: 6 }}
                    onClick={() => navigate(`/candidates/${c.id}`)}
                  >
                    <div style={{
                      width: 34, height: 34, borderRadius: '50%',
                      background: `${STAGE_COLORS[c.stage] ?? 'var(--pr)'}18`,
                      color: STAGE_COLORS[c.stage] ?? 'var(--pr)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13, flexShrink: 0,
                    }}>
                      {c.first_name[0]}{c.last_name[0]}
                    </div>
                    <div className="action-content">
                      <div className="action-title">{c.first_name} {c.last_name}</div>
                      <div className="action-meta">{c.role ?? 'Candidate'} · Day {days} in pipeline</div>
                    </div>
                    <span
                      className="tg"
                      style={{
                        background: `${STAGE_COLORS[c.stage] ?? 'var(--pr)'}18`,
                        color: STAGE_COLORS[c.stage] ?? 'var(--pr)',
                        fontSize: 11,
                        textTransform: 'capitalize',
                      }}
                    >
                      {c.stage}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Job Orders */}
        <div className="pn">
          <div className="pnh">
            <h3>📌 Open Job Orders</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/placements')}>
              View All →
            </button>
          </div>
          <div className="pnb" style={{ padding: '8px 18px' }}>
            {loadingReqs ? (
              <div className="spinner" style={{ margin: '24px auto' }} />
            ) : openReqList.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-icon">📌</div>
                <h3>No open job orders</h3>
                <p>All positions are filled.</p>
              </div>
            ) : (
              openReqList.slice(0, 5).map((p) => (
                <div
                  key={p.id}
                  className="action-item"
                  style={{ cursor: 'pointer', marginBottom: 6 }}
                  onClick={() => navigate('/placements')}
                >
                  <div className="action-dot orange" />
                  <div className="action-content">
                    <div className="action-title">{p.role}</div>
                    <div className="action-meta">
                      {p.facility_name ?? 'Unassigned'} ·{' '}
                      {p.start_date ? `Start: ${new Date(p.start_date).toLocaleDateString()}` : 'Start: TBD'}
                    </div>
                  </div>
                  <span className="tw" style={{ fontSize: 11 }}>Unfilled</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="pn" style={{ marginTop: 20 }}>
        <div className="pnh">
          <h3>⚡ Quick Links</h3>
        </div>
        <div className="pnb">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { icon: '➕', label: 'Add Candidate', nav: '/candidates/new', color: 'var(--pr)' },
              { icon: '🔄', label: 'Pipeline', nav: '/pipeline', color: '#7c3aed' },
              { icon: '🏢', label: 'Clients', nav: '/clients', color: '#0891b2' },
              { icon: '📊', label: 'Reports', nav: '/reports', color: 'var(--ac)' },
            ].map((link) => (
              <div
                key={link.label}
                style={{
                  background: 'var(--sf3)',
                  border: '1px solid var(--bd)',
                  borderRadius: 10,
                  padding: '18px 14px',
                  textAlign: 'center',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(link.nav)}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(30,64,175,0.12)')}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
              >
                <div style={{ fontSize: 24, marginBottom: 8 }}>{link.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>{link.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AtsKpi({ label, value, accent, subtitle, onClick }: { label: string; value: string | number; accent: string; subtitle?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--sf2)', borderRadius: 8, padding: 12,
        borderLeft: `3px solid ${accent}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)' }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}
