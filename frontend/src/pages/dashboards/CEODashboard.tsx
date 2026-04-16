import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { staffApi, placementsApi, credentialsApi, facilitiesApi, onboardingApi } from '../../lib/api';
import DailySummaryWidget from '../../components/DailySummaryWidget';

export default function CEODashboard() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const { data: staffData } = useQuery({
    queryKey: ['ceo-staff-active'],
    queryFn: () => staffApi.list({ status: 'active' }),
  });

  const { data: onboardingStaff } = useQuery({
    queryKey: ['ceo-staff-onboarding'],
    queryFn: () => staffApi.list({ status: 'onboarding' }),
  });

  const { data: activePlacements } = useQuery({
    queryKey: ['ceo-placements-active'],
    queryFn: () => placementsApi.list({ status: 'active' }),
  });

  const { data: pendingPlacements } = useQuery({
    queryKey: ['ceo-placements-pending'],
    queryFn: () => placementsApi.list({ status: 'pending' }),
  });

  const { data: openReqs } = useQuery({
    queryKey: ['ceo-placements-unfilled'],
    queryFn: () => placementsApi.list({ status: 'unfilled' }),
  });

  const { data: expiringData } = useQuery({
    queryKey: ['ceo-credentials-expiring'],
    queryFn: () => credentialsApi.expiring(),
  });

  const { data: clientsData } = useQuery({
    queryKey: ['ceo-clients'],
    queryFn: () => facilitiesApi.list(),
  });

  const staffCount = staffData?.data?.staff?.length ?? 0;
  const onboardingCount = onboardingStaff?.data?.staff?.length ?? 0;
  const activePlacementsCount = activePlacements?.data?.placements?.length ?? 0;
  const pendingCount = pendingPlacements?.data?.placements?.length ?? 0;
  const openReqCount = openReqs?.data?.placements?.length ?? 0;
  const clientCount = clientsData?.data?.facilities?.length ?? 0;
  const expiringSoon = expiringData?.data?.expiringSoon ?? [];
  const alreadyExpired = expiringData?.data?.alreadyExpired ?? [];
  const expiredCount = alreadyExpired.length;
  const expiringCount = expiringSoon.length;
  const totalCredIssues = expiredCount + expiringCount;
  const complianceRate =
    totalCredIssues === 0
      ? 100
      : Math.max(0, Math.round(100 - (totalCredIssues / Math.max(1, staffCount)) * 20));

  const getStatus = (issues: number): { label: string; color: string; dot: string } => {
    if (issues === 0) return { label: 'Healthy', color: 'var(--ac)', dot: '#16a34a' };
    if (issues <= 2) return { label: 'Attention', color: 'var(--wn)', dot: '#ea580c' };
    return { label: 'Critical', color: 'var(--dg)', dot: '#dc2626' };
  };

  const deptStatuses = [
    { dept: 'Recruiting', icon: '👥', issues: openReqCount, detail: `${openReqCount} open requisitions` },
    { dept: 'HR', icon: '🏢', issues: onboardingCount > 5 ? 2 : 0, detail: `${onboardingCount} in onboarding` },
    { dept: 'Credentialing', icon: '📋', issues: expiredCount + (expiringCount >= 3 ? 1 : 0), detail: `${expiredCount} expired, ${expiringCount} expiring` },
    { dept: 'Onboarding', icon: '🎓', issues: onboardingCount > 10 ? 3 : onboardingCount > 5 ? 1 : 0, detail: `${onboardingCount} active` },
  ];

  const quickActions = [
    { icon: '👥', label: 'Staff', nav: '/staff' },
    { icon: '🔗', label: 'Placements', nav: '/placements' },
    { icon: '📋', label: 'Credentialing', nav: '/credentialing' },
    { icon: '🏢', label: 'Clients', nav: '/clients' },
    { icon: '📊', label: 'Reports', nav: '/reports' },
    { icon: '🎓', label: 'Onboarding', nav: '/onboarding' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--t1)' }}>
              CEO Dashboard — FNS AI Compliance Infrastructure
            </h1>
            <p style={{ color: 'var(--t3)', fontSize: 14 }}>{today}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/reports')}>
              📊 Reports
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate('/ai-assistant')}>
              🤖 Ask AI
            </button>
          </div>
        </div>
      </div>

      {/* Daily Intelligence Widget */}
      <DailySummaryWidget />

      {/* 6 Stat Cards — 3-col */}
      <div className="grid-3" style={{ marginBottom: 20 }}>
        <div className="sc" style={{ borderTop: '3px solid var(--pr)' }}>
          <div className="sc-icon" style={{ background: 'rgba(30,64,175,0.1)', color: 'var(--pr)' }}>👥</div>
          <div className="sc-label">Total Active Employees</div>
          <div className="sc-value">{staffCount}</div>
          <div className="sc-sub">Currently active</div>
        </div>

        <div className="sc" style={{ borderTop: '3px solid var(--ac)' }}>
          <div className="sc-icon" style={{ background: 'rgba(22,163,74,0.1)', color: 'var(--ac)' }}>🔗</div>
          <div className="sc-label">Total Placements</div>
          <div className="sc-value">{activePlacementsCount}</div>
          <div className="sc-sub">Active this period</div>
        </div>

        <div className="sc" style={{ borderTop: `3px solid ${openReqCount > 0 ? 'var(--wn)' : 'var(--ac)'}` }}>
          <div className="sc-icon" style={{ background: 'rgba(234,88,12,0.1)', color: 'var(--wn)' }}>📌</div>
          <div className="sc-label">Open Requisitions</div>
          <div className="sc-value" style={{ color: openReqCount > 0 ? 'var(--wn)' : 'var(--t1)' }}>{openReqCount}</div>
          <div className="sc-sub">Unfilled positions</div>
        </div>

        <div className="sc" style={{ borderTop: `3px solid ${complianceRate >= 90 ? 'var(--ac)' : complianceRate >= 70 ? 'var(--wn)' : 'var(--dg)'}` }}>
          <div className="sc-icon" style={{ background: 'rgba(22,163,74,0.1)', color: 'var(--ac)' }}>✅</div>
          <div className="sc-label">Credential Compliance Rate</div>
          <div className="sc-value" style={{ color: complianceRate >= 90 ? 'var(--ac)' : complianceRate >= 70 ? 'var(--wn)' : 'var(--dg)' }}>
            {complianceRate}%
          </div>
          <div className="sc-sub">Org-wide compliance</div>
        </div>

        <div className="sc" style={{ borderTop: '3px solid #7c3aed' }}>
          <div className="sc-icon" style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>🎓</div>
          <div className="sc-label">Pending Onboarding</div>
          <div className="sc-value">{onboardingCount}</div>
          <div className="sc-sub">In progress</div>
        </div>

        <div className="sc" style={{ borderTop: '3px solid #0891b2' }}>
          <div className="sc-icon" style={{ background: 'rgba(8,145,178,0.1)', color: '#0891b2' }}>🏢</div>
          <div className="sc-label">Total Clients</div>
          <div className="sc-value">{clientCount}</div>
          <div className="sc-sub">Active facilities</div>
        </div>
      </div>

      {/* Row 2: Operations Health + Compliance Overview */}
      <div className="grid-2">
        {/* Operations Health */}
        <div className="pn">
          <div className="pnh">
            <h3>🏥 Operations Health</h3>
            <span className="tgr" style={{ fontSize: 11 }}>Live</span>
          </div>
          <div className="pnb" style={{ padding: '8px 18px' }}>
            {deptStatuses.map((dept) => {
              const status = getStatus(dept.issues);
              return (
                <div
                  key={dept.dept}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 0',
                    borderBottom: '1px solid var(--bd)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 20 }}>{dept.icon}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--t1)' }}>{dept.dept}</div>
                      <div style={{ fontSize: 12, color: 'var(--t3)' }}>{dept.detail}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: status.dot,
                      boxShadow: `0 0 6px ${status.dot}80`,
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: status.color }}>{status.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Compliance Overview */}
        <div className="pn">
          <div className="pnh">
            <h3>🛡️ Compliance Overview</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/credentialing')}>
              Manage →
            </button>
          </div>
          <div className="pnb">
            {/* Large compliance rate */}
            <div style={{
              textAlign: 'center',
              padding: '20px 0 16px',
              borderBottom: '1px solid var(--bd)',
              marginBottom: 16,
            }}>
              <div style={{
                fontSize: 56,
                fontWeight: 800,
                color: complianceRate >= 90 ? 'var(--ac)' : complianceRate >= 70 ? 'var(--wn)' : 'var(--dg)',
                lineHeight: 1,
              }}>
                {complianceRate}%
              </div>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginTop: 6 }}>Overall Credential Compliance</div>
            </div>

            {/* Expired list */}
            {alreadyExpired.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--dg)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Expired ({alreadyExpired.length})
                </div>
                {alreadyExpired.slice(0, 3).map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      background: 'rgba(220,38,38,0.06)',
                      borderRadius: 6,
                      marginBottom: 4,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: 'var(--t1)', fontWeight: 500 }}>
                      {c.first_name} {c.last_name}
                    </span>
                    <span style={{ color: 'var(--dg)', fontWeight: 600 }}>{c.type}</span>
                  </div>
                ))}
                {alreadyExpired.length > 3 && (
                  <div
                    style={{ fontSize: 12, color: 'var(--pr)', cursor: 'pointer', padding: '4px 0' }}
                    onClick={() => navigate('/credentialing')}
                  >
                    +{alreadyExpired.length - 3} more
                  </div>
                )}
              </div>
            )}

            {/* Expiring within 30d */}
            {expiringSoon.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--wn)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Expiring Within 30 Days ({expiringSoon.length})
                </div>
                {expiringSoon.slice(0, 3).map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      background: 'rgba(234,88,12,0.06)',
                      borderRadius: 6,
                      marginBottom: 4,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: 'var(--t1)', fontWeight: 500 }}>
                      {c.first_name} {c.last_name}
                    </span>
                    <span style={{ color: 'var(--wn)', fontWeight: 600 }}>{c.type}</span>
                  </div>
                ))}
              </div>
            )}

            {expiredCount === 0 && expiringCount === 0 && (
              <div style={{ textAlign: 'center', padding: '16px', color: 'var(--ac)', fontWeight: 600 }}>
                🎉 All credentials current
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Workforce Summary + Quick Actions */}
      <div className="grid-2" style={{ marginTop: 20 }}>
        {/* Workforce Summary */}
        <div className="pn">
          <div className="pnh">
            <h3>📊 Workforce Summary</h3>
          </div>
          <div className="pnb">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: 'Active Staff', value: staffCount, color: 'var(--ac)', nav: '/staff' },
                { label: 'In Onboarding', value: onboardingCount, color: '#7c3aed', nav: '/onboarding' },
                { label: 'Active Placements', value: activePlacementsCount, color: 'var(--pr)', nav: '/placements' },
                { label: 'Pending Placements', value: pendingCount, color: 'var(--wn)', nav: '/placements' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    background: 'var(--sf3)',
                    borderRadius: 8,
                    padding: '14px 16px',
                    cursor: 'pointer',
                    border: '1px solid var(--bd)',
                  }}
                  onClick={() => navigate(stat.nav)}
                >
                  <div style={{ fontSize: 26, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 3 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="pn">
          <div className="pnh">
            <h3>⚡ Quick Actions</h3>
          </div>
          <div className="pnb">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {quickActions.map((action) => (
                <div
                  key={action.label}
                  style={{
                    background: 'var(--sf3)',
                    border: '1px solid var(--bd)',
                    borderRadius: 10,
                    padding: '16px 10px',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => navigate(action.nav)}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(30,64,175,0.12)')}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
                >
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{action.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{action.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
