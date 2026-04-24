/**
 * My Permissions — self-service page showing the signed-in user exactly
 * what they have access to.
 *
 * Accessible to every authed user. Great for:
 *   - "Why can't I click this button?" — see if the permission is held.
 *   - "What can I do?" — the full list of categories + perms, with the
 *     ones you have checked.
 *   - "I need access to X" — a request button emails the admin.
 */
import { useEffect, useState } from 'react';
import { usePermissions } from '../../contexts/PermissionsContext';
import { rbacApi, PermissionDef } from '../../lib/rbacApi';
import { useToast } from '../../components/ToastHost';

interface Category {
  key: string;
  label: string;
}

export default function MyPermissions() {
  const toast = useToast();
  const { permissions, roles, simulatedRole, isLoading } = usePermissions();
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void rbacApi.catalog().then(r => {
      setCatalog(r.data.permissions);
      setCategories(r.data.categories);
    }).catch(err => toast.error(err?.response?.data?.error ?? 'Failed to load permission catalog'));
  }, [toast]);

  const toggleCategory = (cat: string) => {
    setExpanded(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const byCategory = categories.map(c => {
    const perms = catalog.filter(p => p.category === c.key);
    const granted = perms.filter(p => permissions.has(p.key)).length;
    return { ...c, perms, granted };
  }).filter(c => c.perms.length > 0);

  const requestPermission = (permKey: string, label: string) => {
    const subject = encodeURIComponent(`FNS AI: Permission request — ${label}`);
    const body = encodeURIComponent(
      `Hi,\n\nI'm requesting access to the permission "${label}" (${permKey}).\n\nBusiness reason:\n[describe why]\n\nThanks.`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>🔑 My Permissions</h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
          The complete list of what you can and can't do. Use this to understand why a page or button is hidden.
        </p>
      </div>

      {/* Current roles */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c', margin: '0 0 8px' }}>
          {simulatedRole ? '👁️ Simulating role' : 'Your roles'}
        </h3>
        {simulatedRole && (
          <p style={{ fontSize: 12, color: '#b45309', margin: '0 0 8px' }}>
            You're in View-as-Role mode. This page reflects what "<code>{simulatedRole}</code>" can see, not your actual access.
          </p>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {roles.length === 0 ? (
            <span style={{ fontSize: 12, color: '#94a3b8' }}>No roles assigned. Contact your admin.</span>
          ) : (
            roles.map(r => (
              <span key={r} style={{ fontSize: 11, padding: '3px 10px', background: '#f5f3ff', color: '#6d28d9', borderRadius: 999, fontWeight: 600, border: '1px solid #ddd6fe' }}>{r}</span>
            ))
          )}
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <Stat label="Total permissions" value={catalog.length} color="#64748b" />
        <Stat label="Granted to you" value={permissions.size} color="#16a34a" />
        <Stat label="Not granted" value={catalog.length - permissions.size} color="#94a3b8" />
      </div>

      {/* Category accordion */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {byCategory.map(cat => {
          const isOpen = expanded[cat.key] ?? false;
          const fullAccess = cat.granted === cat.perms.length;
          const noAccess = cat.granted === 0;
          return (
            <div key={cat.key} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <button
                onClick={() => toggleCategory(cat.key)}
                style={{
                  width: '100%', padding: '12px 16px', background: '#f8fafc',
                  border: 'none', borderBottom: isOpen ? '1px solid #e2e8f0' : 'none',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>{cat.label}</span>
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
                    background: fullAccess ? '#dcfce7' : noAccess ? '#fee2e2' : '#fef3c7',
                    color: fullAccess ? '#15803d' : noAccess ? '#991b1b' : '#b45309',
                  }}>
                    {cat.granted}/{cat.perms.length} {fullAccess ? 'FULL' : noAccess ? 'NONE' : 'PARTIAL'}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{isOpen ? '▼' : '▶'}</span>
              </button>
              {isOpen && (
                <div>
                  {cat.perms.map(p => {
                    const has = permissions.has(p.key);
                    return (
                      <div key={p.key} style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span style={{
                          fontSize: 14, lineHeight: 1, marginTop: 2,
                          color: has ? '#16a34a' : '#cbd5e1',
                        }}>{has ? '✓' : '✗'}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: has ? '#1a2b3c' : '#94a3b8' }}>{p.label}</span>
                            <RiskBadge risk={p.risk_level} />
                            <code style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{p.key}</code>
                          </div>
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{p.description}</div>
                        </div>
                        {!has && (
                          <button
                            onClick={() => requestPermission(p.key, p.label)}
                            style={{
                              padding: '4px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0',
                              borderRadius: 6, fontSize: 11, fontWeight: 600, color: '#475569', cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                            title="Request this permission from your admin"
                          >
                            Request
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 20, padding: 14, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, fontSize: 12, color: '#0c4a6e' }}>
        <strong>Need more access?</strong> Click Request next to any permission to email your admin a pre-filled message. Critical permissions require a 20-character business justification and an admin other than yourself to grant them.
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
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
