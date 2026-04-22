import { useState, useEffect, useCallback } from 'react';
import { useLocation, matchPath } from 'react-router-dom';
import api, { textingApi, candidatesApi } from '../lib/api';

/**
 * Phase 1.1C — Global right-side texting panel.
 *
 * Floating 💬 button at bottom-right (stacks above the AI sidebar button).
 * Opens a slide-out panel that lets the user pick a candidate (or uses the
 * one from the current URL if on a candidate page) and send them a text.
 *
 * Also covers Phase 1.1B — when opened from /candidates/:id, the candidate
 * is pre-selected and phone is auto-filled. If the candidate has no phone
 * on file, the panel shows a friendly error instead of the send form.
 */

interface CandidateRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: string | null;
}

type PanelEvent = CustomEvent<{ candidateId?: string }>;

// Fire this event from anywhere to open the panel, optionally pre-loading a
// candidate. Example from CandidateDetail's "Text Candidate" button:
//   window.dispatchEvent(new CustomEvent('open-texting', { detail: { candidateId } }))
const OPEN_EVENT = 'open-texting-panel';

export function openTextingPanel(candidateId?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { candidateId } }));
}

export default function TextingPanel() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [loadingCands, setLoadingCands] = useState(false);

  // Load candidates on first open (best-effort; panel still usable with
  // manual phone entry if this fails).
  const loadCandidates = useCallback(async () => {
    setLoadingCands(true);
    try {
      const res = await candidatesApi.list({ status: 'active' });
      setCandidates(res.data?.candidates?.map((c: any) => ({
        id: c.id, first_name: c.first_name, last_name: c.last_name,
        phone: c.phone ?? null, role: c.role ?? null,
      })) ?? []);
    } catch { /* silent */ }
    finally { setLoadingCands(false); }
  }, []);

  // Listener for programmatic open (Text button on candidate profile)
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as PanelEvent;
      setOpen(true);
      if (candidates.length === 0) void loadCandidates();
      if (ev.detail?.candidateId) setSelectedId(ev.detail.candidateId);
      setFeedback(null);
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, [candidates.length, loadCandidates]);

  // Auto-detect candidate from URL when panel opens on a candidate page
  useEffect(() => {
    if (!open) return;
    const m = matchPath('/candidates/:id', location.pathname);
    if (m?.params?.id && !selectedId) setSelectedId(m.params.id);
  }, [open, location.pathname, selectedId]);

  // Lazy-load candidates the first time the panel opens even if we didn't
  // open via the event (user clicked the floating button directly)
  useEffect(() => {
    if (open && candidates.length === 0 && !loadingCands) void loadCandidates();
  }, [open, candidates.length, loadingCands, loadCandidates]);

  const selected = candidates.find((c) => c.id === selectedId) ?? null;
  const hasPhone = !!(selected?.phone && selected.phone.replace(/\D/g, '').length >= 10);

  const send = async () => {
    if (!selected) { setFeedback({ kind: 'error', text: 'Pick a candidate first.' }); return; }
    if (!hasPhone) { setFeedback({ kind: 'error', text: 'This candidate has no phone number on file. Add one on their profile first.' }); return; }
    if (!message.trim()) { setFeedback({ kind: 'error', text: 'Write a message first.' }); return; }
    setSending(true);
    setFeedback(null);
    try {
      await textingApi.sendDirect({
        recipient_phone: selected.phone!,
        message: message.trim(),
        reference_id: selected.id,
        reference_type: 'candidate',
      });
      setFeedback({ kind: 'ok', text: `Sent to ${selected.first_name} ${selected.last_name}` });
      setMessage('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setFeedback({ kind: 'error', text: e.response?.data?.error ?? e.message ?? 'Send failed' });
    } finally { setSending(false); }
  };

  return (
    <>
      {/* Floating button — below the AI sidebar button so they stack */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open texting panel"
          title="Text a candidate"
          style={{
            position: 'fixed', bottom: 88, right: 20,
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg, #059669, #10b981)',
            color: '#fff', border: 'none', fontSize: 22, cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
            zIndex: 299,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          💬
        </button>
      )}

      {open && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(400px, 100vw)',
          background: 'var(--sf)', borderLeft: '1px solid var(--bd)',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
          display: 'flex', flexDirection: 'column', zIndex: 300,
        }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>💬 Text candidate</div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                Sends directly via FNS AI SMS (no approval queue)
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close"
              style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--t3)', padding: 4 }}>×</button>
          </div>

          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflowY: 'auto' }}>
            {/* Candidate picker */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>
                Candidate
              </label>
              <select
                value={selectedId}
                onChange={(e) => { setSelectedId(e.target.value); setFeedback(null); }}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, background: 'var(--sf)' }}
              >
                <option value="">
                  {loadingCands ? 'Loading candidates…' : `— pick someone (${candidates.length}) —`}
                </option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.phone}>
                    {c.first_name} {c.last_name}{c.role ? ` · ${c.role}` : ''}{c.phone ? '' : ' (no phone)'}
                  </option>
                ))}
              </select>
              {selected && (
                <div style={{ fontSize: 12, color: hasPhone ? 'var(--t3)' : '#b91c1c', marginTop: 4 }}>
                  {hasPhone ? `→ ${selected.phone}` : '⚠ No phone on file — add one on their profile first.'}
                </div>
              )}
            </div>

            {/* Message */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>
                Message
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Hi — quick follow-up on your application…"
                rows={6}
                maxLength={1600}
                disabled={!selected || !hasPhone}
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', resize: 'vertical', background: 'var(--sf)' }}
              />
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, textAlign: 'right' }}>
                {message.length} / 1600 · {Math.ceil(message.length / 160) || 0} SMS segment{Math.ceil(message.length / 160) === 1 ? '' : 's'}
              </div>
            </div>

            {feedback && (
              <div style={{
                padding: 10, borderRadius: 6,
                background: feedback.kind === 'ok' ? '#d1fae5' : '#fee2e2',
                color: feedback.kind === 'ok' ? '#065f46' : '#991b1b',
                fontSize: 12,
              }}>{feedback.text}</div>
            )}
          </div>

          <div style={{ padding: 12, borderTop: '1px solid var(--bd)', display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setMessage(''); setFeedback(null); }}
              style={{ padding: '9px 14px', background: 'var(--sf2)', border: '1px solid var(--bd)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >Clear</button>
            <button
              onClick={send}
              disabled={sending || !selected || !hasPhone || !message.trim()}
              style={{
                flex: 1, padding: '9px 14px',
                background: sending || !hasPhone || !message.trim() ? 'var(--sf3)' : '#10b981',
                color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: sending || !hasPhone || !message.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {sending ? 'Sending…' : 'Send text'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Tiny helper used by the api module — re-export so TextingPanel.tsx is
// self-contained for downstream importers.
void api;
