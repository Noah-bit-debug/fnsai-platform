/**
 * ViewAsRoleBanner — renders a sticky yellow banner at the top of the
 * screen whenever the current user is simulating another role via
 * View-as-Role. Also offers a dropdown to start a simulation.
 *
 * Rendered near the top of App.tsx so it's always visible.
 */
import { useEffect, useState } from 'react';
import { usePermissions } from '../../contexts/PermissionsContext';
import { rbacApi, RoleSummary } from '../../lib/rbacApi';
import { useCan } from '../../contexts/PermissionsContext';

export default function ViewAsRoleBanner() {
  const { simulatedRole, endSimulation, startSimulation } = usePermissions();
  const canSimulate = useCan('admin.simulate.view_as_role');
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!canSimulate) return;
    void rbacApi.listRoles().then(r => setRoles(r.data.roles)).catch(() => { /* silent */ });
  }, [canSimulate]);

  // If not simulating, just render the hidden toggle for admins
  if (!simulatedRole) {
    if (!canSimulate) return null;
    return (
      <div style={{ position: 'fixed', bottom: 16, left: 16, zIndex: 500 }}>
        <button
          onClick={() => setPickerOpen(!pickerOpen)}
          style={{
            padding: '8px 14px', background: '#1e293b', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          title="Preview the app as a different role for testing"
        >
          👁 View as…
        </button>
        {pickerOpen && (
          <div style={{ position: 'absolute', bottom: 40, left: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.15)', padding: 8, minWidth: 220, maxHeight: 300, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, padding: '6px 10px' }}>Pick a role to preview as</div>
            {roles.map(r => (
              <button
                key={r.id}
                onClick={async () => { setPickerOpen(false); await startSimulation(r.key); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'transparent', border: 'none', fontSize: 13, color: '#334155', cursor: 'pointer', borderRadius: 6 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f5f3ff')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {r.label} <span style={{ color: '#94a3b8', fontSize: 11 }}>({r.key})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // In simulation — show the yellow banner
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 1000,
      background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
      color: '#1a2b3c',
      padding: '10px 20px',
      fontSize: 13, fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    }}>
      <div>
        <span style={{ fontSize: 16 }}>👁️</span> You are viewing the app as role <code style={{ background: 'rgba(0,0,0,0.15)', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' }}>{simulatedRole}</code>. Your own permissions are paused — all actions use this role's access.
      </div>
      <button
        onClick={() => void endSimulation()}
        style={{ padding: '6px 14px', background: '#1a2b3c', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
      >
        Exit simulation
      </button>
    </div>
  );
}
