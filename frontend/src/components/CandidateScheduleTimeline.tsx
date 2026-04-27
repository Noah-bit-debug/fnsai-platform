import { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import { useCan } from '../contexts/PermissionsContext';

/**
 * CandidateScheduleTimeline — per-candidate reminder timeline with
 * AI-suggested schedule generation, tone-aware drafting, and inline
 * approval/edit/send controls.
 *
 * Reads from the existing /api/v1/reminders endpoint (filtered by
 * candidate_id) and uses the Phase 2 endpoints:
 *   POST /reminders/suggest-schedule  — AI proposes 3-7 reminders
 *   POST /reminders/ai-draft          — AI rewrites a single message
 *   POST /reminders/:id/send          — actually deliver
 */

interface Reminder {
  id: string;
  candidate_id: string | null;
  type: 'email' | 'sms' | 'both';
  trigger_type: string;
  category: string | null;
  tone: string | null;
  subject: string;
  message: string;
  status: 'scheduled' | 'sent' | 'completed' | 'overdue' | 'failed' | 'cancelled';
  scheduled_at: string | null;
  sent_at: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_name: string | null;
  error: string | null;
  created_at: string;
}

interface Suggestion {
  category: string;
  channel: 'sms' | 'email';
  scheduled_at: string;
  subject: string;
  message: string;
  assignee_role: string;
  rationale: string;
  // Local UI state
  _accepted?: boolean;
  _editing?: boolean;
}

const CATEGORY_LABELS: Record<string, { icon: string; label: string; bg: string; fg: string }> = {
  interview:                { icon: '🗓', label: 'Interview',          bg: '#dbeafe', fg: '#1e40af' },
  application_followup:     { icon: '📩', label: 'Application',        bg: '#e0f2fe', fg: '#0369a1' },
  missing_document:         { icon: '📎', label: 'Missing document',   bg: '#fef3c7', fg: '#b45309' },
  credentialing_followup:   { icon: '🏅', label: 'Credentialing',      bg: '#f3e8ff', fg: '#6b21a8' },
  onboarding_followup:      { icon: '🎓', label: 'Onboarding',          bg: '#ccfbf1', fg: '#0f766e' },
  start_date:               { icon: '🚀', label: 'Start date',          bg: '#dcfce7', fg: '#15803d' },
  general:                  { icon: '💬', label: 'General',             bg: '#f1f5f9', fg: '#475569' },
};

const TONES = [
  { value: 'professional',  label: 'Professional' },
  { value: 'friendly',      label: 'Friendly' },
  { value: 'urgent',        label: 'Urgent' },
  { value: 'short_sms',     label: 'Short SMS' },
  { value: 'formal_email',  label: 'Formal email' },
] as const;

function statusColor(s: Reminder['status']): { bg: string; fg: string } {
  switch (s) {
    case 'sent':       return { bg: '#dcfce7', fg: '#15803d' };
    case 'scheduled':  return { bg: '#e0f2fe', fg: '#0369a1' };
    case 'overdue':    return { bg: '#fef3c7', fg: '#b45309' };
    case 'failed':     return { bg: '#fee2e2', fg: '#b91c1c' };
    case 'cancelled':  return { bg: '#f1f5f9', fg: '#64748b' };
    default:           return { bg: '#f1f5f9', fg: '#64748b' };
  }
}

export default function CandidateScheduleTimeline({
  candidateId,
  candidateName,
  candidatePhone,
  candidateEmail,
}: {
  candidateId: string;
  candidateName: string;
  candidatePhone?: string | null;
  candidateEmail?: string | null;
}) {
  const canManage = useCan('reminders_manage');
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestTone, setSuggestTone] = useState<typeof TONES[number]['value']>('professional');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ reminders: Reminder[] }>(`/reminders?candidate_id=${candidateId}`);
      setItems(r.data.reminders ?? []);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to load reminders');
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const r = await api.get<{ reminders: Reminder[] }>(`/reminders?candidate_id=${candidateId}`);
        if (!cancelled) setItems(r.data.reminders ?? []);
      } catch (e: any) {
        if (!cancelled) setErr(e?.response?.data?.error ?? 'Failed to load reminders');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [candidateId]);

  const handleSuggest = async () => {
    setSuggesting(true);
    setErr(null);
    try {
      const r = await api.post<{ schedule: Suggestion[] }>(`/reminders/suggest-schedule`, {
        candidate_id: candidateId,
        tone: suggestTone,
      });
      setSuggestions((r.data.schedule ?? []).map((s) => ({ ...s, _accepted: true })));
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'AI scheduling failed');
    } finally {
      setSuggesting(false);
    }
  };

  const acceptAll = async () => {
    if (!suggestions) return;
    setCreating(true);
    setErr(null);
    try {
      const accepted = suggestions.filter((s) => s._accepted);
      for (const s of accepted) {
        await api.post(`/reminders`, {
          type: s.channel,
          trigger_type: 'manual',
          candidate_id: candidateId,
          recipient_email: candidateEmail ?? null,
          recipient_phone: candidatePhone ?? null,
          recipient_name: candidateName,
          subject: s.subject,
          message: s.message,
          scheduled_at: s.scheduled_at,
          category: s.category,
          tone: suggestTone,
        });
      }
      setSuggestions(null);
      setSuggestOpen(false);
      await refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to save schedule');
    } finally {
      setCreating(false);
    }
  };

  const sendNow = async (id: string) => {
    if (!confirm('Send this reminder now?')) return;
    setErr(null);
    try {
      const r = await api.post<{ status: string; results: Array<{ channel: string; status: string; error?: string }> }>(
        `/reminders/${id}/send`
      );
      if (r.data.status === 'failed') {
        const errLine = r.data.results.find((x) => x.error)?.error ?? 'Send failed';
        setErr(errLine);
      }
      await refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to send');
    }
  };

  const cancel = async (id: string) => {
    if (!confirm('Cancel this reminder?')) return;
    try {
      await api.delete(`/reminders/${id}`);
      await refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to cancel');
    }
  };

  // Group: upcoming (scheduled, future), past (sent / cancelled / failed)
  const now = Date.now();
  const upcoming = items
    .filter((r) => r.status === 'scheduled' || r.status === 'overdue')
    .sort((a, b) => new Date(a.scheduled_at ?? a.created_at).getTime() - new Date(b.scheduled_at ?? b.created_at).getTime());
  const past = items
    .filter((r) => r.status !== 'scheduled' && r.status !== 'overdue')
    .sort((a, b) => new Date(b.sent_at ?? b.created_at).getTime() - new Date(a.sent_at ?? a.created_at).getTime());

  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
      padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Schedule & Reminders
        </h4>
        {canManage && (
          <button
            onClick={() => setSuggestOpen((v) => !v)}
            style={{
              fontSize: 11, fontWeight: 600,
              background: suggestOpen ? '#1565c0' : '#eff6ff',
              color: suggestOpen ? '#fff' : '#1565c0',
              border: '1px solid #bfdbfe', borderRadius: 6,
              padding: '4px 10px', cursor: 'pointer',
            }}
          >
            ✦ Suggest with AI
          </button>
        )}
      </div>

      {err && (
        <div style={{ fontSize: 12, color: '#b91c1c', background: '#fee2e2', padding: '6px 10px', borderRadius: 6, marginBottom: 10 }}>
          {err}
        </div>
      )}

      {/* Suggest panel */}
      {suggestOpen && canManage && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          {!suggestions ? (
            <>
              <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                Claude will look at this candidate's stage, missing documents, upcoming interviews, and onboarding status, then propose a 3–7 reminder timeline you can review.
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Tone</label>
                <select
                  value={suggestTone}
                  onChange={(e) => setSuggestTone(e.target.value as typeof suggestTone)}
                  style={{ flex: 1, padding: '5px 8px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 6 }}
                >
                  {TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <button
                  onClick={handleSuggest}
                  disabled={suggesting}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 600,
                    background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6,
                    cursor: suggesting ? 'not-allowed' : 'pointer', opacity: suggesting ? 0.6 : 1,
                  }}
                >
                  {suggesting ? 'Drafting…' : 'Generate'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                Review the proposed schedule. Uncheck anything you don't want; the rest will be saved as scheduled reminders.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                {suggestions.map((s, i) => {
                  const c = CATEGORY_LABELS[s.category] ?? CATEGORY_LABELS.general;
                  return (
                    <div key={i} style={{
                      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10,
                      opacity: s._accepted ? 1 : 0.5,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <input
                          type="checkbox"
                          checked={s._accepted ?? true}
                          onChange={(e) => {
                            const next = [...suggestions];
                            next[i] = { ...next[i], _accepted: e.target.checked };
                            setSuggestions(next);
                          }}
                        />
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                          color: c.fg, background: c.bg, textTransform: 'uppercase', letterSpacing: '0.3px',
                        }}>
                          {c.icon} {c.label}
                        </span>
                        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>
                          {new Date(s.scheduled_at).toLocaleDateString()} · {s.channel.toUpperCase()} · → {s.assignee_role}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>
                        {s.subject || '(no subject)'}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#475569', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                        {s.message}
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, fontStyle: 'italic' }}>
                        Why: {s.rationale}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setSuggestions(null)}
                  style={{ padding: '5px 12px', fontSize: 12, background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}
                >
                  Discard
                </button>
                <button
                  onClick={acceptAll}
                  disabled={creating}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 600,
                    background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6,
                    cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.6 : 1,
                  }}
                >
                  {creating ? 'Saving…' : `Save ${suggestions.filter((s) => s._accepted).length} reminders`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Upcoming */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, marginTop: 4 }}>
          Upcoming ({upcoming.length})
        </div>
        {loading ? (
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Loading…</div>
        ) : upcoming.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Nothing scheduled.</div>
        ) : (
          upcoming.map((r) => {
            const c = CATEGORY_LABELS[r.category ?? 'general'] ?? CATEGORY_LABELS.general;
            const dueMs = r.scheduled_at ? new Date(r.scheduled_at).getTime() - now : null;
            const dueLabel = !dueMs ? '—' :
              dueMs < 0 ? `${Math.abs(Math.floor(dueMs / 86400000))}d overdue`
              : dueMs < 86400000 ? 'today'
              : `in ${Math.floor(dueMs / 86400000)}d`;
            const dueColor = !dueMs ? '#94a3b8' : dueMs < 0 ? '#b91c1c' : dueMs < 86400000 ? '#b45309' : '#0369a1';
            return (
              <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                    color: c.fg, background: c.bg, textTransform: 'uppercase', letterSpacing: '0.3px',
                  }}>
                    {c.icon} {c.label}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: dueColor }}>
                    {dueLabel}
                  </span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>· {r.type.toUpperCase()}</span>
                  {canManage && (
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => sendNow(r.id)}
                        title="Send now"
                        style={{ fontSize: 11, fontWeight: 600, color: '#15803d', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        Send now
                      </button>
                      <button
                        onClick={() => cancel(r.id)}
                        title="Cancel"
                        style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{r.subject}</div>
                <div style={{ fontSize: 11.5, color: '#64748b', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{r.message}</div>
              </div>
            );
          })
        )}
      </div>

      {/* Past */}
      {past.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            History ({past.length})
          </div>
          {past.slice(0, 8).map((r) => {
            const sc = statusColor(r.status);
            const c = CATEGORY_LABELS[r.category ?? 'general'] ?? CATEGORY_LABELS.general;
            return (
              <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', opacity: 0.7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5,
                    color: c.fg, background: c.bg, textTransform: 'uppercase', letterSpacing: '0.3px',
                  }}>
                    {c.icon}
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5,
                    color: sc.fg, background: sc.bg, textTransform: 'uppercase', letterSpacing: '0.3px',
                  }}>
                    {r.status}
                  </span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    {new Date(r.sent_at ?? r.created_at).toLocaleDateString()}
                  </span>
                  <span style={{ fontSize: 11.5, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {r.subject}
                  </span>
                </div>
                {r.error && (
                  <div style={{ fontSize: 10.5, color: '#b91c1c', marginTop: 2 }}>{r.error}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
