import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  pipelineApi,
  remindersApi,
  candidatesApi,
  jobsApi,
  type PipelineCandidateCard,
  type PipelineStageColumn,
} from '../lib/api';
import { useToast } from '../components/ToastHost';
import { extractApiError } from '../lib/apiErrors';

/**
 * Candidate Pipeline — Phase 1.4 rewrite.
 *
 * Was: static 4 columns (application, interview, credentialing, onboarding),
 *      no drag-drop, click-only navigation.
 * Now: dynamic columns from pipeline_stages (12 by default, interview first
 *      per Phase 1.1E/4D), drag-drop moves, Ctrl+click multi-select (drag
 *      one selected card to move the whole set at once), filters for role,
 *      shift type, and job.
 */

const SHIFT_OPTIONS = ['days', 'evenings', 'nights', 'weekends', 'rotating'];

export default function Pipeline() {
  const nav = useNavigate();
  const toast = useToast();

  const [columns, setColumns] = useState<PipelineStageColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<PipelineCandidateCard | null>(null);

  // Phase 1.4.B — multi-select. Candidate IDs in the current selection set.
  // Ctrl+click (or Cmd+click on Mac) toggles membership. Dragging any
  // selected card drags the whole set.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Phase 1.4.C — filters (client-side, apply to the already-loaded data)
  const [roleFilter, setRoleFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [hideTerminal, setHideTerminal] = useState(true);

  // Reminder auto-gen state (preserved from old Pipeline)
  const [autoGenerating, setAutoGenerating] = useState(false);

  // Job list for the filter dropdown
  const [jobs, setJobs] = useState<Array<{ id: string; title: string; job_code: string }>>([]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Phase 1 QA fix — drag-drop appeared to do nothing because @dnd-kit's
  // default rectIntersection collision detection wouldn't find the column
  // when you dropped a card ON another card (cards are draggable, not
  // droppable). Custom detection:
  //   1. First try pointerWithin (pointer landed inside the droppable)
  //   2. Fall back to rectIntersection (card overlaps column rect)
  //   3. Fall back to closestCorners (nearest column in viewport)
  // This matches the pattern @dnd-kit docs recommend for kanban.
  const collisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    const rects = rectIntersection(args);
    if (rects.length > 0) return rects;
    return closestCorners(args);
  };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await pipelineApi.candidatesKanban();
      setColumns(res.data.stages);
    } catch (e: unknown) {
      const axiosErr = e as { response?: { data?: { error?: string } }; message?: string };
      setError(axiosErr?.response?.data?.error ?? axiosErr?.message ?? 'Failed to load pipeline');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Preload jobs for filter dropdown — best-effort, empty list on failure
  useEffect(() => {
    void jobsApi.list({ status: 'open' as any })
      .then((r: any) => setJobs((r?.data?.jobs ?? []).map((j: any) => ({ id: j.id, title: j.title, job_code: j.job_code }))))
      .catch(() => { /* silent */ });
  }, []);

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    const card = columns.flatMap((c) => c.items).find((i) => i.id === id);
    if (card) setActiveCard(card);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const draggedId = String(e.active.id);
    const targetStageKey = e.over ? String(e.over.id) : null;
    setActiveCard(null);
    if (!targetStageKey) return;

    // Determine which cards are moving. If the dragged card is in the selected
    // set, move all selected. Otherwise just the one.
    const movingIds = selected.has(draggedId) && selected.size > 1
      ? Array.from(selected)
      : [draggedId];

    // Filter to cards that actually need to move (not already in target)
    const allCards = columns.flatMap((c) => c.items);
    const cardsToMove = movingIds
      .map((id) => allCards.find((c) => c.id === id))
      .filter((c): c is PipelineCandidateCard => !!c && c.stage !== targetStageKey);

    if (cardsToMove.length === 0) return;

    // Optimistic update
    const prev = columns;
    const targetStageLabel = columns.find((c) => c.key === targetStageKey)?.label ?? targetStageKey;
    setColumns((cols) =>
      cols.map((col) => {
        if (cardsToMove.some((c) => c.stage === col.key)) {
          // Remove cards that are leaving this column
          return {
            ...col,
            items: col.items.filter((i) => !cardsToMove.some((m) => m.id === i.id)),
            count: col.items.filter((i) => !cardsToMove.some((m) => m.id === i.id)).length,
          };
        }
        if (col.key === targetStageKey) {
          const moved = cardsToMove.map((c) => ({ ...c, stage: targetStageKey, days_in_stage: 0, is_stale: false }));
          return { ...col, items: [...moved, ...col.items], count: col.items.length + moved.length };
        }
        return col;
      })
    );

    // Clear selection after drag
    setSelected(new Set());

    // Server writes: run them in parallel with Promise.allSettled so a single
    // failure doesn't abort the others, but we still rollback if ANY fail.
    try {
      const results = await Promise.allSettled(
        cardsToMove.map((c) => candidatesApi.moveStage(c.id, targetStageKey))
      );
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        toast.error(`${failures.length} of ${cardsToMove.length} moves failed — reloading pipeline`);
        setColumns(prev);
        void load();
      } else if (cardsToMove.length === 1) {
        toast.success(`Moved ${cardsToMove[0].first_name} ${cardsToMove[0].last_name} to ${targetStageLabel}`, { ttl: 2500 });
      } else {
        toast.success(`Moved ${cardsToMove.length} candidates to ${targetStageLabel}`, { ttl: 3000 });
      }
    } catch (err: unknown) {
      toast.error(`Move failed: ${extractApiError(err, 'unknown')}`);
      setColumns(prev);
    }
  };

  // Multi-select click handler. Ctrl/Cmd+click toggles, regular click opens.
  const onCardClick = (card: PipelineCandidateCard, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(card.id)) next.delete(card.id);
        else next.add(card.id);
        return next;
      });
      return;
    }
    nav(`/candidates/${card.id}`);
  };

  const handleAutoGenerate = async () => {
    setAutoGenerating(true);
    try {
      const res = await remindersApi.autoGenerate();
      toast.success(`Generated ${res.data.generated} reminder${res.data.generated !== 1 ? 's' : ''}.`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to generate reminders.');
    } finally {
      setAutoGenerating(false);
    }
  };

  // Apply filters + terminal-hide to the loaded data before rendering
  const filteredColumns = useMemo(() => {
    const cols = hideTerminal ? columns.filter((c) => !c.is_terminal) : columns;
    const text = searchText.trim().toLowerCase();
    const filterCard = (c: PipelineCandidateCard): boolean => {
      if (roleFilter && c.role !== roleFilter) return false;
      if (shiftFilter && !(c.available_shifts ?? []).includes(shiftFilter)) return false;
      if (jobFilter && !c.submitted_job_ids.includes(jobFilter)) return false;
      if (text) {
        const hay = [c.first_name, c.last_name, c.role, c.city, c.state, ...(c.specialties ?? [])]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    };
    return cols.map((col) => {
      const items = col.items.filter(filterCard);
      return { ...col, items, count: items.length };
    });
  }, [columns, roleFilter, shiftFilter, jobFilter, searchText, hideTerminal]);

  return (
    <div style={{ padding: '20px 24px', maxWidth: '100%', margin: '0 auto' }}>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>Candidate Pipeline</h1>
            <p style={{ fontSize: 13, color: 'var(--t3)' }}>
              Drag cards between stages. Ctrl/Cmd+click to select multiple, then drag one to move the whole set.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {selected.size > 0 && (
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pr)' }}>
                {selected.size} selected
                <button
                  onClick={() => setSelected(new Set())}
                  style={{ marginLeft: 8, fontSize: 11, background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', textDecoration: 'underline' }}
                >clear</button>
              </span>
            )}
            <button onClick={handleAutoGenerate} disabled={autoGenerating}
              title="Scans the pipeline for candidates with overdue follow-ups, missing documents, or stalled stages, then creates a reminder for each so nothing falls through the cracks."
              style={{ background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: autoGenerating ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13, opacity: autoGenerating ? 0.6 : 1 }}>
              {autoGenerating ? 'Generating…' : '🔔 Auto-generate Reminders'}
            </button>
            <button onClick={() => void load()}
              style={{ background: 'var(--sf2)', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, padding: 12, background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)' }}>
        <input
          placeholder="Search name, specialty, city…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ flex: '1 1 220px', padding: '7px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, outline: 'none' }}
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, background: 'var(--sf)' }}>
          <option value="">All positions</option>
          {['RN', 'LPN', 'LVN', 'CNA', 'RT', 'NP', 'PA', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, background: 'var(--sf)' }}>
          <option value="">All shifts</option>
          {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, background: 'var(--sf)' }}>
          <option value="">Submitted to any job</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.title} ({j.job_code})</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={hideTerminal} onChange={(e) => setHideTerminal(e.target.checked)} />
          Hide terminal stages
        </label>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 12 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--t3)' }}>Loading pipeline…</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
            {filteredColumns.map((col) => (
              <StageColumn
                key={col.key}
                column={col}
                selected={selected}
                onCardClick={onCardClick}
              />
            ))}
          </div>
          <DragOverlay>
            {activeCard ? (
              <div style={{ transform: 'rotate(2deg)' }}>
                <CandidateCardInner card={activeCard} isSelected={selected.has(activeCard.id)} isDraggingSet={selected.size > 1 && selected.has(activeCard.id)} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

// ─── Stage column ───────────────────────────────────────────────────────────
function StageColumn({
  column, selected, onCardClick,
}: {
  column: PipelineStageColumn;
  selected: Set<string>;
  onCardClick: (c: PipelineCandidateCard, e: React.MouseEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  const bg = isOver ? `${column.color}22` : 'var(--sf)';
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: '0 0 280px',
        background: bg,
        borderRadius: 12,
        border: `1px solid ${isOver ? column.color : 'var(--bd)'}`,
        padding: 12,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: column.color }}>{column.label}</div>
        <span style={{ background: column.color, color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
          {column.count}
        </span>
      </div>
      <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
        {column.items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 8px', color: 'var(--t3)', fontSize: 12 }}>No candidates</div>
        ) : (
          column.items.map((card) => (
            <DraggableCard
              key={card.id}
              card={card}
              isSelected={selected.has(card.id)}
              onClick={onCardClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Draggable wrapper ──────────────────────────────────────────────────────
function DraggableCard({
  card, isSelected, onClick,
}: {
  card: PipelineCandidateCard;
  isSelected: boolean;
  onClick: (c: PipelineCandidateCard, e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // @dnd-kit fires listener events on pointer down; suppress the real
        // click only if drag actually happened.
        if (isDragging) return;
        onClick(card, e);
      }}
      style={{
        opacity: isDragging ? 0.3 : 1,
        cursor: 'grab',
        marginBottom: 8,
      }}
    >
      <CandidateCardInner card={card} isSelected={isSelected} />
    </div>
  );
}

// ─── Card visuals ───────────────────────────────────────────────────────────
function CandidateCardInner({
  card, isSelected, isDraggingSet,
}: {
  card: PipelineCandidateCard;
  isSelected: boolean;
  isDraggingSet?: boolean;
}) {
  return (
    <div
      style={{
        background: 'var(--sf)',
        borderRadius: 8,
        border: isSelected ? '2px solid var(--pr)' : '1px solid var(--bd)',
        padding: '9px 11px',
        boxShadow: isSelected ? '0 0 0 3px rgba(99, 102, 241, 0.15)' : '0 1px 2px rgba(0,0,0,0.05)',
        position: 'relative',
      }}
    >
      {isDraggingSet && (
        <div style={{
          position: 'absolute', top: -8, right: -8, background: 'var(--pr)', color: '#fff',
          borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700,
        }}>+batch</div>
      )}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 2 }}>
        {card.first_name} {card.last_name}
      </div>
      {card.role && (
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>
          {card.role}
          {card.years_experience ? ` · ${card.years_experience}yr` : ''}
          {card.city || card.state ? ` · ${[card.city, card.state].filter(Boolean).join(', ')}` : ''}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
        {card.recruiter_name && (
          <div style={{ fontSize: 10, color: 'var(--t3)' }}>👤 {card.recruiter_name}</div>
        )}
        {card.days_in_stage != null && (
          <div style={{
            fontSize: 10, fontWeight: 600,
            color: card.is_stale ? '#c62828' : 'var(--t3)',
            background: card.is_stale ? '#fef2f2' : 'var(--sf2)',
            padding: '1px 6px', borderRadius: 8,
          }}>
            {card.days_in_stage}d
          </div>
        )}
      </div>
      {card.missing_docs_count > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: '#e65100', background: '#fff3e0', padding: '2px 6px', borderRadius: 6, fontWeight: 600 }}>
          ⚠️ {card.missing_docs_count} missing doc{card.missing_docs_count !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
