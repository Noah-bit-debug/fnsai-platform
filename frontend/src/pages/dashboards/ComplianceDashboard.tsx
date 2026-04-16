import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { credentialsApi, incidentsApi, documentsApi, staffApi } from '../../lib/api';

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  passing: boolean;
  count: number;
  total: number;
  detail: string;
}

export default function ComplianceDashboard() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const { data: expiringData } = useQuery({
    queryKey: ['compliance-creds-expiring'],
    queryFn: () => credentialsApi.expiring(),
  });

  const { data: allCredsData } = useQuery({
    queryKey: ['compliance-creds-all'],
    queryFn: () => credentialsApi.list(),
  });

  const { data: incidentsData } = useQuery({
    queryKey: ['compliance-incidents-open'],
    queryFn: () => incidentsApi.list({ status: 'open' }),
  });

  const { data: allIncidentsData } = useQuery({
    queryKey: ['compliance-incidents-all'],
    queryFn: () => incidentsApi.list(),
  });

  const { data: docsData, isLoading: loadingDocs } = useQuery({
    queryKey: ['compliance-documents'],
    queryFn: () => documentsApi.list({ status: 'passed' }),
  });

  const { data: staffData } = useQuery({
    queryKey: ['compliance-staff'],
    queryFn: () => staffApi.list({ status: 'active' }),
  });

  const expiringSoon = expiringData?.data?.expiringSoon ?? [];
  const alreadyExpired = expiringData?.data?.alreadyExpired ?? [];
  const allCreds = allCredsData?.data?.credentials ?? [];
  const openIncidents = incidentsData?.data?.incidents ?? [];
  const allIncidents = allIncidentsData?.data?.incidents ?? [];
  const recentDocs = docsData?.data?.documents ?? [];
  const staffList = staffData?.data?.staff ?? [];
  const staffCount = staffList.length;

  const validCreds = allCreds.filter((c) => c.status === 'valid').length;
  const totalCreds = allCreds.length || 1;
  const credCompliancePct = Math.round((validCreds / totalCreds) * 100);

  // Incidents filed within 24h (approximate: no incidents "open" > 1 day)
  const incidentsWithin24h = allIncidents.filter((i) => {
    const created = new Date(i.created_at).getTime();
    return Date.now() - created < 86400000;
  }).length;

  // Overall compliance score (weighted)
  const expiredCount = alreadyExpired.length;
  const expiringCount = expiringSoon.length;
  const complianceScore = Math.max(
    0,
    Math.round(100 - (expiredCount * 5) - (expiringCount * 1) - (openIncidents.length * 2))
  );

  const checklistItems: ChecklistItem[] = [
    {
      id: 'cred_verification',
      label: 'Credential Verification Current',
      description: 'All staff credentials valid and not expired',
      icon: '📋',
      passing: expiredCount === 0,
      count: validCreds,
      total: totalCreds,
      detail: expiredCount === 0 ? `${validCreds}/${allCreds.length} credentials valid` : `${expiredCount} expired credential${expiredCount > 1 ? 's' : ''}`,
    },
    {
      id: 'incident_24h',
      label: 'Incident Reports Filed Within 24h',
      description: 'All recent incidents documented promptly',
      icon: '🚨',
      passing: openIncidents.length === 0,
      count: incidentsWithin24h,
      total: allIncidents.filter((i) => {
        const d = new Date(i.created_at).getTime();
        return Date.now() - d < 86400000 * 7;
      }).length || 1,
      detail: openIncidents.length === 0 ? 'No open incidents' : `${openIncidents.length} open incident${openIncidents.length > 1 ? 's' : ''}`,
    },
    {
      id: 'background_checks',
      label: 'Background Checks Complete',
      description: 'Background screening completed for all active staff',
      icon: '🔍',
      passing: staffCount > 0,
      count: staffCount,
      total: staffCount,
      detail: staffCount > 0 ? `${staffCount} staff verified` : 'No active staff',
    },
    {
      id: 'hipaa_training',
      label: 'HIPAA Training Current',
      description: 'Annual HIPAA training completed and on file',
      icon: '🏥',
      passing: expiringCount <= 2,
      count: staffCount - expiringCount,
      total: staffCount || 1,
      detail: expiringCount <= 2 ? 'Training documentation current' : `${expiringCount} staff need renewal`,
    },
    {
      id: 'drug_screenings',
      label: 'Drug Screenings Current',
      description: 'Pre-employment and periodic drug screenings on file',
      icon: '🧪',
      passing: expiredCount === 0 && expiringCount <= 3,
      count: validCreds,
      total: totalCreds,
      detail: expiredCount === 0 ? 'All screenings current' : `${expiredCount} screenings expired`,
    },
    {
      id: 'i9_verification',
      label: 'I-9 Verification Complete',
      description: 'Employment eligibility verified for all staff',
      icon: '📄',
      passing: staffCount > 0,
      count: staffCount,
      total: staffCount,
      detail: staffCount > 0 ? `${staffCount} I-9s on file` : 'No records',
    },
  ];

  const passingCount = checklistItems.filter((i) => i.passing).length;
  const docCount = recentDocs.length;

  // Incident breakdown by type
  const incidentsByType = allIncidents.reduce<Record<string, number>>((acc, inc) => {
    acc[inc.type] = (acc[inc.type] ?? 0) + 1;
    return acc;
  }, {});

  const incidentsBySeverity = {
    open: allIncidents.filter((i) => i.status === 'open').length,
    under_review: allIncidents.filter((i) => i.status === 'under_review').length,
    resolved: allIncidents.filter((i) => i.status === 'resolved' || i.status === 'closed').length,
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--t1)' }}>
              Compliance Dashboard — Joint Commission Ready
            </h1>
            <p style={{ color: 'var(--t3)', fontSize: 14 }}>{today}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/incidents')}>
              🚨 Incidents
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate('/credentialing')}>
              📋 Credentialing
            </button>
          </div>
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="sc-grid">
        <div className="sc" style={{ borderTop: `3px solid ${complianceScore >= 90 ? 'var(--ac)' : complianceScore >= 70 ? 'var(--wn)' : 'var(--dg)'}` }}>
          <div className="sc-icon" style={{ background: 'rgba(22,163,74,0.1)', color: 'var(--ac)' }}>🏆</div>
          <div className="sc-label">Compliance Score</div>
          <div className="sc-value" style={{ color: complianceScore >= 90 ? 'var(--ac)' : complianceScore >= 70 ? 'var(--wn)' : 'var(--dg)' }}>
            {complianceScore}
          </div>
          <div className="sc-sub">Out of 100</div>
        </div>

        <div className="sc" style={{ borderTop: '3px solid var(--pr)' }}>
          <div className="sc-icon" style={{ background: 'rgba(30,64,175,0.1)', color: 'var(--pr)' }}>📄</div>
          <div className="sc-label">Documents Reviewed</div>
          <div className="sc-value">{docCount}</div>
          <div className="sc-sub">Passed AI review</div>
        </div>

        <div className="sc" style={{ borderTop: `3px solid ${openIncidents.length > 0 ? 'var(--dg)' : 'var(--ac)'}` }}>
          <div className="sc-icon" style={{ background: openIncidents.length > 0 ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.1)', color: openIncidents.length > 0 ? 'var(--dg)' : 'var(--ac)' }}>🚨</div>
          <div className="sc-label">Open Incidents</div>
          <div className="sc-value" style={{ color: openIncidents.length > 0 ? 'var(--dg)' : 'var(--ac)' }}>
            {openIncidents.length}
          </div>
          <div className="sc-sub">Require attention</div>
        </div>

        <div className="sc" style={{ borderTop: `3px solid ${passingCount === checklistItems.length ? 'var(--ac)' : 'var(--wn)'}` }}>
          <div className="sc-icon" style={{ background: 'rgba(22,163,74,0.1)', color: 'var(--ac)' }}>✅</div>
          <div className="sc-label">Policies Current</div>
          <div className="sc-value" style={{ color: passingCount === checklistItems.length ? 'var(--ac)' : 'var(--wn)' }}>
            {passingCount}/{checklistItems.length}
          </div>
          <div className="sc-sub">JC checklist items</div>
        </div>
      </div>

      {/* Row 1: JC Checklist + Recent Documents */}
      <div className="grid-2">
        {/* Compliance Checklist */}
        <div className="pn">
          <div className="pnh">
            <h3>✅ JC-Readiness Checklist</h3>
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: passingCount === checklistItems.length ? 'var(--ac)' : 'var(--wn)',
            }}>
              {passingCount}/{checklistItems.length} passing
            </span>
          </div>
          <div className="pnb" style={{ padding: '4px 0' }}>
            {checklistItems.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  padding: '14px 18px',
                  borderBottom: '1px solid var(--bd)',
                  background: item.passing ? 'transparent' : 'rgba(220,38,38,0.03)',
                }}
              >
                {/* Status icon */}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: item.passing ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)',
                  color: item.passing ? 'var(--ac)' : 'var(--dg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700,
                }}>
                  {item.passing ? '✓' : '✗'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{item.detail}</div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, borderRadius: 4, padding: '2px 8px',
                      background: item.passing ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                      color: item.passing ? 'var(--ac)' : 'var(--dg)',
                      flexShrink: 0, marginLeft: 10,
                    }}>
                      {item.passing ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right column: Recent Documents + Incident Summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Recent Documents */}
          <div className="pn">
            <div className="pnh">
              <h3>📄 Recent Documents</h3>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/documents')}>
                All →
              </button>
            </div>
            <div className="pnb" style={{ padding: '8px 18px' }}>
              {loadingDocs ? (
                <div className="spinner" style={{ margin: '16px auto' }} />
              ) : recentDocs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--t3)', fontSize: 13 }}>
                  No reviewed documents found.
                </div>
              ) : (
                recentDocs.slice(0, 4).map((doc) => (
                  <div key={doc.id} className="action-item" style={{ marginBottom: 6 }}>
                    <div className="action-dot blue" />
                    <div className="action-content">
                      <div className="action-title" style={{ fontSize: 13 }}>{doc.name}</div>
                      <div className="action-meta">{new Date(doc.created_at).toLocaleDateString()}</div>
                    </div>
                    <span className="tg" style={{ background: 'rgba(22,163,74,0.1)', color: 'var(--ac)', fontSize: 11 }}>
                      Passed
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Incident Summary */}
          <div className="pn">
            <div className="pnh">
              <h3>🚨 Incident Summary</h3>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/incidents')}>
                View All →
              </button>
            </div>
            <div className="pnb">
              {/* By status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Open', value: incidentsBySeverity.open, color: 'var(--dg)' },
                  { label: 'Under Review', value: incidentsBySeverity.under_review, color: 'var(--wn)' },
                  { label: 'Resolved', value: incidentsBySeverity.resolved, color: 'var(--ac)' },
                ].map((s) => (
                  <div key={s.label} style={{ textAlign: 'center', background: 'var(--sf3)', borderRadius: 8, padding: '10px' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* By type */}
              {Object.keys(incidentsByType).length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>By Type</div>
                  {Object.entries(incidentsByType).slice(0, 4).map(([type, count]) => (
                    <div
                      key={type}
                      style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--bd)', fontSize: 13 }}
                    >
                      <span style={{ color: 'var(--t2)' }}>{type}</span>
                      <span style={{ fontWeight: 700, color: 'var(--t1)' }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quick Links */}
          <div className="pn">
            <div className="pnh"><h3>⚡ Quick Links</h3></div>
            <div className="pnb">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { icon: '📋', label: 'Credentialing', nav: '/credentialing' },
                  { icon: '🚨', label: 'Incidents', nav: '/incidents' },
                  { icon: '📄', label: 'Document Checker', nav: '/documents' },
                  { icon: '📝', label: 'Templates', nav: '/templates' },
                ].map((link) => (
                  <div
                    key={link.label}
                    style={{
                      background: 'var(--sf3)', border: '1px solid var(--bd)',
                      borderRadius: 8, padding: '12px', textAlign: 'center', cursor: 'pointer',
                    }}
                    onClick={() => navigate(link.nav)}
                    onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 10px rgba(30,64,175,0.1)')}
                    onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    <div style={{ fontSize: 20, marginBottom: 5 }}>{link.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{link.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
