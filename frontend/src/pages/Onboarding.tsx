import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { candidatesApi, Candidate, CandidateDocument } from '../lib/api';
import QueryState, { EmptyCta } from '../components/QueryState';
import { useToast } from '../components/ToastHost';
import { useConfirm } from '../components/ConfirmHost';

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
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);

  const convertMut = useMutation({
    mutationFn: (candidateId: string) => candidatesApi.convertToStaff(candidateId),
    onSuccess: (resp) => {
      toast.success('Candidate converted to staff', {
        action: { label: 'View staff →', onClick: () => navigate(`/staff/${resp.data.staff_id}`) },
        ttl: 8000,
      });
      queryClient.invalidateQueries({ queryKey: ['onboarding-candidates'] });
    },
    onError: (e: { response?: { data?: { error?: string } }; message?: string }) => {
      toast.error(e?.response?.data?.error ?? e?.message ?? 'Failed to convert');
    },
  });

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
        <button className="btn btn-pr" onClick={() => setShowStartModal(true)}>
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

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn-gh btn-sm" onClick={() => navigate(`/candidates/${selected.id}`)}>
                        Open candidate profile →
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'var(--ac)', color: '#fff' }}
                        disabled={convertMut.isPending || progress.pct < 100}
                        title={progress.pct < 100 ? 'All required documents must be complete' : 'Complete onboarding and create a staff record'}
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Complete onboarding for this candidate?',
                            description: `This creates a staff record for ${selected.first_name} ${selected.last_name}, marks the candidate as placed, and links any existing placements.`,
                            confirmLabel: 'Create staff record',
                          });
                          if (ok) convertMut.mutate(selected.id);
                        }}
                      >
                        {convertMut.isPending ? 'Converting…' : '✓ Complete & convert to staff'}
                      </button>
                    </div>
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

      {showStartModal && (
        <StartOnboardingModal
          onClose={() => setShowStartModal(false)}
          onStarted={() => {
            setShowStartModal(false);
            toast.success('Candidate moved into onboarding');
            queryClient.invalidateQueries({ queryKey: ['onboarding-candidates'] });
          }}
          onError={(m) => toast.error(m)}
        />
      )}
    </div>
  );
}

// ─── Start Onboarding modal ──────────────────────────────────────────────────
// Eligible candidates = anyone not already in a terminal stage or already in
// onboarding. Moving them to 'confirmed' via moveStage puts them on this page.
function StartOnboardingModal({
  onClose,
  onStarted,
  onError,
}: {
  onClose: () => void;
  onStarted: () => void;
  onError: (m: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pull candidates in stages that are upstream of onboarding
  const eligibleStages = ['new_lead', 'screening', 'internal_review', 'submitted', 'client_submitted', 'interview', 'offer'];
  const { data, isLoading } = useQuery({
    queryKey: ['onboarding-eligible-candidates'],
    queryFn: async () => {
      const results = await Promise.all(
        eligibleStages.map((stage) => candidatesApi.list({ stage, status: 'active' }))
      );
      return results.flatMap((r) => r.data?.candidates ?? []);
    },
  });

  const candidates = (data ?? []).filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.role ?? '').toLowerCase().includes(q)
    );
  });

  const handleStart = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    try {
      await candidatesApi.moveStage(selectedId, 'confirmed', 'Moved to onboarding from Onboarding page');
      onStarted();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      onError(err?.response?.data?.error ?? err?.message ?? 'Failed to start onboarding');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, width: 'min(92vw, 560px)',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
            Start Onboarding
          </div>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidates by name, email, or role…"
            style={{
              width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0',
              borderRadius: 6, fontSize: 13, outline: 'none',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {isLoading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading…</div>
          ) : candidates.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              {data && data.length > 0
                ? 'No candidates match your search.'
                : 'No eligible candidates. Add a candidate or move one forward in the pipeline first.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {candidates.map((c) => (
                <label
                  key={c.id}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '10px 12px',
                    background: selectedId === c.id ? 'rgba(37, 99, 235, 0.08)' : '#f8fafc',
                    border: `1px solid ${selectedId === c.id ? '#93c5fd' : '#e2e8f0'}`,
                    borderRadius: 8, cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="candidate"
                    checked={selectedId === c.id}
                    onChange={() => setSelectedId(c.id)}
                    style={{ accentColor: '#2563eb' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>
                      {c.first_name} {c.last_name}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {c.role && <span>{c.role}</span>}
                      {c.role && c.email && <span> · </span>}
                      {c.email && <span>{c.email}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: '#e2e8f0', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {c.stage.replace(/_/g, ' ')}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0',
              borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!selectedId || submitting}
            style={{
              background: '#2563eb', color: '#fff', border: 'none',
              borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600,
              cursor: !selectedId || submitting ? 'wait' : 'pointer',
              opacity: !selectedId ? 0.5 : 1,
            }}
          >
            {submitting ? 'Starting…' : 'Move to Onboarding'}
          </button>
        </div>
      </div>
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
