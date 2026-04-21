import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useRBAC } from '../contexts/RBACContext';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Section =
  | 'chat'
  | 'knowledge'
  | 'email'
  | 'attachments'
  | 'onedrive'
  | 'upload'
  | 'clarifications'
  | 'actions'
  | 'activity';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: Date;
  context_used?: boolean;
  sources?: string[];
}

interface Clarification {
  id: string;
  question: string;
  context?: string;
  source_type: string;
  status: 'pending' | 'answered' | 'dismissed';
  answer?: string;
  approved_as_rule?: boolean;
  created_at: string;
  answered_at?: string;
}

interface AuditLog {
  id: string;
  user_clerk_id: string;
  action_type: string;
  source: string;
  details: Record<string, any>;
  created_at: string;
}

interface EmailResult {
  id: string;
  subject: string;
  from: any;
  receivedDateTime: string;
  bodyPreview: string;
  hasAttachments?: boolean;
  isRead?: boolean;
}

interface OdItem {
  id: string;
  name: string;
  size?: number;
  webUrl: string;
  lastModifiedDateTime: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
}

interface UploadRecord {
  id: string;
  original_filename: string;
  destination_path: string;
  routing_confidence: string;
  routing_reason: string;
  status: string;
  created_at: string;
  onedrive_web_url?: string;
}

interface BrainStats {
  clarifications: { pending: number; answered: number };
  uploads: { total: number };
  audit: { total: number; today: number };
  knowledge: { items: number; sources: number };
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const PROMPTS = [
  'What documents does a new RN need before placement?',
  'Show me staff with credentials expiring in the next 30 days',
  'What does Harris Health require for onboarding?',
  'Which candidates are missing credentialing items?',
  'What is our BLS renewal reminder process?',
  "What belongs in the Joint Commission folder?",
  "Summarize today's operational priorities",
  'What compliance items are overdue this week?',
];

const KNOWN_FOLDERS = [
  'Joint Commission', 'Candidate Credentials', 'Onboarding Documents',
  'Compliance Files', 'Credentialing', 'BLS & Certifications',
  'Policies & Procedures', 'HR Documents', 'Facility Contracts',
  'Training Materials', 'Incident Reports',
];

const SOURCES = [
  { key: 'staff_db',     icon: '👥', label: 'Staff & Credentials',  desc: 'Live staff records, licenses, placements',   type: 'live',      color: '#16a34a' },
  { key: 'candidates',   icon: '🎯', label: 'Candidates',           desc: 'Candidate profiles and pipeline',            type: 'live',      color: '#16a34a' },
  { key: 'compliance',   icon: '✅', label: 'Compliance Records',   desc: 'Competency, exams, policies',                type: 'live',      color: '#16a34a' },
  { key: 'placements',   icon: '📍', label: 'Placements',           desc: 'Active and historical placements',           type: 'live',      color: '#16a34a' },
  { key: 'knowledge',    icon: '📚', label: 'Knowledge Base',       desc: 'Indexed company knowledge items',            type: 'live',      color: '#16a34a' },
  { key: 'email',        icon: '📧', label: 'Outlook Emails',       desc: 'Email search and intelligence',              type: 'microsoft', color: '#2563eb' },
  { key: 'onedrive',     icon: '📁', label: 'OneDrive Files',       desc: 'Company documents and credentials',          type: 'microsoft', color: '#2563eb' },
  { key: 'teams',        icon: '💬', label: 'Teams Messages',       desc: 'Internal team communications',               type: 'microsoft', color: '#2563eb' },
  { key: 'sharepoint',   icon: '🗂️', label: 'SharePoint',           desc: 'Shared document libraries',                 type: 'microsoft', color: '#2563eb' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtBytes(b?: number): string {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function emailFrom(from: any): string {
  if (!from) return 'Unknown';
  if (typeof from === 'string') return from;
  const ea = from?.emailAddress;
  if (ea?.name) return `${ea.name}`;
  return ea?.address ?? 'Unknown';
}

// HTML-escape raw text before running markdown substitutions. Without this,
// dangerouslySetInnerHTML would execute any <script> / <img onerror=...>
// that came back from the AI (including prompt-injected replies based on
// untrusted email content or resume text).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function md(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:12px">$1</code>')
    .replace(/^### (.+)$/gm, '<h4 style="margin:12px 0 4px;font-size:13px;font-weight:700;color:#1e293b">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="margin:14px 0 6px;font-size:14px;font-weight:700;color:#1e293b">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="margin:16px 0 8px;font-size:16px;font-weight:700;color:#1e293b">$1</h2>')
    .replace(/^[•\-] (.+)$/gm, '<li style="margin:3px 0;padding-left:4px">$1</li>')
    .replace(/(<li[^>]*>[\s\S]*?<\/li>(\n)?)+/g, m => `<ul style="margin:6px 0;padding-left:20px">${m}</ul>`)
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

function confBadge(c: string): React.CSSProperties {
  if (c === 'high') return { background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' };
  if (c === 'medium') return { background: '#fefce8', color: '#ca8a04', border: '1px solid #fde68a' };
  return { background: '#fff7ed', color: '#ea580c', border: '1px solid #fed7aa' };
}

// ─── Design tokens ──────────────────────────────────────────────────────────────

const C = {
  nav:     '#0f172a',
  navHov:  'rgba(255,255,255,0.08)',
  navAct:  '#1e40af',
  navText: 'rgba(255,255,255,0.7)',
  navActT: '#fff',
  bg:      '#f0f4f8',
  card:    '#ffffff',
  border:  '#e2e8f0',
  blue:    '#2563eb',
  green:   '#16a34a',
  amber:   '#d97706',
  red:     '#dc2626',
  text:    '#0f172a',
  muted:   '#64748b',
  faint:   '#94a3b8',
};

const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 20,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

const inp: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  background: '#fff',
  color: C.text,
};

const btnP: React.CSSProperties = {
  background: C.blue,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
};

const btnS: React.CSSProperties = {
  background: '#f1f5f9',
  color: C.muted,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
};

// ─── Section: CHAT ─────────────────────────────────────────────────────────────

function ChatSection({ onContextChange, pendingPrompt, onPromptSent }: {
  onContextChange: (ctx: any) => void;
  pendingPrompt?: string | null;
  onPromptSent?: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([{
    id: '0', role: 'assistant', ts: new Date(), context_used: true,
    content: `**Good to see you.** I'm the FNS AI Brain — connected to your live company data.\n\nI can help you:\n- **Find information** about staff, candidates, compliance, and placements\n- **Search emails** and locate attachments\n- **Answer operational questions** about Frontline workflows\n- **Suggest next steps** based on current company state\n\nWhat would you like to know?`,
  }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // Fire when a prompt is triggered from outside (e.g., context panel)
  useEffect(() => {
    if (pendingPrompt && !busy) {
      send(pendingPrompt);
      onPromptSent?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    const uMsg: ChatMsg = { id: Date.now().toString(), role: 'user', content: q, ts: new Date() };
    const thinkMsg: ChatMsg = { id: 'thinking', role: 'assistant', content: '…', ts: new Date() };
    setMsgs(p => [...p, uMsg, thinkMsg]);
    setBusy(true);
    try {
      const history = [...msgs.filter(m => m.id !== '0' && m.id !== 'thinking'), uMsg]
        .map(m => ({ role: m.role, content: m.content }));
      const res = await api.post('/ai-brain/chat', { messages: history });
      const aiMsg: ChatMsg = {
        id: Date.now() + '_a', role: 'assistant', ts: new Date(),
        content: res.data.response,
        context_used: res.data.context_used,
      };
      setMsgs(p => p.filter(m => m.id !== 'thinking').concat(aiMsg));
      onContextChange({ type: 'chat_response', response: res.data.response });
    } catch {
      setMsgs(p => p.filter(m => m.id !== 'thinking').concat({
        id: Date.now() + '_err', role: 'assistant', ts: new Date(),
        content: '⚠️ Unable to reach AI Brain. Check your connection and try again.',
      }));
    }
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, paddingRight: 4 }}>
        {msgs.map(m => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 4 }}>
            {m.role === 'user' ? (
              <div style={{ background: C.blue, color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '11px 16px', maxWidth: '78%', fontSize: 14, lineHeight: 1.5 }}>
                {m.content}
              </div>
            ) : (
              <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: '16px 16px 16px 4px', padding: '14px 18px', maxWidth: '88%', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                {m.id === 'thinking' ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', color: C.faint }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: C.faint, animation: `pulse 1.2s ${i*0.2}s infinite` }} />
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 14, lineHeight: 1.65, color: C.text }} dangerouslySetInnerHTML={{ __html: md(m.content) }} />
                )}
                {m.context_used && m.id !== '0' && (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>✓ Used live company data</span>
                  </div>
                )}
              </div>
            )}
            <div style={{ fontSize: 10, color: C.faint }}>
              {m.ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Suggested prompts */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {PROMPTS.slice(0, 4).map(p => (
          <button key={p} onClick={() => send(p)} style={{
            background: '#eff6ff', color: C.blue, border: `1px solid #bfdbfe`,
            borderRadius: 20, padding: '6px 13px', fontSize: 12, cursor: 'pointer',
            fontWeight: 500, whiteSpace: 'nowrap',
          }}>
            {p}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ ...card, padding: 14 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask anything about Frontline operations, staff, compliance, emails, or files…"
            rows={2}
            disabled={busy}
            style={{ ...inp, flex: 1, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
          <button onClick={() => send()} disabled={busy || !input.trim()} style={{ ...btnP, alignSelf: 'flex-end', paddingLeft: 22, paddingRight: 22, opacity: busy || !input.trim() ? 0.5 : 1 }}>
            {busy ? '…' : '→ Ask'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>
          Enter to send · Shift+Enter for new line · AI has live access to staff, compliance, and placement data
        </div>
      </div>
    </div>
  );
}

// ─── Section: KNOWLEDGE SOURCES ────────────────────────────────────────────────

function KnowledgeSection() {
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [log, setLog] = useState<any[]>([]);

  useEffect(() => {
    api.get('/ai-brain/stats').then(r => setStats(r.data)).catch(() => {});
    api.get('/ai-brain/refresh-log').then(r => setLog(r.data.logs ?? [])).catch(() => {});
  }, []);

  async function doRefresh(key: string, label: string) {
    setRefreshing(key);
    try {
      await api.post('/ai-brain/refresh', { source_type: key, source_label: label });
      setTimeout(() => {
        api.get('/ai-brain/refresh-log').then(r => setLog(r.data.logs ?? [])).catch(() => {});
        setRefreshing(null);
      }, 3500);
    } catch { setRefreshing(null); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats row */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {[
            { label: 'Knowledge Items', value: stats.knowledge.items, icon: '📚', color: C.blue },
            { label: 'Connected Sources', value: stats.knowledge.sources, icon: '🔌', color: '#7c3aed' },
            { label: 'AI Actions Today', value: stats.audit.today, icon: '⚡', color: C.amber },
            { label: 'Files Uploaded', value: stats.uploads.total, icon: '☁️', color: C.green },
            { label: 'Open Questions', value: stats.clarifications.pending, icon: '❓', color: stats.clarifications.pending > 0 ? C.red : C.muted },
          ].map(s => (
            <div key={s.label} style={{ ...card, textAlign: 'center', padding: '16px 12px' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value ?? '—'}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Source cards */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Connected Knowledge Sources</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {SOURCES.map(s => (
            <div key={s.key} style={{ ...card, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 26, flexShrink: 0, marginTop: 2 }}>{s.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{s.label}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{s.desc}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: s.type === 'live' ? '#f0fdf4' : '#eff6ff',
                    color: s.type === 'live' ? C.green : C.blue,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.type === 'live' ? C.green : C.blue, display: 'inline-block' }} />
                    {s.type === 'live' ? 'Live' : 'Microsoft 365'}
                  </span>
                  {s.type === 'microsoft' && (
                    <button
                      onClick={() => doRefresh(s.key, s.label)}
                      disabled={refreshing === s.key}
                      style={{ ...btnS, padding: '4px 10px', fontSize: 11 }}
                    >
                      {refreshing === s.key ? '⏳ Refreshing…' : '🔄 Refresh'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Refresh log */}
      {log.length > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 14 }}>Recent Refresh Activity</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {log.slice(0, 6).map((l: any) => (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: '#f8fafc', borderRadius: 8 }}>
                <div style={{ fontSize: 13, color: C.text }}>
                  <span style={{ fontWeight: 500 }}>{l.source_label ?? l.source_type}</span>
                  <span style={{ color: C.muted, marginLeft: 8, fontSize: 12 }}>refreshed</span>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: l.status === 'completed' ? '#f0fdf4' : l.status === 'running' ? '#eff6ff' : '#fef2f2',
                    color: l.status === 'completed' ? C.green : l.status === 'running' ? C.blue : C.red,
                  }}>{l.status}</span>
                  <span style={{ fontSize: 12, color: C.faint }}>{fmtDateTime(l.started_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Helpful guide */}
      <div style={{ ...card, background: '#eff6ff', borderColor: '#bfdbfe' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: C.blue, marginBottom: 8 }}>💡 How the AI Brain learns</div>
        <div style={{ fontSize: 13, color: '#1e40af', lineHeight: 1.7 }}>
          <strong>Live sources</strong> (staff, candidates, compliance, placements) update automatically — the AI always has current data.<br />
          <strong>Microsoft 365 sources</strong> (Outlook, OneDrive, Teams) need periodic refresh. Click <em>Refresh</em> on any source to reload the latest data into AI knowledge.
        </div>
      </div>
    </div>
  );
}

// ─── Section: EMAIL INTELLIGENCE ───────────────────────────────────────────────

function EmailSection({ onSelect }: { onSelect: (email: EmailResult | null) => void }) {
  const [sender, setSender] = useState('');
  const [keyword, setKeyword] = useState('');
  const [subject, setSubject] = useState('');
  const [from_, setFrom_] = useState('');
  const [to_, setTo_] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hasAttach, setHasAttach] = useState(false);
  const [results, setResults] = useState<EmailResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<EmailResult | null>(null);

  async function search(overrides?: { keyword?: string; hasAttach?: boolean }) {
    const kw = overrides?.keyword !== undefined ? overrides.keyword : keyword;
    const ha = overrides?.hasAttach !== undefined ? overrides.hasAttach : hasAttach;
    if (!sender && !kw && !subject && !ha && !dateFrom) {
      setError('Enter at least one search filter to get started.');
      return;
    }
    setLoading(true); setError(''); setSummary(''); setSelected(null); onSelect(null);
    try {
      const r = await api.post('/ai-email/search', {
        sender: sender || undefined, keyword: kw || undefined,
        subject: subject || undefined, date_from: dateFrom || undefined,
        date_to: dateTo || undefined, has_attachments: ha || undefined, top: 30,
      });
      setResults(r.data.emails ?? []);
      if (r.data.error) setError(r.data.error);
    } catch { setError('Email search failed — make sure Microsoft Graph is configured.'); }
    setLoading(false);
  }

  async function summarize() {
    if (!results.length) return;
    setSummarizing(true);
    try {
      const r = await api.post('/ai-email/summarize', {
        emails: results,
        question: keyword ? `Summarize emails related to: ${keyword}` : undefined,
      });
      setSummary(r.data.summary ?? '');
    } catch { setSummary('Summarization failed.'); }
    setSummarizing(false);
  }

  function selectEmail(e: EmailResult) {
    setSelected(e);
    onSelect(e);
  }

  const QUICK = [
    { label: '📎 Has attachments', action: () => { setHasAttach(true); search({ hasAttach: true }); } },
    { label: '🏅 BLS / credentials', action: () => { setKeyword('BLS credentials'); search({ keyword: 'BLS credentials' }); } },
    { label: '🏥 Joint Commission', action: () => { setKeyword('Joint Commission'); search({ keyword: 'Joint Commission' }); } },
    { label: '🏢 Harris Health', action: () => { setKeyword('Harris Health'); search({ keyword: 'Harris Health' }); } },
    { label: '📋 Onboarding', action: () => { setKeyword('onboarding'); search({ keyword: 'onboarding' }); } },
    { label: '🔖 Compliance', action: () => { setKeyword('compliance'); search({ keyword: 'compliance' }); } },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, height: '100%' }}>
      {/* Filter panel */}
      <div style={{ ...card, alignSelf: 'start' }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 16 }}>Search Filters</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'From (email address)', val: sender, set: setSender, ph: 'name@example.com' },
            { label: 'Keyword (any field)', val: keyword, set: setKeyword, ph: 'BLS, onboarding, credentials…' },
            { label: 'Subject contains', val: subject, set: setSubject, ph: 'Placement request…' },
          ].map(f => (
            <div key={f.label}>
              <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>{f.label}</label>
              <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph} style={inp} />
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>From date</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>To date</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={hasAttach} onChange={e => setHasAttach(e.target.checked)} />
            <span>Has attachments only</span>
          </label>
          <button onClick={() => search()} disabled={loading} style={{ ...btnP, width: '100%', textAlign: 'center', opacity: loading ? 0.7 : 1 }}>
            {loading ? '🔍 Searching…' : '🔍 Search Emails'}
          </button>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: C.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Quick Searches</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {QUICK.map(q => (
                <button key={q.label} onClick={q.action} style={{
                  background: 'none', border: 'none', textAlign: 'left', fontSize: 13,
                  color: C.blue, cursor: 'pointer', padding: '3px 0', fontFamily: 'inherit',
                }}>{q.label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {error && (
          <div style={{ background: '#fff7ed', border: `1px solid #fed7aa`, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#92400e' }}>
            ⚠️ {error}
          </div>
        )}

        {results.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>
                {results.length} email{results.length !== 1 ? 's' : ''} found
              </div>
              <button onClick={summarize} disabled={summarizing} style={{ ...btnP, background: '#7c3aed', fontSize: 12, padding: '7px 14px' }}>
                {summarizing ? '⏳ Summarizing…' : '✨ AI Summarize'}
              </button>
            </div>

            {summary && (
              <div style={{ ...card, background: '#f5f3ff', borderColor: '#e9d5ff' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>AI Summary</div>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: md(summary) }} />
              </div>
            )}

            <div style={card}>
              {results.map((email, i) => (
                <div
                  key={email.id}
                  onClick={() => selectEmail(email)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    borderBottom: i < results.length - 1 ? `1px solid ${C.border}` : 'none',
                    background: selected?.id === email.id ? '#eff6ff' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {!email.isRead && <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.blue, flexShrink: 0 }} />}
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {email.subject || '(No subject)'}
                        </span>
                        {email.hasAttachments && <span style={{ fontSize: 12, flexShrink: 0 }}>📎</span>}
                      </div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{emailFrom(email.from)}</div>
                      <div style={{ fontSize: 12, color: C.faint, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {email.bodyPreview}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: C.faint, flexShrink: 0, whiteSpace: 'nowrap', marginTop: 2 }}>
                      {fmtDateTime(email.receivedDateTime)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && !error && results.length === 0 && (
          <div style={{ ...card, textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: C.text, marginBottom: 6 }}>Search your company emails</div>
            <div style={{ fontSize: 13, color: C.muted }}>
              Use the filters on the left to find emails by sender, keyword, date range, or attachment presence.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section: ATTACHMENT FINDER ────────────────────────────────────────────────

function AttachmentSection() {
  const [keyword, setKeyword] = useState('');
  const [hasAttach] = useState(true);
  const [results, setResults] = useState<EmailResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function search(kwOverride?: string) {
    const kw = kwOverride !== undefined ? kwOverride : keyword;
    setLoading(true); setError('');
    try {
      const r = await api.post('/ai-email/search', { keyword: kw || undefined, has_attachments: true, top: 40 });
      setResults(r.data.emails ?? []);
      if (r.data.error) setError(r.data.error);
    } catch { setError('Could not load attachments — Microsoft Graph may not be configured.'); }
    setLoading(false);
  }

  useEffect(() => { search(); }, []); // auto-load on enter

  function getFileTypeIcon(name: string): string {
    const ext = name?.split('.').pop()?.toLowerCase() ?? '';
    if (['jpg','jpeg','png','gif','webp'].includes(ext)) return '🖼️';
    if (ext === 'pdf') return '📑';
    if (['doc','docx'].includes(ext)) return '📝';
    if (['xls','xlsx'].includes(ext)) return '📊';
    if (['zip','rar'].includes(ext)) return '🗜️';
    return '📎';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Search attachments by keyword, sender, or candidate name…"
            style={inp}
          />
        </div>
        <button onClick={() => search()} disabled={loading} style={{ ...btnP, opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Searching…' : '🔍 Find Attachments'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fff7ed', border: `1px solid #fed7aa`, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#92400e' }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['BLS card', 'License', 'TB test', 'Background check', 'I-9', 'Resume', 'Onboarding form'].map(t => (
          <button key={t} onClick={() => { setKeyword(t); search(t); }} style={{
            background: keyword === t ? '#eff6ff' : '#f1f5f9',
            color: keyword === t ? C.blue : C.muted,
            border: `1px solid ${keyword === t ? '#bfdbfe' : C.border}`,
            borderRadius: 20, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
            fontWeight: keyword === t ? 600 : 400,
          }}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={card}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ padding: '12px 0', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: '#f1f5f9' }} />
              <div style={{ flex: 1 }}>
                <div style={{ height: 13, width: '60%', background: '#f1f5f9', borderRadius: 4, marginBottom: 6 }} />
                <div style={{ height: 11, width: '40%', background: '#f1f5f9', borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      ) : results.length > 0 ? (
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 14 }}>
            {results.length} email{results.length !== 1 ? 's' : ''} with attachments
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {results.map((email, i) => (
              <div key={email.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 10px', borderRadius: 8, background: i % 2 === 0 ? '#fafafa' : '#fff' }}>
                <div style={{ fontSize: 28, flexShrink: 0 }}>📎</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {email.subject || '(No subject)'}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>From: {emailFrom(email.from)}</div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{fmtDateTime(email.receivedDateTime)}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <span style={{ padding: '3px 8px', background: '#f0fdf4', color: C.green, borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                    📎 Has attachment
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : !loading && !error ? (
        <div style={{ ...card, textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📎</div>
          <div style={{ fontWeight: 600, fontSize: 15, color: C.text, marginBottom: 6 }}>No attachments found</div>
          <div style={{ fontSize: 13, color: C.muted }}>Try searching by a different keyword, or check that Outlook is connected.</div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Section: ONEDRIVE ─────────────────────────────────────────────────────────

function OneDriveSection({ onSelect }: { onSelect: (f: OdItem | null) => void }) {
  const [path, setPath] = useState('/');
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [files, setFiles] = useState<OdItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadFolders(); }, []);

  async function loadFolders() {
    setLoading(true);
    try {
      const r = await api.get(`/ai-onedrive/folders?path=${encodeURIComponent(path)}`);
      setFolders(r.data.folders ?? []);
      setOffline(!!r.data.offline);
    } catch { setError('Could not load OneDrive folders.'); }
    setLoading(false);
  }

  async function browse(folderPath: string, folderName: string) {
    setLoading(true); setError('');
    setBreadcrumb(p => [...p, folderName]);
    setPath(folderPath);
    try {
      const r = await api.get(`/ai-onedrive/browse?path=${encodeURIComponent(folderPath)}`);
      setFiles(r.data.files ?? []);
      if (r.data.error) setError(r.data.error);
    } catch { setError('Could not browse folder.'); }
    setLoading(false);
  }

  async function doSearch() {
    if (!search.trim()) return;
    setLoading(true); setError('');
    try {
      const r = await api.get(`/ai-onedrive/search?q=${encodeURIComponent(search)}`);
      setFiles(r.data.files ?? []);
      if (r.data.error) setError(r.data.error);
    } catch { setError('Search failed.'); }
    setLoading(false);
  }

  function goBack() {
    setBreadcrumb(p => p.slice(0, -1));
    setPath('/');
    setFiles([]);
    loadFolders();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {offline && (
        <div style={{ background: '#fff7ed', border: `1px solid #fed7aa`, borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#92400e' }}>
          ℹ️ OneDrive is not connected — showing known folder structure. Configure Microsoft Graph credentials to enable live browsing.
        </div>
      )}

      {/* Search bar */}
      <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Search files across OneDrive…" style={inp} />
        </div>
        <button onClick={doSearch} style={{ ...btnP, padding: '9px 16px' }}>Search</button>
        {breadcrumb.length > 0 && (
          <button onClick={goBack} style={{ ...btnS }}>← Back</button>
        )}
      </div>

      {/* Breadcrumb */}
      {breadcrumb.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: C.muted }}>
          <span style={{ cursor: 'pointer', color: C.blue }} onClick={goBack}>OneDrive</span>
          {breadcrumb.map((b, i) => (
            <React.Fragment key={i}>
              <span>/</span>
              <span style={{ color: i === breadcrumb.length - 1 ? C.text : C.blue, fontWeight: i === breadcrumb.length - 1 ? 600 : 400 }}>{b}</span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Folder grid */}
      {files.length === 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {breadcrumb.length === 0 ? 'Company Folders' : 'Folders'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {(breadcrumb.length === 0 ? KNOWN_FOLDERS : folders.filter((f: any) => f.folder)).map((f: any) => {
              const name = typeof f === 'string' ? f : f.name;
              const folderPath = typeof f === 'string' ? `/${f}` : (f.path ?? `/${f.name}`);
              const count = f.item_count ?? f.folder?.childCount;
              return (
                <div
                  key={name}
                  onClick={() => browse(folderPath, name)}
                  style={{
                    ...card, cursor: 'pointer', padding: '16px 18px',
                    borderLeft: `3px solid ${C.blue}`, transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📁</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{name}</div>
                  {count != null && <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>{count} items</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 14 }}>
            {files.length} items in {breadcrumb[breadcrumb.length - 1] ?? 'folder'}
          </div>
          {files.map(file => (
            <div
              key={file.id}
              onClick={() => onSelect(file)}
              style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.1s' }}
            >
              <span style={{ fontSize: 20 }}>{file.folder ? '📁' : '📄'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{fmtBytes(file.size)} · {fmtDate(file.lastModifiedDateTime)}</div>
              </div>
              {file.webUrl && (
                <a href={file.webUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: C.blue, textDecoration: 'none', flexShrink: 0 }}>
                  Open ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section: UPLOAD ───────────────────────────────────────────────────────────

function UploadSection() {
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState('');
  const [context, setContext] = useState('');
  const [suggest, setSuggest] = useState<any>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [step, setStep] = useState<1|2|3>(1); // 1=select, 2=confirm, 3=done

  useEffect(() => {
    api.get('/ai-onedrive/uploads').then(r => setUploads(r.data.uploads ?? [])).catch(() => {});
  }, []);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setSuggest(null); setResult(null); setStep(2);
    setSuggesting(true);
    try {
      const r = await api.post('/ai-brain/smart-route', { filename: f.name, context_hint: context || undefined });
      setSuggest(r.data);
      if (!folder) setFolder(r.data.folder ?? '');
    } catch {}
    setSuggesting(false);
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (folder) fd.append('destination_folder', folder);
      if (context) fd.append('context_hint', context);
      const r = await api.post('/ai-onedrive/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(r.data);
      setStep(3);
      const ul = await api.get('/ai-onedrive/uploads');
      setUploads(ul.data.uploads ?? []);
    } catch {
      setResult({ success: false, error: 'Upload failed — check OneDrive connection.' });
      setStep(3);
    }
    setUploading(false);
  }

  function reset() { setFile(null); setFolder(''); setContext(''); setSuggest(null); setResult(null); setStep(1); }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
      {/* Upload panel */}
      <div>
        {/* Step indicators */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
          {[{ n: 1, label: 'Select File' }, { n: 2, label: 'Choose Destination' }, { n: 3, label: 'Confirm' }].map((s, i) => (
            <React.Fragment key={s.n}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                  background: step >= s.n ? C.blue : '#e2e8f0',
                  color: step >= s.n ? '#fff' : C.faint,
                }}>{step > s.n ? '✓' : s.n}</div>
                <span style={{ fontSize: 13, color: step >= s.n ? C.text : C.faint, fontWeight: step === s.n ? 600 : 400 }}>{s.label}</span>
              </div>
              {i < 2 && <div style={{ flex: 1, height: 2, background: step > s.n ? C.blue : '#e2e8f0', margin: '0 12px', alignSelf: 'center' }} />}
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6 }}>Select a file to upload</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
              The AI will automatically detect the correct OneDrive folder based on the file name.
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Optional: add context to help routing</label>
              <input value={context} onChange={e => setContext(e.target.value)}
                placeholder="e.g. Jane Smith BLS card, Joint Commission policy document…" style={inp} />
            </div>
            <label style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              border: `2px dashed ${C.border}`, borderRadius: 12, padding: '40px 20px',
              cursor: 'pointer', background: '#f8fafc', transition: 'all 0.15s',
            }}>
              <input type="file" onChange={onFileChange} style={{ display: 'none' }} />
              <div style={{ fontSize: 40, marginBottom: 12 }}>☁️</div>
              <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>Click to select a file</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Any file type · up to 50MB</div>
            </label>
          </div>
        )}

        {step === 2 && file && (
          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 4 }}>Confirm destination</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>Review where your file will be saved in OneDrive.</div>

            {/* File info */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '14px 16px', background: '#f8fafc', borderRadius: 10, marginBottom: 20 }}>
              <div style={{ fontSize: 32 }}>📄</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{file.name}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{fmtBytes(file.size)}</div>
              </div>
            </div>

            {/* AI suggestion */}
            {suggesting && (
              <div style={{ padding: '14px 16px', background: '#eff6ff', borderRadius: 10, marginBottom: 16, fontSize: 13, color: C.blue }}>
                ⏳ AI is analyzing file name and suggesting the best folder…
              </div>
            )}

            {suggest && !suggesting && (
              <div style={{ padding: '16px', background: '#f0fdf4', border: `1px solid #bbf7d0`, borderRadius: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 6 }}>🤖 AI Suggested Destination</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>📁 {suggest.folder}</div>
                <div style={{ fontSize: 12, color: '#15803d', marginTop: 4, lineHeight: 1.5 }}>{suggest.reason}</div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...confBadge(suggest.confidence), padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                    {suggest.confidence === 'high' ? '✓ High confidence' : suggest.confidence === 'medium' ? '~ Medium confidence' : '! Low confidence — please review'}
                  </span>
                </div>
                {suggest.confidence === 'low' && (
                  <div style={{ marginTop: 10, padding: '10px 12px', background: '#fff7ed', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
                    ⚠️ The AI is not confident about this routing. Please select the correct folder below before uploading.
                  </div>
                )}
              </div>
            )}

            {/* Folder selector */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 6 }}>Destination folder (change if needed)</label>
              <select value={folder} onChange={e => setFolder(e.target.value)} style={{ ...inp, background: '#fff' }}>
                <option value="">— Let AI decide —</option>
                {KNOWN_FOLDERS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={upload} disabled={uploading} style={{ ...btnP, flex: 1, textAlign: 'center', opacity: uploading ? 0.7 : 1 }}>
                {uploading ? '⏳ Uploading…' : '📤 Upload to OneDrive'}
              </button>
              <button onClick={reset} style={{ ...btnS }}>Cancel</button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div style={card}>
            <div style={{
              padding: 24, borderRadius: 10, textAlign: 'center',
              background: result.success ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${result.success ? '#bbf7d0' : '#fecaca'}`,
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{result.success ? '✅' : '❌'}</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: result.success ? '#166534' : C.red }}>
                {result.success ? 'File uploaded successfully!' : 'Upload failed'}
              </div>
              {result.success && (
                <div style={{ fontSize: 13, color: '#15803d', marginTop: 8 }}>
                  Saved to: <strong>{result.destination_folder}</strong>
                  {result.onedrive_url && (
                    <> · <a href={result.onedrive_url} target="_blank" rel="noreferrer" style={{ color: C.blue }}>Open in OneDrive ↗</a></>
                  )}
                </div>
              )}
              {!result.success && <div style={{ fontSize: 13, color: C.red, marginTop: 8 }}>{result.error}</div>}
            </div>
            <button onClick={reset} style={{ ...btnP, width: '100%', textAlign: 'center' }}>Upload Another File</button>
          </div>
        )}
      </div>

      {/* Upload history */}
      <div>
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 14 }}>Recent Uploads</div>
          {uploads.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: C.faint, fontSize: 13 }}>No uploads yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {uploads.slice(0, 8).map(u => (
                <div key={u.id} style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    📄 {u.original_filename}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>→ {u.destination_path}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <span style={{ ...confBadge(u.routing_confidence), padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>
                      {u.routing_confidence}
                    </span>
                    <span style={{ fontSize: 11, color: C.faint }}>{fmtDate(u.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Section: CLARIFICATIONS ───────────────────────────────────────────────────

function ClarificationsSection() {
  const [items, setItems] = useState<Clarification[]>([]);
  const [tab, setTab] = useState<'pending' | 'answered'>('pending');
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [newQ, setNewQ] = useState('');
  const [newCtx, setNewCtx] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => { load(); }, [tab]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/ai-brain/clarifications?status=${tab}`);
      setItems(r.data.clarifications ?? []);
    } catch {}
    setLoading(false);
  }

  async function answer(id: string, asRule: boolean) {
    const ans = answers[id]?.trim();
    if (!ans) return;
    setSaving(id);
    try {
      await api.patch(`/ai-brain/clarifications/${id}`, { answer: ans, status: 'answered', approved_as_rule: asRule });
      setAnswers(p => { const n = {...p}; delete n[id]; return n; });
      load();
    } catch {}
    setSaving(null);
  }

  async function dismiss(id: string) {
    try {
      await api.patch(`/ai-brain/clarifications/${id}`, { status: 'dismissed' });
      load();
    } catch {}
  }

  async function addQuestion() {
    if (!newQ.trim()) return;
    try {
      await api.post('/ai-brain/clarifications', { question: newQ, context: newCtx || undefined });
      setNewQ(''); setNewCtx(''); load();
    } catch {}
  }

  const SOURCE_LABELS: Record<string, string> = {
    file_routing: '📁 File Routing',
    policy: '📋 Policy',
    workflow: '⚙️ Workflow',
    email: '📧 Email',
    general: '💬 General',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(['pending', 'answered'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${tab === t ? C.blue : C.border}`,
              background: tab === t ? C.blue : '#fff',
              color: tab === t ? '#fff' : C.muted,
            }}>
              {t === 'pending' ? '❓ Needs Answer' : '✅ Answered'}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: C.faint }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{tab === 'pending' ? '✅' : '📭'}</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>
              {tab === 'pending' ? 'No open questions — AI Brain is fully informed!' : 'No answered questions yet.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {items.map(c => (
              <div key={c.id} style={card}>
                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 22, flexShrink: 0 }}>❓</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: C.text, lineHeight: 1.5 }}>{c.question}</div>
                    {c.context && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{c.context}</div>}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <span style={{ padding: '2px 8px', background: '#f1f5f9', color: C.muted, borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                        {SOURCE_LABELS[c.source_type] ?? c.source_type}
                      </span>
                      <span style={{ fontSize: 11, color: C.faint }}>{fmtDate(c.created_at)}</span>
                    </div>
                  </div>
                </div>

                {c.status === 'pending' && (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                    <textarea
                      value={answers[c.id] ?? ''}
                      onChange={e => setAnswers(p => ({ ...p, [c.id]: e.target.value }))}
                      placeholder="Type your answer here…"
                      rows={2}
                      style={{ ...inp, resize: 'vertical', marginBottom: 10 }}
                    />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => answer(c.id, true)} disabled={!answers[c.id]?.trim() || saving === c.id}
                        style={{ ...btnP, background: C.green, fontSize: 12, padding: '7px 14px', opacity: !answers[c.id]?.trim() ? 0.5 : 1 }}>
                        ✅ Save as Company Rule
                      </button>
                      <button onClick={() => answer(c.id, false)} disabled={!answers[c.id]?.trim() || saving === c.id}
                        style={{ ...btnP, fontSize: 12, padding: '7px 14px', opacity: !answers[c.id]?.trim() ? 0.5 : 1 }}>
                        💬 Answer Once
                      </button>
                      <button onClick={() => dismiss(c.id)} style={{ ...btnS, fontSize: 12, padding: '7px 14px' }}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                {c.status === 'answered' && c.answer && (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 6 }}>Answer:</div>
                    <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{c.answer}</div>
                    {c.approved_as_rule && (
                      <div style={{ marginTop: 8, display: 'inline-flex', gap: 6, alignItems: 'center', padding: '4px 12px', background: '#f0fdf4', borderRadius: 20, fontSize: 11, color: C.green, fontWeight: 600 }}>
                        ✅ Saved as Company Rule — AI uses this in responses
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add question + guide */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 10 }}>Add a Question</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
            Add company-specific questions for the AI to learn from. Approved answers become permanent company rules.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea value={newQ} onChange={e => setNewQ(e.target.value)} placeholder="What should the AI know about…" rows={3} style={{ ...inp, resize: 'vertical' }} />
            <input value={newCtx} onChange={e => setNewCtx(e.target.value)} placeholder="Why is this important? (optional)" style={inp} />
            <button onClick={addQuestion} disabled={!newQ.trim()} style={{ ...btnP, opacity: !newQ.trim() ? 0.5 : 1 }}>
              Add to Review Queue
            </button>
          </div>
        </div>

        <div style={{ ...card, background: '#f0fdf4', borderColor: '#bbf7d0' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#166534', marginBottom: 8 }}>💡 How this works</div>
          <div style={{ fontSize: 12, color: '#15803d', lineHeight: 1.7 }}>
            1. AI Brain asks questions when it's uncertain<br />
            2. You answer and choose to save as a Company Rule<br />
            3. Company Rules are used in every future AI response<br />
            4. This makes the AI smarter over time for your company
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Section: SUGGESTED ACTIONS ────────────────────────────────────────────────

interface SuggestionItem {
  id: string; icon: string; priority: 'high' | 'medium' | 'low';
  title: string; desc: string; action: string;
  nav_section?: string; nav_path?: string; color: string;
}

function ActionsSection({ goToSection }: { goToSection: (s: Section) => void }) {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/ai-brain/suggestions')
      .then(r => setSuggestions(r.data.suggestions ?? []))
      .catch(() => setError('Could not load suggestions — check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  function takeAction(s: SuggestionItem) {
    if (s.nav_section) goToSection(s.nav_section as Section);
    else if (s.nav_path) navigate(s.nav_path);
  }

  const active = suggestions.filter(s => !dismissed.has(s.id));

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>AI-Suggested Actions</div>
        <div style={{ textAlign: 'center', padding: 48, color: C.faint }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>🔍</div>
          Checking company state…
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>AI-Suggested Actions</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
            Proactive recommendations based on your current company state — updated on every visit.
          </div>
        </div>
        <button onClick={() => {
          setLoading(true);
          api.get('/ai-brain/suggestions')
            .then(r => { setSuggestions(r.data.suggestions ?? []); setDismissed(new Set()); })
            .catch(() => {})
            .finally(() => setLoading(false));
        }} style={{ ...btnS, fontSize: 12, padding: '6px 12px', flexShrink: 0 }}>
          🔄 Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: '#fff7ed', border: `1px solid #fed7aa`, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#92400e' }}>
          ⚠️ {error}
        </div>
      )}

      {active.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
          <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>All caught up!</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>No immediate actions needed. Your company data looks healthy.</div>
        </div>
      ) : (
        active.map(s => (
          <div key={s.id} style={{ ...card, borderLeft: `4px solid ${s.color}` }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 26, flexShrink: 0 }}>{s.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{s.title}</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{s.desc}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => takeAction(s)}
                    style={{ ...btnP, fontSize: 12, padding: '6px 14px', background: s.color }}
                  >
                    {s.action} →
                  </button>
                  <button
                    onClick={() => setDismissed(p => new Set([...p, s.id]))}
                    style={{ ...btnS, fontSize: 12, padding: '6px 14px' }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, flexShrink: 0,
                background: s.priority === 'high' ? '#fef2f2' : s.priority === 'medium' ? '#fefce8' : '#eff6ff',
                color: s.priority === 'high' ? C.red : s.priority === 'medium' ? C.amber : C.blue,
              }}>
                {s.priority === 'high' ? '🔴 High' : s.priority === 'medium' ? '🟡 Medium' : '🔵 Low'}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Section: ACTIVITY LOG ─────────────────────────────────────────────────────

function ActivitySection() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get('/ai-brain/audit?limit=50').then(r => setLogs(r.data.logs ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const ACTION_LABELS: Record<string, { label: string; icon: string; color: string; bg: string }> = {
    chat: { label: 'AI Chat', icon: '🤖', color: C.blue, bg: '#eff6ff' },
    email_search: { label: 'Email Search', icon: '📧', color: '#7c3aed', bg: '#f5f3ff' },
    email_summarize: { label: 'Email Summary', icon: '✨', color: '#7c3aed', bg: '#f5f3ff' },
    file_upload: { label: 'File Upload', icon: '☁️', color: C.green, bg: '#f0fdf4' },
    file_route_suggest: { label: 'File Routing', icon: '📁', color: C.amber, bg: '#fffbeb' },
    refresh: { label: 'Source Refresh', icon: '🔄', color: C.muted, bg: '#f8fafc' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Recent AI Activity</div>
      <div style={{ fontSize: 13, color: C.muted }}>Everything the AI Brain has done — fully transparent and auditable.</div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: C.faint }}>Loading activity…</div>
      ) : logs.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>No activity yet</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Start asking questions and the AI Brain will log everything here.</div>
        </div>
      ) : (
        <div style={card}>
          {logs.map((log, i) => {
            const meta = ACTION_LABELS[log.action_type] ?? { label: log.action_type, icon: '⚡', color: C.muted, bg: '#f8fafc' };
            return (
              <div key={log.id} style={{ display: 'flex', gap: 14, padding: '12px 0', borderBottom: i < logs.length - 1 ? `1px solid ${C.border}` : 'none', alignItems: 'flex-start' }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                  {meta.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{meta.label}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: meta.bg, color: meta.color }}>
                      {log.source}
                    </span>
                  </div>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                      {Object.entries(log.details).slice(0, 3).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.faint, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {fmtDateTime(log.created_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Context Panel ──────────────────────────────────────────────────────────────

function ContextPanel({ section, ctx, onPromptClick, goToSection }: {
  section: Section; ctx: any;
  onPromptClick?: (p: string) => void;
  goToSection?: (s: Section) => void;
}) {
  const navigate = useNavigate();

  if (section === 'chat') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Live Data Connected</div>
          {[
            { icon: '👥', label: 'Staff & Credentials', status: 'Live' },
            { icon: '🎯', label: 'Candidates', status: 'Live' },
            { icon: '✅', label: 'Compliance Records', status: 'Live' },
            { icon: '📍', label: 'Placements', status: 'Live' },
            { icon: '📧', label: 'Email Intelligence', status: 'Ready' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0' }}>
              <span style={{ fontSize: 16 }}>{s.icon}</span>
              <span style={{ flex: 1, fontSize: 12, color: C.text }}>{s.label}</span>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: '#f0fdf4', color: C.green }}>{s.status}</span>
            </div>
          ))}
        </div>

        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>More Questions</div>
          {PROMPTS.slice(4).map(p => (
            <div
              key={p}
              onClick={() => onPromptClick?.(p)}
              style={{ fontSize: 12, color: C.blue, padding: '6px 0', cursor: 'pointer', lineHeight: 1.4, borderBottom: `1px solid ${C.border}` }}
              onMouseEnter={e => (e.currentTarget.style.color = '#1d4ed8')}
              onMouseLeave={e => (e.currentTarget.style.color = C.blue)}
            >
              → {p}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section === 'email' && ctx?.type === 'email') {
    const email: EmailResult = ctx.email;
    return (
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Email Details</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 8, lineHeight: 1.4 }}>{email.subject}</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}><strong>From:</strong> {emailFrom(email.from)}</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}><strong>Date:</strong> {fmtDateTime(email.receivedDateTime)}</div>
        {email.hasAttachments && (
          <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: 12, color: C.green, fontWeight: 600, marginBottom: 12 }}>
            📎 Has attachments
          </div>
        )}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Actions</div>
          <button
            onClick={() => goToSection?.('upload')}
            style={{ display: 'block', width: '100%', textAlign: 'left', ...btnS, fontSize: 12, marginBottom: 6 }}
          >
            ☁️ Save attachment to OneDrive
          </button>
          <button
            onClick={() => navigate('/candidates')}
            style={{ display: 'block', width: '100%', textAlign: 'left', ...btnS, fontSize: 12, marginBottom: 6 }}
          >
            🎯 Assign to candidate
          </button>
          <button
            onClick={() => goToSection?.('clarifications')}
            style={{ display: 'block', width: '100%', textAlign: 'left', ...btnS, fontSize: 12, marginBottom: 6 }}
          >
            ❓ Add to clarification queue
          </button>
        </div>
      </div>
    );
  }

  if (section === 'onedrive' && ctx?.type === 'file') {
    const file: OdItem = ctx.file;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>File Details</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>{file.name}</div>
          <div style={{ fontSize: 12, color: C.muted }}>Size: {fmtBytes(file.size)}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Modified: {fmtDate(file.lastModifiedDateTime)}</div>
          {file.webUrl && (
            <a href={file.webUrl} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 12, ...btnP, fontSize: 12, textDecoration: 'none', textAlign: 'center' }}>
              Open in OneDrive ↗
            </a>
          )}
        </div>
      </div>
    );
  }

  if (section === 'upload') {
    return (
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Smart Routing</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 14 }}>
          The AI analyzes your file name and context to suggest the best destination folder.
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>Routing confidence levels:</div>
        {[
          { level: 'High', desc: 'AI is confident — safe to auto-upload', ...confBadge('high') },
          { level: 'Medium', desc: 'Review suggested folder before uploading', ...confBadge('medium') },
          { level: 'Low', desc: 'Please select the folder manually', ...confBadge('low') },
        ].map(l => (
          <div key={l.level} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: l.background, color: l.color, flexShrink: 0 }}>
              {l.level}
            </span>
            <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{l.desc}</span>
          </div>
        ))}
      </div>
    );
  }

  // Default / empty context panel
  return (
    <div style={{ ...card, textAlign: 'center', padding: 32 }}>
      <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>🧠</div>
      <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
        Select an item to see details and available actions here.
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function AIBrain() {
  const { role, hasRole } = useRBAC();
  const [section, setSection] = useState<Section>('chat');
  const [ctx, setCtx] = useState<any>(null);
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [actionCount, setActionCount] = useState<number>(0);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  useEffect(() => {
    api.get('/ai-brain/stats').then(r => setStats(r.data)).catch(() => {});
    api.get('/ai-brain/suggestions').then(r => setActionCount(r.data.total ?? 0)).catch(() => {});
  }, []);

  const isAdmin = hasRole(['ceo', 'admin', 'manager']);

  const NAV_GROUPS = [
    {
      label: null,
      items: [
        { key: 'chat',    icon: '🤖', label: 'Ask AI',              show: true },
        { key: 'actions', icon: '✨', label: 'Suggested Actions',    show: true, badge: actionCount > 0 ? actionCount : undefined },
      ],
    },
    {
      label: 'SEARCH & FIND',
      items: [
        { key: 'email',       icon: '📧', label: 'Email Search',       show: true },
        { key: 'attachments', icon: '📎', label: 'Attachment Finder',  show: true },
        { key: 'onedrive',    icon: '📁', label: 'Browse Files',       show: true },
      ],
    },
    {
      label: 'MANAGE',
      items: [
        { key: 'upload',          icon: '☁️', label: 'Upload to OneDrive',   show: true },
        { key: 'clarifications',  icon: '❓', label: 'Review Queue',         show: true, badge: stats?.clarifications.pending },
        { key: 'knowledge',       icon: '🔌', label: 'Connected Sources',    show: isAdmin },
        { key: 'activity',        icon: '📋', label: 'Activity Log',         show: isAdmin },
      ],
    },
  ];

  const SECTION_TITLES: Record<Section, { title: string; subtitle: string }> = {
    chat:           { title: '🤖 Ask AI',                subtitle: 'Ask anything about Frontline operations, staff, compliance, or files' },
    knowledge:      { title: '🔌 Connected Sources',     subtitle: 'Manage and refresh the AI Brain\'s knowledge connections' },
    email:          { title: '📧 Email Intelligence',    subtitle: 'Search and analyze emails from your connected Outlook account' },
    attachments:    { title: '📎 Attachment Finder',     subtitle: 'Find and process email attachments — save them to OneDrive or candidate records' },
    onedrive:       { title: '📁 Browse Files',          subtitle: 'Browse, search, and navigate your OneDrive company folder structure' },
    upload:         { title: '☁️ Upload to OneDrive',    subtitle: 'AI automatically routes files to the correct folder — or choose manually' },
    clarifications: { title: '❓ Review Queue',          subtitle: 'Questions the AI Brain needs you to answer to improve its accuracy' },
    actions:        { title: '✨ Suggested Actions',     subtitle: 'Proactive AI recommendations based on your current company state' },
    activity:       { title: '📋 Activity Log',          subtitle: 'Full audit trail of everything the AI Brain has done' },
  };

  const SHOW_RIGHT_PANEL: Section[] = ['chat', 'email', 'onedrive', 'upload'];
  const showRight = SHOW_RIGHT_PANEL.includes(section);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: C.bg }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }
        .ai-nav-item:hover { background: rgba(255,255,255,0.08) !important; }
        .ai-nav-item.active { background: #1e40af !important; color: #fff !important; }
        .od-folder:hover { background: #eff6ff !important; border-color: #bfdbfe !important; }
        .email-row:hover { background: #f8fafc !important; }
        @media (max-width: 900px) { .ai-right-panel { display: none !important; } }
        @media (max-width: 600px) { .ai-left-nav { width: 56px !important; } .ai-left-nav .nav-label { display: none !important; } .ai-left-nav .nav-group-label { display: none !important; } }
      `}</style>

      {/* ── LEFT NAVIGATION ── */}
      <div className="ai-left-nav" style={{
        width: 230,
        background: C.nav,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflowY: 'auto',
        borderRight: '1px solid rgba(255,255,255,0.08)',
      }}>
        {/* Brand */}
        <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>🧠 FNS AI Brain</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>Company Intelligence Center</div>
        </div>

        {/* Nav groups */}
        <div style={{ flex: 1, padding: '10px 10px', overflowY: 'auto' }}>
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} style={{ marginBottom: 6 }}>
              {group.label && (
                <div className="nav-group-label" style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', padding: '10px 10px 4px', textTransform: 'uppercase' }}>
                  {group.label}
                </div>
              )}
              {group.items.filter(i => i.show).map(item => (
                <button
                  key={item.key}
                  className={`ai-nav-item${section === item.key ? ' active' : ''}`}
                  onClick={() => setSection(item.key as Section)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                    padding: '9px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: section === item.key ? '#1e40af' : 'transparent',
                    color: section === item.key ? '#fff' : 'rgba(255,255,255,0.65)',
                    fontSize: 13, fontWeight: section === item.key ? 600 : 400,
                    transition: 'background 0.15s',
                    marginBottom: 2,
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                  <span className="nav-label" style={{ flex: 1 }}>{item.label}</span>
                  {item.badge != null && item.badge > 0 && (
                    <span style={{
                      background: section === item.key ? 'rgba(255,255,255,0.25)' : C.red,
                      color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 700, flexShrink: 0,
                    }}>{item.badge}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
          Connected to Railway · Live
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Section header */}
        <div style={{ padding: '18px 24px 14px', background: '#fff', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>
            {SECTION_TITLES[section].title}
          </h1>
          <p style={{ fontSize: 13, color: C.muted, margin: '4px 0 0' }}>
            {SECTION_TITLES[section].subtitle}
          </p>
        </div>

        {/* Content + right panel */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Center panel */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 24, minWidth: 0 }}>
            {section === 'chat'           && <ChatSection onContextChange={setCtx} pendingPrompt={pendingPrompt} onPromptSent={() => setPendingPrompt(null)} />}
            {section === 'knowledge'      && <KnowledgeSection />}
            {section === 'email'          && <EmailSection onSelect={e => setCtx(e ? { type: 'email', email: e } : null)} />}
            {section === 'attachments'    && <AttachmentSection />}
            {section === 'onedrive'       && <OneDriveSection onSelect={f => setCtx(f ? { type: 'file', file: f } : null)} />}
            {section === 'upload'         && <UploadSection />}
            {section === 'clarifications' && <ClarificationsSection />}
            {section === 'actions'        && <ActionsSection goToSection={setSection} />}
            {section === 'activity'       && <ActivitySection />}
          </div>

          {/* Right context panel */}
          {showRight && (
            <div className="ai-right-panel" style={{
              width: 280, flexShrink: 0, overflowY: 'auto', padding: 20,
              borderLeft: `1px solid ${C.border}`, background: '#f8fafc',
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
                {section === 'chat' ? 'Context & Sources' : 'Details & Actions'}
              </div>
              <ContextPanel
                section={section}
                ctx={ctx}
                onPromptClick={(p) => { setSection('chat'); setPendingPrompt(p); }}
                goToSection={setSection}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
