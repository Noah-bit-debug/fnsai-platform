import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRBAC } from '../contexts/RBACContext';
import { candidatesApi, pipelineApi, remindersApi, Candidate } from '../lib/api';

const STAGE_COLORS: Record<string, string> = {
  application:   '#1565c0',
  interview:     '#e65100',
  credentialing: '#6a1b9a',
  onboarding:    '#2e7d32',
  placed:        '#00695c',
};

function StatCard({ label, value, color, sub }: { label: string; value: number | string; color?: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '20px 24px' }}>
      <div style={{ fontSize: 32, fontWeight: 700, color: color ?? '#1a2b3c' }}>{value}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function QuickLink({ icon, label, to, onClick }: { icon: string; label: string; to?: string; onClick?: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={onClick ?? (() => navigate(to ?? '/'))}
      style={{
        background: '#fff', border: '1px solid #e8edf2', borderRadius: 10, padding: '14px 18px',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        textAlign: 'left', transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c' }}>{label}</span>
      <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 16 }}>→</span>
    </button>
  );
}

// ─── CEO View ─────────────────────────────────────────────────────────────────
function CEOView({ stages, stats }: { stages: Record<string, Candidate[]>; stats: any }) {
  const navigate = useNavigate();
  const stageCounts = Object.entries(stages);
  const placed = stages['placed']?.length ?? 0;
  const total = stats?.total ?? 0;
  const completionRate = total > 0 ? Math.round((placed / total) * 100) : 0;

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Executive Overview</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Candidates" value={total} color="#1565c0" />
        <StatCard label="Placed This Cycle" value={placed} color="#00695c" />
        <StatCard label="Placement Rate" value={`${completionRate}%`} color="#2e7d32" />
        <StatCard label="Added (7 days)" value={stats?.recent_7_days ?? 0} color="#e65100" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Pipeline by Stage</div>
          {stageCounts.map(([stage, candidates]) => (
            <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize', width: 110, color: '#374151' }}>{stage}</div>
              <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4,
                  background: STAGE_COLORS[stage] ?? '#94a3b8',
                  width: total > 0 ? `${Math.round((candidates.length / total) * 100)}%` : '0%',
                }} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2b3c', width: 28, textAlign: 'right' }}>{candidates.length}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Quick Actions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <QuickLink icon="👤" label="View All Candidates" to="/candidates" />
            <QuickLink icon="🔄" label="Pipeline Board" to="/pipeline" />
            <QuickLink icon="🔔" label="Manage Reminders" to="/reminders" />
            <QuickLink icon="⚙️" label="System Settings" to="/setup-wizard" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Manager View ─────────────────────────────────────────────────────────────
function ManagerView({ stages, remindersCount }: { stages: Record<string, Candidate[]>; remindersCount: number }) {
  const navigate = useNavigate();
  const bottlenecks = Object.entries(stages)
    .map(([stage, candidates]) => ({
      stage,
      stale: candidates.filter((c) => (c.days_since_update ?? 0) > 7).length,
      total: candidates.length,
    }))
    .filter((s) => s.stale > 0)
    .sort((a, b) => b.stale - a.stale);

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Team Overview</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {Object.entries(stages).slice(0, 3).map(([stage, cands]) => (
          <StatCard key={stage} label={stage.charAt(0).toUpperCase() + stage.slice(1)} value={cands.length} color={STAGE_COLORS[stage]} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>
            ⚠️ Bottlenecks (stale &gt; 7 days)
          </div>
          {bottlenecks.length === 0 ? (
            <div style={{ color: '#2e7d32', fontSize: 14, fontWeight: 600 }}>No bottlenecks — pipeline is moving well!</div>
          ) : (
            bottlenecks.map(({ stage, stale, total }) => (
              <div key={stage} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c', textTransform: 'capitalize' }}>{stage}</div>
                <div>
                  <span style={{ fontSize: 13, color: '#c62828', fontWeight: 700 }}>{stale}</span>
                  <span style={{ fontSize: 13, color: '#64748b' }}> / {total} stale</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Quick Actions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <QuickLink icon="🔄" label="Pipeline Board" to="/pipeline" />
            <QuickLink icon="👤" label="All Candidates" to="/candidates" />
            <QuickLink icon="🔔" label={`Pending Reminders (${remindersCount})`} to="/reminders" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── HR View ──────────────────────────────────────────────────────────────────
function HRView({ stages }: { stages: Record<string, Candidate[]> }) {
  const navigate = useNavigate();
  const applications = stages['application']?.length ?? 0;
  const missingDocs = Object.values(stages).flat().filter((c) => (c.missing_docs_count ?? 0) > 0).length;
  const onboardingPending = stages['onboarding']?.length ?? 0;

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>HR Dashboard</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Pending Applications" value={applications} color="#1565c0" sub="Awaiting review" />
        <StatCard label="Missing Docs Alerts" value={missingDocs} color="#c62828" sub="Candidates with missing required docs" />
        <StatCard label="In Onboarding" value={onboardingPending} color="#2e7d32" sub="Forms awaiting completion" />
      </div>

      {missingDocs > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#c62828', marginBottom: 8 }}>
            ⚠️ {missingDocs} candidate{missingDocs !== 1 ? 's' : ''} with missing documents
          </div>
          <div style={{ fontSize: 13, color: '#374151' }}>Review and follow up to keep the pipeline moving.</div>
          <button
            onClick={() => navigate('/candidates?stage=credentialing')}
            style={{ marginTop: 12, background: '#c62828', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
          >
            View Credentialing →
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Quick Actions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <QuickLink icon="🔄" label="Go to Pipeline" to="/pipeline" />
            <QuickLink icon="🔔" label="Go to Reminders" to="/reminders" />
            <QuickLink icon="👤" label="All Candidates" to="/candidates" />
          </div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Stage Snapshot</div>
          {Object.entries(stages).map(([stage, cands]) => (
            <div key={stage} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
              <span style={{ textTransform: 'capitalize', color: '#374151' }}>{stage}</span>
              <span style={{ fontWeight: 700, color: STAGE_COLORS[stage] ?? '#1a2b3c' }}>{cands.length}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Recruiter View ───────────────────────────────────────────────────────────
function RecruiterView({ allCandidates }: { allCandidates: Candidate[] }) {
  const navigate = useNavigate();
  const myActive = allCandidates.filter((c) => c.status === 'active');
  const needFollowUp = myActive.filter((c) => c.stage === 'interview' && (c.days_since_update ?? 0) > 3);

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>My Recruiter Dashboard</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Active Candidates" value={myActive.length} color="#1565c0" />
        <StatCard label="Interview Follow-ups" value={needFollowUp.length} color="#e65100" sub="In interview > 3 days" />
        <StatCard label="In Application" value={allCandidates.filter((c) => c.stage === 'application').length} color="#6a1b9a" />
      </div>

      {needFollowUp.length > 0 && (
        <div style={{ background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e65100', marginBottom: 10 }}>
            Interview Follow-ups Needed
          </div>
          {needFollowUp.slice(0, 5).map((c) => (
            <div
              key={c.id}
              onClick={() => navigate(`/candidates/${c.id}`)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #ffe0b2', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c' }}>{c.first_name} {c.last_name}</span>
              <span style={{ fontSize: 12, color: '#e65100', fontWeight: 600 }}>{c.days_since_update}d in interview</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Quick Actions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <QuickLink icon="➕" label="Add Candidate" to="/candidates/new" />
            <QuickLink icon="👤" label="All Candidates" to="/candidates" />
            <QuickLink icon="🔄" label="Pipeline View" to="/pipeline" />
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>My Candidate Stages</div>
          {['application', 'interview', 'credentialing', 'onboarding'].map((stage) => {
            const count = myActive.filter((c) => c.stage === stage).length;
            return (
              <div key={stage} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
                <span style={{ textTransform: 'capitalize', color: '#374151' }}>{stage}</span>
                <span style={{ fontWeight: 700, color: STAGE_COLORS[stage] ?? '#1a2b3c' }}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function RoleDashboard() {
  const { role, isLoading: rbacLoading } = useRBAC();
  const [stages, setStages] = useState<Record<string, Candidate[]>>({});
  const [stats, setStats] = useState<any>(null);
  const [remindersCount, setRemindersCount] = useState(0);
  const [allCandidates, setAllCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rbacLoading) return;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const promises: Promise<any>[] = [pipelineApi.overview()];
        if (role === 'ceo' || role === 'admin') promises.push(candidatesApi.stats());
        if (role === 'manager' || role === 'hr') promises.push(remindersApi.list({ status: 'scheduled' }));
        if (role === 'recruiter') promises.push(candidatesApi.list({ status: 'active' }));

        const results = await Promise.allSettled(promises);

        if (results[0].status === 'fulfilled') {
          setStages(results[0].value.data?.stages ?? {});
        }
        if (results[1]?.status === 'fulfilled') {
          if (role === 'ceo' || role === 'admin') {
            setStats(results[1].value.data);
          } else if (role === 'manager' || role === 'hr') {
            setRemindersCount(results[1].value.data?.reminders?.length ?? 0);
          } else if (role === 'recruiter') {
            setAllCandidates(results[1].value.data?.candidates ?? []);
          }
        }
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load dashboard data.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [role, rbacLoading]);

  const effectiveRole = role ?? 'hr';

  if (rbacLoading || loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}>Loading dashboard...</div>;
  }

  if (error) {
    return <div style={{ textAlign: 'center', padding: 40, color: '#c62828' }}>{error}</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>
          My Dashboard
        </h1>
        <p style={{ fontSize: 14, color: '#64748b' }}>
          Showing view for: <strong style={{ textTransform: 'capitalize' }}>{effectiveRole}</strong>
        </p>
      </div>

      {(effectiveRole === 'ceo' || effectiveRole === 'admin') && (
        <CEOView stages={stages} stats={stats} />
      )}
      {effectiveRole === 'manager' && (
        <ManagerView stages={stages} remindersCount={remindersCount} />
      )}
      {(effectiveRole === 'hr' || effectiveRole === 'coordinator') && (
        <HRView stages={stages} />
      )}
      {effectiveRole === 'recruiter' && (
        <RecruiterView allCandidates={allCandidates} />
      )}
      {effectiveRole === 'viewer' && (
        <HRView stages={stages} />
      )}
    </div>
  );
}
