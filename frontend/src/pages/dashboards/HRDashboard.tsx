import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { staffApi, credentialsApi, incidentsApi, remindersApi } from '../../lib/api';
import DailySummaryWidget from '../../components/DailySummaryWidget';

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function expiryColor(days: number): string {
  if (days < 0) return 'var(--dg)';
  if (days <= 7) return 'var(--dg)';
  if (days <= 14) return 'var(--wn)';
  return '#ca8a04';
}

interface EmployeeRelation { id: string; staffId: string; name: string; date: string; type: string; severity: string; }

export default function HRDashboard() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const todayStr = new Date().toDateString();
  const [employeeRelations, setEmployeeRelations] = useState<EmployeeRelation[]>([]);

  const { data: staffData } = useQuery({
    queryKey: ['hr-staff-active'],
    queryFn: () => staffApi.list({ status: 'active' }),
  });

  const { data: onboardingStaff, isLoading: loadingOnboarding } = useQuery({
    queryKey: ['hr-staff-onboarding'],
    queryFn: () => staffApi.list({ status: 'onboarding' }),
  });

  const { data: expiringData, isLoading: loadingExpiring } = useQuery({
    queryKey: ['hr-credentials-expiring'],
    queryFn: () => credentialsApi.expiring(),
  });

  const { data: incidentsData, isLoading: loadingIncidents } = useQuery({
    queryKey: ['hr-incidents'],
    queryFn: () => incidentsApi.list({ status: 'open' }),
  });

  const { data: remindersData, isLoading: loadingReminders } = useQuery({
    queryKey: ['hr-reminders'],
    queryFn: () => remindersApi.list(),
  });

  useEffect(() => {
    // Collect write-ups from all staff localStorage keys
    const relations: EmployeeRelation[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      if (key.startsWith('fns_staff_writeups_')) {
        const staffId = key.replace('fns_staff_writeups_', '');
        try {
          const items = JSON.parse(localStorage.getItem(key) ?? '[]');
          items.forEach((wu: any) => {
            relations.push({ id: wu.id, staffId, name: wu.issued_by ?? 'Staff', date: wu.date, type: wu.type, severity: wu.severity });
          });
        } catch {}
      }
    }
    relations.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setEmployeeRelations(relations.slice(0, 6));
  }, []);

  const staffCount = staffData?.data?.staff?.length ?? 0;
  const onboardingList = onboardingStaff?.data?.staff ?? [];
  const expiringSoon = expiringData?.data?.expiringSoon ?? [];
  const alreadyExpired = expiringData?.data?.alreadyExpired ?? [];
  const credentialAlerts = expiringSoon.length + alreadyExpired.length;
  const incidentList = incidentsData?.data?.incidents ?? [];
  const incidentsThisMonth = incidentList.filter((i) => {
    const d = new Date(i.created_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const allReminders = remindersData?.data?.reminders ?? [];
  const reviewsDue = allReminders.filter((r) => r.status === 'scheduled' || r.status === 'overdue').length;
  const todayReminders = allReminders.filter(
    (r) => r.scheduled_at && new Date(r.scheduled_at).toDateString() === todayStr
  );

  const allExpiring = [...alreadyExpired, ...expiringSoon]
    .filter((c) => c.expiry_date)
    .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime());

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--t1)' }}>HR Dashboard</h1>
            <p style={{ color: 'var(--t3)', fontSize: 14 }}>{today}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/incidents')}>
              🚨 Incidents
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate('/staff')}>
              + Add Employee
            </button>
          </div>
        </div>
      </div>

      {/* Daily Intelligence Widget */}
      <DailySummaryWidget />

      {/* 5 Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Active Employees', value: staffCount, color: 'var(--pr)', icon: '👥' },
          { label: 'Attendance Issues', value: 0, color: 'var(--ac)', icon: '⏱' },
          { label: 'Credential Alerts', value: credentialAlerts, color: credentialAlerts > 0 ? 'var(--dg)' : 'var(--ac)', icon: '⚠️' },
          { label: 'Incidents This Month', value: incidentsThisMonth, color: incidentsThisMonth > 0 ? 'var(--wn)' : 'var(--ac)', icon: '🚨' },
          { label: 'Employee Relations', value: employeeRelations.length, color: employeeRelations.length > 0 ? 'var(--wn)' : 'var(--ac)', icon: '📝' },
        ].map((stat) => (
          <div key={stat.label} className="sc" style={{ borderTop: `3px solid ${stat.color}` }}>
            <div className="sc-icon" style={{ background: `${stat.color}18`, color: stat.color }}>{stat.icon}</div>
            <div className="sc-label">{stat.label}</div>
            <div className="sc-value" style={{ color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Row 1: Credential Expiration Tracker + Active Onboarding */}
      <div className="grid-2">
        {/* Credential Expiration Tracker */}
        <div className="pn">
          <div className="pnh">
            <h3>📋 Credential Expiration Tracker</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/credentialing')}>
              Manage →
            </button>
          </div>
          <div className="pnb" style={{ padding: '4px 0' }}>
            {loadingExpiring ? (
              <div className="spinner" style={{ margin: '24px auto' }} />
            ) : allExpiring.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-icon">✅</div>
                <h3>All credentials current</h3>
                <p>No credentials expiring within 30 days.</p>
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: 340 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--sf3)' }}>
                      {['Employee', 'Credential', 'Expires', 'Days'].map((h) => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allExpiring.slice(0, 10).map((c) => {
                      const days = daysUntil(c.expiry_date!);
                      const color = expiryColor(days);
                      return (
                        <tr key={c.id} style={{ borderTop: '1px solid var(--bd)' }}>
                          <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 500, color: 'var(--t1)' }}>
                            {c.first_name} {c.last_name}
                          </td>
                          <td style={{ padding: '9px 14px', fontSize: 12, color: 'var(--t2)' }}>{c.type}</td>
                          <td style={{ padding: '9px 14px', fontSize: 12, color: 'var(--t3)' }}>
                            {new Date(c.expiry_date!).toLocaleDateString()}
                          </td>
                          <td style={{ padding: '9px 14px' }}>
                            <span style={{
                              fontSize: 12, fontWeight: 700, color,
                              background: `${color}18`,
                              borderRadius: 6, padding: '2px 8px',
                            }}>
                              {days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {allExpiring.length > 10 && (
                  <div
                    style={{ textAlign: 'center', padding: '10px', fontSize: 13, color: 'var(--pr)', cursor: 'pointer', fontWeight: 600 }}
                    onClick={() => navigate('/credentialing')}
                  >
                    +{allExpiring.length - 10} more — view all
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Attendance Summary */}
        <div className="pn">
          <div className="pnh">
            <h3>⏱ Attendance Summary</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/time-tracking/admin')}>
              Admin View →
            </button>
          </div>
          <div className="pnb" style={{ padding: '18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              {[
                { label: 'Active Today', value: staffCount, color: 'var(--ac)', icon: '✅' },
                { label: 'On Leave', value: onboardingList.length, color: '#7c3aed', icon: '🏖' },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--sf3)', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>{s.icon} {s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, color: 'var(--t3)', textAlign: 'center', fontStyle: 'italic' }}>
              Detailed attendance tracking available in{' '}
              <span style={{ color: 'var(--pr)', cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate('/time-tracking')}>
                Time Tracking
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Recent Incidents + Reminders Due + Employee Relations */}
      <div className="grid-2" style={{ marginTop: 20 }}>
        {/* Recent Incidents */}
        <div className="pn">
          <div className="pnh">
            <h3>🚨 Recent Incidents</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/incidents')}>
              View All →
            </button>
          </div>
          <div className="pnb" style={{ padding: '8px 18px' }}>
            {loadingIncidents ? (
              <div className="spinner" style={{ margin: '24px auto' }} />
            ) : incidentList.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-icon">✅</div>
                <h3>No open incidents</h3>
                <p>All incidents resolved.</p>
              </div>
            ) : (
              incidentList.slice(0, 5).map((inc) => (
                <div
                  key={inc.id}
                  className="action-item"
                  style={{ cursor: 'pointer', marginBottom: 6 }}
                  onClick={() => navigate('/incidents')}
                >
                  <div className="action-dot orange" />
                  <div className="action-content">
                    <div className="action-title">{inc.type}</div>
                    <div className="action-meta">
                      {inc.first_name} {inc.last_name} · {new Date(inc.date).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="tw" style={{ fontSize: 11, textTransform: 'capitalize' }}>
                    {inc.status.replace('_', ' ')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Reminders Due + Quick Links */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="pn" style={{ flex: 1 }}>
            <div className="pnh">
              <h3>🔔 Reminders Due Today</h3>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/reminders')}>
                Manage →
              </button>
            </div>
            <div className="pnb" style={{ padding: '8px 18px' }}>
              {loadingReminders ? (
                <div className="spinner" style={{ margin: '16px auto' }} />
              ) : todayReminders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '18px', color: 'var(--t3)', fontSize: 13 }}>
                  No reminders scheduled for today.
                </div>
              ) : (
                todayReminders.slice(0, 4).map((r) => (
                  <div key={r.id} className="action-item" style={{ marginBottom: 6 }}>
                    <div className={`action-dot ${r.status === 'overdue' ? 'red' : 'blue'}`} />
                    <div className="action-content">
                      <div className="action-title">{r.subject}</div>
                      <div className="action-meta">{r.recipient_name ?? r.candidate_name ?? '—'}</div>
                    </div>
                    <span className={r.status === 'overdue' ? 'tg' : 'tg'} style={{
                      background: r.status === 'overdue' ? 'rgba(220,38,38,0.1)' : 'rgba(30,64,175,0.08)',
                      color: r.status === 'overdue' ? 'var(--dg)' : 'var(--pr)',
                      fontSize: 11,
                    }}>
                      {r.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Links */}
          <div className="pn">
            <div className="pnh"><h3>⚡ Quick Links</h3></div>
            <div className="pnb">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { icon: '👥', label: 'Staff', nav: '/staff' },
                  { icon: '📋', label: 'Credentialing', nav: '/credentialing' },
                  { icon: '🎓', label: 'Onboarding', nav: '/onboarding' },
                  { icon: '🚨', label: 'Incidents', nav: '/incidents' },
                  { icon: '🔔', label: 'Reminders', nav: '/reminders' },
                  { icon: '📊', label: 'Reports', nav: '/reports' },
                ].map((link) => (
                  <div
                    key={link.label}
                    style={{
                      background: 'var(--sf3)', border: '1px solid var(--bd)',
                      borderRadius: 8, padding: '10px 8px', textAlign: 'center', cursor: 'pointer',
                    }}
                    onClick={() => navigate(link.nav)}
                    onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 10px rgba(30,64,175,0.1)')}
                    onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{link.icon}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)' }}>{link.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Employee Relations Log */}
      <div style={{ marginTop: 20 }}>
        <div className="pn">
          <div className="pnh">
            <h3>📝 Employee Relations Log</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/staff')}>
              Staff Profiles →
            </button>
          </div>
          <div className="pnb" style={{ padding: '8px 18px' }}>
            {employeeRelations.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-icon">✅</div>
                <h3>No write-ups recorded</h3>
                <p>Add write-ups from individual staff profiles.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--sf3)' }}>
                    {['Employee', 'Incident Type', 'Severity', 'Date', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employeeRelations.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--bd)' }}>
                      <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 500, color: 'var(--t1)' }}>{r.name}</td>
                      <td style={{ padding: '9px 14px', fontSize: 12, color: 'var(--t2)' }}>{r.type}</td>
                      <td style={{ padding: '9px 14px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize', background: r.severity === 'verbal' ? '#dbeafe' : r.severity === 'written' ? '#fef3c7' : '#fee2e2', color: r.severity === 'verbal' ? '#1d4ed8' : r.severity === 'written' ? '#92400e' : '#991b1b', padding: '2px 8px', borderRadius: 6 }}>
                          {r.severity}
                        </span>
                      </td>
                      <td style={{ padding: '9px 14px', fontSize: 12, color: 'var(--t3)' }}>{new Date(r.date).toLocaleDateString()}</td>
                      <td style={{ padding: '9px 14px' }}>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate(`/staff/${r.staffId}`)}>View Profile</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
