import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { staffApi, placementsApi, credentialsApi, remindersApi } from '../../lib/api';

export default function ManagementDashboard() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const { data: staffData } = useQuery({
    queryKey: ['mgmt-staff-active'],
    queryFn: () => staffApi.list({ status: 'active' }),
  });

  const { data: onboardingStaff, isLoading: loadingOnboarding } = useQuery({
    queryKey: ['mgmt-staff-onboarding'],
    queryFn: () => staffApi.list({ status: 'onboarding' }),
  });

  const { data: expiringData } = useQuery({
    queryKey: ['mgmt-credentials-expiring'],
    queryFn: () => credentialsApi.expiring(),
  });

  const { data: openPositions } = useQuery({
    queryKey: ['mgmt-placements-unfilled'],
    queryFn: () => placementsApi.list({ status: 'unfilled' }),
  });

  const { data: remindersData, isLoading: loadingReminders } = useQuery({
    queryKey: ['mgmt-reminders'],
    queryFn: () => remindersApi.list(),
  });

  const { data: recentPlacements, isLoading: loadingPlacements } = useQuery({
    queryKey: ['mgmt-placements-recent'],
    queryFn: () => placementsApi.list({ status: 'active' }),
  });

  const staffCount = staffData?.data?.staff?.length ?? 0;
  const onboardingList = onboardingStaff?.data?.staff ?? [];
  const expiringCount = (expiringData?.data?.expiringSoon?.length ?? 0) + (expiringData?.data?.alreadyExpired?.length ?? 0);
  const openCount = openPositions?.data?.placements?.length ?? 0;
  const allReminders = remindersData?.data?.reminders ?? [];
  const todayStr = new Date().toDateString();
  const todayReminders = allReminders.filter((r) => {
    if (!r.scheduled_at) return false;
    return new Date(r.scheduled_at).toDateString() === todayStr;
  });
  const overdueReminders = allReminders.filter((r) => r.status === 'overdue');
  const pendingReviews = allReminders.filter((r) => r.status === 'scheduled').length;
  const recentPlacementsList = recentPlacements?.data?.placements?.slice(0, 5) ?? [];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--t1)' }}>Management Dashboard</h1>
            <p style={{ color: 'var(--t3)', fontSize: 14 }}>{today}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/reminders')}>
              🔔 Reminders
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate('/staff')}>
              + Add Staff
            </button>
          </div>
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="sc-grid">
        <div className="sc" style={{ borderTop: '3px solid var(--pr)' }}>
          <div className="sc-icon" style={{ background: 'rgba(30,64,175,0.1)', color: 'var(--pr)' }}>👥</div>
          <div className="sc-label">Active Staff</div>
          <div className="sc-value">{staffCount}</div>
          <div className="sc-sub">Currently active</div>
        </div>

        <div className="sc" style={{ borderTop: `3px solid ${openCount > 0 ? 'var(--wn)' : 'var(--ac)'}` }}>
          <div className="sc-icon" style={{ background: 'rgba(234,88,12,0.1)', color: 'var(--wn)' }}>📌</div>
          <div className="sc-label">Open Positions</div>
          <div className="sc-value" style={{ color: openCount > 0 ? 'var(--wn)' : 'var(--t1)' }}>{openCount}</div>
          <div className="sc-sub">Unfilled requisitions</div>
        </div>

        <div className="sc" style={{ borderTop: `3px solid ${expiringCount > 0 ? 'var(--dg)' : 'var(--ac)'}` }}>
          <div className="sc-icon" style={{ background: expiringCount > 0 ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.1)', color: expiringCount > 0 ? 'var(--dg)' : 'var(--ac)' }}>📋</div>
          <div className="sc-label">Credentials Expiring</div>
          <div className="sc-value" style={{ color: expiringCount > 0 ? 'var(--dg)' : 'var(--ac)' }}>{expiringCount}</div>
          <div className="sc-sub">Expired + expiring soon</div>
        </div>

        <div className="sc" style={{ borderTop: `3px solid ${pendingReviews > 0 ? 'var(--wn)' : 'var(--ac)'}` }}>
          <div className="sc-icon" style={{ background: 'rgba(234,88,12,0.1)', color: 'var(--wn)' }}>📝</div>
          <div className="sc-label">Pending Reviews</div>
          <div className="sc-value">{pendingReviews}</div>
          <div className="sc-sub">Scheduled reminders</div>
        </div>
      </div>

      {/* Row 1: Team Reminders + Staff in Onboarding */}
      <div className="grid-2">
        {/* Team Reminders */}
        <div className="pn">
          <div className="pnh">
            <h3>🔔 Team Reminders</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/reminders')}>
              View All →
            </button>
          </div>
          <div className="pnb" style={{ padding: '8px 18px' }}>
            {loadingReminders ? (
              <div className="spinner" style={{ margin: '24px auto' }} />
            ) : todayReminders.length === 0 && overdueReminders.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-icon">🎉</div>
                <h3>No reminders today</h3>
                <p>You're all clear for today.</p>
              </div>
            ) : (
              <>
                {overdueReminders.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dg)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, marginTop: 4 }}>
                      Overdue ({overdueReminders.length})
                    </div>
                    {overdueReminders.slice(0, 3).map((r) => (
                      <div key={r.id} className="action-item" style={{ marginBottom: 6 }}>
                        <div className="action-dot red" />
                        <div className="action-content">
                          <div className="action-title">{r.subject}</div>
                          <div className="action-meta">{r.recipient_name ?? r.candidate_name ?? '—'}</div>
                        </div>
                        <span className="tg" style={{ background: 'rgba(220,38,38,0.1)', color: 'var(--dg)', fontSize: 11 }}>Overdue</span>
                      </div>
                    ))}
                  </>
                )}
                {todayReminders.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pr)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, marginTop: 10 }}>
                      Today ({todayReminders.length})
                    </div>
                    {todayReminders.slice(0, 4).map((r) => (
                      <div key={r.id} className="action-item" style={{ marginBottom: 6 }}>
                        <div className="action-dot blue" />
                        <div className="action-content">
                          <div className="action-title">{r.subject}</div>
                          <div className="action-meta">{r.recipient_name ?? r.candidate_name ?? '—'}</div>
                        </div>
                        <span className="tg" style={{ fontSize: 11 }}>Scheduled</span>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Staff In Onboarding */}
        <div className="pn">
          <div className="pnh">
            <h3>🎓 Staff In Onboarding</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/onboarding')}>
              View All →
            </button>
          </div>
          <div className="pnb" style={{ padding: '8px 18px' }}>
            {loadingOnboarding ? (
              <div className="spinner" style={{ margin: '24px auto' }} />
            ) : onboardingList.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-icon">✅</div>
                <h3>No staff in onboarding</h3>
                <p>Everyone is fully onboarded.</p>
              </div>
            ) : (
              onboardingList.slice(0, 6).map((s) => {
                const daysSince = Math.floor(
                  (Date.now() - new Date(s.created_at).getTime()) / 86400000
                );
                return (
                  <div
                    key={s.id}
                    className="action-item"
                    style={{ cursor: 'pointer', marginBottom: 6 }}
                    onClick={() => navigate(`/staff/${s.id}`)}
                  >
                    <div style={{
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      background: 'rgba(124,58,237,0.12)',
                      color: '#7c3aed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 13,
                      flexShrink: 0,
                    }}>
                      {s.first_name[0]}{s.last_name[0]}
                    </div>
                    <div className="action-content">
                      <div className="action-title">{s.first_name} {s.last_name}</div>
                      <div className="action-meta">{s.role ?? 'Staff'} · Day {daysSince}</div>
                    </div>
                    <span style={{ color: 'var(--t3)', fontSize: 16 }}>›</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Recent Activity + Quick Access */}
      <div className="grid-2" style={{ marginTop: 20 }}>
        {/* Recent Activity */}
        <div className="pn">
          <div className="pnh">
            <h3>📋 Recent Placements</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/placements')}>
              View All →
            </button>
          </div>
          <div className="pnb" style={{ padding: '8px 18px' }}>
            {loadingPlacements ? (
              <div className="spinner" style={{ margin: '24px auto' }} />
            ) : recentPlacementsList.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-icon">📋</div>
                <h3>No recent placements</h3>
              </div>
            ) : (
              recentPlacementsList.map((p) => (
                <div
                  key={p.id}
                  className="action-item"
                  style={{ cursor: 'pointer', marginBottom: 6 }}
                  onClick={() => navigate(`/placements`)}
                >
                  <div className="action-dot blue" />
                  <div className="action-content">
                    <div className="action-title">
                      {p.first_name} {p.last_name} — {p.role}
                    </div>
                    <div className="action-meta">
                      {p.facility_name ?? 'Unassigned'} ·{' '}
                      {p.start_date ? new Date(p.start_date).toLocaleDateString() : 'TBD'}
                    </div>
                  </div>
                  <span className="tg" style={{ fontSize: 11 }}>Active</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Access */}
        <div className="pn">
          <div className="pnh">
            <h3>⚡ Quick Access</h3>
          </div>
          <div className="pnb">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { icon: '🔔', label: 'Reminders', nav: '/reminders', color: '#0891b2' },
                { icon: '🎓', label: 'Onboarding', nav: '/onboarding', color: '#7c3aed' },
                { icon: '📋', label: 'Credentialing', nav: '/credentialing', color: 'var(--dg)' },
                { icon: '👥', label: 'Staff', nav: '/staff', color: 'var(--pr)' },
              ].map((link) => (
                <div
                  key={link.label}
                  style={{
                    background: 'var(--sf3)',
                    border: '1px solid var(--bd)',
                    borderRadius: 10,
                    padding: '20px 14px',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => navigate(link.nav)}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(30,64,175,0.12)')}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
                >
                  <div style={{ fontSize: 26, marginBottom: 8 }}>{link.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>{link.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
