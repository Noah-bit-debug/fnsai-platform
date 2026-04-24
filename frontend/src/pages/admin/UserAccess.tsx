/**
 * User Access — per-user role assignments + permission overrides.
 *
 * Pick a user from the left; see effective permissions, role memberships,
 * and active overrides on the right. Admins can assign/remove roles,
 * grant/deny individual overrides (with optional expiry), and see the
 * resolution chain (permission X comes from role Y).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usersApi, OrgUser } from '../../lib/api';
import { rbacApi, PermissionDef, RoleSummary, UserAccess } from '../../lib/rbacApi';
import { useToast } from '../../components/ToastHost';
import { useConfirm } from '../../components/ConfirmHost';
import { useCan } from '../../contexts/PermissionsContext';

export default function UserAccessPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = useCan('admin.users.manage');
  const canOverride = useCan('admin.overrides.grant');

  const [users, setUsers] = useState<OrgUser[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGrant, setShowGrant] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r, c] = await Promise.all([usersApi.list(), rbacApi.listRoles(), rbacApi.catalog()]);
      setUsers(u.data.users);
      setRoles(r.data.roles);
      setCatalog(c.data.permissions);
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedUserId) { setAccess(null); return; }
    void rbacApi.userPermissions(selectedUserId).then(r => setAccess(r.data))
      .catch(err => toast.error(err?.response?.data?.error ?? 'Failed to load user access.'));
  }, [selectedUserId, toast]);

  const filtered = useMemo(() => {
    if (!filter) return users;
    const q = filter.toLowerCase();
    return users.filter(u =>
      (u.name ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q) ||
      (u.role ?? '').toLowerCase().includes(q)
    );
  }, [users, filter]);

  const selectedUser = users.find(u => u.id === selectedUserId);

  const toggleRole = async (roleId: string, currentlyAssigned: boolean) => {
    if (!selectedUserId || !canManage) return;
    try {
      if (currentlyAssigned) {
        await rbacApi.removeUserRole(selectedUserId, roleId);
      } else {
        await rbacApi.assignUserRole(selectedUserId, roleId);
      }
      const r = await rbacApi.userPermissions(selectedUserId);
      setAccess(r.data);
      toast.success(currentlyAssigned ? 'Role removed' : 'Role assigned');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Action failed');
    }
  };

  const revokeOverride = async (overrideId: string, permLabel: string) => {
    if (!selectedUserId || !canOverride) return;
    const ok = await confirm({
      title: 'Revoke override?',
      description: `Remove the override for "${permLabel}"?`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
    try {
      await rbacApi.revokeUserOverride(selectedUserId, overrideId);
      const r = await rbacApi.userPermissions(selectedUserId);
      setAccess(r.data);
      toast.success('Override revoked');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to revoke');
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading users…</div>;

  return (
    <div style={{ display: 'flex', gap: 20, padding: '24px 32px', maxWidth: 1400, margin: '0 auto', minHeight: 'calc(100vh - 60px)' }}>
      {/* Left: user list */}
      <div style={{ width: 320, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', margin: '0 0 8px' }}>Users ({users.length})</h2>
        <input
          type="search"
          placeholder="Filter by name, email, role…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1.5px solid #e2e8f0', borderRadius: 8, marginBottom: 10, boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
          {filtered.map(u => (
            <button
              key={u.id}
              onClick={() => setSelectedUserId(u.id)}
              style={{
                textAlign: 'left', padding: '10px 12px',
                background: u.id === selectedUserId ? '#f5f3ff' : '#fff',
                border: `1px solid ${u.id === selectedUserId ? '#6d28d9' : '#e2e8f0'}`,
                borderLeft: `3px solid ${u.id === selectedUserId ? '#6d28d9' : 'transparent'}`,
                borderRadius: 8, cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>{u.name}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{u.email}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{u.role}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: user access detail */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selectedUser ? (
          <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>Select a user to manage their access.</div>
        ) : !access ? (
          <div style={{ padding: 40, color: '#64748b' }}>Loading access…</div>
        ) : (
          <>
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20, marginBottom: 16 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1a2b3c' }}>{selectedUser.name ?? selectedUser.email}</h1>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>{selectedUser.email}</p>
              <div style={{ marginTop: 12, display: 'flex', gap: 12, fontSize: 12, color: '#475569' }}>
                <span><strong>{access.effective_permissions.length}</strong> effective permissions</span>
                <span><strong>{access.role_keys.length}</strong> roles</span>
                <span><strong>{access.overrides.length}</strong> overrides</span>
              </div>
            </div>

            {/* Roles */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c', margin: '0 0 10px' }}>Roles</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {roles.map(r => {
                  const assigned = access.role_keys.includes(r.key);
                  return (
                    <button
                      key={r.id}
                      onClick={() => toggleRole(r.id, assigned)}
                      disabled={!canManage}
                      style={{
                        padding: '6px 12px', borderRadius: 999,
                        background: assigned ? '#6d28d9' : '#fff',
                        color: assigned ? '#fff' : '#475569',
                        border: `1px solid ${assigned ? '#6d28d9' : '#e2e8f0'}`,
                        fontSize: 12, fontWeight: 600, cursor: canManage ? 'pointer' : 'default',
                      }}
                      title={assigned ? 'Click to remove' : 'Click to assign'}
                    >
                      {assigned ? '✓ ' : ''}{r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Overrides */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>User-specific overrides</h3>
                {canOverride && (
                  <button onClick={() => setShowGrant(true)} style={primaryBtn}>+ Add override</button>
                )}
              </div>
              {access.overrides.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94a3b8', padding: '12px 0' }}>No overrides. User gets exactly what their role(s) grant.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {access.overrides.map(o => {
                    const def = catalog.find(p => p.key === o.permission_key);
                    return (
                      <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: o.effect === 'grant' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${o.effect === 'grant' ? '#bbf7d0' : '#fecaca'}`, borderRadius: 6 }}>
                        <span style={{ fontSize: 10, padding: '2px 6px', background: o.effect === 'grant' ? '#16a34a' : '#dc2626', color: '#fff', borderRadius: 4, fontWeight: 700, textTransform: 'uppercase' }}>{o.effect}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: '#1a2b3c' }}>{def?.label ?? o.permission_key}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            {o.reason && <>{o.reason} · </>}
                            {o.expires_at ? `expires ${new Date(o.expires_at).toLocaleDateString()}` : 'permanent'}
                            {o.created_by_name && ` · by ${o.created_by_name}`}
                          </div>
                        </div>
                        {canOverride && (
                          <button onClick={() => revokeOverride(o.id, def?.label ?? o.permission_key)} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 18, cursor: 'pointer' }} title="Revoke">×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Effective permissions preview */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c', margin: '0 0 10px' }}>Effective permissions ({access.effective_permissions.length})</h3>
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6d28d9' }}>Show all</summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {access.effective_permissions.sort().map(p => (
                    <code key={p} style={{ fontSize: 10, padding: '2px 6px', background: '#f1f5f9', color: '#334155', borderRadius: 4, fontFamily: 'monospace' }}>{p}</code>
                  ))}
                </div>
              </details>
            </div>
          </>
        )}
      </div>

      {showGrant && selectedUserId && (
        <AddOverrideModal
          userId={selectedUserId}
          catalog={catalog}
          onClose={() => setShowGrant(false)}
          onSaved={async () => {
            setShowGrant(false);
            const r = await rbacApi.userPermissions(selectedUserId);
            setAccess(r.data);
          }}
        />
      )}
    </div>
  );
}

function AddOverrideModal({ userId, catalog, onClose, onSaved }: { userId: string; catalog: PermissionDef[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [permKey, setPermKey] = useState('');
  const [effect, setEffect] = useState<'grant' | 'deny'>('grant');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const perm = catalog.find(p => p.key === permKey);
  const needsJustification = perm?.risk_level === 'critical';

  const save = async () => {
    if (!permKey) { toast.error('Pick a permission'); return; }
    if (needsJustification && reason.length < 20) {
      toast.error('Critical permissions require a written justification of at least 20 characters.');
      return;
    }
    setSaving(true);
    try {
      await rbacApi.grantUserOverride(userId, {
        permission_key: permKey,
        effect,
        reason: reason || undefined,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      toast.success(`${effect === 'grant' ? 'Granted' : 'Denied'} ${perm?.label}`);
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to save override');
    } finally { setSaving(false); }
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...modal, maxWidth: 520 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1a2b3c', margin: '0 0 14px' }}>Add user override</h3>
        <label style={lbl}>Permission</label>
        <select value={permKey} onChange={e => setPermKey(e.target.value)} style={field}>
          <option value="">— Pick a permission —</option>
          {catalog.map(p => <option key={p.key} value={p.key}>{p.label} ({p.key}) · {p.risk_level}</option>)}
        </select>
        <label style={lbl}>Effect</label>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="radio" name="effect" checked={effect === 'grant'} onChange={() => setEffect('grant')} /> Grant (add this permission)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="radio" name="effect" checked={effect === 'deny'} onChange={() => setEffect('deny')} /> Deny (block this permission)
          </label>
        </div>
        <label style={lbl}>Reason {needsJustification && <span style={{ color: '#dc2626' }}>(required for critical perms, min 20 chars)</span>}</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder={needsJustification ? 'Business justification required' : 'Optional'} style={{ ...field, minHeight: 60 }} />
        <label style={lbl}>Expires (optional)</label>
        <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} style={field} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={save} disabled={saving || !permKey} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal: React.CSSProperties = { background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
const field: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', marginBottom: 10 };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
const primaryBtn: React.CSSProperties = { padding: '7px 14px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 600, fontSize: 12, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '7px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer' };
