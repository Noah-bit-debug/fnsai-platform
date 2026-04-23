/**
 * Phase 6.6 — Shared tag renderer for AI output.
 *
 * Extracted from AIAssistant.tsx so the same tag grammar
 * ([[link:type:value]] and [[action:type|label]]) can be rendered
 * consistently by the main chat, suggestion panels on workflow
 * pages, dashboard widgets, etc. The extraction avoids copy-pasting
 * the ~150 lines of rendering logic.
 *
 * Tag grammar:
 *   [[link:candidate:<name>]]
 *   [[link:staff:<name>]]
 *   [[link:job:<title>]]
 *   [[link:facility:<name>]]
 *   [[link:policy:<title>]]
 *   [[action:create_task|<goal>]]
 *   [[action:send_esign|<recipient>]]
 *   [[action:draft_email|<prompt>]]
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiApi } from '../../lib/api';

export type EntityType = 'candidate' | 'staff' | 'job' | 'facility' | 'policy';
export type ActionType = 'create_task' | 'send_esign' | 'draft_email';
export type EntityMatch = { id: string; [k: string]: unknown };

const TAG_RE = /\[\[(link|action):([a-z_]+)(?::|\|)([^\]]+)\]\]/g;

type Tok =
  | { kind: 'text'; text: string }
  | { kind: 'link'; entity: EntityType; value: string }
  | { kind: 'action'; action: ActionType; label: string };

export function tokenize(content: string): Tok[] {
  const tokens: Tok[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content))) {
    if (m.index > lastIdx) tokens.push({ kind: 'text', text: content.slice(lastIdx, m.index) });
    const [, kind, type, rest] = m;
    if (kind === 'link') tokens.push({ kind: 'link', entity: type as EntityType, value: rest.trim() });
    else                 tokens.push({ kind: 'action', action: type as ActionType, label: rest.trim() });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < content.length) tokens.push({ kind: 'text', text: content.slice(lastIdx) });
  if (tokens.length === 0) tokens.push({ kind: 'text', text: content });
  return tokens;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatTextSegment(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
}

const ENTITY_COLORS: Record<EntityType, { bg: string; fg: string; icon: string }> = {
  candidate: { bg: '#eff6ff', fg: '#1565c0', icon: '👤' },
  staff:     { bg: '#f0fdf4', fg: '#2e7d32', icon: '🧑‍⚕️' },
  job:       { bg: '#fef3c7', fg: '#92400e', icon: '💼' },
  facility:  { bg: '#f5f3ff', fg: '#6d28d9', icon: '🏥' },
  policy:    { bg: '#fdf2f8', fg: '#9f1239', icon: '📜' },
};
const ACTION_COLORS: Record<ActionType, { bg: string; fg: string; icon: string }> = {
  create_task:  { bg: '#ede9fe', fg: '#6d28d9', icon: '✦' },
  send_esign:   { bg: '#fef3c7', fg: '#92400e', icon: '✍️' },
  draft_email:  { bg: '#eff6ff', fg: '#1565c0', icon: '📧' },
};

function hrefFor(entity: EntityType, match: EntityMatch): string {
  switch (entity) {
    case 'candidate': return `/candidates/${match.id}`;
    case 'staff':     return `/staff/${match.id}`;
    case 'job':       return `/jobs/${match.id}`;
    case 'facility':  return `/clients/${match.id}`;
    case 'policy':    return `/compliance/admin/policies/${match.id}/edit`;
  }
}

// ── Buttons ──────────────────────────────────────────────────────────────

export function EntityLinkButton({ entity, value, onDisambiguate }: {
  entity: EntityType; value: string;
  onDisambiguate: (entity: EntityType, value: string, matches: EntityMatch[]) => void;
}) {
  const navigate = useNavigate();
  const c = ENTITY_COLORS[entity];
  async function onClick() {
    try {
      const { data } = await aiApi.resolveEntity(entity, value);
      if (data.matches.length === 0) { alert(`No ${entity} found matching "${value}".`); return; }
      if (data.matches.length === 1) { navigate(hrefFor(entity, data.matches[0])); return; }
      onDisambiguate(entity, value, data.matches);
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Lookup failed.');
    }
  }
  return (
    <button onClick={onClick} title={`Go to ${entity}: ${value}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px',
        background: c.bg, color: c.fg, border: `1px solid ${c.fg}33`,
        borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        marginInline: 2, verticalAlign: 'baseline',
      }}>
      <span style={{ fontSize: 11 }}>{c.icon}</span>
      {value}
    </button>
  );
}

export function ActionTagButton({ action, label, onInvoke }: {
  action: ActionType; label: string;
  onInvoke: (action: ActionType, label: string) => void;
}) {
  const c = ACTION_COLORS[action];
  const verb: Record<ActionType, string> = { create_task: 'Create task', send_esign: 'Send eSign', draft_email: 'Draft email' };
  return (
    <button onClick={() => onInvoke(action, label)}
      title={`${verb[action]}: ${label}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
        background: c.bg, color: c.fg, border: `1px solid ${c.fg}33`,
        borderRadius: 14, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        marginInline: 2, verticalAlign: 'baseline',
      }}>
      <span>{c.icon}</span>
      {verb[action]}: {label}
    </button>
  );
}

// ── DisambiguationModal ──────────────────────────────────────────────────

export function DisambiguationModal({ entity, value, matches, onClose }: {
  entity: EntityType; value: string; matches: EntityMatch[]; onClose: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 480, maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Pick the right {entity}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{matches.length} matches for "{value}"</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {matches.map(m => (
            <button key={String(m.id)} onClick={() => { navigate(hrefFor(entity, m)); onClose(); }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', textAlign: 'left' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{describe(entity, m)}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{secondary(entity, m)}</div>
              </div>
              <span style={{ color: '#94a3b8', fontSize: 16 }}>→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
function describe(entity: EntityType, m: EntityMatch): string {
  if (entity === 'candidate' || entity === 'staff') return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || String(m.id);
  if (entity === 'job' || entity === 'policy') return String(m.title ?? m.id);
  if (entity === 'facility') return String(m.name ?? m.id);
  return String(m.id);
}
function secondary(entity: EntityType, m: EntityMatch): string {
  if (entity === 'candidate') return [m.email, m.role, m.stage].filter(Boolean).join(' · ');
  if (entity === 'staff')     return [m.email, m.role, m.status].filter(Boolean).join(' · ');
  if (entity === 'job')       return String(m.status ?? '');
  if (entity === 'facility')  return [m.city, m.state].filter(Boolean).join(', ');
  if (entity === 'policy')    return [m.version, m.status].filter(Boolean).join(' · ');
  return '';
}

// ── Renderer ─────────────────────────────────────────────────────────────

export function TaggedText({ content, onInvokeAction, onDisambiguate }: {
  content: string;
  onInvokeAction: (action: ActionType, label: string) => void;
  onDisambiguate: (entity: EntityType, value: string, matches: EntityMatch[]) => void;
}) {
  const tokens = tokenize(content);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === 'text') return <span key={i} dangerouslySetInnerHTML={{ __html: formatTextSegment(t.text) }} />;
        if (t.kind === 'link') return <EntityLinkButton key={i} entity={t.entity} value={t.value} onDisambiguate={onDisambiguate} />;
        return <ActionTagButton key={i} action={t.action} label={t.label} onInvoke={onInvokeAction} />;
      })}
    </>
  );
}

/** Reusable disambig-modal container. Drop next to <TaggedText> and
 *  its onDisambiguate callback sets the state this component reads. */
export function useDisambig() {
  const [state, setState] = useState<{ entity: EntityType; value: string; matches: EntityMatch[] } | null>(null);
  const onDisambiguate = (entity: EntityType, value: string, matches: EntityMatch[]) => setState({ entity, value, matches });
  const element = state
    ? <DisambiguationModal entity={state.entity} value={state.value} matches={state.matches} onClose={() => setState(null)} />
    : null;
  return { onDisambiguate, element };
}
