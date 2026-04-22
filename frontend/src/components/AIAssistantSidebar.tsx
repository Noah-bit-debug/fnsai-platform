import { useState, useEffect, useRef } from 'react';
import { useLocation, useParams, matchPath } from 'react-router-dom';
import api from '../lib/api';
import { renderMarkdown } from '../lib/markdown';

/**
 * Global AI assistant sidebar — mounts once in AppShell and appears on every
 * page. Detects the current route + any :id param, and passes that context
 * to the AI Brain so responses are entity-aware without the user having to
 * re-explain what they're looking at.
 *
 * Routes -> entity mapping:
 *   /candidates/:id     -> { entityType: 'candidate',  entityId: :id }
 *   /jobs/:id           -> { entityType: 'job',        entityId: :id }
 *   /submissions/:id    -> { entityType: 'submission', entityId: :id }
 *   /placements/:id     -> { entityType: 'placement',  entityId: :id }
 *   /clients-orgs/:id   -> { entityType: 'client',     entityId: :id }
 *   everything else     -> { page: location.pathname } only
 */

interface Message {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

const ROUTE_ENTITY_MAP: Array<{ pattern: string; entityType: string }> = [
  { pattern: '/candidates/:id',     entityType: 'candidate'  },
  { pattern: '/jobs/:id',           entityType: 'job'        },
  { pattern: '/submissions/:id',    entityType: 'submission' },
  { pattern: '/placements/:id',     entityType: 'placement'  },
  { pattern: '/clients-orgs/:id',   entityType: 'client'     },
];

// Page-specific suggested prompts. When the user opens the sidebar on
// candidate X, we show "What jobs is this candidate a good fit for?"
// instead of generic prompts.
const SUGGESTED_PROMPTS: Record<string, string[]> = {
  candidate: [
    'What jobs would this candidate be a good fit for?',
    'Are there any compliance gaps for this candidate?',
    'Draft a submission summary for this candidate.',
    'What\'s missing from this candidate\'s profile?',
  ],
  job: [
    'Which of our candidates match this job best?',
    'Draft a job description for this requisition.',
    'What\'s the typical fill time for jobs like this?',
    'Generate a boolean search string for this job.',
  ],
  submission: [
    'Summarize this submission for the client.',
    'What are the risks with this candidate for this role?',
    'Draft a follow-up email to the client about this submission.',
  ],
  placement: [
    'When does this placement end?',
    'What credentials expire during this placement?',
    'Draft an end-of-contract email.',
  ],
  client: [
    'Show me this client\'s open jobs.',
    'What roles has this client hired for historically?',
    'Draft an outreach email to this client.',
  ],
  dashboard: [
    'What\'s the most urgent thing I should work on today?',
    'Summarize our pipeline health.',
    'Which candidates are at risk of dropping off?',
  ],
  _default: [
    'What should I be working on right now?',
    'Are there any expiring credentials this week?',
    'Summarize the state of our pipeline.',
  ],
};

function detectEntityFromRoute(pathname: string): { entityType?: string; entityId?: string } {
  for (const { pattern, entityType } of ROUTE_ENTITY_MAP) {
    const match = matchPath(pattern, pathname);
    if (match?.params?.id) return { entityType, entityId: match.params.id };
  }
  return {};
}

export default function AIAssistantSidebar() {
  const location = useLocation();
  const params = useParams();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Detect current entity from URL
  const entity = detectEntityFromRoute(location.pathname);
  const suggestedPrompts = SUGGESTED_PROMPTS[entity.entityType ?? ''] ??
    (location.pathname === '/dashboard' ? SUGGESTED_PROMPTS.dashboard : SUGGESTED_PROMPTS._default);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Reset conversation when navigating to a different entity (keeps the
  // context from getting stale — if you're now looking at a different
  // candidate, the old chat about the previous candidate is confusing).
  useEffect(() => {
    setMessages([]);
  }, [entity.entityType, entity.entityId]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: Message = { role: 'user', content: trimmed, ts: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setSending(true);

    try {
      const res = await api.post<{ response: string }>('/ai-brain/chat', {
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        pageContext: {
          page: location.pathname,
          entityType: entity.entityType,
          entityId: entity.entityId,
        },
      });
      const assistantContent = res.data?.response ?? 'No response.';
      setMessages([...newMessages, { role: 'assistant', content: assistantContent, ts: Date.now() }]);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
      const errMsg = axiosErr?.response?.data?.error ?? axiosErr?.message ?? 'AI request failed';
      setMessages([...newMessages, { role: 'assistant', content: `⚠️ ${errMsg}`, ts: Date.now() }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          title="Ask the AI Brain (knows what you're looking at)"
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff',
            border: 'none',
            fontSize: 24,
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✦
        </button>
      )}

      {/* Sidebar panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 'min(420px, 100vw)',
            background: 'var(--sf)',
            borderLeft: '1px solid var(--bd)',
            boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 301,
          }}
        >
          {/* Header */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>✦ AI Brain</div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                {entity.entityType
                  ? `Viewing: ${entity.entityType} · ${(entity.entityId ?? '').slice(0, 8)}…`
                  : `Page: ${location.pathname}`}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: 'none',
                border: 'none',
                fontSize: 20,
                cursor: 'pointer',
                color: 'var(--t3)',
                padding: 4,
              }}
            >×</button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {messages.length === 0 && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10 }}>
                  I can see what you're looking at. Ask me anything about it — or try:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {suggestedPrompts.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => void send(p)}
                      style={{
                        textAlign: 'left',
                        padding: '8px 12px',
                        fontSize: 12.5,
                        background: 'var(--sf2)',
                        border: '1px solid var(--bd)',
                        borderRadius: 8,
                        color: 'var(--t2)',
                        cursor: 'pointer',
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'ai-bubble-user' : 'ai-bubble-assistant'}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '90%',
                  padding: m.role === 'user' ? '10px 14px' : '2px 14px',
                  borderRadius: 14,
                  background: m.role === 'user' ? 'var(--pr)' : 'var(--sf2)',
                  color: m.role === 'user' ? '#fff' : 'var(--t1)',
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  wordBreak: 'break-word',
                  ...(m.role === 'user' ? { whiteSpace: 'pre-wrap' } : {}),
                }}
                {...(m.role === 'assistant'
                  ? { dangerouslySetInnerHTML: { __html: renderMarkdown(m.content) } }
                  : { children: m.content })}
              />
            ))}
            {sending && (
              <div style={{ alignSelf: 'flex-start', padding: '10px 13px', borderRadius: 12, background: 'var(--sf2)', fontSize: 13, color: 'var(--t3)' }}>
                Thinking…
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); void send(input); }}
            style={{
              padding: 12,
              borderTop: '1px solid var(--bd)',
              display: 'flex',
              gap: 8,
              background: 'var(--sf)',
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                entity.entityType
                  ? `Ask about this ${entity.entityType}…`
                  : 'Ask the AI Brain…'
              }
              disabled={sending}
              style={{
                flex: 1,
                padding: '9px 12px',
                border: '1px solid var(--bd)',
                borderRadius: 8,
                fontSize: 13,
                outline: 'none',
                background: 'var(--sf2)',
              }}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              style={{
                padding: '9px 14px',
                background: sending || !input.trim() ? 'var(--sf3)' : 'var(--pr)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}

// Unused import dance — `useParams` kept in signature for future prop drilling.
void useParams;
