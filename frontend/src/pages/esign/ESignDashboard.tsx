import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { esignApi, ESignDocument, ESignTemplate } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ESignStats {
  pending?: string;
  awaiting?: string;
  completed: string;
  voided: string;
  drafts: string;
  declined?: string;
  total: string;
  custom_templates: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DocStatus = ESignDocument['status'];

const STATUS_CONFIG: Record<DocStatus, { label: string; bg: string; color: string }> = {
  draft:            { label: 'Draft',       bg: '#f3f4f6', color: '#6b7280' },
  sent:             { label: 'Sent',        bg: '#fff7ed', color: '#c2410c' },
  partially_signed: { label: 'In Progress', bg: '#eff6ff', color: '#1d4ed8' },
  completed:        { label: 'Completed',   bg: '#f0fdf4', color: '#15803d' },
  voided:           { label: 'Voided',      bg: '#fef2f2', color: '#b91c1c' },
  expired:          { label: 'Expired',     bg: '#fdf4e7', color: '#92400e' },
};

function StatusBadge({ status }: { status: DocStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      background: cfg.bg,
      color: cfg.color,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function SignerPills({ signers }: { signers: ESignDocument['signers'] }) {
  const shown = signers.slice(0, 2);
  const extra = signers.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {shown.map((s) => (
        <span key={s.id} style={{
          fontSize: 12,
          padding: '2px 8px',
          borderRadius: 12,
          background: s.status === 'signed' ? '#f0fdf4' : '#f9fafb',
          color: s.status === 'signed' ? '#15803d' : '#6b7280',
          border: '1px solid',
          borderColor: s.status === 'signed' ? '#bbf7d0' : '#e5e7eb',
          whiteSpace: 'nowrap',
        }}>
          {s.name}
        </span>
      ))}
      {extra > 0 && (
        <span style={{ fontSize: 12, color: '#9ca3af' }}>+{extra} more</span>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ width = '100%', height = 16, radius = 6 }: { width?: string | number; height?: number; radius?: number }) {
  return (
    <div style={{
      width,
      height,
      borderRadius: radius,
      background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: string;
  value: string | number;
  label: string;
  trend?: string;
  trendUp?: boolean;
  accent?: string;
  loading?: boolean;
}

function StatCard({ icon, value, label, trend, trendUp, accent = 'var(--ac)', loading }: StatCardProps) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      flex: '1 1 200px',
      minWidth: 160,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 24 }}>{icon}</span>
        {trend && !loading && (
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: trendUp ? '#15803d' : '#b91c1c',
            background: trendUp ? '#f0fdf4' : '#fef2f2',
            padding: '2px 8px',
            borderRadius: 10,
          }}>
            {trendUp ? '↑' : '↓'} {trend}
          </span>
        )}
      </div>
      {loading ? (
        <>
          <Skeleton height={32} width={80} />
          <Skeleton height={14} width={120} />
        </>
      ) : (
        <>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--prd, #1e293b)', lineHeight: 1 }}>
            {value}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>{label}</div>
        </>
      )}
      <div style={{ height: 3, background: `${accent}20`, borderRadius: 2, marginTop: 4 }}>
        <div style={{ height: '100%', width: '60%', background: accent, borderRadius: 2 }} />
      </div>
    </div>
  );
}

// ─── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({ template, onUse }: { template: ESignTemplate; onUse: (id: string) => void }) {
  const categoryColors: Record<string, { bg: string; color: string }> = {
    employment:  { bg: '#eff6ff', color: '#1d4ed8' },
    contract:    { bg: '#faf5ff', color: '#7c3aed' },
    compliance:  { bg: '#fff7ed', color: '#c2410c' },
    onboarding:  { bg: '#f0fdf4', color: '#15803d' },
    staffing:    { bg: '#fdf4e7', color: '#92400e' },
  };
  const cat = categoryColors[template.category?.toLowerCase()] ?? { bg: '#f3f4f6', color: '#374151' };

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      transition: 'box-shadow 0.15s, border-color 0.15s',
    }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ac, #6366f1)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLDivElement).style.borderColor = '#e5e7eb';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--prd, #1e293b)', lineHeight: 1.4 }}>
          {template.name}
        </div>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          padding: '2px 8px',
          borderRadius: 10,
          background: cat.bg,
          color: cat.color,
          whiteSpace: 'nowrap',
          textTransform: 'capitalize',
        }}>
          {template.category || 'General'}
        </span>
      </div>
      {template.description && (
        <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
          {template.description.length > 80 ? template.description.slice(0, 80) + '…' : template.description}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>
          {template.fields?.length ?? 0} fields
        </span>
        <button
          type="button"
          onClick={() => onUse(template.id)}
          style={{
            background: 'var(--ac, #6366f1)',
            color: '#fff',
            border: 'none',
            borderRadius: 7,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Use Template
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ESignDashboard() {
  const navigate = useNavigate();

  const [stats, setStats] = useState<ESignStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [documents, setDocuments] = useState<ESignDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<ESignTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await esignApi.stats();
        setStats(res.data?.stats ?? null);
      } catch {
        setStatsError('Could not load stats.');
      } finally {
        setStatsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await esignApi.listDocuments({ limit: 10 } as Parameters<typeof esignApi.listDocuments>[0]);
        setDocuments(res.data?.documents ?? []);
      } catch {
        setDocsError('Could not load documents.');
      } finally {
        setDocsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await esignApi.listTemplates();
        setTemplates(res.data?.templates ?? []);
      } catch {
        setTemplatesError('Could not load templates.');
      } finally {
        setTemplatesLoading(false);
      }
    })();
  }, []);

  const totalSent = stats ? parseInt(stats.total, 10) : 0;
  const awaiting = stats ? parseInt(stats.pending ?? stats.awaiting ?? '0', 10) : 0;
  const completed = stats ? parseInt(stats.completed, 10) : 0;
  const completionRate = totalSent > 0 ? Math.round((completed / totalSent) * 100) : 0;

  const shownTemplates = templates.slice(0, 6);

  return (
    <div>
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .esign-table-row:hover {
          background: #f9fafb !important;
        }
        .esign-action-btn {
          background: transparent;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 4px 12px;
          font-size: 12px;
          font-weight: 600;
          color: var(--prd, #1e293b);
          cursor: pointer;
          transition: background 0.12s, border-color 0.12s;
        }
        .esign-action-btn:hover {
          background: var(--ac, #6366f1);
          color: #fff;
          border-color: var(--ac, #6366f1);
        }
      `}</style>

      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--prd, #1e293b)' }}>
              eSign Center
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#6b7280' }}>
              Manage digital signatures, templates, and signing workflows
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/esign/documents/new')}
            style={{
              background: 'var(--ac, #6366f1)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> New Document
          </button>
        </div>
      </div>

      {/* Stats error */}
      {statsError && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 8,
          padding: '10px 16px',
          marginBottom: 20,
          color: '#b91c1c',
          fontSize: 13,
        }}>
          {statsError}
        </div>
      )}

      {/* Stat Cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <StatCard
          icon="📤"
          value={statsLoading ? '—' : totalSent}
          label="Total Sent"
          trend="this month"
          trendUp
          accent="var(--ac, #6366f1)"
          loading={statsLoading}
        />
        <StatCard
          icon="⏳"
          value={statsLoading ? '—' : awaiting}
          label="Awaiting Signature"
          accent="#f59e0b"
          loading={statsLoading}
        />
        <StatCard
          icon="✅"
          value={statsLoading ? '—' : completed}
          label="Completed"
          trend="all time"
          trendUp
          accent="#22c55e"
          loading={statsLoading}
        />
        <StatCard
          icon="📊"
          value={statsLoading ? '—' : `${completionRate}%`}
          label="Completion Rate"
          trendUp={completionRate >= 70}
          trend={completionRate >= 70 ? 'good' : 'low'}
          accent={completionRate >= 70 ? '#22c55e' : '#ef4444'}
          loading={statsLoading}
        />
      </div>

      {/* Recent Documents */}
      <div style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        marginBottom: 32,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid #f3f4f6',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--prd, #1e293b)' }}>
              Recent Documents
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#9ca3af' }}>Last 10 sent or active documents</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/esign/documents')}
            style={{
              background: 'transparent',
              border: '1px solid #e5e7eb',
              borderRadius: 7,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--prd, #1e293b)',
              cursor: 'pointer',
            }}
          >
            View All →
          </button>
        </div>

        {docsError && (
          <div style={{ padding: '20px 24px', color: '#b91c1c', fontSize: 13 }}>
            {docsError}
          </div>
        )}

        {docsLoading ? (
          <div style={{ padding: '24px' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center' }}>
                <Skeleton width="30%" height={14} />
                <Skeleton width="20%" height={14} />
                <Skeleton width={60} height={22} radius={20} />
                <Skeleton width="15%" height={14} />
                <Skeleton width={60} height={28} radius={7} />
              </div>
            ))}
          </div>
        ) : documents.length === 0 && !docsError ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
            <div style={{ fontWeight: 600, color: 'var(--prd, #1e293b)', marginBottom: 6 }}>No documents yet</div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>
              Send your first document for signing to get started.
            </div>
            <button
              type="button"
              onClick={() => navigate('/esign/documents/new')}
              style={{
                background: 'var(--ac, #6366f1)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '9px 18px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + New Document
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  {['Document Title', 'Signers', 'Status', 'Sent', 'Actions'].map((col) => (
                    <th key={col} style={{
                      padding: '10px 24px',
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#9ca3af',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      whiteSpace: 'nowrap',
                    }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr
                    key={doc.id}
                    className="esign-table-row"
                    style={{ borderBottom: '1px solid #f9fafb', transition: 'background 0.1s' }}
                  >
                    <td style={{ padding: '14px 24px', maxWidth: 280 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--prd, #1e293b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {doc.title}
                      </div>
                    </td>
                    <td style={{ padding: '14px 24px' }}>
                      <SignerPills signers={doc.signers ?? []} />
                    </td>
                    <td style={{ padding: '14px 24px', whiteSpace: 'nowrap' }}>
                      <StatusBadge status={doc.status} />
                    </td>
                    <td style={{ padding: '14px 24px', fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {formatDate(doc.created_at)}
                    </td>
                    <td style={{ padding: '14px 24px' }}>
                      <button
                        type="button"
                        className="esign-action-btn"
                        onClick={() => navigate(`/esign/documents/${doc.id}`)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Send / Templates */}
      <div style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        marginBottom: 32,
      }}>
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid #f3f4f6',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--prd, #1e293b)' }}>
              Quick Send
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#9ca3af' }}>Start from a ready-to-use template</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/esign/templates')}
            style={{
              background: 'transparent',
              border: '1px solid #e5e7eb',
              borderRadius: 7,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--prd, #1e293b)',
              cursor: 'pointer',
            }}
          >
            All Templates →
          </button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {templatesError && (
            <div style={{ color: '#b91c1c', fontSize: 13, padding: '8px 0' }}>{templatesError}</div>
          )}

          {templatesLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 18px' }}>
                  <Skeleton height={16} width="70%" />
                  <div style={{ margin: '10px 0' }}><Skeleton height={12} /></div>
                  <Skeleton height={12} width="50%" />
                </div>
              ))}
            </div>
          ) : shownTemplates.length === 0 && !templatesError ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
              <div style={{ fontWeight: 600, color: 'var(--prd, #1e293b)', marginBottom: 6 }}>No templates yet</div>
              <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>
                Create a template to speed up your document sending workflow.
              </div>
              <button
                type="button"
                onClick={() => navigate('/esign/templates/new')}
                style={{
                  background: 'var(--ac, #6366f1)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Create Template
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {shownTemplates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onUse={(id) => navigate(`/esign/documents/new?template=${id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
