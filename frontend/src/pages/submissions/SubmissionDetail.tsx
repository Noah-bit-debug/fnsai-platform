import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  submissionsApi,
  pipelineStagesApi,
  Submission,
  SubmissionStageHistoryEntry,
  PipelineStage,
  FitLabel,
  GateStatus,
} from '../../lib/api';
import { useToast } from '../../components/ToastHost';

const FIT_COLOR: Record<FitLabel, string> = {
  excellent: '#059669', strong: '#10b981', moderate: '#f59e0b',
  weak: '#ef4444', poor: '#7f1d1d',
};
const GATE_COLOR: Record<GateStatus, string> = {
  ok: '#10b981', pending: '#f59e0b', missing: '#ef4444', unknown: '#9ca3af',
};

export default function SubmissionDetail() {
  const { id } = useParams<{ id: string }>();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [history, setHistory] = useState<SubmissionStageHistoryEntry[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'score' | 'gate' | 'stage' | null>(null);
  // Sync re-entry guard for the stage select. React state is one render
  // tick behind a click; without the ref a fast double-change can fire
  // moveStage twice before `busy` propagates to disable the select.
  const stageInFlight = useRef(false);
  const toast = useToast();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const [subRes, stageRes] = await Promise.all([
        submissionsApi.get(id),
        pipelineStagesApi.list().catch(() => ({ data: { stages: [] as PipelineStage[] } })),
      ]);
      setSubmission(subRes.data.submission);
      setHistory(subRes.data.stage_history);
      setStages(stageRes.data.stages);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load submission');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const rescore = async () => {
    if (!id) return;
    setBusy('score');
    try { await submissionsApi.rescore(id); await load(); }
    catch (e) { alert(`Re-score failed: ${e instanceof Error ? e.message : 'unknown'}`); }
    finally { setBusy(null); }
  };

  const recheckGate = async () => {
    if (!id) return;
    setBusy('gate');
    try { await submissionsApi.recheckGate(id); await load(); }
    catch (e) { alert(`Gate recheck failed: ${e instanceof Error ? e.message : 'unknown'}`); }
    finally { setBusy(null); }
  };

  const moveStage = async (newKey: string) => {
    if (!id || !submission || newKey === submission.stage_key) return;
    if (stageInFlight.current || busy === 'stage') return;
    // Cancel returns null on every browser. Treat that as a real cancel
    // (don't run the move) so the user gets the dropdown reverted on
    // the next render and isn't surprised by a silent submission.
    const note = window.prompt('Optional note for this transition (press Enter to skip):');
    if (note === null) {
      // Force the visible select back to its real value by triggering
      // a refetch — React's controlled select will snap to s.stage_key.
      void load();
      return;
    }
    stageInFlight.current = true;
    setBusy('stage');
    try {
      await submissionsApi.moveStage(id, newKey, note.trim() || undefined);
      await load();
      toast.success('Submission stage updated.');
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? (e instanceof Error ? e.message : 'Stage move failed.');
      toast.error(`Move failed: ${msg}`);
      // Re-pull so the select snaps back to whatever the server actually
      // has — prevents the dropdown from showing the optimistic value.
      void load();
    } finally {
      stageInFlight.current = false;
      setBusy(null);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>;
  if (error) return <div style={{ padding: 20, color: '#991b1b', background: '#fee2e2', margin: 20, borderRadius: 8 }}>{error}</div>;
  if (!submission) return null;

  const s = submission;
  const breakdown = s.ai_score_breakdown;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>
        <Link to="/submissions" style={{ color: 'var(--t3)', textDecoration: 'none' }}>Submissions</Link> ›{' '}
        <span style={{ color: 'var(--t2)' }}>{s.id.slice(0, 8)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t1)' }}>
            <Link to={`/candidates/${s.candidate_id}`} style={{ color: 'var(--t1)', textDecoration: 'none' }}>
              {s.candidate_name ?? 'Candidate'}
            </Link>{' '}
            <span style={{ color: 'var(--t3)', fontWeight: 400 }}>→</span>{' '}
            <Link to={`/jobs/${s.job_id}`} style={{ color: 'var(--t1)', textDecoration: 'none' }}>
              {s.job_title ?? 'Job'}
            </Link>
          </h1>
          <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {s.candidate_role && <span>{s.candidate_role}</span>}
            {s.job_code && <span style={{ fontFamily: 'monospace', color: 'var(--t3)' }}>· {s.job_code}</span>}
            {s.client_name && <span>· {s.client_name}</span>}
            {s.recruiter_name && <span>· recruiter: {s.recruiter_name}</span>}
          </div>
        </div>

        {/* Stage move control */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--t3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Stage
          </label>
          <select
            value={s.stage_key ?? ''}
            onChange={(e) => moveStage(e.target.value)}
            disabled={busy !== null}
            style={{
              padding: '8px 14px',
              background: s.stage_color ? `${s.stage_color}20` : 'var(--sf2)',
              color: s.stage_color ?? 'var(--t1)',
              border: `1px solid ${s.stage_color ?? 'var(--bd)'}`,
              borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', outline: 'none',
            }}
          >
            {stages.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
          </select>
        </div>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* AI Score */}
          <Section title="AI fit score" action={
            <button onClick={rescore} disabled={busy !== null} style={smallBtn}>
              {busy === 'score' ? 'Scoring…' : 'Re-score'}
            </button>
          }>
            {s.ai_score == null ? (
              <div style={{ padding: 16, color: 'var(--t3)', fontSize: 13, textAlign: 'center' }}>
                No score yet. Click "Re-score" to generate.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 14 }}>
                  <div style={{ width: 80, height: 80, borderRadius: '50%', background: `conic-gradient(${FIT_COLOR[s.ai_fit_label ?? 'moderate']} ${(s.ai_score / 100) * 360}deg, var(--sf3) 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--sf)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', lineHeight: 1 }}>{s.ai_score}</div>
                      <div style={{ fontSize: 9, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>total</div>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    {s.ai_fit_label && <Pill color={FIT_COLOR[s.ai_fit_label]} label={s.ai_fit_label} />}
                    {s.ai_summary && (
                      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>{s.ai_summary}</p>
                    )}
                  </div>
                </div>
                {breakdown && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                    {Object.entries(breakdown).map(([k, v]) => (
                      <ScoreBar key={k} label={k} value={v} />
                    ))}
                  </div>
                )}
                {s.ai_gaps && s.ai_gaps.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Gaps</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--t2)' }}>
                      {s.ai_gaps.map((g, i) => (
                        <li key={i}>
                          <strong>{g.category}:</strong> {g.gap}{' '}
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: g.severity === 'high' ? '#fee2e2' : g.severity === 'medium' ? '#fef3c7' : '#dbeafe', color: g.severity === 'high' ? '#991b1b' : g.severity === 'medium' ? '#92400e' : '#1e40af', marginLeft: 4 }}>{g.severity}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Section>

          {/* Credential gate */}
          <Section title="Credential gate" action={
            <button onClick={recheckGate} disabled={busy !== null} style={smallBtn}>
              {busy === 'gate' ? 'Checking…' : 'Re-check'}
            </button>
          }>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Pill color={GATE_COLOR[s.gate_status ?? 'unknown']} label={s.gate_status ?? 'unknown'} />
              <span style={{ fontSize: 13, color: 'var(--t2)' }}>
                {s.gate_status === 'ok' && 'All required items satisfied — clear to submit to client.'}
                {s.gate_status === 'pending' && 'All items known but some in progress.'}
                {s.gate_status === 'missing' && `${s.gate_missing?.length ?? 0} required item(s) missing.`}
                {s.gate_status === 'unknown' && 'No requirements configured on the job.'}
              </span>
            </div>
            {s.gate_missing && s.gate_missing.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--t2)' }}>
                {s.gate_missing.map((m, i) => (
                  <li key={i}>
                    <strong>{m.label}</strong>{' '}
                    <span style={{ color: 'var(--t3)' }}>· {m.kind} · {m.status ?? 'missing'} · {m.source}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Financials */}
          <Section title="Submission financials">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
              <Fact label="Bill rate" value={s.bill_rate != null ? `$${s.bill_rate}` : '—'} />
              <Fact label="Pay rate" value={s.pay_rate != null ? `$${s.pay_rate}` : '—'} />
              <Fact label="Stipend" value={s.stipend != null ? `$${s.stipend}` : '—'} />
              <Fact label="Expenses" value={s.expenses != null ? `$${s.expenses}` : '—'} />
              <Fact label="Margin" value={s.margin != null ? `$${s.margin}` : '—'} />
            </div>
          </Section>

          {/* Notes */}
          {s.candidate_summary && (
            <Section title="Candidate summary">
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: 'var(--t2)' }}>{s.candidate_summary}</div>
            </Section>
          )}
        </div>

        {/* Right rail — stage history */}
        <Section title={`Stage history (${history.length})`}>
          {history.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--t3)', fontSize: 13, textAlign: 'center' }}>No transitions yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10, position: 'relative' }}>
              {history.map((h) => (
                <div key={h.id} style={{ padding: 10, background: 'var(--sf2)', borderRadius: 6, border: '1px solid var(--bd)', fontSize: 12 }}>
                  <div style={{ color: 'var(--t1)', fontWeight: 600 }}>
                    {h.from_stage ? `${h.from_stage} → ` : ''}<span>{h.to_stage}</span>
                  </div>
                  <div style={{ color: 'var(--t3)', marginTop: 3 }}>
                    {new Date(h.created_at).toLocaleString()} · {h.display_changed_by ?? h.changed_by_name ?? 'system'}
                  </div>
                  {h.note && <div style={{ marginTop: 6, color: 'var(--t2)', fontStyle: 'italic' }}>"{h.note}"</div>}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

// ─── UI bits ────────────────────────────────────────────────────────────────
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--t1)', letterSpacing: 0.3 }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? '#10b981' : value >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: 'var(--t3)', textTransform: 'capitalize' }}>{label}</span>
        <span style={{ color: 'var(--t1)', fontWeight: 600 }}>{value}</span>
      </div>
      <div style={{ height: 6, background: 'var(--sf3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: `${color}20`, color, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

const smallBtn: React.CSSProperties = {
  padding: '6px 12px', background: 'var(--sf2)', color: 'var(--t2)',
  border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
