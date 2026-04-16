import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { pipelineApi, remindersApi, Candidate } from '../lib/api';

const COLUMNS = [
  { key: 'application',   label: 'Application',   color: '#1565c0', bg: '#eff6ff' },
  { key: 'interview',     label: 'Interview',      color: '#e65100', bg: '#fff3e0' },
  { key: 'credentialing', label: 'Credentialing',  color: '#6a1b9a', bg: '#fdf4ff' },
  { key: 'onboarding',    label: 'Onboarding',     color: '#2e7d32', bg: '#f0fdf4' },
];

function CandidateCard({ candidate, onClick }: { candidate: Candidate; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        borderRadius: 10,
        border: '1px solid #e8edf2',
        padding: '12px 14px',
        cursor: 'pointer',
        marginBottom: 10,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        transition: 'box-shadow 0.15s, transform 0.1s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.1)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)';
        e.currentTarget.style.transform = '';
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, color: '#1a2b3c', marginBottom: 2 }}>
        {candidate.first_name} {candidate.last_name}
      </div>
      {candidate.role && (
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{candidate.role}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
        {candidate.recruiter_name && (
          <div style={{ fontSize: 11, color: '#94a3b8' }}>👤 {candidate.recruiter_name}</div>
        )}
        {candidate.days_since_update != null && (
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: candidate.days_since_update > 7 ? '#c62828' : '#64748b',
            background: candidate.days_since_update > 7 ? '#fef2f2' : '#f1f5f9',
            padding: '2px 7px', borderRadius: 8,
          }}>
            {candidate.days_since_update}d
          </div>
        )}
      </div>
      {(candidate.missing_docs_count ?? 0) > 0 && (
        <div style={{
          marginTop: 8, fontSize: 11, color: '#e65100',
          background: '#fff3e0', padding: '4px 8px', borderRadius: 6, fontWeight: 600,
        }}>
          ⚠️ {candidate.missing_docs_count} missing doc{candidate.missing_docs_count !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

export default function Pipeline() {
  const navigate = useNavigate();
  const [stages, setStages] = useState<Record<string, Candidate[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);

  const fetchPipeline = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await pipelineApi.overview();
      setStages(res.data?.stages ?? {});
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load pipeline.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPipeline(); }, []);

  const handleAutoGenerate = async () => {
    setAutoGenerating(true);
    setAutoMsg(null);
    try {
      const res = await remindersApi.autoGenerate();
      setAutoMsg(`Generated ${res.data.generated} reminder${res.data.generated !== 1 ? 's' : ''}.`);
    } catch (e: any) {
      setAutoMsg(e?.response?.data?.error ?? 'Failed to generate reminders.');
    } finally {
      setAutoGenerating(false);
      setTimeout(() => setAutoMsg(null), 4000);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>Pipeline</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Kanban view of your recruiting pipeline</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {autoMsg && (
              <span style={{ fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>{autoMsg}</span>
            )}
            <button
              onClick={handleAutoGenerate}
              disabled={autoGenerating}
              style={{
                background: '#00796b', color: '#fff', border: 'none', borderRadius: 8,
                padding: '9px 18px', cursor: autoGenerating ? 'not-allowed' : 'pointer',
                fontWeight: 600, fontSize: 14, opacity: autoGenerating ? 0.7 : 1,
              }}
            >
              {autoGenerating ? 'Generating...' : '🔔 Auto-generate Reminders'}
            </button>
            <button
              onClick={fetchPipeline}
              style={{
                background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8,
                padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
              }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>Loading pipeline...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'start' }}>
          {COLUMNS.map(({ key, label, color, bg }) => {
            const cards = stages[key] ?? [];
            return (
              <div key={key} style={{ background: bg, borderRadius: 12, border: `1px solid ${color}22`, padding: 16 }}>
                {/* Column header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color, textTransform: 'capitalize' }}>
                    {label}
                  </div>
                  <span style={{
                    background: color, color: '#fff', borderRadius: 12,
                    padding: '2px 9px', fontSize: 12, fontWeight: 700,
                  }}>
                    {cards.length}
                  </span>
                </div>

                {/* Cards */}
                <div style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
                  {cards.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px 10px', color: '#94a3b8', fontSize: 13 }}>
                      No candidates
                    </div>
                  ) : (
                    cards.map((c) => (
                      <CandidateCard
                        key={c.id}
                        candidate={c}
                        onClick={() => navigate(`/candidates/${c.id}`)}
                      />
                    ))
                  )}
                </div>

                <button
                  onClick={() => navigate('/candidates/new')}
                  style={{
                    width: '100%', marginTop: 10, background: 'transparent',
                    border: `1px dashed ${color}66`, borderRadius: 8, padding: '8px',
                    cursor: 'pointer', color, fontWeight: 600, fontSize: 13,
                  }}
                >
                  + Add
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary footer */}
      {!loading && !error && (
        <div style={{ marginTop: 20, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {COLUMNS.map(({ key, label, color }) => {
            const count = stages[key]?.length ?? 0;
            const stale = stages[key]?.filter((c) => (c.days_since_update ?? 0) > 7).length ?? 0;
            return (
              <div key={key} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8edf2', padding: '12px 18px', minWidth: 130 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color }}>{count}</div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</div>
                {stale > 0 && <div style={{ fontSize: 11, color: '#c62828', marginTop: 4 }}>⚠️ {stale} stale (&gt;7d)</div>}
              </div>
            );
          })}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8edf2', padding: '12px 18px', minWidth: 130 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1a2b3c' }}>
              {COLUMNS.reduce((sum, { key }) => sum + (stages[key]?.length ?? 0), 0)}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Total Active</div>
          </div>
        </div>
      )}
    </div>
  );
}
