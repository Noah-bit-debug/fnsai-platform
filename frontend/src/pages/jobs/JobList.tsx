import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobsApi, Job } from '../../lib/api';
import { useRBAC } from '../../contexts/RBACContext';

const PRIORITY_COLOR: Record<Job['priority'], string> = {
  urgent: '#dc2626',
  high: '#f59e0b',
  normal: '#6b7280',
  low: '#9ca3af',
};

const STATUS_COLOR: Record<Job['status'], string> = {
  draft: '#9ca3af',
  open: '#10b981',
  on_hold: '#f59e0b',
  filled: '#3b82f6',
  closed: '#6b7280',
  cancelled: '#ef4444',
};

export default function JobList() {
  const nav = useNavigate();
  const { can } = useRBAC();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('open');
  const [priority, setPriority] = useState<string>('');
  const [profession, setProfession] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (status) params.status = status;
      if (priority) params.priority = priority;
      if (profession) params.profession = profession;
      if (search) params.search = search;
      const res = await jobsApi.list(params);
      setJobs(res.data.jobs);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, priority, profession]);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load();
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>Jobs</h1>
          <div style={{ color: 'var(--t3)', fontSize: 13, marginTop: 4 }}>
            {loading ? 'Loading…' : `${jobs.length} job${jobs.length === 1 ? '' : 's'}`}
          </div>
        </div>
        {can('candidates_create') && (
          <button
            onClick={() => nav('/jobs/new')}
            style={{
              background: 'var(--pr)',
              color: 'var(--sf)',
              border: 'none',
              borderRadius: 'var(--br)',
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: 'var(--sh)',
            }}
          >
            + New Job
          </button>
        )}
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 16,
          padding: 12,
          background: 'var(--sf)',
          borderRadius: 'var(--br)',
          border: '1px solid var(--bd)',
          flexWrap: 'wrap',
        }}
      >
        <form onSubmit={onSearchSubmit} style={{ display: 'flex', gap: 6, flex: '1 1 240px', minWidth: 240 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, code, city, state…"
            style={{
              flex: 1,
              padding: '8px 10px',
              border: '1px solid var(--bd)',
              borderRadius: 6,
              fontSize: 13,
              outline: 'none',
            }}
          />
          <button type="submit" style={{ padding: '8px 14px', background: 'var(--sf2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
            Search
          </button>
        </form>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={filterSelectStyle}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="open">Open</option>
          <option value="on_hold">On hold</option>
          <option value="filled">Filled</option>
          <option value="closed">Closed</option>
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} style={filterSelectStyle}>
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <select value={profession} onChange={(e) => setProfession(e.target.value)} style={filterSelectStyle}>
          <option value="">All professions</option>
          <option value="RN">RN</option>
          <option value="LPN">LPN</option>
          <option value="LVN">LVN</option>
          <option value="CNA">CNA</option>
          <option value="RT">RT</option>
          <option value="NP">NP</option>
          <option value="PA">PA</option>
          <option value="Other">Other</option>
        </select>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 12 }}>{error}</div>
      )}

      {/* Job cards */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading jobs…</div>
      ) : jobs.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)', background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px dashed var(--bd)' }}>
          No jobs found. {can('candidates_create') && 'Click "New Job" to create one.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {jobs.map((j) => (
            <div
              key={j.id}
              onClick={() => nav(`/jobs/${j.id}`)}
              style={{
                background: 'var(--sf)',
                borderRadius: 'var(--br)',
                border: '1px solid var(--bd)',
                padding: '14px 18px',
                cursor: 'pointer',
                transition: 'var(--tr)',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto auto auto auto',
                gap: 16,
                alignItems: 'center',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--sh)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: 'var(--t1)', fontSize: 15 }}>{j.title}</span>
                  {j.job_code && <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>{j.job_code}</span>}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: `${PRIORITY_COLOR[j.priority]}20`,
                      color: PRIORITY_COLOR[j.priority],
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    {j.priority}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--t2)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {j.profession && <span>{j.profession}{j.specialty ? ` · ${j.specialty}` : ''}</span>}
                  {(j.city || j.state) && <span>· {[j.city, j.state].filter(Boolean).join(', ')}</span>}
                  {j.job_type && <span>· {j.job_type}</span>}
                  {j.client_name && <span>· {j.client_name}</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--t3)' }}>
                <div style={{ fontWeight: 600, color: 'var(--t1)' }}>{j.submission_count ?? 0}</div>
                <div>subs</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--t3)' }}>
                <div style={{ fontWeight: 600, color: 'var(--t1)' }}>{j.positions ?? 1}</div>
                <div>pos</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--t3)' }}>
                <div style={{ fontWeight: 600, color: 'var(--t1)' }}>{j.age_days ?? 0}d</div>
                <div>age</div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: `${STATUS_COLOR[j.status]}20`,
                  color: STATUS_COLOR[j.status],
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {j.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const filterSelectStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--bd)',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--sf)',
  cursor: 'pointer',
  outline: 'none',
};
