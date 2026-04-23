import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReportRun {
  id: string;
  name: string;
  type: ReportType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  narrative?: string;
  metrics?: Record<string, string | number>;
  filters?: {
    date_from?: string;
    date_to?: string;
    department?: string;
    team_member?: string;
    client_name?: string;
    custom_prompt?: string;
  };
  created_at: string;
  completed_at?: string;
}

interface ReportMetrics {
  active_placements: number;
  candidates_pipeline: number;
  compliance_rate: number;
  open_positions: number;
  avg_time_to_fill: number;
  revenue_mtd: number;
}

type ReportType = 'operations' | 'recruiting' | 'compliance' | 'financial' | 'ai_narrative' | 'ceo' | 'business_dev';
type ReportCategory = 'all' | 'operations' | 'recruiting' | 'compliance' | 'financial' | 'hr' | 'ceo' | 'business_dev';

// ─── Constants ────────────────────────────────────────────────────────────────
const REPORT_TYPES: { value: ReportType; label: string; icon: string; description: string }[] = [
  { value: 'operations',   label: 'Operations Overview',   icon: '⚙️',  description: 'Staffing operations, placements, and scheduling' },
  { value: 'recruiting',   label: 'Recruiting Activity',   icon: '🎯',  description: 'Pipeline, candidate flow, and recruiter performance' },
  { value: 'compliance',   label: 'Compliance Status',     icon: '🛡️',  description: 'Credential expirations, compliance gaps, and audits' },
  { value: 'financial',    label: 'Financial Summary',     icon: '💰',  description: 'Revenue, billing, payroll, and cost analysis' },
  { value: 'ceo',          label: 'CEO Executive Summary', icon: '👔',  description: 'High-level KPIs and strategic intelligence for leadership' },
  { value: 'business_dev', label: 'Business Development',  icon: '💼',  description: 'Lead pipeline, client acquisition, and BD performance' },
  { value: 'ai_narrative', label: 'AI Narrative (Custom)', icon: '🤖',  description: 'Let AI write a custom intelligence narrative' },
];

const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'all',          label: 'All Reports'      },
  { value: 'ceo',          label: 'CEO'              },
  { value: 'operations',   label: 'Operations'       },
  { value: 'recruiting',   label: 'Recruiting'       },
  { value: 'compliance',   label: 'Compliance'       },
  { value: 'financial',    label: 'Financial'        },
  { value: 'hr',           label: 'HR'               },
  { value: 'business_dev', label: 'Business Dev'     },
];

const TYPE_COLORS: Record<ReportType | string, string> = {
  operations:   '#1565c0',
  recruiting:   '#7c3aed',
  compliance:   '#166534',
  financial:    '#854d0e',
  ceo:          '#1e40af',
  business_dev: '#0f766e',
  ai_narrative: '#0e7490',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtShortDate(d?: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function inp(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%', padding: '9px 14px', border: '1px solid #e8edf2',
    borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c',
    boxSizing: 'border-box', background: '#fff', ...extra,
  };
}

function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
  navigator.clipboard.writeText(text).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 2000,
      background: type === 'success' ? '#166534' : '#991b1b',
      color: '#fff', borderRadius: 10, padding: '12px 20px',
      fontSize: 14, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', gap: 10, maxWidth: 360,
    }}>
      <span>{type === 'success' ? '✅' : '❌'}</span>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
    </div>
  );
}

// ─── Metrics Snapshot ─────────────────────────────────────────────────────────
function MetricsSnapshot() {
  const { data, isLoading } = useQuery({
    queryKey: ['report-metrics'],
    queryFn: () => api.get<ReportMetrics>('/reports/standard/metrics'),
    refetchInterval: 60000,
  });

  const metrics = data?.data;

  // `—` fallback for any field the backend omits so we never render
  // the literal string "undefined%" or "NaNd" in a KPI card.
  const fmtInt = (n: unknown): string =>
    typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—';
  const fmtPct = (n: unknown): string =>
    typeof n === 'number' && Number.isFinite(n) ? `${n}%` : '—';
  const fmtDays = (n: unknown): string =>
    typeof n === 'number' && Number.isFinite(n) ? `${n}d` : '—';
  const fmtUsd = (n: unknown): string =>
    typeof n === 'number' && Number.isFinite(n) ? `$${n.toLocaleString()}` : '—';

  const items = metrics
    ? [
        { label: 'Active Placements',      value: fmtInt(metrics.active_placements),    icon: '👩‍⚕️', color: '#1565c0' },
        { label: 'Candidates in Pipeline', value: fmtInt(metrics.candidates_pipeline),  icon: '🎯',  color: '#7c3aed' },
        { label: 'Compliance Rate',        value: fmtPct(metrics.compliance_rate),      icon: '🛡️',  color: '#166534' },
        { label: 'Open Positions',         value: fmtInt(metrics.open_positions),       icon: '📋',  color: '#854d0e' },
        { label: 'Avg. Days to Fill',      value: fmtDays(metrics.avg_time_to_fill),    icon: '⏱️',  color: '#0e7490' },
        { label: 'Revenue MTD',            value: fmtUsd(metrics.revenue_mtd),          icon: '💰',  color: '#065f46' },
      ]
    : [];

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', padding: '20px 22px', marginBottom: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>📊</span> Key Metrics Snapshot
        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>• auto-refreshes every minute</span>
      </div>
      {isLoading ? (
        <div style={{ fontSize: 14, color: '#64748b' }}>Loading metrics...</div>
      ) : !metrics ? (
        <div style={{ fontSize: 14, color: '#94a3b8' }}>Metrics unavailable</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {items.map((item) => (
            <div key={item.label} style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>{item.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: item.color, lineHeight: 1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 4 }}>{item.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Generate Report Modal ────────────────────────────────────────────────────
function GenerateModal({ onClose, onGenerated }: { onClose: () => void; onGenerated: () => void }) {
  const [form, setForm] = useState({
    type: 'operations' as ReportType,
    name: '',
    date_from: '',
    date_to: '',
    department: '',
    team_member: '',
    client_name: '',
    custom_prompt: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const selectedType = REPORT_TYPES.find((t) => t.value === form.type)!;

  const handleGenerate = async () => {
    if (!form.name.trim()) { setErr('Report name is required.'); return; }
    if (form.type === 'ai_narrative' && !form.custom_prompt.trim()) {
      setErr('Custom prompt is required for AI Narrative reports.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api.post('/reports/runs', {
        run_name: form.name.trim(),
        report_type: form.type,
        filters: {
          date_from:     form.date_from || undefined,
          date_to:       form.date_to || undefined,
          department:    form.department || undefined,
          team_member:   form.team_member || undefined,
          client_name:   form.client_name || undefined,
          custom_prompt: form.custom_prompt || undefined,
        },
      });
      onGenerated();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to generate report.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>Generate Report</div>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>Choose a report type and configure filters.</p>

        {/* Report type */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Report Type</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {REPORT_TYPES.map((t) => (
              <label key={t.value} style={{
                display: 'flex', alignItems: 'center', gap: 12, border: '1px solid',
                borderColor: form.type === t.value ? '#1565c0' : '#e8edf2',
                borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
                background: form.type === t.value ? '#eff6ff' : '#fff',
                transition: 'all 0.15s',
              }}>
                <input type="radio" name="rtype" value={t.value} checked={form.type === t.value}
                  onChange={() => setForm((f) => ({ ...f, type: t.value }))} style={{ accentColor: '#1565c0' }} />
                <span style={{ fontSize: 20 }}>{t.icon}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#1a2b3c' }}>{t.label}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{t.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Report Name *</label>
          <input style={inp()} value={form.name} onChange={set('name')} placeholder={`e.g. ${selectedType.label} – ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`} />
        </div>

        {/* Date range */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>From</label>
            <input style={inp()} type="date" value={form.date_from} onChange={set('date_from')} />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>To</label>
            <input style={inp()} type="date" value={form.date_to} onChange={set('date_to')} />
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Department</label>
            <input style={inp()} value={form.department} onChange={set('department')} placeholder="e.g. ICU" />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Team Member</label>
            <input style={inp()} value={form.team_member} onChange={set('team_member')} placeholder="Name or ID" />
          </div>
        </div>

        <div style={{ marginBottom: form.type === 'ai_narrative' ? 14 : 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Client / Facility Name</label>
          <input style={inp()} value={form.client_name} onChange={set('client_name')} placeholder="Filter by client" />
        </div>

        {/* AI Narrative prompt */}
        {form.type === 'ai_narrative' && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Custom AI Focus / Prompt *
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>What should the AI focus on?</span>
            </label>
            <textarea
              style={{ ...inp(), height: 100, resize: 'vertical' }}
              value={form.custom_prompt}
              onChange={set('custom_prompt')}
              placeholder="e.g. Analyze our compliance gaps for ICU nurses and highlight any upcoming credential expirations that could impact staffing..."
            />
          </div>
        )}

        {err && <div style={{ color: '#991b1b', fontSize: 13, marginBottom: 12, background: '#fee2e2', borderRadius: 8, padding: '8px 12px' }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={handleGenerate} disabled={saving} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
            {saving ? '⏳ Generating...' : '📊 Generate Report'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Report Card ──────────────────────────────────────────────────────────────
function ReportCard({ report }: { report: ReportRun }) {
  const [copied, setCopied] = useState(false);
  const typeMeta = REPORT_TYPES.find((t) => t.value === report.type);
  const color = TYPE_COLORS[report.type] ?? '#374151';

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18 }}>{typeMeta?.icon ?? '📊'}</span>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#1a2b3c' }}>{report.name}</span>
            <span style={{ background: `${color}18`, color, borderRadius: 8, padding: '2px 9px', fontSize: 11, fontWeight: 600 }}>
              {typeMeta?.label ?? report.type}
            </span>
            {report.status !== 'completed' && (
              <span style={{
                background: report.status === 'running' ? '#fef9c3' : report.status === 'failed' ? '#fee2e2' : '#f1f5f9',
                color:      report.status === 'running' ? '#854d0e' : report.status === 'failed' ? '#991b1b' : '#374151',
                borderRadius: 8, padding: '2px 9px', fontSize: 11, fontWeight: 600,
              }}>
                {report.status === 'running' ? '⏳ Running' : report.status === 'failed' ? '❌ Failed' : '🕐 Pending'}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Generated {fmtDate(report.created_at)}
            {report.filters?.date_from && ` · ${fmtShortDate(report.filters.date_from)} – ${fmtShortDate(report.filters.date_to)}`}
            {report.filters?.department && ` · ${report.filters.department}`}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {report.narrative && (
            <button
              onClick={() => copyToClipboard(report.narrative!, setCopied)}
              style={{ background: copied ? '#dcfce7' : '#f1f5f9', color: copied ? '#166534' : '#374151', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12, transition: 'all 0.2s' }}
            >
              {copied ? '✅ Copied' : '📋 Copy'}
            </button>
          )}
          {/* Phase 5.4 fix — the old handler fetched the blob but just
              alerted "Export started" without actually downloading the
              file. Now we create an object URL + programmatic anchor
              click so the file lands in the user's Downloads folder. */}
          <button
            onClick={async () => {
              try {
                const resp = await api.get(`/reports/runs/${report.id}/export`, { responseType: 'blob' });
                // Try to recover the filename from Content-Disposition; fall back to a sensible default.
                const cd = (resp.headers as Record<string, string>)['content-disposition'] ?? '';
                const nameMatch = /filename="?([^"]+)"?/.exec(cd);
                const ct = (resp.headers as Record<string, string>)['content-type'] ?? 'application/octet-stream';
                const ext = ct.includes('pdf') ? 'pdf' : ct.includes('csv') ? 'csv' : ct.includes('json') ? 'json' : 'bin';
                const filename = nameMatch?.[1] ?? `${report.type}_${report.id.slice(0, 8)}.${ext}`;
                const blob = resp.data instanceof Blob ? resp.data : new Blob([resp.data], { type: ct });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (e: any) {
                alert(e?.response?.data?.error ?? e?.message ?? 'Export failed.');
              }
            }}
            style={{ background: '#eff6ff', color: '#1565c0', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
          >
            📥 Export
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '16px 20px' }}>
        {/* Narrative */}
        {report.narrative && (
          <div style={{ marginBottom: report.metrics ? 16 : 0 }}>
            {report.narrative.split('\n\n').filter(Boolean).map((para, i) => (
              <p key={i} style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, margin: i > 0 ? '10px 0 0' : 0 }}>
                {para}
              </p>
            ))}
          </div>
        )}

        {report.status === 'running' && !report.narrative && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#854d0e', fontSize: 14 }}>
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
            AI is generating your report...
          </div>
        )}

        {report.status === 'failed' && !report.narrative && (
          <div style={{ color: '#991b1b', fontSize: 14 }}>Report generation failed. Please try again.</div>
        )}

        {/* Metrics table */}
        {report.metrics && Object.keys(report.metrics).length > 0 && (
          <div style={{ marginTop: report.narrative ? 16 : 0, background: '#f8fafc', borderRadius: 10, overflow: 'hidden', border: '1px solid #f1f5f9' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Metric</th>
                  <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.metrics).map(([key, val], i) => (
                  <tr key={key} style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none' }}>
                    <td style={{ padding: '8px 14px', color: '#64748b' }}>
                      {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600, color: '#1a2b3c' }}>
                      {typeof val === 'number' ? val.toLocaleString() : val}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Reports() {
  const queryClient = useQueryClient();
  const [showGenerate, setShowGenerate] = useState(false);
  const [activeCategory, setActiveCategory] = useState<ReportCategory>('all');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['report-runs'],
    queryFn: () => api.get<{ runs: ReportRun[] }>('/reports/runs'),
    refetchInterval: 15000,
  });

  const runs: ReportRun[] = data?.data?.runs ?? [];

  const generateMutation = useMutation({
    mutationFn: (payload: unknown) => api.post('/reports/runs', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-runs'] });
      showToast('Report generation started! It will appear below when complete.');
    },
    onError: (e: any) => showToast(e?.response?.data?.error ?? 'Failed to generate report.', 'error'),
  });

  // Category ↔ report type mapping
  const categoryToTypes: Record<ReportCategory, ReportType[]> = {
    all:          ['operations', 'recruiting', 'compliance', 'financial', 'ceo', 'business_dev', 'ai_narrative'],
    ceo:          ['ceo', 'ai_narrative'],
    operations:   ['operations'],
    recruiting:   ['recruiting'],
    compliance:   ['compliance'],
    financial:    ['financial'],
    hr:           ['recruiting', 'compliance'],
    business_dev: ['business_dev'],
  };

  const filteredRuns = runs.filter((r) => categoryToTypes[activeCategory].includes(r.type));

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* Left sidebar */}
      <div style={{ width: 196, flexShrink: 0 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', overflow: 'hidden', position: 'sticky', top: 20 }}>
          <div style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.8px', borderBottom: '1px solid #f1f5f9' }}>
            Categories
          </div>
          {REPORT_CATEGORIES.map((cat) => {
            const count = runs.filter((r) => categoryToTypes[cat.value].includes(r.type)).length;
            return (
              <button
                key={cat.value}
                onClick={() => setActiveCategory(cat.value)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 16px', border: 'none', cursor: 'pointer', fontSize: 14,
                  fontWeight: activeCategory === cat.value ? 700 : 500,
                  color: activeCategory === cat.value ? '#1565c0' : '#374151',
                  background: activeCategory === cat.value ? '#eff6ff' : 'transparent',
                  textAlign: 'left', borderLeft: activeCategory === cat.value ? '3px solid #1565c0' : '3px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                <span>{cat.label}</span>
                {count > 0 && (
                  <span style={{ background: activeCategory === cat.value ? '#1565c0' : '#e8edf2', color: activeCategory === cat.value ? '#fff' : '#374151', borderRadius: 12, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <div className="page-header">
          <div className="page-header-row">
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>📊 Reports & Intelligence</h1>
              <p style={{ fontSize: 14, color: '#64748b' }}>Generate AI-powered reports and analytics</p>
            </div>
            <button
              onClick={() => setShowGenerate(true)}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              + Generate Report
            </button>
          </div>
        </div>

        {/* Metrics snapshot */}
        <MetricsSnapshot />

        {/* Report runs */}
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#64748b', fontSize: 14 }}>Loading reports...</div>
        ) : (error || filteredRuns.length === 0) && filteredRuns.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf2', padding: '56px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>📊</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>No reports yet</div>
            <p style={{ fontSize: 14, color: '#64748b', maxWidth: 360, margin: '0 auto 20px' }}>
              {activeCategory === 'all'
                ? 'Generate your first report to start seeing intelligence insights.'
                : `No ${activeCategory} reports found. Generate one to get started.`}
            </p>
            <button
              onClick={() => setShowGenerate(true)}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}
            >
              + Generate Report
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {filteredRuns.map((run) => (
              <ReportCard key={run.id} report={run} />
            ))}
          </div>
        )}
      </div>

      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onGenerated={() => {
            queryClient.invalidateQueries({ queryKey: ['report-runs'] });
            generateMutation.reset();
          }}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
