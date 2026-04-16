import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { jobsApi, submissionsApi, complianceBundlesApi, Job, JobRequirement, MatchingCandidate, CompBundle } from '../../lib/api';
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

  // Requirement editor (Phase 3)
  const [bundles, setBundles] = useState<CompBundle[]>([]);
  const [reqKind, setReqKind] = useState<'submission' | 'onboarding'>('submission');
  const [reqBundleId, setReqBundleId] = useState<string>('');
  const [reqAdHoc, setReqAdHoc] = useState<Array<{ type: 'doc' | 'cert' | 'license' | 'skill'; label: string; required: boolean }>>([]);
  const [reqAdHocDraft, setReqAdHocDraft] = useState<{ type: 'doc' | 'cert' | 'license' | 'skill'; label: string }>({ type: 'doc', label: '' });
  const [savingReq, setSavingReq] = useState(false);
  const [showReqEditor, setShowReqEditor] = useState(false);

  useEffect(() => {
    complianceBundlesApi.list({ status: 'published' }).then((r) => setBundles(r.data.bundles)).catch(() => { /* ignore */ });
  }, []);

  const addAdHocRow = () => {
    const label = reqAdHocDraft.label.trim();
    if (!label) return;
    setReqAdHoc([...reqAdHoc, { type: reqAdHocDraft.type, label, required: true }]);
    setReqAdHocDraft({ type: reqAdHocDraft.type, label: '' });
  };

  const resetReqEditor = () => {
    setShowReqEditor(false);
    setReqBundleId('');
    setReqAdHoc([]);
    setReqAdHocDraft({ type: 'doc', label: '' });
  };

  const saveRequirement = async () => {
    if (!id) return;
    if (!reqBundleId && reqAdHoc.length === 0) {
      alert('Select a bundle or add at least one ad-hoc item.');
      return;
    }
    setSavingReq(true);
    try {
      await jobsApi.addRequirement(id, {
        kind: reqKind,
        bundle_id: reqBundleId || null,
        ad_hoc: reqAdHoc,
      });
      resetReqEditor();
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      alert(err.response?.data?.error ?? err.message ?? 'Failed to save');
    } finally {
      setSavingReq(false);
    }
  };

  const removeRequirement = async (reqId: string) => {
    if (!id) return;
    if (!window.confirm('Remove this requirement row?')) return;
    try {
      await jobsApi.deleteRequirement(id, reqId);
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      alert(err.response?.data?.error ?? err.message ?? 'Failed to remove');
    }
  };

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
          <Section title="Credential requirements" action={
            can('candidates_edit') && !showReqEditor ? (
              <button onClick={() => setShowReqEditor(true)} style={{ padding: '5px 12px', background: 'var(--pr)', color: 'var(--sf)', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>+ Add requirement</button>
            ) : null
          }>
            {requirements.length === 0 && !showReqEditor ? (
              <div style={{ padding: 16, color: 'var(--t3)', fontSize: 13, textAlign: 'center', background: 'var(--sf2)', borderRadius: 6 }}>
                No requirements configured yet. Submission gate will report "unknown" until you add a bundle or ad-hoc items.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {requirements.map((r) => (
                  <div key={r.id} style={{ padding: 12, background: 'var(--sf2)', borderRadius: 6, border: '1px solid var(--bd)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--t1)', textTransform: 'capitalize' }}>{r.kind}</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {r.bundle_title && <span style={{ fontSize: 11, color: 'var(--pr)' }}>Bundle: {r.bundle_title}</span>}
                        {can('candidates_edit') && (
                          <button onClick={() => removeRequirement(r.id)} style={{ background: 'none', border: 'none', color: 'var(--dg)', cursor: 'pointer', fontSize: 11 }}>Remove</button>
                        )}
                      </div>
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

            {/* Inline editor */}
            {showReqEditor && (
              <div style={{ marginTop: 12, padding: 14, background: 'var(--sf2)', borderRadius: 6, border: '1px dashed var(--pr)' }}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <label style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Applies to</span>
                    <select value={reqKind} onChange={(e) => setReqKind(e.target.value as 'submission' | 'onboarding')} style={inputBase}>
                      <option value="submission">Submission (pre-client)</option>
                      <option value="onboarding">Onboarding (post-placement)</option>
                    </select>
                  </label>
                  <label style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Bundle (optional)</span>
                    <select value={reqBundleId} onChange={(e) => setReqBundleId(e.target.value)} style={inputBase}>
                      <option value="">— no bundle —</option>
                      {bundles.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                    </select>
                  </label>
                </div>

                {/* Ad-hoc items */}
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Ad-hoc items {reqAdHoc.length > 0 && `(${reqAdHoc.length})`}
                </div>
                {reqAdHoc.length > 0 && (
                  <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 12, color: 'var(--t2)' }}>
                    {reqAdHoc.map((a, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: 1 }}>{a.label} <span style={{ color: 'var(--t3)' }}>· {a.type}</span></span>
                        <button onClick={() => setReqAdHoc(reqAdHoc.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--dg)', cursor: 'pointer', fontSize: 11 }}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  <select value={reqAdHocDraft.type} onChange={(e) => setReqAdHocDraft({ ...reqAdHocDraft, type: e.target.value as 'doc' | 'cert' | 'license' | 'skill' })} style={{ ...inputBase, flex: '0 0 120px' }}>
                    <option value="doc">Document</option>
                    <option value="cert">Certification</option>
                    <option value="license">License</option>
                    <option value="skill">Skill</option>
                  </select>
                  <input
                    value={reqAdHocDraft.label}
                    onChange={(e) => setReqAdHocDraft({ ...reqAdHocDraft, label: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAdHocRow(); } }}
                    placeholder={reqAdHocDraft.type === 'cert' ? 'e.g. BLS, ACLS' : reqAdHocDraft.type === 'license' ? 'e.g. TX RN License' : reqAdHocDraft.type === 'skill' ? 'e.g. EPIC charting' : 'e.g. Physical form'}
                    style={{ ...inputBase, flex: 1 }}
                  />
                  <button onClick={addAdHocRow} style={{ padding: '6px 12px', background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>Add</button>
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={resetReqEditor} style={{ padding: '7px 14px', background: 'var(--sf)', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={saveRequirement} disabled={savingReq} style={{ padding: '7px 14px', background: 'var(--pr)', color: 'var(--sf)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: savingReq ? 0.6 : 1 }}>
                    {savingReq ? 'Saving…' : 'Save requirement'}
                  </button>
                </div>
              </div>
            )}
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

const inputBase: React.CSSProperties = {
  padding: '7px 10px',
  border: '1px solid var(--bd)',
  borderRadius: 5,
  fontSize: 12,
  background: 'var(--sf)',
  outline: 'none',
};

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
