import { useState, useEffect } from 'react';
import { useUser } from '../../lib/auth';
import { useRBAC } from '../../contexts/RBACContext';
import { useCan, usePermissions } from '../../contexts/PermissionsContext';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────
interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  role: string;
  lastSignInAt: number | null;
  createdAt: number;
  imageUrl: string;
}

// ─── Role badge config ────────────────────────────────────────
const ROLE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  ceo:         { label: 'CEO',         color: '#1e40af', bg: '#dbeafe' },
  admin:       { label: 'Admin',       color: '#6b21a8', bg: '#f3e8ff' },
  manager:     { label: 'Manager',     color: '#0f766e', bg: '#ccfbf1' },
  hr:          { label: 'HR',          color: '#b45309', bg: '#fef3c7' },
  recruiter:   { label: 'Recruiter',   color: '#0369a1', bg: '#e0f2fe' },
  coordinator: { label: 'Coordinator', color: '#4f46e5', bg: '#ede9fe' },
  viewer:      { label: 'Viewer',      color: '#64748b', bg: '#f1f5f9' },
};

const ALL_ROLES = ['ceo', 'admin', 'manager', 'hr', 'recruiter', 'coordinator', 'viewer'];

// ─── Permission matrix (for accordion) ───────────────────────
const ROLES_LIST = ['CEO', 'Manager', 'HR', 'Recruiter', 'Coordinator', 'Viewer'] as const;
const PERMISSION_MATRIX = [
  { feature: 'Dashboard',              access: [true,  true,  true,  true,  true,  true]  },
  { feature: 'Candidates & Pipeline',  access: [true,  true,  true,  true,  true,  false] },
  { feature: 'Credentialing',          access: [true,  true,  true,  false, true,  false] },
  { feature: 'Onboarding & eSign',     access: [true,  true,  true,  false, true,  false] },
  { feature: 'Staff Management',       access: [true,  true,  true,  false, false, false] },
  { feature: 'Placements',             access: [true,  true,  false, false, true,  false] },
  { feature: 'Clients & Business Dev', access: [true,  true,  false, false, false, false] },
  { feature: 'Reports & Analytics',    access: [true,  true,  true,  false, false, false] },
  { feature: 'AI Tools',               access: [true,  false, false, false, false, false] },
  { feature: 'User Management',        access: [true,  true,  false, false, false, false] },
  { feature: 'System Settings',        access: [true,  false, false, false, false, false] },
];

// ─── Helper: format relative time ────────────────────────────
function relativeTime(ts: number | null): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── RoleBadge component ──────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const b = ROLE_BADGES[role] ?? ROLE_BADGES.viewer;
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10,
      fontWeight: 700,
      padding: '2px 9px',
      borderRadius: 10,
      color: b.color,
      background: b.bg,
      textTransform: 'uppercase',
      letterSpacing: '0.4px',
    }}>
      {b.label}
    </span>
  );
}

// ─── Toast component ──────────────────────────────────────────
function Toast({ msg, ok, onClose }: { msg: string; ok: boolean; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: ok ? '#dcfce7' : '#fee2e2',
      border: `1px solid ${ok ? '#86efac' : '#fca5a5'}`,
      color: ok ? '#15803d' : '#b91c1c',
      borderRadius: 10, padding: '12px 20px',
      fontWeight: 600, fontSize: 13,
      boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span>{ok ? '✓' : '✗'}</span>
      <span>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16, lineHeight: 1, padding: '0 0 0 8px' }}>×</button>
    </div>
  );
}

// ─── Confirmation Popover ─────────────────────────────────────
interface ConfirmPopoverProps {
  member: TeamMember;
  newRole: string;
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}

function ConfirmPopover({ member, newRole, onConfirm, onCancel, saving }: ConfirmPopoverProps) {
  const b = ROLE_BADGES[newRole] ?? ROLE_BADGES.viewer;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, padding: 16,
    }} onClick={onCancel}>
      <div
        style={{
          background: '#fff', borderRadius: 14, padding: '24px 28px',
          maxWidth: 400, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 28, textAlign: 'center', marginBottom: 10 }}>🔐</div>
        <h3 style={{ textAlign: 'center', fontSize: 16, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>
          Change Role
        </h3>
        <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b', margin: '0 0 18px', lineHeight: 1.5 }}>
          Change <strong>{member.fullName}</strong>'s role to{' '}
          <span style={{ color: b.color, fontWeight: 700 }}>{b.label}</span>?
          <br />
          <span style={{ fontSize: 12, color: '#94a3b8' }}>This takes effect immediately.</span>
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 20px', background: '#f1f5f9', border: 'none',
              borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            style={{
              padding: '8px 20px', background: b.color, color: '#fff', border: 'none',
              borderRadius: 8, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: 13, opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Confirm Change'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────
export default function UserManagement() {
  const { user } = useUser();
  const { role } = useRBAC();
  const { reload: reloadPermissions } = usePermissions();
  // Permission gate: only users with admin.users.manage can change roles.
  // Other admins can view the list but the role dropdown becomes read-only.
  const canChangeRoles = useCan('admin.users.manage');

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);

  // Role change state
  const [pendingChange, setPendingChange] = useState<{ member: TeamMember; newRole: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Accordion
  const [showMatrix, setShowMatrix] = useState(false);

  // Fetch team members.
  // NOTE: previously used raw axios with a bare apiBase URL — that
  // bypassed the Clerk Bearer-token interceptor, so the request went out
  // unauthenticated and got redirected / rejected by the backend. Using
  // the shared `api` instance (lib/api.ts) re-uses that interceptor.
  useEffect(() => {
    const fetchUsers = async () => {
      setLoadingMembers(true);
      setMembersError(null);
      try {
        const res = await api.get<{ users: TeamMember[] }>('/users');
        setMembers(res.data.users ?? []);
      } catch (err: any) {
        setMembersError(err?.response?.data?.error ?? 'Failed to load team members.');
      } finally {
        setLoadingMembers(false);
      }
    };
    fetchUsers();
  }, []);

  // Confirm role change
  const handleConfirmChange = async () => {
    if (!pendingChange) return;
    setSaving(true);
    try {
      await api.patch(`/users/${pendingChange.member.id}`, {
        role: pendingChange.newRole,
      });
      setMembers((prev) =>
        prev.map((m) =>
          m.id === pendingChange.member.id ? { ...m, role: pendingChange.newRole } : m
        )
      );
      // If the admin changed their OWN role (rare but possible), or if anyone
      // changed the currently signed-in user's role, refetch the local
      // permissions context so the sidebar/route gates re-render against the
      // new permission set without requiring a logout.
      if (pendingChange.member.email === user?.primaryEmailAddress?.emailAddress) {
        await reloadPermissions();
      }
      setToast({ msg: `Role updated for ${pendingChange.member.fullName}.`, ok: true });
    } catch (err: any) {
      setToast({
        msg: err?.response?.data?.error ?? `Failed to update role for ${pendingChange.member.fullName}.`,
        ok: false,
      });
    } finally {
      setSaving(false);
      setPendingChange(null);
    }
  };

  const currentBadge = role ? ROLE_BADGES[role] : ROLE_BADGES.viewer;
  const fullName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.primaryEmailAddress?.emailAddress ||
    'User';

  return (
    <div className="page-wrapper" style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Page header */}
      <div className="page-header">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
          User Management
        </h1>
        <p style={{ fontSize: 13, color: '#64748b' }}>Manage team access and role assignments</p>
      </div>

      {/* Team Members */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', margin: 0 }}>Team Members</h3>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            {loadingMembers ? 'Loading…' : `${members.length} member${members.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        {membersError && (
          <div style={{ padding: '16px 20px', background: '#fee2e2', color: '#b91c1c', fontSize: 13, borderTop: '1px solid #fca5a5' }}>
            ⚠️ {membersError}
          </div>
        )}

        {loadingMembers ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Loading team members…
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 20px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Member</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current Role</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Last Active</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Change Role</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member, idx) => {
                  const isCurrentUser = member.email === user?.primaryEmailAddress?.emailAddress;
                  return (
                    <tr
                      key={member.id}
                      style={{
                        background: isCurrentUser ? '#fffbeb' : idx % 2 === 0 ? '#fff' : '#f8fafc',
                        borderBottom: '1px solid #f1f5f9',
                      }}
                    >
                      {/* Avatar + Name */}
                      <td style={{ padding: '12px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: '50%',
                            background: (ROLE_BADGES[member.role] ?? ROLE_BADGES.viewer).bg,
                            color: (ROLE_BADGES[member.role] ?? ROLE_BADGES.viewer).color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: 12, flexShrink: 0,
                          }}>
                            {member.fullName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 13 }}>
                              {member.fullName}
                              {isCurrentUser && (
                                <span style={{ marginLeft: 6, fontSize: 10, color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>You</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 12 }}>{member.email}</td>

                      {/* Role badge */}
                      <td style={{ padding: '12px 16px' }}>
                        <RoleBadge role={member.role} />
                      </td>

                      {/* Last active */}
                      <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 12 }}>
                        {relativeTime(member.lastSignInAt)}
                      </td>

                      {/* Change role — hidden unless user has admin.users.manage */}
                      <td style={{ padding: '12px 16px' }}>
                        {isCurrentUser ? (
                          <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>Contact admin</span>
                        ) : !canChangeRoles ? (
                          <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>View only</span>
                        ) : (
                          <select
                            value={member.role}
                            onChange={(e) => {
                              const newRole = e.target.value;
                              if (newRole !== member.role) {
                                setPendingChange({ member, newRole });
                              }
                            }}
                            style={{
                              padding: '5px 10px',
                              border: '1px solid #e2e8f0',
                              borderRadius: 7,
                              fontSize: 12,
                              color: '#1e293b',
                              background: '#fff',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                              outline: 'none',
                            }}
                          >
                            {ALL_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_BADGES[r]?.label ?? r}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loadingMembers && members.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                      No team members found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Your Account */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0 }}>Your Account</h3>
        </div>
        <div className="pnb" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: currentBadge?.bg ?? '#f1f5f9',
            color: currentBadge?.color ?? '#64748b',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 700, flexShrink: 0,
            border: `2px solid ${currentBadge?.color ?? '#e2e8f0'}`,
          }}>
            {fullName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{fullName}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{user?.primaryEmailAddress?.emailAddress}</div>
            {currentBadge && (
              <span style={{
                display: 'inline-block', marginTop: 6, fontSize: 10, fontWeight: 700,
                padding: '2px 10px', borderRadius: 10,
                color: currentBadge.color, background: currentBadge.bg,
                textTransform: 'uppercase', letterSpacing: '0.4px',
              }}>
                {currentBadge.label}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
            To change your own role, contact a system administrator.
          </div>
        </div>
      </div>

      {/* How to invite */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0 }}>Inviting New Team Members</h3>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{
            display: 'flex', gap: 14, alignItems: 'flex-start',
            background: '#f0f9ff', borderRadius: 10, padding: '14px 16px',
          }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>📩</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0369a1', marginBottom: 6 }}>
                Invitations are sent through the Clerk Dashboard
              </div>
              <ol style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
                <li>Go to your <strong>Clerk Dashboard</strong> → <em>User Management</em></li>
                <li>Click <strong>"Invite user"</strong> and enter their email address</li>
                <li>After they accept, return here and set their role using the <strong>Change Role</strong> dropdown above</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      {/* Role definitions accordion */}
      <div className="pn" style={{ marginBottom: 24 }}>
        <button
          onClick={() => setShowMatrix((v) => !v)}
          style={{
            width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
            📋 View Role Definitions & Permission Matrix
          </span>
          <span style={{ fontSize: 12, color: '#94a3b8', transition: 'transform 0.2s', display: 'inline-block', transform: showMatrix ? 'rotate(180deg)' : 'none' }}>▼</span>
        </button>

        {showMatrix && (
          <div style={{ borderTop: '1px solid #f1f5f9', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '10px 20px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e2e8f0', width: '32%' }}>Feature</th>
                  {ROLES_LIST.map((r) => {
                    const key = r.toLowerCase();
                    const b = ROLE_BADGES[key];
                    return (
                      <th key={r} style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, fontSize: 11, borderBottom: '1px solid #e2e8f0' }}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 8, color: b?.color ?? '#64748b', background: b?.bg ?? '#f1f5f9', textTransform: 'uppercase', letterSpacing: '0.4px', fontSize: 10 }}>{r}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_MATRIX.map((row, idx) => (
                  <tr key={row.feature} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ padding: '9px 20px', fontWeight: 500, color: '#1e293b', borderBottom: '1px solid #f1f5f9' }}>{row.feature}</td>
                    {row.access.map((allowed, i) => (
                      <td key={i} style={{ padding: '9px 12px', textAlign: 'center', borderBottom: '1px solid #f1f5f9' }}>
                        {allowed
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', background: '#dcfce7', color: '#16a34a', fontSize: 11, fontWeight: 700 }}>✓</span>
                          : <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', background: '#f1f5f9', color: '#cbd5e1', fontSize: 11 }}>—</span>
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation popover */}
      {pendingChange && (
        <ConfirmPopover
          member={pendingChange.member}
          newRole={pendingChange.newRole}
          onConfirm={handleConfirmChange}
          onCancel={() => setPendingChange(null)}
          saving={saving}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} ok={toast.ok} onClose={() => setToast(null)} />}
    </div>
  );
}
