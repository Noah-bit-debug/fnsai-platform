import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { kanbanApi, submissionsApi, KanbanColumn, FitLabel, GateStatus } from '../lib/api';

const FIT_COLOR: Record<FitLabel, string> = {
  excellent: '#059669', strong: '#10b981', moderate: '#f59e0b',
  weak: '#ef4444', poor: '#7f1d1d',
};

const GATE_COLOR: Record<GateStatus, string> = {
  ok: '#10b981', pending: '#f59e0b', missing: '#ef4444', unknown: '#9ca3af',
};

type KanbanCard = KanbanColumn['items'][number];

export default function KanbanBoard() {
  const nav = useNavigate();
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<KanbanCard | null>(null);
  const [hideTerminal, setHideTerminal] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await kanbanApi.get();
      setColumns(res.data.stages);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load kanban');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    const card = columns.flatMap((c) => c.items).find((i) => i.id === id);
    if (card) setActiveCard(card);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const cardId = String(e.active.id);
    const targetStageKey = e.over ? String(e.over.id) : null;
    setActiveCard(null);
    if (!targetStageKey) return;

    const card = columns.flatMap((c) => c.items).find((i) => i.id === cardId);
    if (!card || card.stage_key === targetStageKey) return;

    // Optimistic update
    const prev = columns;
    const next = columns.map((col) => {
      if (col.key === card.stage_key) {
        return { ...col, items: col.items.filter((i) => i.id !== cardId), count: col.count - 1 };
      }
      if (col.key === targetStageKey) {
        const moved: KanbanCard = { ...card, stage_key: targetStageKey, days_in_stage: 0, is_stale: false };
        return { ...col, items: [moved, ...col.items], count: col.count + 1 };
      }
      return col;
    });
    setColumns(next);

    try {
      await submissionsApi.moveStage(cardId, targetStageKey);
    } catch (err: unknown) {
      alert(`Move failed: ${err instanceof Error ? err.message : 'unknown'}`);
      setColumns(prev); // rollback
    }
  };

  const visibleColumns = hideTerminal ? columns.filter((c) => !c.is_terminal) : columns;
  const totalCards = columns.reduce((n, c) => n + c.count, 0);

  return (
    <div style={{ padding: '16px 24px', height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t1)' }}>Pipeline — Kanban</h1>
          <div style={{ color: 'var(--t3)', fontSize: 13, marginTop: 2 }}>
            {loading ? 'Loading…' : `${totalCards} submission${totalCards === 1 ? '' : 's'} across ${visibleColumns.length} stage${visibleColumns.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={hideTerminal} onChange={(e) => setHideTerminal(e.target.checked)} />
            Hide terminal stages
          </label>
          <button onClick={load} style={{ padding: '6px 14px', background: 'var(--sf2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div style={{ padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 10 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', flex: 1, paddingBottom: 8 }}>
            {visibleColumns.map((col) => (
              <StageColumn
                key={col.key}
                column={col}
                onCardClick={(cardId) => nav(`/submissions/${cardId}`)}
              />
            ))}
          </div>
          <DragOverlay>
            {activeCard && <Card card={activeCard} dragging />}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

// ─── Column (droppable) ─────────────────────────────────────────────────────
function StageColumn({ column, onCardClick }: { column: KanbanColumn; onCardClick: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  const accent = column.color ?? '#6b7280';

  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        background: isOver ? `${accent}15` : 'var(--sf2)',
        borderRadius: 10,
        border: `1px solid ${isOver ? accent : 'var(--bd)'}`,
        display: 'flex',
        flexDirection: 'column',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: accent }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{column.label}</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600, padding: '1px 8px', background: 'var(--sf)', borderRadius: 999 }}>
          {column.count}
        </span>
      </div>
      <div ref={setNodeRef} style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1, minHeight: 100 }}>
        {column.items.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--t3)' }}>Drop here</div>
        ) : (
          column.items.map((item) => (
            <DraggableCard key={item.id} card={item} onClick={() => onCardClick(item.id)} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Draggable card wrapper ─────────────────────────────────────────────────
function DraggableCard({ card, onClick }: { card: KanbanCard; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => { if (!isDragging) onClick(); e.stopPropagation(); }}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      <Card card={card} />
    </div>
  );
}

// ─── Card visual (used in both the column and the DragOverlay) ──────────────
function Card({ card, dragging }: { card: KanbanCard; dragging?: boolean }) {
  return (
    <div
      style={{
        background: 'var(--sf)',
        borderRadius: 8,
        border: card.is_stale ? '1px solid #f59e0b' : '1px solid var(--bd)',
        boxShadow: dragging ? '0 8px 24px rgba(0,0,0,0.16)' : 'none',
        padding: 10,
        fontSize: 12,
        color: 'var(--t1)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {card.candidate_name}
        </span>
        {card.ai_score != null && (
          <span
            style={{
              fontSize: 10, fontWeight: 700, color: '#fff',
              background: card.ai_fit_label ? FIT_COLOR[card.ai_fit_label] : '#6b7280',
              padding: '1px 6px', borderRadius: 999, flexShrink: 0,
            }}
          >
            {card.ai_score}
          </span>
        )}
      </div>
      <div style={{ color: 'var(--t3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
        {card.job_title}
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        {card.gate_status && card.gate_status !== 'unknown' && (
          <span
            title={`Gate: ${card.gate_status}`}
            style={{
              fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
              background: `${GATE_COLOR[card.gate_status]}20`,
              color: GATE_COLOR[card.gate_status],
              textTransform: 'uppercase',
            }}
          >
            {card.gate_status}
          </span>
        )}
        {card.is_stale && (
          <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700 }}>⚠ {card.days_in_stage}d</span>
        )}
        {!card.is_stale && (
          <span style={{ fontSize: 9, color: 'var(--t3)' }}>{card.days_in_stage}d</span>
        )}
        {card.recruiter_name && (
          <span style={{ fontSize: 9, color: 'var(--t3)' }}>· {card.recruiter_name}</span>
        )}
      </div>
    </div>
  );
}
