/**
 * Phase 5.3 — AI Assistant chat
 *
 * Four features added on top of the previous minimal chat page:
 *   a. Clickable entity links in AI responses — [[link:candidate:Name]],
 *      [[link:job:Title]], [[link:facility:Name]], [[link:policy:Title]],
 *      [[link:staff:Name]]. Clicking resolves via /ai/resolve-entity
 *      and navigates to the detail page. Multiple matches → picker.
 *   b. Action buttons in AI responses — [[action:create_task|Goal]]
 *      opens the Action Plan AI Wizard pre-filled. Other actions
 *      (send_esign, draft_email) navigate to the right page with
 *      context. Backend system prompt instructs the model when to
 *      emit these tags.
 *   c. Name disambiguation — when a link click has >1 match, a picker
 *      opens listing the candidates with last name / email so the user
 *      selects the right one before navigating.
 *   d. File uploads — paperclip button accepts PDF / DOCX / TXT /
 *      images. Server-side text extraction (or vision for images)
 *      sends context to Claude with the user's prompt.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { aiApi, ChatMessage } from '../lib/api';
import AITaskWizard from '../components/ActionPlan/AITaskWizard';
import { planTasksApi, PlanTaskGroup } from '../lib/api';

type EntityType = 'candidate' | 'staff' | 'job' | 'facility' | 'policy';
type ActionType = 'create_task' | 'send_esign' | 'draft_email';
type EntityMatch = { id: string; [k: string]: unknown };

const QUICK_PROMPTS = [
  'What credentials does a new RN need before first placement?',
  "Summarize today's compliance action items",
  'Draft an email to a facility about a staffing request',
  'How do I handle a credential expiring in 7 days?',
];

// ─── Message tokenization ─────────────────────────────────────────────────
// Splits a message into alternating plain-text segments and UI tags
// (links / actions). Matches this grammar:
//   [[link:<type>:<value>]]
//   [[action:<type>|<label>]]
const TAG_RE = /\[\[(link|action):([a-z_]+)(?::|\|)([^\]]+)\]\]/g;

type Tok =
  | { kind: 'text'; text: string }
  | { kind: 'link'; entity: EntityType; value: string }
  | { kind: 'action'; action: ActionType; label: string };

function tokenize(content: string): Tok[] {
  const tokens: Tok[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content))) {
    if (m.index > lastIdx) tokens.push({ kind: 'text', text: content.slice(lastIdx, m.index) });
    const [, kind, type, rest] = m;
    if (kind === 'link') {
      tokens.push({ kind: 'link', entity: type as EntityType, value: rest.trim() });
    } else {
      tokens.push({ kind: 'action', action: type as ActionType, label: rest.trim() });
    }
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

// ─── Entity-link button ───────────────────────────────────────────────────

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

function EntityLinkButton({ entity, value, onNavigate, onDisambiguate }: {
  entity: EntityType; value: string;
  onNavigate: (href: string) => void;
  onDisambiguate: (entity: EntityType, value: string, matches: EntityMatch[]) => void;
}) {
  const c = ENTITY_COLORS[entity];
  async function onClick(evt: React.MouseEvent) {
    // Phase 5.3 QA fix — QA reported clicking the pill did nothing.
    // Add diagnostic logging at every branch so whatever path the
    // handler takes is visible in DevTools Console. Also stop
    // propagation in case a parent handler was swallowing the event.
    evt.preventDefault();
    evt.stopPropagation();
    console.log('[ai-chat] entity pill clicked:', { entity, value });
    try {
      const resp = await aiApi.resolveEntity(entity, value);
      const matches = Array.isArray(resp?.data?.matches) ? resp.data.matches : [];
      console.log('[ai-chat] resolve-entity response:', { entity, value, matchCount: matches.length, matches });
      if (matches.length === 0) {
        alert(`No ${entity} found matching "${value}".`);
        return;
      }
      if (matches.length === 1) {
        const href = hrefFor(entity, matches[0]);
        console.log('[ai-chat] navigating to:', href);
        onNavigate(href);
        return;
      }
      console.log('[ai-chat] opening disambiguation picker');
      onDisambiguate(entity, value, matches);
    } catch (e: any) {
      console.error('[ai-chat] resolve-entity error:', e);
      alert(e?.response?.data?.error ?? e?.message ?? 'Lookup failed.');
    }
  }
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px',
        background: c.bg, color: c.fg, border: `1px solid ${c.fg}33`,
        borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        marginInline: 2, verticalAlign: 'baseline',
      }}
      title={`Go to ${entity}: ${value}`}
    >
      <span style={{ fontSize: 11 }}>{c.icon}</span>
      {value}
    </button>
  );
}

function ActionButton({ action, label, onInvoke }: {
  action: ActionType; label: string;
  onInvoke: (action: ActionType, label: string) => void;
}) {
  const c = ACTION_COLORS[action];
  const verbMap: Record<ActionType, string> = {
    create_task: 'Create task',
    send_esign: 'Send eSign',
    draft_email: 'Draft email',
  };
  return (
    <button
      onClick={() => onInvoke(action, label)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
        background: c.bg, color: c.fg, border: `1px solid ${c.fg}33`,
        borderRadius: 14, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        marginInline: 2, verticalAlign: 'baseline',
      }}
      title={`${verbMap[action]}: ${label}`}
    >
      <span>{c.icon}</span>
      {verbMap[action]}: {label}
    </button>
  );
}

function hrefFor(entity: EntityType, match: EntityMatch): string {
  switch (entity) {
    case 'candidate': return `/candidates/${match.id}`;
    case 'staff':     return `/staff/${match.id}`;
    case 'job':       return `/jobs/${match.id}`;
    case 'facility':  return `/clients/${match.id}`;
    case 'policy':    return `/compliance/admin/policies/${match.id}/edit`;
  }
}

// ─── Disambiguation picker modal ──────────────────────────────────────────

function DisambiguationModal({ entity, value, matches, onPick, onClose }: {
  entity: EntityType; value: string; matches: EntityMatch[];
  onPick: (m: EntityMatch) => void;
  onClose: () => void;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 480, maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Pick the right {entity}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{matches.length} matches for "{value}"</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {matches.map(m => (
            <button key={String(m.id)} onClick={() => onPick(m)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', textAlign: 'left' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{describeMatch(entity, m)}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{secondaryMatch(entity, m)}</div>
              </div>
              <span style={{ color: '#94a3b8', fontSize: 16 }}>→</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#475569' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function describeMatch(entity: EntityType, m: EntityMatch): string {
  if (entity === 'candidate' || entity === 'staff') {
    return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || String(m.id);
  }
  if (entity === 'job' || entity === 'policy') return String(m.title ?? m.id);
  if (entity === 'facility') return String(m.name ?? m.id);
  return String(m.id);
}
function secondaryMatch(entity: EntityType, m: EntityMatch): string {
  if (entity === 'candidate') return [m.email, m.role, m.stage].filter(Boolean).join(' · ');
  if (entity === 'staff')     return [m.email, m.role, m.status].filter(Boolean).join(' · ');
  if (entity === 'job')       return String(m.status ?? '');
  if (entity === 'facility')  return [m.city, m.state].filter(Boolean).join(', ');
  if (entity === 'policy')    return [m.version, m.status].filter(Boolean).join(' · ');
  return '';
}

// ─── Bubble renderer ──────────────────────────────────────────────────────

function MessageBubble({ content, onAction, onNavigate, onDisambiguate }: {
  content: string;
  onAction: (a: ActionType, label: string) => void;
  onNavigate: (href: string) => void;
  onDisambiguate: (e: EntityType, v: string, m: EntityMatch[]) => void;
}) {
  const tokens = tokenize(content);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === 'text') return <span key={i} dangerouslySetInnerHTML={{ __html: formatTextSegment(t.text) }} />;
        if (t.kind === 'link') return <EntityLinkButton key={i} entity={t.entity} value={t.value} onNavigate={onNavigate} onDisambiguate={onDisambiguate} />;
        return <ActionButton key={i} action={t.action} label={t.label} onInvoke={onAction} />;
      })}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export default function AIAssistant() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        "Hello! I'm FNS AI, your healthcare staffing operations assistant. I can help with credentialing, placements, compliance, document review, email drafting, and more. What do you need help with today?",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [disambig, setDisambig] = useState<{ entity: EntityType; value: string; matches: EntityMatch[] } | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardGoal, setWizardGoal] = useState('');
  const [groups, setGroups] = useState<PlanTaskGroup[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill prompt from ?prompt= (used by Draft Reply in Email Monitor)
  useEffect(() => {
    const q = searchParams.get('prompt');
    if (q) { setInput(q); }
  }, [searchParams]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Load groups once so the AI Task Wizard (invoked from an action button)
  // has them available.
  useEffect(() => {
    planTasksApi.listGroups().then(r => setGroups(r.data.groups)).catch(() => {});
  }, []);

  async function sendMessage(content: string) {
    if ((!content.trim() && !pendingFile) || isLoading) return;

    const finalContent = content.trim() || (pendingFile ? `Please review the attached ${pendingFile.type.startsWith('image/') ? 'image' : 'document'}: ${pendingFile.name}` : '');
    const userMsg: ChatMessage = { role: 'user', content: finalContent };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setIsLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      if (pendingFile) {
        const { data } = await aiApi.chatWithFile(updated, pendingFile);
        setMessages([...updated, { role: 'assistant', content: data.response }]);
        setPendingFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        const { data } = await aiApi.chat(updated);
        setMessages([...updated, { role: 'assistant', content: data.response }]);
      }
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string; message?: string } } };
      if (e.response?.status === 503 && e.response.data?.error === 'ai_unavailable') {
        setUnavailable(e.response.data.message ?? 'AI Assistant is not configured.');
        setMessages(messages);
      } else {
        const errMsg = e.response?.data?.error ?? 'Sorry, I encountered an error. Please check your connection and try again.';
        setMessages([...updated, { role: 'assistant', content: errMsg }]);
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  }

  function onAction(action: ActionType, label: string) {
    if (action === 'create_task') {
      setWizardGoal(label);
      setShowWizard(true);
    } else if (action === 'send_esign') {
      navigate(`/esign/documents/new?recipient_name=${encodeURIComponent(label)}`);
    } else if (action === 'draft_email') {
      setInput(label);
      textareaRef.current?.focus();
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>🤖 AI Assistant</h1>
            <p>Powered by Claude — your healthcare staffing operations expert</p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => setMessages([
              { role: 'assistant', content: 'Hello! New conversation started. How can I help you today?' },
            ])}
          >
            New Chat
          </button>
        </div>
      </div>

      {unavailable && (
        <div role="alert" style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 10, padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 10, color: '#78350f' }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>⚠</span>
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>AI Assistant is not available right now.</div>
            <div>{unavailable}</div>
          </div>
        </div>
      )}

      <div className="pn chat-wrap">
        <div className="quick-prompts">
          <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600, marginRight: 4 }}>Quick:</span>
          {QUICK_PROMPTS.map((p) => (
            <button key={p} className="quick-prompt-btn" type="button"
              onClick={() => void sendMessage(p)} disabled={isLoading || !!unavailable}>
              {p.length > 50 ? p.slice(0, 50) + '…' : p}
            </button>
          ))}
        </div>

        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.role}`}>
              <div className={`chat-avatar ${msg.role === 'assistant' ? 'ai' : 'user-av'}`}>
                {msg.role === 'assistant' ? 'AI' : 'You'}
              </div>
              <div className="chat-bubble">
                <MessageBubble
                  content={msg.content}
                  onAction={onAction}
                  onNavigate={(href) => navigate(href)}
                  onDisambiguate={(entity, value, matches) => setDisambig({ entity, value, matches })}
                />
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="chat-msg assistant">
              <div className="chat-avatar ai">AI</div>
              <div className="chat-bubble">
                <div className="typing-indicator">
                  <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Attached file preview strip */}
        {pendingFile && (
          <div style={{ padding: '6px 12px', background: '#f5f3ff', borderTop: '1px solid #ddd6fe', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ color: '#6d28d9', fontWeight: 600 }}>📎 {pendingFile.name}</span>
            <span style={{ color: '#94a3b8' }}>({Math.round(pendingFile.size / 1024)} KB)</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
              style={{ background: 'none', border: 'none', color: '#c62828', cursor: 'pointer', fontWeight: 700 }}>
              × Remove
            </button>
          </div>
        )}

        <div className="chat-input-bar">
          {/* File upload button */}
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt,image/*" style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > 20 * 1024 * 1024) { alert('File too large (max 20 MB).'); return; }
                setPendingFile(f);
              }
            }} />
          <button
            className="btn btn-ghost"
            type="button"
            title="Attach a file (PDF, DOCX, TXT, or image)"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || !!unavailable}
            style={{ height: 42, padding: '0 12px' }}
          >
            📎
          </button>
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={unavailable ? 'AI Assistant unavailable' : pendingFile ? `Ask about "${pendingFile.name}" or press Send…` : 'Ask anything about staffing, compliance, credentials… (Enter to send)'}
            value={input}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            disabled={isLoading || !!unavailable}
            rows={1}
          />
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void sendMessage(input)}
            disabled={(!input.trim() && !pendingFile) || isLoading || !!unavailable}
            style={{ height: 42 }}
          >
            {isLoading ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : 'Send'}
          </button>
        </div>
      </div>

      {disambig && (
        <DisambiguationModal
          entity={disambig.entity}
          value={disambig.value}
          matches={disambig.matches}
          onPick={(m) => { navigate(hrefFor(disambig.entity, m)); setDisambig(null); }}
          onClose={() => setDisambig(null)}
        />
      )}

      {showWizard && (
        <AITaskWizard
          groups={groups}
          initialGoal={wizardGoal || undefined}
          onCreated={() => {
            // Nudge the chat with a confirmation message
            setMessages(prev => [...prev, { role: 'assistant', content: '✓ Task created. It\'s now on your Action Plan.' }]);
          }}
          onClose={() => { setShowWizard(false); setWizardGoal(''); }}
        />
      )}
    </div>
  );
}
