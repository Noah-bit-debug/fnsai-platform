import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { esignApi } from '../../lib/api';

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft:            { label: 'Draft',             color: '#666',    bg: '#f5f5f5' },
  sent:             { label: 'Awaiting',           color: '#e65100', bg: '#fff3e0' },
  in_progress:      { label: 'In Progress',        color: '#1565c0', bg: '#e3f2fd' },
  completed:        { label: 'Completed',          color: '#2e7d32', bg: '#e8f5e9' },
  approved:         { label: 'Approved',           color: '#1b5e20', bg: '#dcedc8' },
  needs_correction: { label: 'Needs Correction',   color: '#c2410c', bg: '#fff7ed' },
  declined:         { label: 'Declined',           color: '#c62828', bg: '#fce4ec' },
  voided:           { label: 'Voided',             color: '#6a1b9a', bg: '#f3e5f5' },
};

const SIGNER_STATUS: Record<string, { icon: string; color: string; label: string }> = {
  pending:  { icon: '⏳', color: '#e65100', label: 'Pending' },
  viewed:   { icon: '👁',  color: '#0288d1', label: 'Viewed' },
  signed:   { icon: '✓',  color: '#2e7d32', label: 'Signed' },
  declined: { icon: '✗',  color: '#c62828', label: 'Declined' },
};

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Send Back Modal ──────────────────────────────────────────────────────────
function SendBackModal({
  onClose,
  onSubmit,
  submitting,
}: {
  onClose: () => void;
  onSubmit: (reason: string) => void;
  submitting: boolean;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  function submit() {
    if (!reason.trim()) { setErr('A reason is required before sending back.'); return; }
    onSubmit(reason.trim());
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 8 }}>↩</div>
        <h3 style={{ textAlign: 'center', margin: '0 0 8px', fontSize: 18, color: '#1a2b3c' }}>Send Back for Correction</h3>
        <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13, margin: '0 0 20px', lineHeight: 1.5 }}>
          The document status will be set to <strong>Needs Correction</strong> and all pending signers will be notified.
        </p>

        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
          Reason for rejection <span style={{ color: '#c62828' }}>*</span>
        </label>
        <textarea
          autoFocus
          value={reason}
          onChange={e => { setReason(e.target.value); setErr(''); }}
          placeholder="Describe what needs to be corrected or re-signed…"
          style={{
            width: '100%', padding: '10px 14px', border: `1px solid ${err ? '#fca5a5' : '#e8edf2'}`,
            borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c',
            boxSizing: 'border-box', height: 100, resize: 'vertical', lineHeight: 1.6,
          }}
        />
        {err && <div style={{ color: '#c62828', fontSize: 12, marginTop: 4 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '9px 18px', background: '#f5f5f5', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            style={{ padding: '9px 20px', background: '#e65100', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 14, opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? 'Sending…' : 'Send to Signer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ESignDocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const location = useLocation();
  const [doc, setDoc] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingLinks, setSigningLinks] = useState<any[]>((location.state as any)?.newSigners ?? []);
  const [downloading, setDownloading] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [approving, setApproving] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [showSendBackModal, setShowSendBackModal] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  // 24-hour reminder cooldown
  const reminderCooldownKey = `fns_esign_reminder_${id}`;
  const [reminderOnCooldown, setReminderOnCooldown] = useState(() => {
    const last = Number(localStorage.getItem(`fns_esign_reminder_${id}`) ?? 0);
    return last > 0 && Date.now() - last < 24 * 60 * 60 * 1000;
  });
  const [cooldownRemaining, setCooldownRemaining] = useState('');

  // Live countdown — updates every minute while on cooldown
  useEffect(() => {
    const tick = () => {
      const last = Number(localStorage.getItem(reminderCooldownKey) ?? 0);
      if (!last) { setReminderOnCooldown(false); setCooldownRemaining(''); return; }
      const remaining = 24 * 60 * 60 * 1000 - (Date.now() - last);
      if (remaining <= 0) { setReminderOnCooldown(false); setCooldownRemaining(''); return; }
      const h = Math.floor(remaining / 3_600_000);
      const m = Math.floor((remaining % 3_600_000) / 60_000);
      setCooldownRemaining(`${h}h ${m}m`);
    };
    tick();
    const iv = setInterval(tick, 60_000);
    return () => clearInterval(iv);
  }, [reminderCooldownKey]);

  const load = async () => {
    if (!id) return;
    try {
      const [dr, ar] = await Promise.all([esignApi.getDocument(id), esignApi.getAudit(id)]);
      setDoc(dr.data.document);
      setAudit(ar.data.auditLog ?? []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const handleDownload = async () => {
    if (!id) return;
    setDownloading(true);
    try {
      const resp = await esignApi.downloadSigned(id);
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url; a.download = `${doc?.title}_signed.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Download not available yet.'); }
    finally { setDownloading(false); }
  };

  const handleVoid = async () => {
    setVoiding(true);
    try { await esignApi.voidDocument(id!, 'Voided by administrator'); load(); }
    finally { setVoiding(false); setShowVoidConfirm(false); }
  };

  const handleRemind = async () => {
    try {
      const resp = await esignApi.remind(id!);
      const links = (resp.data as any).signers ?? (resp.data as any).pendingSigners ?? [];
      setSigningLinks(links);
    } catch { alert('Failed to get signing links.'); }
  };

  const handleSend = async () => {
    try {
      const resp = await esignApi.sendDocument2(id!);
      setSigningLinks(resp.data.signers ?? []);
    } catch { alert('Failed to send.'); }
  };

  const flash = (text: string, ok = true) => {
    setActionMsg({ text, ok });
    setTimeout(() => setActionMsg(null), 3500);
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      await esignApi.updateDocument(id!, { status: 'approved' });
      flash('Document approved and logged in audit trail.');
      load();
    } catch { flash('Failed to approve document.', false); }
    finally { setApproving(false); }
  };

  // Opens the Send Back modal — actual send happens in submitSendBack
  const handleSendBack = () => {
    setShowSendBackModal(true);
  };

  const submitSendBack = async (reason: string) => {
    setSendingBack(true);
    try {
      await esignApi.updateDocument(id!, { status: 'needs_correction', correction_reason: reason });
      flash('Document sent back — status set to Needs Correction. Signers have been notified.');
      setShowSendBackModal(false);
      load();
    } catch { flash('Failed to send back for correction.', false); }
    finally { setSendingBack(false); }
  };

  const handleSendReminder = async () => {
    setSendingReminder(true);
    try {
      const resp = await esignApi.remind(id!);
      const links = (resp.data as any).signers ?? (resp.data as any).pendingSigners ?? [];
      setSigningLinks(links);
      // Store timestamp for 24h cooldown
      const now = Date.now();
      localStorage.setItem(reminderCooldownKey, String(now));
      setReminderOnCooldown(true);
      setCooldownRemaining('23h 59m');
      const n = links.length;
      flash(`📩 Reminder sent to ${n} signer${n !== 1 ? 's' : ''}. Next reminder available in 24h.`);
    } catch { flash('Failed to send reminder.', false); }
    finally { setSendingReminder(false); }
  };

  const copyLink = (url: string, name: string) => {
    navigator.clipboard.writeText(url);
    setCopied(name); setTimeout(() => setCopied(null), 2000);
  };

  if (loading) return <div className="page-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}><div style={{ color: '#888' }}>Loading...</div></div>;
  if (!doc) return <div className="page-wrapper"><p style={{ color: '#c62828' }}>Document not found.</p></div>;

  const signers = (doc.signers ?? []).filter(Boolean);
  const status = STATUS_META[doc.status] ?? STATUS_META.draft;
  const canSend = doc.status === 'draft';
  const canVoid = !['completed', 'voided', 'approved'].includes(doc.status);
  // Send Reminder: show whenever ANY signer is still pending (regardless of doc status)
  const hasPendingSigners = signers.some((s: any) => s.status === 'pending');
  // Approve + Send Back: only when Awaiting ('sent') or In Progress
  const canApprove = ['sent', 'in_progress'].includes(doc.status);
  const canSendBack = ['sent', 'in_progress'].includes(doc.status);
  const signedCount = signers.filter((s: any) => s.status === 'signed').length;

  return (
    <div className="page-wrapper">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={() => nav('/esign/documents')} style={{ background: '#f5f5f5', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', color: '#555', fontWeight: 600, fontSize: 13 }}>← Documents</button>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>{doc.title}</h1>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ background: status.bg, color: status.color, borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>{status.label}</span>
              <span style={{ fontSize: 12, color: '#888' }}>Sent {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—'}</span>
              {doc.expires_at && <span style={{ fontSize: 12, color: '#888' }}>Expires {new Date(doc.expires_at).toLocaleDateString()}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {doc.status === 'draft' && <button onClick={() => nav(`/esign/documents/${id}/prepare`)} style={{ padding: '9px 18px', background: '#6a1b9a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>📐 Prepare Fields</button>}
          {canSend && <button onClick={handleSend} style={{ padding: '9px 18px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>✉ Send</button>}
          {['sent', 'in_progress'].includes(doc.status) && (
            <button onClick={handleRemind} style={{ padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>🔗 Signing Links</button>
          )}

          {/* Send Back for Correction — opens modal with required reason */}
          {canSendBack && (
            <button
              onClick={handleSendBack}
              style={{ padding: '9px 18px', background: '#fff', color: '#e65100', border: '1px solid #ffd0b0', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
            >
              ↩ Send Back for Correction
            </button>
          )}

          {/* Approve — only when completed */}
          {canApprove && (
            <button
              onClick={handleApprove}
              disabled={approving}
              style={{ padding: '9px 18px', background: '#1b5e20', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: approving ? 'not-allowed' : 'pointer', fontSize: 13, opacity: approving ? 0.7 : 1 }}
            >
              {approving ? 'Approving…' : '✓ Approve Document'}
            </button>
          )}

          {(doc.status === 'completed' || doc.status === 'approved') && <button onClick={handleDownload} disabled={downloading} style={{ padding: '9px 18px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>⬇ Download Signed PDF</button>}
          {canVoid && <button onClick={() => setShowVoidConfirm(true)} disabled={voiding} style={{ padding: '9px 18px', background: '#fff', color: '#c62828', border: '1px solid #fcc', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Void</button>}
        </div>
      </div>

      {/* Action flash message */}
      {actionMsg && (
        <div style={{ background: actionMsg.ok ? '#e8f5e9' : '#fee2e2', border: `1px solid ${actionMsg.ok ? '#a5d6a7' : '#fca5a5'}`, borderRadius: 10, padding: '12px 18px', marginBottom: 16, fontSize: 14, fontWeight: 600, color: actionMsg.ok ? '#2e7d32' : '#991b1b' }}>
          {actionMsg.ok ? '✓ ' : '✗ '}{actionMsg.text}
        </div>
      )}

      {/* Needs correction notice */}
      {doc.status === 'needs_correction' && doc.correction_reason && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '12px 18px', marginBottom: 16, fontSize: 14, color: '#9a3412' }}>
          <strong>↩ Sent Back for Correction:</strong> {doc.correction_reason}
        </div>
      )}

      {/* Signing links panel */}
      {signingLinks.length > 0 && (
        <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 14, padding: '18px 22px', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>✅ Document Ready — Share Signing Links</div>
          {signingLinks.map((s: any) => (
            <div key={s.name} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 120 }}>{s.name}</span>
              {s.email && <span style={{ fontSize: 12, color: '#555' }}>{s.email}</span>}
              <input readOnly value={s.signing_url} style={{ flex: 1, padding: '6px 10px', border: '1px solid #c8e6c9', borderRadius: 7, fontSize: 11, fontFamily: 'monospace', background: '#fff' }} />
              <button onClick={() => copyLink(s.signing_url, s.name)} style={{ padding: '6px 14px', background: copied === s.name ? '#2e7d32' : '#1565c0', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {copied === s.name ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          ))}
          <button onClick={() => setSigningLinks([])} style={{ marginTop: 8, fontSize: 11, color: '#2e7d32', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }}>
        {/* Left: signers + audit */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Signers */}
          <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>Signers ({signedCount}/{signers.length} signed)</span>
                <div style={{ height: 6, flex: 1, maxWidth: 120, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: '#2e7d32', width: signers.length ? `${100 * signedCount / signers.length}%` : '0%', borderRadius: 3, transition: 'width 0.3s' }} />
                </div>
              </div>

              {/* 📩 Send Reminder — shown whenever any signer is pending */}
              {hasPendingSigners && (
                <button
                  onClick={handleSendReminder}
                  disabled={sendingReminder || reminderOnCooldown}
                  title={reminderOnCooldown ? `Next reminder available in ${cooldownRemaining}` : 'Send reminder to all pending signers'}
                  style={{
                    padding: '6px 14px',
                    background: '#fff',
                    color: reminderOnCooldown ? '#94a3b8' : '#1565c0',
                    border: `1.5px solid ${reminderOnCooldown ? '#cbd5e1' : '#1565c0'}`,
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor: (sendingReminder || reminderOnCooldown) ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                    opacity: sendingReminder ? 0.6 : 1,
                  }}
                >
                  {sendingReminder
                    ? '📩 Sending…'
                    : reminderOnCooldown
                      ? `📩 Sent · available in ${cooldownRemaining}`
                      : '📩 Send Reminder'}
                </button>
              )}
            </div>
            {signers.map((s: any, i: number) => {
              const ss = SIGNER_STATUS[s.status] ?? SIGNER_STATUS.pending;
              return (
                <div key={s.id} style={{ padding: '14px 20px', borderTop: i > 0 ? '1px solid #f5f5f5' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {doc.signing_order === 'sequential' && (
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: s.status === 'signed' ? '#2e7d32' : '#e0e0e0', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{i + 1}</div>
                    )}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: '#666' }}>{s.email} · {s.role}</div>
                      {s.signed_at && <div style={{ fontSize: 11, color: '#2e7d32', marginTop: 2 }}>Signed {new Date(s.signed_at).toLocaleString()}</div>}
                      {s.viewed_at && !s.signed_at && <div style={{ fontSize: 11, color: '#0288d1', marginTop: 2 }}>Viewed {timeAgo(s.viewed_at)}</div>}
                      {s.decline_reason && <div style={{ fontSize: 11, color: '#c62828', marginTop: 2 }}>Declined: {s.decline_reason}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: ss.color, fontSize: 13, fontWeight: 600 }}>{ss.icon} {ss.label}</span>
                    {s.status !== 'signed' && s.token && (
                      <button onClick={() => copyLink(`${window.location.origin}/sign/${s.token}`, s.name)} style={{ fontSize: 11, color: '#1565c0', background: '#f0f4ff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
                        {copied === s.name ? '✓ Copied' : 'Copy Link'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Audit trail */}
          <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Audit Trail</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#888', background: '#f5f5f5', borderRadius: 6, padding: '3px 8px' }}>Hash-chained · tamper-evident</span>
                <button onClick={() => setShowAudit(!showAudit)} style={{ fontSize: 12, color: '#1565c0', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{showAudit ? 'Collapse' : 'Expand'}</button>
              </div>
            </div>
            <div style={{ padding: '0 20px' }}>
              {(showAudit ? audit : audit.slice(-5)).map((e: any, i: number) => (
                <div key={e.id} style={{ padding: '12px 0', borderTop: i > 0 ? '1px solid #f5f5f5' : 'none', display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{new Date(e.created_at).toLocaleString()}</div>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{e.action.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                    {e.actor && <span style={{ fontSize: 12, color: '#666' }}> — {e.actor}</span>}
                    {e.ip_address && <span style={{ fontSize: 11, color: '#aaa', marginLeft: 6 }}>({e.ip_address})</span>}
                    {e.metadata?.reason && <div style={{ fontSize: 11, color: '#c2410c', marginTop: 2, fontStyle: 'italic' }}>Reason: {e.metadata.reason}</div>}
                    {e.event_hash && <div style={{ fontSize: 10, color: '#bbb', fontFamily: 'monospace', marginTop: 2 }}>#{e.event_hash.slice(0, 16)}...</div>}
                  </div>
                </div>
              ))}
              {audit.length === 0 && <div style={{ padding: '20px 0', fontSize: 13, color: '#aaa' }}>No events yet</div>}
            </div>
            {!showAudit && audit.length > 5 && (
              <div style={{ padding: '10px 20px', borderTop: '1px solid #f5f5f5', textAlign: 'center' }}>
                <button onClick={() => setShowAudit(true)} style={{ fontSize: 12, color: '#1565c0', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Show all {audit.length} events</button>
              </div>
            )}
          </div>
        </div>

        {/* Right: details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1565c0', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Document Info</div>
            {[
              { label: 'Status', value: <span style={{ background: status.bg, color: status.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{status.label}</span> },
              { label: 'Created', value: doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—' },
              { label: 'Signing Order', value: doc.signing_order === 'sequential' ? 'Sequential' : 'Parallel' },
              { label: 'Expires', value: doc.expires_at ? new Date(doc.expires_at).toLocaleDateString() : 'Never' },
              { label: 'Completed', value: doc.completed_at ? new Date(doc.completed_at).toLocaleString() : '—' },
              { label: 'Fields', value: (doc.fields ?? []).length },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 }}>
                <span style={{ color: '#666' }}>{label}</span>
                <span style={{ fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>

          {doc.message && (
            <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1565c0', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Message to Signers</div>
              <p style={{ fontSize: 13, color: '#444', margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>"{doc.message}"</p>
            </div>
          )}

          <div style={{ background: '#fffde7', border: '1px solid #fff176', borderRadius: 14, padding: 18, fontSize: 12, color: '#555', lineHeight: 1.6 }}>
            ⚖️ <strong>Legal Notice:</strong> All signatures on this document are legally binding under the U.S. ESIGN Act (15 U.S.C. § 7001) and UETA. The audit trail above is tamper-evident via SHA-256 hash chaining.
          </div>
        </div>
      </div>

      {/* Send Back Modal */}
      {showSendBackModal && (
        <SendBackModal
          onClose={() => setShowSendBackModal(false)}
          onSubmit={submitSendBack}
          submitting={sendingBack}
        />
      )}

      {/* Void confirmation modal */}
      {showVoidConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
             onClick={() => setShowVoidConfirm(false)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
               onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
            <h3 style={{ textAlign: 'center', margin: '0 0 8px', fontSize: 18, color: '#1a2b3c' }}>Void This Document?</h3>
            <p style={{ textAlign: 'center', color: '#64748b', fontSize: 14, margin: '0 0 24px' }}>
              This will permanently void the document and notify all signers. <strong>This action cannot be undone.</strong>
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button onClick={() => setShowVoidConfirm(false)}
                      style={{ padding: '10px 24px', background: '#f5f5f5', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                Cancel
              </button>
              <button onClick={() => void handleVoid()} disabled={voiding}
                      style={{ padding: '10px 24px', background: '#c62828', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: voiding ? 'not-allowed' : 'pointer', fontSize: 14, opacity: voiding ? 0.7 : 1 }}>
                {voiding ? 'Voiding…' : 'Yes, Void Document'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
