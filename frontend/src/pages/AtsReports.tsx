import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { atsReportsApi, AtsReportsOverview } from '../lib/api';

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#dc2626', high: '#f59e0b', normal: '#6b7280', low: '#9ca3af',
};

export default function AtsReports() {
  const nav = useNavigate();
  const [data, setData] = useState<AtsReportsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    atsReportsApi.overview()
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading reports…</div>;
  if (error) return <div style={{ padding: 20, color: '#991b1b', background: '#fee2e2', margin: 20, borderRadius: 8 }}>{error}</div>;
  if (!data) return null;

  const maxFunnelCount = Math.max(1, ...data.funnel.map((f) => f.count));
  const conv = data.submission_to_placement;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>ATS Reports</h1>
        <div style={{ color: 'var(--t3)', fontSize: 13, marginTop: 4 }}>
          Last 30 days unless noted · click any number to drill in
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KPI
          label="Open jobs"
          value={data.active_jobs_summary.open_jobs ?? 0}
          accent="#10b981"
          subtitle={`${data.active_jobs_summary.urgent_open ?? 0} urgent`}
          onClick={() => nav('/jobs')}
        />
        <KPI
          label="Total positions"
          value={data.active_jobs_summary.total_positions_open ?? 0}
          accent="#3b82f6"
        />
        <KPI
          label="Placement rate"
          value={`${conv.placement_rate}%`}
          accent="#059669"
          subtitle={`${conv.placed}/${conv.total} submissions (90d)`}
          onClick={() => nav('/submissions')}
        />
        <KPI
          label="Tasks open"
          value={data.tasks.open_tasks ?? 0}
          accent={data.tasks.overdue && data.tasks.overdue > 0 ? '#ef4444' : '#6b7280'}
          subtitle={`${data.tasks.overdue ?? 0} overdue · ${data.tasks.due_today ?? 0} today`}
          onClick={() => nav('/tasks')}
        />
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginBottom: 16 }}>
        {/* Pipeline funnel */}
        <Card title="Pipeline funnel">
          {data.funnel.length === 0 ? (
            <Empty msg="No submissions yet." />
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {data.funnel.map((stage) => (
                <div
                  key={stage.key}
                  onClick={() => nav(`/submissions?stage_key=${stage.key}`)}
                  style={{ cursor: 'pointer', display: 'grid', gridTemplateColumns: '140px 1fr auto', alignItems: 'center', gap: 8 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color ?? '#6b7280' }} />
                    <span style={{ fontSize: 12, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {stage.label}
                    </span>
                  </div>
                  <div style={{ height: 22, background: 'var(--sf2)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                    <div style={{
                      height: '100%',
                      width: `${(stage.count / maxFunnelCount) * 100}%`,
                      background: stage.color ?? '#6b7280',
                      opacity: 0.85, transition: 'width 0.3s',
                    }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', minWidth: 30, textAlign: 'right' }}>
                    {stage.count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Submission → placement conversion */}
        <Card title="Submission → placement (90d)">
          {conv.total === 0 ? (
            <Empty msg="No submissions in last 90 days." />
          ) : (
            <>
              <div style={{ marginBottom: 12, padding: 12, background: 'var(--sf2)', borderRadius: 6 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ac)' }}>{conv.placement_rate}%</div>
                <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>placement rate</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <MiniStat label="Client submitted" value={conv.client_submitted} />
                <MiniStat label="Interview" value={conv.interview} />
                <MiniStat label="Offer" value={conv.offer} />
                <MiniStat label="Placed" value={conv.placed} color="#10b981" />
                <MiniStat label="Lost" value={conv.lost} color="#ef4444" />
                <MiniStat label="Total" value={conv.total} />
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Jobs at risk + Recruiter leaderboard */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
        <Card title={`Jobs at risk (${data.jobs_at_risk.length})`} subtitle="Open > 14d with < 3 submissions">
          {data.jobs_at_risk.length === 0 ? (
            <Empty msg="No jobs at risk." />
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {data.jobs_at_risk.map((j) => (
                <div
                  key={j.id}
                  onClick={() => nav(`/jobs/${j.id}`)}
                  style={{
                    padding: 10, background: 'var(--sf2)', borderRadius: 6, cursor: 'pointer',
                    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 10, alignItems: 'center',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {j.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                      {j.job_code && <span style={{ fontFamily: 'monospace' }}>{j.job_code} · </span>}
                      {j.age_days}d old · {j.submission_count} sub{j.submission_count === 1 ? '' : 's'}
                      {j.recruiter_name && <span> · {j.recruiter_name}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: `${PRIORITY_COLOR[j.priority]}20`, color: PRIORITY_COLOR[j.priority], textTransform: 'uppercase' }}>
                    {j.priority}
                  </span>
                  <span style={{ fontSize: 10, color: '#b45309', fontWeight: 600 }}>⚠ {j.age_days}d</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Recruiter leaderboard" subtitle="Last 30 days">
          {data.recruiter_leaderboard.length === 0 ? (
            <Empty msg="No recruiter activity yet." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--t3)' }}>
                  <th style={th}>Recruiter</th>
                  <th style={{ ...th, textAlign: 'right' }}>Subs 30d</th>
                  <th style={{ ...th, textAlign: 'right' }}>Placed</th>
                  <th style={{ ...th, textAlign: 'right' }}>Open jobs</th>
                </tr>
              </thead>
              <tbody>
                {data.recruiter_leaderboard.map((r, i) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--bd)' }}>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--t1)' }}>
                      <span style={{ color: 'var(--t3)', marginRight: 6 }}>{i + 1}.</span>
                      {r.name ?? r.email ?? r.id.slice(0, 8)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: 'var(--pr)' }}>{r.submissions_30d}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#10b981' }}>{r.placements}</td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--t2)' }}>{r.open_jobs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── UI bits ─────────────────────────────────────────────────────────────────
function KPI({ label, value, accent, subtitle, onClick }: { label: string; value: string | number; accent: string; subtitle?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)',
        padding: 14, cursor: onClick ? 'pointer' : 'default',
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>{value}</div>
      {subtitle && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)', padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--t1)', letterSpacing: 0.3 }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ padding: 8, background: 'var(--sf2)', borderRadius: 6, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? 'var(--t1)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: 12 }}>{msg}</div>;
}

const th: React.CSSProperties = { padding: '6px 4px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '8px 4px', fontSize: 13 };
