import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { candidatesApi, Candidate, CandidateDocument } from '../lib/api';
import QueryState, { EmptyCta } from '../components/QueryState';

// The ATS migration mapped the old 'onboarding' stage key to 'confirmed' and
// kept 'onboarding' for any un-migrated rows. Fetch both so nothing is missed.
const ONBOARDING_STAGES = ['confirmed', 'onboarding'];

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 86400000));
}

/**
 * Computes completion % for a candidate's documents checklist.
 * Approved or received docs count as complete; missing/pending count as not.
 */
function docProgress(docs: CandidateDocument[]): { pct: number; complete: number; total: number } {
  const required = docs.filter((d) => d.required);
  if (required.length === 0) return { pct: 0, complete: 0, total: 0 };
  const complete = required.filter((d) => d.status === 'approved' || d.status === 'received').length;
  return { pct: Math.round((complete / required.length) * 100), complete, total: required.length };
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 1. Load all onboarding-stage candidates
  const {
    data: list,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['onboarding-candidates'],
    queryFn: async () => {
      const results = await Promise.all(ONBOARDING_STAGES.map((stage) => candidatesApi.list({ stage })));
      return results.flatMap((r) => r.data?.candidates ?? []);
    },
  });

  const candidates: Candidate[] = useMemo(() => list ?? [], [list]);

  // Default-select the first candidate once the list loads
  const activeId = selectedId ?? candidates[0]?.id ?? null;
  const selected = candidates.find((c) => c.id === activeId) ?? null;

  // 2. Load the selected candidate's documents (checklist)
  const {
    data: docsResp,
    isLoading: loadingDocs,
    error: docsError,
    refetch: refetchDocs,
  } = useQuery({
    queryKey: ['onboarding-docs', activeId ?? ''],
    queryFn: () => candidatesApi.getDocuments(activeId as string),
    enabled: !!activeId,
  });

  const documents: CandidateDocument[] = docsResp?.data?.documents ?? [];
  const progress = docProgress(documents);

  return (
    <div>
      {/* Page Header */}
      <div className="ph">
        <div>
          <div className="pt">📋 Onboarding</div>
          <div className="ps">Active onboarding candidates and their document status</div>
        </div>
        <button
          className="btn btn-pr"
          onClick={() => {
            alert(
              'The Start Onboarding workflow will be wired up in the next release. For now, move a candidate to the "Confirmed" stage on the Pipeline board to put them in onboarding.'
            );
          }}
        >
          + Start Onboarding
        </button>
      </div>

      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={candidates.length === 0}
        empty={
          <EmptyCta
            title="No one is onboarding right now"
            subtitle="Move a candidate to the Confirmed stage on the Pipeline board to begin onboarding. The list here will update automatically."
            ctaLabel="Open Pipeline"
            onCta={() => navigate('/pipeline')}
          />
        }
        onRetry={() => void refetch()}
      >
        <div className="cg2">
          {/* LEFT: Selected candidate detail */}
          <div className="pn">
            {selected ? (
              <>
                <div className="pnh">
                  <div>
                    <h3>
                      {selected.first_name} {selected.last_name}{' '}
                      {selected.role && (
                        <span className="tag tgr" style={{ marginLeft: 4 }}>
                          {selected.role}
                        </span>
                      )}
                    </h3>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>
                      {daysSince(selected.updated_at) != null
                        ? `In onboarding ${daysSince(selected.updated_at)} day${daysSince(selected.updated_at) === 1 ? '' : 's'}`
                        : 'Newly added'}
                    </div>
                  </div>
                  <span className={`tag ${progress.pct >= 80 ? 'tg' : progress.pct >= 50 ? 'tb' : 'tw'}`}>
                    {progress.pct}% complete
                  </span>
                </div>
                <div className="pnb">
                  {/* Progress bar */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--t3)', marginBottom: 6 }}>
                      <span>Required documents</span>
                      <span>{progress.complete} / {progress.total}</span>
                    </div>
                    <div className="pb">
                      <div className="pf" style={{ width: `${progress.pct}%`, background: 'var(--ac)' }} />
                    </div>
                  </div>

                  {/* Documents checklist */}
                  <QueryState
                    isLoading={loadingDocs}
                    error={docsError}
                    isEmpty={documents.length === 0}
                    empty={
                      <div style={{ padding: 16, color: 'var(--t3)', fontSize: 13, textAlign: 'center' }}>
                        No onboarding documents assigned to this candidate yet. Add required documents from the candidate's profile.
                      </div>
                    }
                    onRetry={() => void refetchDocs()}
                    minHeight={100}
                  >
                    <div style={{ marginBottom: 16 }}>
                      {documents.map((item, idx) => {
                        const done = item.status === 'approved' || item.status === 'received';
                        return (
                          <div
                            key={item.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '8px 0',
                              borderBottom: idx < documents.length - 1 ? '1px solid var(--sf3)' : 'none',
                            }}
                          >
                            <div
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: 4,
                                border: done ? '2px solid var(--ac)' : '2px solid var(--bd)',
                                background: done ? 'var(--ac)' : 'transparent',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {done && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                            </div>
                            <span
                              style={{
                                flex: 1,
                                fontSize: 13,
                                color: done ? 'var(--t3)' : 'var(--t1)',
                                textDecoration: done ? 'line-through' : 'none',
                              }}
                            >
                              {item.label ?? item.document_type}
                            </span>
                            <span className={`tag ${tagForDocStatus(item.status)}`}>{item.status}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Deep-link into the candidate profile to manage docs */}
                    <button className="btn btn-gh btn-sm" onClick={() => navigate(`/candidates/${selected.id}`)}>
                      Open candidate profile →
                    </button>
                  </QueryState>
                </div>
              </>
            ) : (
              <div className="pnb" style={{ padding: 24, color: 'var(--t3)' }}>
                Select a candidate to view their onboarding progress.
              </div>
            )}
          </div>

          {/* RIGHT: All onboarding candidates table */}
          <div className="pn">
            <div className="pnh">
              <h3>All Onboarding</h3>
              <span className="tag tb">{candidates.length} active</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>In stage</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const days = daysSince(c.updated_at);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        style={{
                          cursor: 'pointer',
                          background: c.id === activeId ? 'rgba(26, 95, 122, 0.06)' : undefined,
                        }}
                      >
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {c.first_name} {c.last_name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.email}</div>
                        </td>
                        <td>{c.role ?? '—'}</td>
                        <td>
                          <span style={{ fontSize: 12, color: 'var(--t3)' }}>
                            {days != null ? `${days}d` : '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </QueryState>
    </div>
  );
}

function tagForDocStatus(status: CandidateDocument['status']): string {
  switch (status) {
    case 'approved':
    case 'received':
      return 'tg';
    case 'pending':
      return 'tb';
    case 'rejected':
    case 'expired':
      return 'td';
    case 'missing':
    default:
      return 'tw';
  }
}
