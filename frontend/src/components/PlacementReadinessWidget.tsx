import React, { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';

interface ReadinessRecord {
  id: string;
  is_ready: boolean;
  readiness_score: number;
  blocking_issues: string[];
  last_evaluated: string;
  notes?: string;
}

interface PlacementReadinessWidgetProps {
  staffId?: string;
  candidateId?: string;
  onEvaluate?: () => void;
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  const mos = Math.floor(days / 30);
  return `${mos} month${mos !== 1 ? 's' : ''} ago`;
}

function scoreColor(score: number): string {
  if (score >= 70) return '#16a34a';
  if (score >= 50) return '#ea580c';
  return '#dc2626';
}

const PlacementReadinessWidget: React.FC<PlacementReadinessWidgetProps> = ({
  staffId,
  candidateId,
  onEvaluate,
}) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReadinessRecord | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let res;
      if (staffId) {
        res = await api.get(`/compliance/readiness/staff/${staffId}`);
      } else if (candidateId) {
        res = await api.get(`/compliance/readiness/candidate/${candidateId}`);
      } else {
        setLoading(false);
        return;
      }
      setData(res.data ?? null);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setData(null);
      } else {
        setError('Failed to load readiness data.');
      }
    } finally {
      setLoading(false);
    }
  }, [staffId, candidateId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleEvaluate = async () => {
    setEvaluating(true);
    try {
      if (staffId) {
        await api.post(`/compliance/readiness/evaluate/staff/${staffId}`);
      } else if (candidateId) {
        await api.post(`/compliance/readiness/evaluate/candidate/${candidateId}`);
      }
      await fetchData();
      onEvaluate?.();
    } catch {
      setError('Evaluation failed. Please try again.');
    } finally {
      setEvaluating(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: 'white',
    borderRadius: 10,
    boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
    padding: 16,
    fontSize: 13,
    color: '#1e293b',
  };

  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>
          Loading readiness…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={cardStyle}>
        <div style={{ color: '#dc2626', fontSize: 12 }}>{error}</div>
      </div>
    );
  }

  if (data === null) {
    return (
      <div style={{ ...cardStyle, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div style={{ color: '#64748b', marginBottom: 10 }}>Readiness not evaluated</div>
        <button
          onClick={handleEvaluate}
          disabled={evaluating}
          style={{
            background: 'white',
            border: '1.5px solid #2563eb',
            color: '#2563eb',
            borderRadius: 6,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: evaluating ? 'not-allowed' : 'pointer',
            opacity: evaluating ? 0.7 : 1,
          }}
        >
          {evaluating ? 'Evaluating…' : 'Evaluate Now'}
        </button>
      </div>
    );
  }

  const { is_ready, readiness_score, blocking_issues, last_evaluated } = data;
  const color = is_ready ? '#16a34a' : '#dc2626';
  const barColor = scoreColor(readiness_score);
  const issueCount = blocking_issues?.length ?? 0;

  return (
    <div style={cardStyle}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span
          style={{
            background: is_ready ? '#dcfce7' : '#fee2e2',
            color,
            borderRadius: 6,
            padding: '3px 10px',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 0.3,
            whiteSpace: 'nowrap',
          }}
        >
          {is_ready ? '✓ PLACEMENT READY' : '✗ NOT READY'}
        </span>
        <span style={{ color: '#64748b', fontSize: 12 }}>
          Score: {readiness_score} / 100
        </span>
      </div>

      {/* Score bar */}
      <div
        style={{
          height: 6,
          borderRadius: 4,
          background: '#e2e8f0',
          marginBottom: 10,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(readiness_score, 100)}%`,
            background: barColor,
            borderRadius: 4,
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* Blocking issues */}
      {issueCount > 0 && (
        <div style={{ marginBottom: 10 }}>
          <button
            onClick={() => setIssuesOpen((o) => !o)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#ea580c',
              fontWeight: 600,
              fontSize: 12,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>⚠</span>
            <span>
              {issueCount} issue{issueCount !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 10, marginLeft: 2 }}>{issuesOpen ? '▲' : '▼'}</span>
          </button>

          {issuesOpen && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {blocking_issues.map((issue, i) => (
                <div
                  key={i}
                  style={{
                    background: '#fff1f1',
                    border: '1px solid #fecaca',
                    borderRadius: 5,
                    padding: '4px 8px',
                    color: '#b91c1c',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                  }}
                >
                  <span style={{ marginTop: 1 }}>•</span>
                  <span>{issue}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: '#94a3b8', fontSize: 11 }}>
          Last evaluated: {relativeDate(last_evaluated)}
        </span>
        <button
          onClick={handleEvaluate}
          disabled={evaluating}
          style={{
            background: 'white',
            border: '1.5px solid #2563eb',
            color: '#2563eb',
            borderRadius: 5,
            padding: '2px 9px',
            fontSize: 11,
            fontWeight: 600,
            cursor: evaluating ? 'not-allowed' : 'pointer',
            opacity: evaluating ? 0.7 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {evaluating ? 'Running…' : 'Re-evaluate'}
        </button>
      </div>
    </div>
  );
};

export default PlacementReadinessWidget;
