import { useState, useEffect } from 'react';
import { esignApi } from '../../lib/api';

function MetricCard({ label, value, icon, color, sub }: { label: string; value: string | number; icon: string; color: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: '20px 22px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
      <div style={{ height: '100%', width: `${max ? (value / max) * 100 : 0}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
    </div>
  );
}

export default function ESignAnalytics() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    esignApi.analytics().then((r) => { setData(r.data); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const ov = data?.overview ?? {};
  const daily = data?.daily ?? [];
  const topTemplates = data?.topTemplates ?? [];
  const slowest = data?.slowestDocuments ?? [];

  const maxSent = Math.max(...daily.map((d: any) => parseInt(d.sent) || 0), 1);

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h1 className="page-title">eSign Analytics</h1>
          <p className="page-subtitle">Document performance, completion rates, and signer activity</p>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading analytics...</div>
      ) : (
        <>
          {/* Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14, marginBottom: 28 }}>
            <MetricCard icon="📤" label="Total Sent" value={ov.total_sent ?? '0'} color="#1565c0" />
            <MetricCard icon="✅" label="Completed" value={ov.completed ?? '0'} color="#2e7d32" />
            <MetricCard icon="📊" label="Completion Rate" value={`${ov.completion_rate ?? 0}%`} color="#6a1b9a" />
            <MetricCard icon="⏱" label="Avg. Hours to Sign" value={ov.avg_hours ? `${ov.avg_hours}h` : '—'} color="#e65100" />
            <MetricCard icon="✗" label="Declined" value={ov.declined ?? '0'} color="#c62828" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            {/* Activity chart — simple bar chart */}
            <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Activity — Last 30 Days</div>
              {daily.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#bbb', fontSize: 13 }}>No activity yet</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, paddingBottom: 4 }}>
                  {daily.slice(-30).map((d: any) => {
                    const sent = parseInt(d.sent) || 0;
                    const completed = parseInt(d.completed) || 0;
                    const h = maxSent ? Math.max((sent / maxSent) * 100, 2) : 2;
                    return (
                      <div key={d.date} title={`${new Date(d.date).toLocaleDateString()}: ${sent} sent, ${completed} completed`}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                        <div style={{ width: '100%', height: `${h}px`, background: '#1565c020', borderRadius: '2px 2px 0 0', position: 'relative', overflow: 'hidden', cursor: 'help' }}>
                          <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${maxSent ? (completed / maxSent) * 100 : 0}%`, background: '#2e7d32', transition: 'height 0.3s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: '#1565c020', border: '1px solid #1565c0', borderRadius: 2, display: 'inline-block' }} />Sent</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: '#2e7d32', borderRadius: 2, display: 'inline-block' }} />Completed</span>
              </div>
            </div>

            {/* Slowest awaiting */}
            <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Awaiting Longest</div>
              {slowest.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#bbb', fontSize: 13 }}>No pending documents 🎉</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {slowest.map((d: any) => (
                    <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div>
                        <MiniBar value={d.days_pending} max={Math.max(...slowest.map((x: any) => x.days_pending), 1)} color={d.days_pending > 7 ? '#c62828' : '#f57c00'} />
                      </div>
                      <span style={{ marginLeft: 12, fontSize: 12, fontWeight: 700, color: d.days_pending > 7 ? '#c62828' : '#f57c00', whiteSpace: 'nowrap' }}>
                        {d.days_pending}d
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Top templates */}
          {topTemplates.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '16px 22px', borderBottom: '1px solid #eef', fontWeight: 700, fontSize: 14 }}>Top Templates Used</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fc' }}>
                    {['Template', 'Uses', 'Avg. Sign Time'].map((h) => (
                      <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topTemplates.map((t: any, i: number) => (
                    <tr key={t.template_id} style={{ borderTop: '1px solid #f0f2f7' }}>
                      <td style={{ padding: '12px 20px', fontWeight: 600, fontSize: 13 }}>{t.template_id ?? 'Custom'}</td>
                      <td style={{ padding: '12px 20px', fontSize: 13 }}>{t.usage_count}</td>
                      <td style={{ padding: '12px 20px', fontSize: 13, color: '#666' }}>{t.avg_hours ? `${t.avg_hours}h` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
