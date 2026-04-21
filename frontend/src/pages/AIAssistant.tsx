import { useState, useRef, useEffect } from 'react';
import { aiApi, ChatMessage } from '../lib/api';

const QUICK_PROMPTS = [
  'What credentials does a new RN need before first placement?',
  'Summarize today\'s compliance action items',
  'Draft an email to a facility about a staffing request',
  'What are the workers\' comp requirements for my state?',
  'How do I handle a credential expiring in 7 days?',
  'What should my onboarding checklist include for LPN staff?',
];

/**
 * HTML-escape every character in the raw input before applying our markdown
 * regexes. This is critical — the raw string may contain AI output that was
 * prompt-injected with <script> or <img onerror=...>. Without escaping,
 * dangerouslySetInnerHTML would execute it. After escaping, only the tags
 * emitted by our own regex replacements exist, so the output is safe.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMessage(content: string): string {
  return escapeHtml(content)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
}

export default function AIAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hello! I\'m FNS AI, your healthcare staffing operations assistant. I can help with credentialing, placements, compliance, document review, email drafting, and more. What do you need help with today?',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // When the backend has no ANTHROPIC_API_KEY it returns 503 {error:'ai_unavailable'}.
  // Surface that as a persistent banner + disabled input instead of a generic error reply.
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  async function sendMessage(content: string) {
    if (!content.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: content.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setIsLoading(true);

    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const resp = await aiApi.chat(updated);
      setMessages([...updated, { role: 'assistant', content: resp.data.response }]);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string; message?: string } } };
      if (e.response?.status === 503 && e.response.data?.error === 'ai_unavailable') {
        setUnavailable(e.response.data.message ?? 'AI Assistant is not configured.');
        // Roll back the optimistic user message so the chat doesn't stay stuck
        setMessages(messages);
      } else {
        setMessages([
          ...updated,
          {
            role: 'assistant',
            content:
              'Sorry, I encountered an error. Please check your connection and try again.',
          },
        ]);
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
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
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
        <div
          role="alert"
          style={{
            background: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            color: '#78350f',
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>⚠</span>
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>AI Assistant is not available right now.</div>
            <div>{unavailable}</div>
          </div>
        </div>
      )}

      <div className="pn chat-wrap">
        {/* Quick prompts */}
        <div className="quick-prompts">
          <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600, marginRight: 4 }}>Quick:</span>
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              className="quick-prompt-btn"
              type="button"
              onClick={() => void sendMessage(p)}
              disabled={isLoading || !!unavailable}
            >
              {p.length > 50 ? p.slice(0, 50) + '…' : p}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.role}`}>
              <div className={`chat-avatar ${msg.role === 'assistant' ? 'ai' : 'user-av'}`}>
                {msg.role === 'assistant' ? 'AI' : 'You'}
              </div>
              <div
                className="chat-bubble"
                dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
              />
            </div>
          ))}

          {isLoading && (
            <div className="chat-msg assistant">
              <div className="chat-avatar ai">AI</div>
              <div className="chat-bubble">
                <div className="typing-indicator">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="chat-input-bar">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={unavailable ? 'AI Assistant unavailable' : 'Ask anything about healthcare staffing, compliance, credentials… (Enter to send, Shift+Enter for new line)'}
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
            disabled={!input.trim() || isLoading || !!unavailable}
            style={{ height: 42 }}
          >
            {isLoading ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
