import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

interface Summary {
  id: string;
  date: string;
  status: string;
  narrative?: string;
  risk_alerts?: string[];
  metrics?: Record<string, number>;
}

export default function DailySummaryWidget() {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ['daily-summary-widget', today],
    queryFn: () => api.get<{ summary: Summary | null }>(`/daily-summary/${today}`),
    select: (r) => r.data?.summary ?? null,
    retry: 0,
  });

  if (isLoading) {
    return (
      <div style={{ background: '#1e3a8a', borderRadius: 12, padding: '18px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Loading daily intelligence...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ background: 'linear-gradient(135deg, #1e3a8a, #1e40af)', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}
           onClick={() => navigate('/daily-summary')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>📅</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Daily Intelligence Digest</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>No summary for today yet — click to generate</div>
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: 6 }}>Generate →</span>
      </div>
    );
  }

  const alerts = data.risk_alerts ?? [];
  const metrics = data.metrics ?? {};
  const metricKeys = Object.keys(metrics).slice(0, 4);

  return (
    <div style={{ background: 'linear-gradient(135deg, #1e3a8a, #1e40af)', borderRadius: 12, padding: '16px 20px', marginBottom: 20, cursor: 'pointer' }}
         onClick={() => navigate('/daily-summary')}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📅</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Daily Intelligence</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: 4, textTransform: 'capitalize' }}>
            {data.status}
          </span>
        </div>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          {new Date(data.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} →
        </span>
      </div>

      {metricKeys.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: alerts.length > 0 ? 10 : 0 }}>
          {metricKeys.map(k => (
            <div key={k} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{metrics[k]}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</div>
            </div>
          ))}
        </div>
      )}

      {alerts.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {alerts.slice(0, 2).map((a, i) => (
            <span key={i} style={{ fontSize: 11, background: 'rgba(220,38,38,0.3)', color: '#fca5a5', borderRadius: 6, padding: '3px 8px' }}>
              ⚠ {a.length > 50 ? a.slice(0, 47) + '...' : a}
            </span>
          ))}
        </div>
      )}

      {!metricKeys.length && !alerts.length && data.narrative && (
        <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
          {data.narrative.slice(0, 120)}{data.narrative.length > 120 ? '...' : ''}
        </p>
      )}
    </div>
  );
}
