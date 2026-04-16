import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { submissionsApi, Submission, FitLabel, GateStatus } from '../../lib/api';

const FIT_COLOR: Record<FitLabel, string> = {
  excellent: '#059669', strong: '#10b981', moderate: '#f59e0b',
  weak: '#ef4444', poor: '#7f1d1d',
};

const GATE_COLOR: Record<GateStatus, string> = {
  ok: '#10b981', pending: '#f59e0b', missing: '#ef4444', unknown: '#9ca3af',
};

export default function SubmissionList() {
  const nav = useNavigate();
  const [subs, setSubs] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fitFilter, setFitFilter] = useState<string>('');
  const [gateFilter, setGateFilter] = useState<string>('');
  const [stageFilter, setStageFilter] = useState<string>('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const params: Record<string, string> = {};
      if (fitFilter) params.fit_label = fitFilter;
      if (gateFilter) params.gate_status = gateFilter;
      if (stageFilter) params.stage_key = stageFilter;
      const res = await submissionsApi.list(params);
      setSubs(res.data.submissions);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load submissions');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fitFilter, gateFilter, stageFilter]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>Submissions</h1>
        <div style={{ color: 'var(--t3)', fontSize: 13, marginTop: 4 }}>
          {loading ? 'Loading…' : `${subs.length} submission${subs.length === 1 ? '' : 's'}`}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={fitFilter} onChange={(e) => setFitFilter(e.target.value)} style={filterSelect}>
          <option value="">All fit labels</option>
          <option value="excellent">Excellent</option>
          <option value="strong">Strong</option>
          <option value="moderate">Moderate</option>
          <option value="weak">Weak</option>
          <option value="poor">Poor</option>
        </select>
        <select value={gateFilter} onChange={(e) => setGateFilter(e.target.value)} style={filterSelect}>
          <option value="">All gate statuses</option>
          <option value="ok">OK</option>
          <option value="pending">Pending</option>
          <option value="missing">Missing</option>
          <option value="unknown">Unknown</option>
        </select>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} style={filterSelect}>
          <option value="">All stages</option>
          <option value="internal_review">Internal Review</option>
          <option value="submitted">Submitted</option>
          <option value="client_submitted">Client Submitted</option>
          <option value="interview">Interview</option>
          <option value="offer">Offer</option>
          <option value="confirmed">Confirmed</option>
          <option value="placed">Placed</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
      </div>

      {error && <div style={{ padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>
      ) : subs.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)', background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px dashed var(--bd)' }}>
          No submissions yet. Create one from a job's matching-candidates list.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {subs.map((s) => (
            <div
              key={s.id}
              onClick={() => nav(`/submissions/${s.id}`)}
              style={{
                background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)',
                padding: '12px 16px', cursor: 'pointer',
                display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1.2fr) auto auto auto auto',
                gap: 16, alignItems: 'center',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.candidate_name ?? s.candidate_id.slice(0, 8)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--t3)' }}>{s.candidate_role}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <Link to={`/jobs/${s.job_id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--pr)', textDecoration: 'none' }}>
                    {s.job_title ?? 'Job'}
                  </Link>
                </div>
                <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                  {s.job_code} {s.client_name && `· ${s.client_name}`}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                {s.ai_score != null ? (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>{s.ai_score}</div>
                    <div style={{ fontSize: 10, color: 'var(--t3)' }}>score</div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>—</div>
                )}
              </div>
              {s.ai_fit_label ? <Pill color={FIT_COLOR[s.ai_fit_label]} label={s.ai_fit_label} /> : <span />}
              {s.gate_status ? <Pill color={GATE_COLOR[s.gate_status]} label={`gate: ${s.gate_status}`} /> : <span />}
              <Pill color={s.stage_color ?? 'var(--t3)'} label={s.stage_label ?? s.stage_key ?? '—'} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: `${color}20`, color, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

const filterSelect: React.CSSProperties = {
  padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6,
  fontSize: 13, background: 'var(--sf)', cursor: 'pointer', outline: 'none',
};
