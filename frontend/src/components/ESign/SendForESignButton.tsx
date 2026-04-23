import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { esignApi } from '../../lib/api';
import { useToast } from '../ToastHost';
import { extractApiError } from '../../lib/apiErrors';

/**
 * Phase 3.2 — Shared "Send for eSign" button.
 *
 * Drop this on any page where a signature is needed (candidate profile,
 * policy detail, etc.). Click opens a small modal that lets the user:
 *   - Pick an existing template, OR
 *   - Start from scratch with a blank document
 *
 * Either path routes to /esign/documents/new or /esign/documents/:id/prepare
 * with the recipient pre-filled from the props (recipientName,
 * recipientEmail, referenceId, referenceType).
 *
 * Reuses the existing eSign create/send flow — does NOT duplicate it.
 */

interface Template {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
}

interface Props {
  recipientName?: string;
  recipientEmail?: string | null;
  referenceId?: string;       // candidate.id, policy.id, etc.
  referenceType?: string;     // 'candidate', 'policy'
  label?: string;             // button text; default "Send for eSign"
  compact?: boolean;          // smaller button styling
  // Optional: seed the new doc with a specific title based on context
  defaultDocTitle?: string;
}

export default function SendForESignButton({
  recipientName, recipientEmail, referenceId, referenceType,
  label = 'Send for eSign', compact, defaultDocTitle,
}: Props) {
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);

  const openPicker = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const res = await esignApi.listTemplates();
      setTemplates(res.data?.templates ?? []);
    } catch (e) {
      toast.error(extractApiError(e, 'Failed to load templates'));
    } finally { setLoading(false); }
  };

  // Navigate to the eSign new-doc page with recipient + template prefilled
  // via query string. The existing ESignDocumentNew reads these params.
  const go = (templateId?: string) => {
    const params = new URLSearchParams();
    if (templateId) params.set('template', templateId);
    if (recipientName)  params.set('recipient_name', recipientName);
    if (recipientEmail) params.set('recipient_email', recipientEmail);
    if (referenceId)    params.set('reference_id', referenceId);
    if (referenceType)  params.set('reference_type', referenceType);
    if (defaultDocTitle) params.set('title', defaultDocTitle);
    nav(`/esign/documents/new?${params.toString()}`);
  };

  return (
    <>
      <button
        onClick={() => void openPicker()}
        title={recipientName ? `Send a document to ${recipientName} for signature` : 'Start an eSign document'}
        style={{
          padding: compact ? '6px 12px' : '9px 18px',
          background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
          color: '#fff',
          border: 'none',
          borderRadius: compact ? 6 : 8,
          fontSize: compact ? 12 : 14,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        ✍ {label}
      </button>

      {open && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
          onClick={() => setOpen(false)}
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>Send for eSign</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              {recipientName ? <>Recipient: <strong>{recipientName}</strong>{recipientEmail ? ` (${recipientEmail})` : ''}</> : 'Pick a template or start blank.'}
            </div>

            {/* Blank document option */}
            <div
              onClick={() => go()}
              style={{ padding: 12, border: '1px dashed #c7d2fe', borderRadius: 8, cursor: 'pointer', marginBottom: 12, background: '#f5f3ff' }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: '#4f46e5' }}>+ Start blank</div>
              <div style={{ fontSize: 12, color: '#6366f1' }}>Upload a fresh PDF and place fields from scratch</div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Or use a template
            </div>

            {loading ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading templates…</div>
            ) : templates.length === 0 ? (
              <div style={{ padding: 16, color: '#94a3b8', fontSize: 12, border: '1px dashed #e2e8f0', borderRadius: 6, textAlign: 'center' }}>
                No templates yet. Create one from the eSign Dashboard.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {templates.map((t) => (
                  <div key={t.id} onClick={() => go(t.id)}
                    style={{ padding: 10, border: '1px solid #e8edf2', borderRadius: 6, cursor: 'pointer', background: '#fff' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>{t.name}</div>
                    {(t.category || t.description) && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        {t.category && <span style={{ fontWeight: 600 }}>{t.category}</span>}
                        {t.category && t.description && ' · '}
                        {t.description?.slice(0, 80)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setOpen(false)}
                style={{ padding: '8px 16px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
