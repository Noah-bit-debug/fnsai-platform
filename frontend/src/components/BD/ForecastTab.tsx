/**
 * Phase 4.4 — Revenue Forecast tab
 *
 * Weighted pipeline projection. The backend computes:
 *   expected = estimated_value × win_probability
 * where win_probability scales from the org's historical win rate.
 *
 * Shows:
 *   * Total open pipeline $ vs weighted projection
 *   * Baseline historical win rate + per-status probability used
 *   * By-month breakdown (gross vs weighted)
 *   * Drilldown list: every open bid with its individual weighted value
 */
import { useEffect, useState } from 'react';
import { bdApi, BDForecast } from '../../lib/api';

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtMonth(m: string): string {
  if (m === 'Unscheduled') return 'Unscheduled';
  try { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }); } catch { return m; }
}

export default function ForecastTab() {
  const [data, setData] = useState<BDForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await bdApi.forecast();
      setData(r.data);
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Load failed.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading forecast…</div>;
  if (err) return <div style={{ margin: 20, background: '#fef2f2', color: '#991b1b', padding: 10, borderRadius: 8, fontSize: 13 }}>{err}</div>;
  if (!data) return null;

  const weightedPct = data.total_gross_open > 0 ? Math.round((data.total_weighted_projection / data.total_gross_open) * 100) : 0;
  const maxMonthly = Math.max(1, ...data.by_month.map(m => m.gross_value));

  return (
    <div style={{ padding: 20 }}>
      {/* Top stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        <Stat label="Open pipeline (gross)" value={fmtMoney(data.total_gross_open)} color="#1565c0" />
        <Stat label="Weighted projection" value={fmtMoney(data.total_weighted_projection)} color="#6d28d9" sub={`${weightedPct}% of gross`} />
        <Stat label="Historical win rate" value={`${data.baseline_win_rate}%`} color="#2e7d32" sub={`${data.history.won} won / ${data.history.decided_total} decided`} />
        <Stat label="Open bids" value={String(data.by_bid.length)} color="#e65100" />
      </div>

      {/* Probability table */}
      <div style={{ padding: 14, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Win probability by stage (derived from history, defaults to 30% baseline if &lt;5 decided)
        </div>
        <div style={{ display: 'flex', gap: 24, fontSize: 13 }}>
          <div><strong>Draft:</strong> {data.probabilities.draft}%</div>
          <div><strong>In progress:</strong> {data.probabilities.in_progress}%</div>
          <div><strong>Submitted:</strong> {data.probabilities.submitted}%</div>
        </div>
      </div>

      {/* By-month rollup */}
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c', marginBottom: 10 }}>Projection by month</div>
      {data.by_month.length === 0 ? (
        <div style={{ padding: 30, color: '#94a3b8', fontSize: 13, textAlign: 'center', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 18 }}>
          No open bids with estimated values.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 18 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              {['Month', 'Bids', 'Gross $', 'Weighted $', ''].map(h =>
                <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {data.by_month.map(m => {
                const barPct = Math.min(100, (m.gross_value / maxMonthly) * 100);
                const weightedPctOfGross = m.gross_value > 0 ? (m.weighted_value / m.gross_value) * 100 : 0;
                return (
                  <tr key={m.month} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{fmtMonth(m.month)}</td>
                    <td style={td}>{m.bid_count}</td>
                    <td style={td}>{fmtMoney(m.gross_value)}</td>
                    <td style={{ ...td, color: '#6d28d9', fontWeight: 600 }}>{fmtMoney(m.weighted_value)}</td>
                    <td style={{ ...td, minWidth: 180 }}>
                      <div style={{ position: 'relative', height: 8, background: '#e2e8f0', borderRadius: 4 }}>
                        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${barPct}%`, background: '#bfdbfe', borderRadius: 4 }} />
                        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${(barPct * weightedPctOfGross) / 100}%`, background: '#6d28d9', borderRadius: 4 }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-bid breakdown */}
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c', marginBottom: 10 }}>Open bids contributing to projection</div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8fafc' }}>
            {['Bid', 'Status', 'Due', 'Gross $', 'Prob', 'Weighted $'].map(h => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {data.by_bid.map(b => (
              <tr key={b.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ ...td, fontWeight: 600 }}>{b.title}</td>
                <td style={td}>{b.status.replace('_', ' ')}</td>
                <td style={{ ...td, fontSize: 12, color: '#64748b' }}>{b.due_date ?? '—'}</td>
                <td style={td}>{fmtMoney(b.gross)}</td>
                <td style={{ ...td, color: '#6d28d9' }}>{Math.round(b.probability * 100)}%</td>
                <td style={{ ...td, fontWeight: 600, color: '#6d28d9' }}>{fmtMoney(b.weighted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 };
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: '#1e293b' };
