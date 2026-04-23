/**
 * Phase 6.5 — Admin-side manager for client portal share links.
 *
 * Drop into ClientOrgDetail.tsx (scoped to one client_id) or any
 * facility detail page (scoped to one facility_id). Lets the admin:
 *   - See which share links currently exist for this scope
 *   - Generate a new link with an optional display label + expiry
 *   - Copy a link to clipboard
 *   - Revoke a link (soft delete — row stays for audit)
 */
import { useEffect, useRef, useState } from 'react';
import { clientPortalApi, ClientPortalToken } from '../../lib/api';

interface Props {
  /** Pass one or the other. Facility-scoped = single-facility view.
   *  Client-scoped = aggregates all facilities under the client. */
  facilityId?: string;
  clientId?: string;
  /** Shown in the header so the admin knows what scope this is for. */
  scopeLabel?: string;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function ClientPortalManager({ facilityId, clientId, scopeLabel }: Props) {
  const [tokens, setTokens] = useState<ClientPortalToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Phase 6.5 QA fix — use refs instead of controlled-input state for
  // the two new-link fields. QA reported that expiry was being silently
  // dropped on submit even though the UI visually accepted the value.
  // Root cause was almost certainly controlled-component + automation
  // mismatch: when a test tool sets `input.value = "..."` directly
  // via DOM, React's synthetic onChange never fires, so the state
  // setter never runs and `if (newExpires)` is false at submit time.
  // Reading via ref at submit time reads whatever the DOM currently
  // shows — works whether the value was set by a human, an automation
  // tool, or a browser autofill.
  const labelRef = useRef<HTMLInputElement | null>(null);
  const expiresRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const params: { facility_id?: string; client_id?: string } = {};
      if (facilityId) params.facility_id = facilityId;
      else if (clientId) params.client_id = clientId;
      const res = await clientPortalApi.listTokens(params);
      setTokens(res.data.tokens);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load portal links.');
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [facilityId, clientId]);

  async function createToken() {
    setCreating(true); setError(null);
    // Read directly from the DOM at submit time so automation tools
    // (or any code path that sets input.value without firing React's
    // synthetic onChange) still get captured.
    const labelValue = (labelRef.current?.value ?? '').trim();
    const expiresValue = (expiresRef.current?.value ?? '').trim();
    try {
      const body: { facility_id?: string; client_id?: string; display_label?: string; expires_at?: string } = {};
      if (facilityId) body.facility_id = facilityId;
      else if (clientId) body.client_id = clientId;
      if (labelValue) body.display_label = labelValue;
      if (expiresValue) body.expires_at = new Date(expiresValue).toISOString();
      // Keep the diagnostic log — pair with Railway's [client-portal]
      // backend logs to triangulate any future disappearance.
      console.log('[client-portal] creating token with body:', body, 'raw datetime-local:', expiresValue);
      const resp = await clientPortalApi.createToken(body);
      console.log('[client-portal] server created token:', resp.data);
      // Clear the form by resetting the DOM values.
      if (labelRef.current) labelRef.current.value = '';
      if (expiresRef.current) expiresRef.current.value = '';
      setShowNewForm(false);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to create link.');
    } finally { setCreating(false); }
  }

  async function revokeToken(id: string) {
    if (!confirm('Revoke this portal link? Anyone using it will immediately lose access.')) return;
    try { await clientPortalApi.revokeToken(id); await load(); }
    catch (e: any) { alert(e?.response?.data?.error ?? 'Revoke failed.'); }
  }

  function linkFor(t: ClientPortalToken): string {
    return `${window.location.origin}/client-view/${t.token}`;
  }

  async function copyLink(t: ClientPortalToken) {
    try {
      await navigator.clipboard.writeText(linkFor(t));
      setCopiedId(t.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { alert('Clipboard unavailable — copy manually.'); }
  }

  return (
    <div style={{ padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c' }}>🔗 Client Portal Links</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            Share-link access for {scopeLabel ?? (facilityId ? 'this facility' : 'this client')}. No login required.
          </div>
        </div>
        <button onClick={() => setShowNewForm(v => !v)}
          style={{ padding: '7px 14px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {showNewForm ? 'Cancel' : '+ New link'}
        </button>
      </div>

      {error && <div style={{ padding: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{error}</div>}

      {showNewForm && (
        <div style={{ padding: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 12, display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10 }}>
          <div>
            <label style={lbl}>Display label (optional)</label>
            <input ref={labelRef} style={field} placeholder="e.g. Xyrene Home Health" defaultValue="" />
          </div>
          <div>
            <label style={lbl}>Expires (optional)</label>
            <input ref={expiresRef} type="datetime-local" style={field} defaultValue="" />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={() => void createToken()} disabled={creating}
              style={{ padding: '7px 14px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', height: 32 }}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading ? <div style={{ padding: 16, color: '#64748b', fontSize: 12 }}>Loading…</div>
      : tokens.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12, color: '#94a3b8' }}>No links yet. Click "+ New link" to create one.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tokens.map(t => {
            const expired = t.expires_at && new Date(t.expires_at).getTime() < Date.now();
            const stateLabel = t.revoked ? 'REVOKED' : expired ? 'EXPIRED' : 'ACTIVE';
            const stateColor = t.revoked ? '#c62828' : expired ? '#e65100' : '#2e7d32';
            return (
              <div key={t.id} style={{ padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ padding: '2px 8px', borderRadius: 10, background: stateColor + '22', color: stateColor, fontSize: 10, fontWeight: 700, letterSpacing: 0.3 }}>{stateLabel}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1a2b3c' }}>
                    {t.display_label ?? t.client_name ?? t.facility_name ?? '(no label)'}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {linkFor(t)}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                    {t.access_count} view{t.access_count !== 1 ? 's' : ''}
                    {t.last_accessed_at && ` · last ${fmtDate(t.last_accessed_at)}`}
                    {t.expires_at && ` · expires ${fmtDate(t.expires_at)}`}
                  </div>
                </div>
                <button onClick={() => void copyLink(t)} disabled={t.revoked || !!expired}
                  style={{ padding: '5px 10px', background: copiedId === t.id ? '#dcfce7' : '#f1f5f9', color: copiedId === t.id ? '#166534' : '#475569', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  {copiedId === t.id ? '✓ Copied' : 'Copy'}
                </button>
                {!t.revoked && (
                  <button onClick={() => void revokeToken(t.id)}
                    style={{ padding: '5px 10px', background: '#fef2f2', color: '#c62828', border: '1px solid #fecaca', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    Revoke
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const field: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fff' };
const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.4 };
