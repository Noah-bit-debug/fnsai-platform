/**
 * Phase 6.5 — Public client portal view
 *
 * Rendered at /client-view/:token. No authentication required — the
 * token IS the credential. The backend validates + revokes + expires.
 *
 * Shows a read-only snapshot of:
 *   - Facility / client header (name from display_label or backend)
 *   - Active staff placed at the facility (names + role + start date)
 *   - Upcoming submissions (candidates being submitted to open jobs)
 *   - Open jobs for coverage visibility
 *
 * Intentionally minimal — this is a "share a URL with the client" level
 * of portal, not a full login portal.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
// Type alias imported inline to avoid name collision with the default-export
// component in this file ("ClientPortalView"). Using `type` keeps it erased.
import type { ClientPortalView as ClientPortalViewData } from '../lib/api';

// Resolve the same backend base URL that `api` uses, but bypass the
// axios instance that injects Clerk bearer tokens — this endpoint is
// genuinely public and users viewing the URL may not be logged in.
function publicBase(): string {
  const env = (import.meta as unknown as { env: { VITE_API_BASE_URL?: string } }).env;
  return (env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '');
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const s = String(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString();
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}

const STATUS_COLORS: Record<string, string> = {
  active:       '#2e7d32',
  pending:      '#e65100',
  draft:        '#64748b',
  submitted:    '#1565c0',
  interviewing: '#6d28d9',
  open:         '#1565c0',
  filling:      '#e65100',
};

export default function ClientPortalView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ClientPortalViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError('No link token.'); setLoading(false); return; }
    (async () => {
      try {
        const res = await axios.get<ClientPortalViewData>(`${publicBase()}/client-portal/view/${token}`);
        setData(res.data);
      } catch (e: any) {
        setError(e?.response?.data?.error ?? 'Failed to load portal.');
      } finally { setLoading(false); }
    })();
  }, [token]);

  if (loading) {
    return <Shell><div style={{ padding: 80, textAlign: 'center', color: '#64748b' }}>Loading…</div></Shell>;
  }
  if (error || !data) {
    return (
      <Shell>
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>Portal unavailable</div>
          <div style={{ fontSize: 14, color: '#64748b' }}>{error ?? 'Could not load this portal.'}</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 16 }}>If you believe this is an error, contact your FNS AI administrator.</div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.6, textTransform: 'uppercase' }}>Client Portal</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', margin: '4px 0' }}>{data.label}</h1>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {data.facilities.length} facilit{data.facilities.length === 1 ? 'y' : 'ies'} · Generated {new Date(data.generated_at).toLocaleString()}
          </div>
        </div>

        {/* Summary stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
          <Stat label="Active staff"          value={data.active_staff.length}          color="#2e7d32" />
          <Stat label="Upcoming submissions"  value={data.upcoming_submissions.length}  color="#1565c0" />
          <Stat label="Open jobs"             value={data.open_jobs.length}             color="#e65100" />
        </div>

        {/* Active staff */}
        <Section title="Staff currently placed">
          {data.active_staff.length === 0
            ? <Empty icon="🧑‍⚕️" text="No active placements right now." />
            : (
              <Table>
                <thead><Tr>{['Name', 'Role', 'Facility', 'Status', 'Start'].map(h => <Th key={h}>{h}</Th>)}</Tr></thead>
                <tbody>
                  {data.active_staff.map(s => (
                    <Tr key={s.placement_id}>
                      <Td strong>{s.first_name} {s.last_name}</Td>
                      <Td>{s.role ?? '—'}</Td>
                      <Td>{s.facility_name ?? '—'}</Td>
                      <Td><StatusPill status={s.status} /></Td>
                      <Td muted>{fmtDate(s.start_date)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
        </Section>

        {/* Upcoming submissions */}
        <Section title="Candidates being considered for your open roles">
          {data.upcoming_submissions.length === 0
            ? <Empty icon="📨" text="No submissions in progress. Your FNS team will send candidates here as they move through the pipeline." />
            : (
              <Table>
                <thead><Tr>{['Candidate', 'Role', 'Job', 'Facility', 'Status', 'Submitted'].map(h => <Th key={h}>{h}</Th>)}</Tr></thead>
                <tbody>
                  {data.upcoming_submissions.map(s => (
                    <Tr key={s.id}>
                      <Td strong>{s.first_name} {s.last_name}</Td>
                      <Td>{s.candidate_role ?? '—'}</Td>
                      <Td>{s.job_title ?? '—'}</Td>
                      <Td>{s.facility_name ?? '—'}</Td>
                      <Td><StatusPill status={s.status} /></Td>
                      <Td muted>{fmtDate(s.submitted_at ?? s.created_at)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
        </Section>

        {/* Open jobs */}
        <Section title="Open positions">
          {data.open_jobs.length === 0
            ? <Empty icon="💼" text="No open positions listed at the moment." />
            : (
              <Table>
                <thead><Tr>{['Title', 'Facility', 'Status', 'Opened'].map(h => <Th key={h}>{h}</Th>)}</Tr></thead>
                <tbody>
                  {data.open_jobs.map(j => (
                    <Tr key={j.id}>
                      <Td strong>{j.title}</Td>
                      <Td>{j.facility_name ?? '—'}</Td>
                      <Td><StatusPill status={j.status} /></Td>
                      <Td muted>{fmtDate(j.created_at)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
        </Section>

        <div style={{ marginTop: 30, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
          Questions? Reach out to your FNS AI account manager. · This view is read-only and refreshes each time the page loads.
        </div>
      </div>
    </Shell>
  );
}

// ── Layout / primitives ──────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ background: '#1a2b3c', color: '#fff', padding: '14px 40px', fontSize: 14, fontWeight: 700, letterSpacing: 0.3 }}>
        FNS AI
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 18, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
      <div style={{ fontSize: 32, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>{title}</div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ padding: 30, textAlign: 'center' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13, color: '#64748b', maxWidth: 480, margin: '0 auto' }}>{text}</div>
    </div>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>;
}
function Tr({ children }: { children: React.ReactNode }) {
  return <tr style={{ borderBottom: '1px solid #f1f5f9' }}>{children}</tr>;
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc' }}>{children}</th>;
}
function Td({ children, strong, muted }: { children: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <td style={{ padding: '10px 14px', fontSize: 13, color: muted ? '#64748b' : '#1e293b', fontWeight: strong ? 600 : 400 }}>
      {children}
    </td>
  );
}
function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#64748b';
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, background: color + '22', color, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>
      {status.replace('_', ' ')}
    </span>
  );
}
