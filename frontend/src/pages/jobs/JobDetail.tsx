import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { jobsApi, submissionsApi, Job, JobRequirement, MatchingCandidate } from '../../lib/api';
import { useRBAC } from '../../contexts/RBACContext';

const STATUS_COLOR: Record<Job['status'], string> = {
  draft: '#9ca3af', open: '#10b981', on_hold: '#f59e0b',
  filled: '#3b82f6', closed: '#6b7280', cancelled: '#ef4444',
};
const PRIORITY_COLOR: Record<Job['priority'], string> = {
  urgent: '#dc2626', high: '#f59e0b', normal: '#6b7280', low: '#9ca3af',
};

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { can } = useRBAC();
  const [job, setJob] = useState<Job | null>(null);
  const [requirements, setRequirements] = useState<JobRequirement[]>([]);
  const [matches, setMatches] = useState<MatchingCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<'boolean' | 'ad' | 'summary' | null>(null);
  const [creatingSub, setCreatingSub] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const [jobRes, matchRes] = await Promise.all([
        jobsApi.get(id),
        jobsApi.matchingCandidates(id).catch(() => ({ data: { candidates: [] as MatchingCandidate[] } })),
      ]);
      setJob(jobRes.data.job);
      setRequirements(jobRes.data.requirements);
      setMatches(matchRes.data.candidates);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const runAI = async (kind: 'boolean' | 'ad' | 'summary') => {
    if (!id) return;
    setAiBusy(kind);
    try {
      if (kind === 'boolean') await jobsApi.generateBoolean(id);
      if (kind === 'ad') await jobsApi.generateJobAd(id);
      if (kind === 'summary') await jobsApi.generateSummary(id);
      await load();
    } catch (e) {
      alert(`AI generation failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setAiBusy(null);
    }
  };

  const submitCandidate = async (candidateId: string) => {
    if (!id) return;
    setCreatingSub(candidateId);
    try {
      const res = await submissionsApi.create({ candidate_id: candidateId, job_id: id });
      nav(`/submissions/${res.data.submission.id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      alert(err.response?.data?.error ?? err.message ?? 'Failed to submit');
      setCreatingSub(null);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>;
  if (error) return <div style={{ padding: 20, color: '#991b1b', background: '#fee2e2', margin: 20, borderRadius: 8 }}>{error}</div>;
  if (!job) return null;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Breadcrumb + Header */}
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>
        <Link to="/jobs" style={{ color: 'var(--t3)', textDecoration: 'none' }}>Jobs</Link> ›{' '}
        <span style={{ color: 'var(--t2)' }}>{job.job_code ?? job.id.slice(0, 8)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>{job.title}</h1>
          <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {job.job_code && <span style={{ fontFamily: 'monospace', color: 'var(--t3)' }}>{job.job_code}</span>}
            {job.profession && <span>· {job.profession}{job.specialty ? ` · ${job.specialty}` : ''}</span>}
            {(job.city || job.state) && <span>· {[job.city, job.state].filter(Boolean).join(', ')}</span>}
            {job.client_name && <span>· {job.client_name}</span>}
            {job.facility_name && <span>· {job.facility_name}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Badge color={PRIORITY_COLOR[job.priority]} label={job.priority} />
          <Badge color={STATUS_COLOR[job.status]} label={job.status.replace('_', ' ')} />
        </div>
      </div>

      {/* Grid: left = details, right = matching candidates */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Summary + key facts */}
          <Section title="Summary">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Fact label="Job type" value={job.job_type ?? '—'} />
              <Fact label="Shift" value={job.shift ?? '—'} />
              <Fact label="Duration" value={job.duration_weeks ? `${job.duration_weeks} wks` : '—'} />
              <Fact label="Positions" value={String(job.positions ?? 1)} />
              <Fact label="Pay rate" value={job.pay_rate ? `$${job.pay_rate}/hr` : '—'} />
              <Fact label="Bill rate" value={job.bill_rate ? `$${job.bill_rate}/hr` : '—'} />
              <Fact label="Primary recruiter" value={job.primary_recruiter_name ?? '—'} />
              <Fact label="Submissions" value={String(job.submission_count ?? 0)} />
            </div>
            {job.summary && (
              <div style={{ marginTop: 14, padding: 12, background: 'var(--sf2)', borderRadius: 6, fontSize: 13, color: 'var(--t2)', lineHeight: 1.55 }}>
                {job.summary}
              </div>
            )}
          </Section>

          {/* AI actions */}
          <Section title="AI actions">
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <AIButton label="Generate Boolean" onClick={() => runAI('boolean')} busy={aiBusy === 'boolean'} disabled={aiBusy !== null} />
              <AIButton label="Generate Job Ad" onClick={() => runAI('ad')} busy={aiBusy === 'ad'} disabled={aiBusy !== null} />
              <AIButton label="Generate Summary" onClick={() => runAI('summary')} busy={aiBusy === 'summary'} disabled={aiBusy !== null} />
            </div>
            {job.boolean_search && (
              <AIResultBlock label="Boolean search">
                <code style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{job.boolean_search}</code>
              </AIResultBlock>
            )}
            {job.job_ad && (
              <AIResultBlock label="Job ad">
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>{job.job_ad}</div>
              </AIResultBlock>
            )}
          </Section>

          {/* Requirements / Credential gate */}
          <Section title="Credential requirements">
            {requirements.length === 0 ? (
              <div style={{ padding: 16, color: 'var(--t3)', fontSize: 13, textAlign: 'center', background: 'var(--sf2)', borderRadius: 6 }}>
                No requirements configured yet. Submission gate will report "unknown" until you add a bundle or ad-hoc items.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {requirements.map((r) => (
                  <div key={r.id} style={{ padding: 12, background: 'var(--sf2)', borderRadius: 6, border: '1px solid var(--bd)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--t1)', textTransform: 'capitalize' }}>{r.kind}</span>
                      {r.bundle_title && <span style={{ fontSize: 11, color: 'var(--pr)' }}>Bundle: {r.bundle_title}</span>}
                    </div>
                    {r.ad_hoc?.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--t2)' }}>
                        {r.ad_hoc.map((a, i) => (
                          <li key={i}>
                            {a.label}
                            {a.type && <span style={{ color: 'var(--t3)' }}> · {a.type}</span>}
                            {a.required === false && <span style={{ color: 'var(--t3)' }}> (optional)</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 10 }}>
              Requirement editor UI lands in Phase 3 — for now, add rows via the API or database.
            </div>
          </Section>

          {/* Description */}
          {job.description && (
            <Section title="Description">
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: 'var(--t2)' }}>{job.description}</div>
            </Section>
          )}
        </div>

        {/* Right rail — matching candidates */}
        <Section title={`Matching candidates (${matches.length})`}>
          {matches.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--t3)', fontSize: 13, textAlign: 'center' }}>
              No matching active candidates.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {matches.map((m) => (
                <div key={m.id} style={{ padding: 10, background: 'var(--sf2)', borderRadius: 6, border: '1px solid var(--bd)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <Link to={`/candidates/${m.id}`} style={{ fontWeight: 600, fontSize: 13, color: 'var(--t1)', textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.first_name} {m.last_name}
                    </Link>
                    <span
                      title="Match score"
                      style={{
                        fontSize: 11, fontWeight: 700, color: 'var(--sf)',
                        background: m.match_score >= 70 ? '#10b981' : m.match_score >= 40 ? '#f59e0b' : '#6b7280',
                        padding: '2px 7px', borderRadius: 999, flexShrink: 0,
                      }}
                    >
                      {m.match_score}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {m.role && <span>{m.role}</span>}
                    {m.specialties && m.specialties.length > 0 && <span>· {m.specialties.slice(0, 3).join(', ')}</span>}
                    {(m.city || m.state) && <span>· {[m.city, m.state].filter(Boolean).join(', ')}</span>}
                    {m.years_experience != null && <span>· {m.years_experience}y</span>}
                  </div>
                  {can('candidates_create') && (
                    <button
                      onClick={() => submitCandidate(m.id)}
                      disabled={creatingSub === m.id}
                      style={{ marginTop: 8, width: '100%', padding: '6px 10px', background: 'var(--pr)', color: 'var(--sf)', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: creatingSub === m.id ? 0.6 : 1 }}
                    >
                      {creatingSub === m.id ? 'Submitting…' : 'Submit to this job'}
                    </button>
                  )}
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
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px solid var(--bd)', padding: 16 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--t1)', letterSpacing: 0.3 }}>{title}</h2>
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

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: `${color}20`, color, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {label}
    </span>
  );
}

function AIButton({ label, onClick, busy, disabled }: { label: string; onClick: () => void; busy: boolean; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 14px',
        background: busy ? 'var(--sf2)' : 'var(--pu)',
        color: busy ? 'var(--t2)' : 'var(--sf)',
        border: 'none',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled && !busy ? 0.5 : 1,
      }}
    >
      {busy ? 'Generating…' : `✨ ${label}`}
    </button>
  );
}

function AIResultBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10, padding: 12, background: 'var(--sf2)', borderRadius: 6, border: '1px solid var(--bd)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}
