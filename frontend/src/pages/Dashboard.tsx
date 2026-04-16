import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import { staffApi, placementsApi, credentialsApi, onboardingApi } from '../lib/api';

function relativeTimeAgo(ms: number): string {
  if (!ms) return 'never';
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user } = useUser();
  const navigate = useNavigate();
  const firstName = user?.firstName ?? 'there';
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const { data: staffData, dataUpdatedAt: staffUpdatedAt } = useQuery({
    queryKey: ['staff-active'],
    queryFn: () => staffApi.list({ status: 'active' }),
    refetchInterval: 60000,
  });

  const { data: pendingData, dataUpdatedAt: pendingUpdatedAt } = useQuery({
    queryKey: ['placements-pending'],
    queryFn: () => placementsApi.list({ status: 'pending' }),
    refetchInterval: 60000,
  });

  const { data: onboardingStaff, dataUpdatedAt: onboardingUpdatedAt } = useQuery({
    queryKey: ['staff-onboarding'],
    queryFn: () => staffApi.list({ status: 'onboarding' }),
    refetchInterval: 60000,
  });

  const { data: expiringData, dataUpdatedAt: expiringUpdatedAt } = useQuery({
    queryKey: ['credentials-expiring'],
    queryFn: () => credentialsApi.expiring(),
    refetchInterval: 60000,
  });

  const { data: onboardingData } = useQuery({
    queryKey: ['onboarding-summary'],
    queryFn: () => onboardingApi.summary(),
    refetchInterval: 60000,
  });

  // Use the most-recent fetch for the header "updated" indicator
  const lastUpdated = Math.max(staffUpdatedAt ?? 0, pendingUpdatedAt ?? 0, onboardingUpdatedAt ?? 0, expiringUpdatedAt ?? 0);

  // Re-render every 10s so the "updated Xs ago" text stays accurate
  const [, setTick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(h);
  }, []);

  const activeEmployees = staffData?.data?.staff?.length ?? 0;
  const pendingPlacements = pendingData?.data?.placements?.length ?? 0;
  const onboardingCount = onboardingStaff?.data?.staff?.length ?? 0;
  const expiringSoon = expiringData?.data?.expiringSoon ?? [];
  const alreadyExpired = expiringData?.data?.alreadyExpired ?? [];
  const expiringCreds = expiringSoon.length;
  const expiredCreds = alreadyExpired.length;
  const expiringWithin7 = expiringSoon.filter((c) => {
    if (!c.expiry_date) return false;
    const days = Math.ceil((new Date(c.expiry_date).getTime() - Date.now()) / 86400000);
    return days <= 7;
  }).length;
  const totalCredIssues = expiredCreds + expiringCreds;
  const complianceRate =
    totalCredIssues === 0
      ? 100
      : Math.max(0, Math.round(100 - (totalCredIssues / Math.max(1, activeEmployees)) * 20));
  const criticalAlert = expiredCreds > 0 || expiringCreds >= 3;

  const quickLinks = [
    { icon: '👥', label: 'Candidates', nav: '/candidates', color: 'var(--pr)' },
    { icon: '📋', label: 'Credentialing', nav: '/credentialing', color: 'var(--dg)' },
    { icon: '🎓', label: 'Onboarding', nav: '/onboarding', color: 'var(--wn)' },
    { icon: '🔗', label: 'Placements', nav: '/placements', color: '#7c3aed' },
    { icon: '🔔', label: 'Reminders', nav: '/reminders', color: '#0891b2' },
    { icon: '📊', label: 'Reports', nav: '/reports', color: 'var(--ac)' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>{getGreeting()}, {firstName} 👋</h1>
            <p style={{ color: 'var(--t3)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{today}</span>
              <span
                title="Live data — refreshes every 60 seconds"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(22,163,74,0.1)', color: 'var(--ac)', fontWeight: 600 }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ac)' }} />
                Live · updated {relativeTimeAgo(lastUpdated)}
              </span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/ai-assistant')}>
              🤖 Ask AI
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate('/staff')}>
              + Add Staff
            </button>
          </div>
        </div>
      </div>

      {/* Critical alert banner */}
      {criticalAlert && (
        <div className="critical-banner">
          <span>🚨</span>
          <div>
            <strong>Compliance Alert: </strong>
            {expiredCreds > 0 && `${expiredCreds} expired credential${expiredCreds > 1 ? 's' : ''} require immediate attention. `}
            {expiringCreds > 0 && `${expiringCreds} credential${expiringCreds > 1 ? 's' : ''} expiring within 30 days.`}
            <span
              className="cta-link"
              style={{ marginLeft: 8 }}
              onClick={() => navigate('/credentialing')}
            >
              View now →
            </span>
          </div>
        </div>
      )}

      {/* 4 Stat cards — clickable, each routes to the filtered destination */}
      <div className="sc-grid">
        <div
          className="sc"
          style={{ borderTop: '3px solid var(--pr)', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
          onClick={() => navigate('/staff')}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 12px rgba(30,64,175,0.12)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
          title="Open Staff"
        >
          <div className="sc-icon" style={{ background: 'rgba(30,64,175,0.1)', color: 'var(--pr)' }}>👥</div>
          <div className="sc-label">Active Employees</div>
          <div className="sc-value">{activeEmployees}</div>
          <div className="sc-sub">Currently active staff</div>
        </div>

        <div
          className="sc"
          style={{ borderTop: '3px solid var(--wn)', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
          onClick={() => navigate('/placements')}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 12px rgba(234,88,12,0.12)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
          title="Open Placements"
        >
          <div className="sc-icon" style={{ background: 'rgba(234,88,12,0.1)', color: 'var(--wn)' }}>⏳</div>
          <div className="sc-label">Pending Placements</div>
          <div className="sc-value" style={{ color: pendingPlacements > 0 ? 'var(--wn)' : 'var(--t1)' }}>
            {pendingPlacements}
          </div>
          <div className="sc-sub">Awaiting confirmation</div>
        </div>

        <div
          className="sc"
          style={{ borderTop: '3px solid #7c3aed', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
          onClick={() => navigate('/onboarding')}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 12px rgba(124,58,237,0.12)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
          title="Open Onboarding"
        >
          <div className="sc-icon" style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>🎓</div>
          <div className="sc-label">In Onboarding</div>
          <div className="sc-value">{onboardingCount}</div>
          <div className="sc-sub">Completing onboarding</div>
        </div>

        <div
          className="sc"
          style={{ borderTop: `3px solid ${complianceRate >= 90 ? 'var(--ac)' : complianceRate >= 70 ? 'var(--wn)' : 'var(--dg)'}`, cursor: 'pointer', transition: 'box-shadow 0.15s' }}
          onClick={() => navigate('/compliance/admin/records')}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 12px rgba(22,163,74,0.12)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
          title="Open Compliance Records"
        >
          <div className="sc-icon" style={{ background: 'rgba(22,163,74,0.1)', color: 'var(--ac)' }}>✅</div>
          <div className="sc-label">Compliance Rate</div>
          <div className="sc-value" style={{ color: complianceRate >= 90 ? 'var(--ac)' : complianceRate >= 70 ? 'var(--wn)' : 'var(--dg)' }}>
            {complianceRate}%
          </div>
          <div className="sc-sub">Credential compliance</div>
        </div>
      </div>

      {/* Row 1: Immediate Actions + Compliance Alerts */}
      <div className="grid-2">
        {/* Immediate Actions */}
        <div className="pn">
          <div className="pnh">
            <h3>⚡ Immediate Actions</h3>
            <span className="tgr" style={{ fontSize: 11 }}>Live</span>
          </div>
          <div className="pnb" style={{ padding: '8px 18px' }}>
            {totalCredIssues === 0 && onboardingCount === 0 ? (
              <div className="empty-state" style={{ padding: '24px' }}>
                <div className="empty-state-icon">🎉</div>
                <h3>All caught up!</h3>
                <p>No immediate actions required.</p>
              </div>
            ) : (
              <>
                {expiredCreds > 0 && (
                  <div className="action-item">
                    <div className="action-dot red" />
                    <div className="action-content">
                      <div className="action-title">
                        {expiredCreds} Expired Credential{expiredCreds > 1 ? 's' : ''}
                      </div>
                      <div className="action-meta">Remove from placement until renewed</div>
                    </div>
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => navigate('/credentialing')}>
                      Fix Now
                    </button>
                  </div>
                )}
                {expiringWithin7 > 0 && (
                  <div className="action-item">
                    <div className="action-dot red" />
                    <div className="action-content">
                      <div className="action-title">
                        {expiringWithin7} Credential{expiringWithin7 > 1 ? 's' : ''} Expiring This Week
                      </div>
                      <div className="action-meta">Expires within 7 days — urgent renewal needed</div>
                    </div>
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => navigate('/credentialing')}>
                      Fix Now
                    </button>
                  </div>
                )}
                {expiringCreds > expiringWithin7 && (
                  <div className="action-item">
                    <div className="action-dot orange" />
                    <div className="action-content">
                      <div className="action-title">
                        {expiringCreds - expiringWithin7} Credential{expiringCreds - expiringWithin7 > 1 ? 's' : ''} Expiring Soon
                      </div>
                      <div className="action-meta">Within 30 days — notify staff to renew</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/credentialing')}>
                      Review
                    </button>
                  </div>
                )}
                {onboardingCount > 0 && (
                  <div className="action-item">
                    <div className="action-dot blue" />
                    <div className="action-content">
                      <div className="action-title">
                        {onboardingCount} Staff in Onboarding
                      </div>
                      <div className="action-meta">Complete onboarding to activate placement eligibility</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/onboarding')}>
                      View
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Compliance Alerts */}
        <div className="pn">
          <div className="pnh">
            <h3>🛡️ Compliance Alerts</h3>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => navigate('/credentialing')}
            >
              Manage →
            </button>
          </div>
          <div className="pnb" style={{ padding: '8px 18px' }}>
            {[
              {
                label: 'Expired Credentials',
                value: expiredCreds,
                color: 'var(--dg)',
                bg: 'rgba(220,38,38,0.07)',
                icon: '🔴',
                urgent: true,
              },
              {
                label: 'Expiring Within 7 Days',
                value: expiringWithin7,
                color: 'var(--dg)',
                bg: 'rgba(220,38,38,0.05)',
                icon: '🔴',
                urgent: true,
              },
              {
                label: 'Expiring Within 30 Days',
                value: expiringCreds,
                color: 'var(--wn)',
                bg: 'rgba(234,88,12,0.06)',
                icon: '🟠',
                urgent: false,
              },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: item.value > 0 ? item.bg : 'var(--sf3)',
                  marginBottom: 10,
                  border: `1px solid ${item.value > 0 ? item.color + '40' : 'var(--bd)'}`,
                  cursor: 'pointer',
                }}
                onClick={() => navigate('/credentialing')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{item.icon}</span>
                  <span style={{ fontSize: 13, color: 'var(--t2)', fontWeight: 500 }}>{item.label}</span>
                </div>
                <span style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: item.value > 0 ? item.color : 'var(--ac)',
                }}>
                  {item.value}
                </span>
              </div>
            ))}
            <div
              style={{
                textAlign: 'center',
                padding: '8px',
                fontSize: 13,
                color: 'var(--pr)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={() => navigate('/credentialing')}
            >
              View all in Credentialing →
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Workforce Overview */}
      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="pn">
          <div className="pnh">
            <h3>📊 Workforce Overview</h3>
          </div>
          <div className="pnb">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: 'Active Employees', value: activeEmployees, color: 'var(--ac)', nav: '/staff' },
                { label: 'Pending Placements', value: pendingPlacements, color: pendingPlacements > 0 ? 'var(--wn)' : 'var(--t1)', nav: '/placements' },
                { label: 'Onboarding Stage', value: onboardingCount, color: '#7c3aed', nav: '/onboarding' },
                { label: 'Credential Alerts', value: totalCredIssues, color: totalCredIssues > 0 ? 'var(--dg)' : 'var(--ac)', nav: '/credentialing' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    background: 'var(--sf3)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    border: '1px solid var(--bd)',
                  }}
                  onClick={() => navigate(stat.nav)}
                >
                  <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="pn">
          <div className="pnh">
            <h3>🔗 Quick Access</h3>
          </div>
          <div className="pnb">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {quickLinks.map((link) => (
                <div
                  key={link.label}
                  style={{
                    background: 'var(--sf3)',
                    border: '1px solid var(--bd)',
                    borderRadius: 10,
                    padding: '16px 10px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.15s',
                  }}
                  onClick={() => navigate(link.nav)}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(30,64,175,0.12)')}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
                >
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{link.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{link.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
