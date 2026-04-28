/**
 * Roles & Permissions — admin page for managing RBAC roles.
 *
 * Left pane: list of all roles (system + custom).
 * Right pane: for the selected role, a permission matrix grouped by category
 * with checkboxes. Changes are saved via "Save" button.
 *
 * Actions:
 *   - Create custom role (from scratch or by duplicating)
 *   - Edit role label/description (custom only)
 *   - Edit role permission set (custom only — system roles are defined in code)
 *   - Delete custom role
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rbacApi, PermissionDef, RoleSummary } from '../../lib/rbacApi';
import { useToast } from '../../components/ToastHost';
import { useConfirm } from '../../components/ConfirmHost';
import { useCan } from '../../contexts/PermissionsContext';

export default function RolesPermissions() {
  const toast = useToast();
  const confirm = useConfirm();
  const canCreateCustom = useCan('admin.roles.create_custom');
  const canEditPerms = useCan('admin.permissions.edit');

  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [categories, setCategories] = useState<{ key: string; label: string }[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  const [originalPerms, setOriginalPerms] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, r] = await Promise.all([rbacApi.catalog(), rbacApi.listRoles()]);
      setCatalog(cat.data.permissions);
      setCategories(cat.data.categories);
      setRoles(r.data.roles);
      if (!selectedRoleId && r.data.roles.length > 0) {
        setSelectedRoleId(r.data.roles[0].id);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to load roles.');
    } finally {
      setLoading(false);
    }
  }, [selectedRoleId, toast]);

  useEffect(() => { void load(); }, [load]);

  // When the selected role changes, load its permission set
  useEffect(() => {
    if (!selectedRoleId) return;
    void rbacApi.getRole(selectedRoleId).then(res => {
      const s = new Set(res.data.permissions);
      setSelectedPerms(s);
      setOriginalPerms(new Set(s));
    }).catch(err => toast.error(err?.response?.data?.error ?? 'Failed to load role detail.'));
  }, [selectedRoleId, toast]);

  const selectedRole = roles.find(r => r.id === selectedRoleId) ?? null;
  const isDirty = useMemo(() => {
    if (selectedPerms.size !== originalPerms.size) return true;
    for (const p of selectedPerms) if (!originalPerms.has(p)) return true;
    return false;
  }, [selectedPerms, originalPerms]);

  const togglePerm = (key: string) => {
    if (!selectedRole || selectedRole.is_system || !canEditPerms) return;
    const next = new Set(selectedPerms);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelectedPerms(next);
  };

  const save = async () => {
    if (!selectedRole || !isDirty) return;
    setSaving(true);
    try {
      const result = await rbacApi.updateRolePermissions(selectedRole.id, Array.from(selectedPerms));
      toast.success(`Saved: ${result.data.granted} granted, ${result.data.revoked} revoked.`);
      setOriginalPerms(new Set(selectedPerms));
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const duplicateRole = async () => {
    if (!selectedRole) return;
    const newKey = prompt('New role key (lowercase, letters/numbers/underscores only):', `${selectedRole.key}_copy`);
    if (!newKey) return;
    const newLabel = prompt('Display name:', `${selectedRole.label} (copy)`);
    if (!newLabel) return;
    try {
      const res = await rbacApi.createRole({
        key: newKey,
        label: newLabel,
        description: `Copy of ${selectedRole.label}`,
        based_on_role: selectedRole.id,
      });
      toast.success(`Created ${newLabel}`);
      await load();
      setSelectedRoleId(res.data.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to duplicate.');
    }
  };

  const deleteRole = async () => {
    if (!selectedRole || selectedRole.is_system) return;
    const ok = await confirm({
      title: 'Delete role?',
      description: `This will permanently delete "${selectedRole.label}" and remove it from all users who have it. Continue?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await rbacApi.deleteRole(selectedRole.id);
      toast.success('Role deleted.');
      setSelectedRoleId(null);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Delete failed.');
    }
  };

  const permsByCategory = useMemo(() => {
    const map = new Map<string, PermissionDef[]>();
    for (const p of catalog) {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category)!.push(p);
    }
    return map;
  }, [catalog]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading roles…</div>;

  return (
    <div style={{ display: 'flex', gap: 20, padding: '24px 32px', maxWidth: 1400, margin: '0 auto', minHeight: 'calc(100vh - 60px)' }}>

      {/* Left: role list */}
      <div style={{ width: 280, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>Roles</h2>
          {canCreateCustom && (
            <button onClick={() => setShowCreate(true)} style={primaryBtn}>+ New</button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {roles.map(r => (
            <button
              key={r.id}
              onClick={() => setSelectedRoleId(r.id)}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                background: r.id === selectedRoleId ? '#f5f3ff' : '#fff',
                border: `1px solid ${r.id === selectedRoleId ? '#6d28d9' : '#e2e8f0'}`,
                borderLeft: `3px solid ${r.id === selectedRoleId ? '#6d28d9' : 'transparent'}`,
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>{r.label}</span>
                {r.is_system && <span style={{ fontSize: 9, padding: '1px 6px', background: '#e0f2fe', color: '#0369a1', borderRadius: 4, fontWeight: 700 }}>SYS</span>}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {r.perm_count} permissions · {r.user_count} users
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: role detail + permissions matrix */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selectedRole ? (
          <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>Select a role to view its permissions.</div>
        ) : (
          <>
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#6d28d9', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {selectedRole.is_system ? 'System role' : 'Custom role'} · {selectedRole.key}
                  </div>
                  <h1 style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 700, color: '#1a2b3c' }}>{selectedRole.label}</h1>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={duplicateRole} style={ghostBtn} disabled={!canCreateCustom}>Duplicate</button>
                  {!selectedRole.is_system && (
                    <button onClick={deleteRole} style={{ ...ghostBtn, color: '#c62828', borderColor: '#fecaca' }}>Delete</button>
                  )}
                </div>
              </div>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>{selectedRole.description || 'No description.'}</p>
              {selectedRole.is_system && (
                <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, fontSize: 12, color: '#713f12' }}>
                  System roles are defined in <code>backend/src/services/permissions/catalog.ts</code>. To customize, <button style={{ color: '#6d28d9', background: 'none', border: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }} onClick={duplicateRole}>duplicate this role</button>.
                </div>
              )}
            </div>

            {/* Permission matrix */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {categories.map(cat => {
                const perms = permsByCategory.get(cat.key) ?? [];
                if (perms.length === 0) return null;
                return (
                  <div key={cat.key} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 13, fontWeight: 700, color: '#334155' }}>
                      {cat.label} <span style={{ fontWeight: 400, color: '#64748b' }}>({perms.filter(p => selectedPerms.has(p.key)).length}/{perms.length})</span>
                    </div>
                    <div>
                      {perms.map(p => {
                        const checked = selectedPerms.has(p.key);
                        return (
                          <label
                            key={p.key}
                            style={{
                              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 16px',
                              cursor: (selectedRole.is_system || !canEditPerms) ? 'not-allowed' : 'pointer',
                              borderBottom: '1px solid #f1f5f9',
                              opacity: (selectedRole.is_system || !canEditPerms) ? 0.85 : 1,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePerm(p.key)}
                              disabled={selectedRole.is_system || !canEditPerms}
                              style={{ marginTop: 2, accentColor: '#6d28d9' }}
                            />
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>{p.label}</span>
                                <RiskBadge risk={p.risk} />
                                <code style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{p.key}</code>
                              </div>
                              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{p.description}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Save bar */}
            {isDirty && !selectedRole.is_system && (
              <div style={{ position: 'sticky', bottom: 16, marginTop: 16, padding: 12, background: '#1e293b', color: '#fff', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}>
                <span style={{ fontSize: 13 }}>{selectedPerms.size} permissions selected. Unsaved changes.</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setSelectedPerms(new Set(originalPerms))} style={{ ...ghostBtn, background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }}>Discard</button>
                  <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreateRoleModal
          roles={roles}
          onClose={() => setShowCreate(false)}
          onCreated={async (id) => { setShowCreate(false); await load(); setSelectedRoleId(id); }}
        />
      )}
    </div>
  );
}

function RiskBadge({ risk }: { risk: 'low' | 'medium' | 'high' | 'critical' }) {
  const map = {
    low:      { bg: '#f1f5f9', color: '#64748b' },
    medium:   { bg: '#fef3c7', color: '#b45309' },
    high:     { bg: '#ffedd5', color: '#c2410c' },
    critical: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[risk];
  return (
    <span style={{ fontSize: 9, padding: '1px 6px', background: s.bg, color: s.color, borderRadius: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {risk}
    </span>
  );
}

function CreateRoleModal({ roles, onClose, onCreated }: { roles: RoleSummary[]; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [basedOn, setBasedOn] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!key || !label) { toast.error('Key and label are required'); return; }
    setSaving(true);
    try {
      const res = await rbacApi.createRole({ key, label, description: description || undefined, based_on_role: basedOn || undefined });
      toast.success(`Created role ${label}`);
      onCreated(res.data.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Create failed');
    } finally { setSaving(false); }
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1a2b3c', margin: '0 0 10px' }}>New custom role</h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px' }}>Optionally base it on an existing role to copy its permission set.</p>
        <label style={lbl}>Role key</label>
        <input value={key} onChange={e => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="e.g. bids_team" style={field} />
        <label style={lbl}>Display name</label>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Bids Team" style={field} />
        <label style={lbl}>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this role do?" style={{ ...field, minHeight: 60 }} />
        <label style={lbl}>Based on (optional)</label>
        <select value={basedOn} onChange={e => setBasedOn(e.target.value)} style={field}>
          <option value="">— Start from scratch —</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={save} disabled={saving || !key || !label} style={primaryBtn}>{saving ? 'Creating…' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal: React.CSSProperties = { background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
const field: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', marginBottom: 10 };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
const primaryBtn: React.CSSProperties = { padding: '7px 14px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 600, fontSize: 12, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '7px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer' };
