/**
 * Widget picker modal — opens from the Dashboard header "Customize"
 * button. Shows a checkbox for each widget; on Save, persists to
 * localStorage and the dashboard re-renders with the new layout.
 */
import { useEffect, useState } from 'react';
import {
  DASHBOARD_WIDGETS,
  WidgetId,
  readWidgetPrefs,
  writeWidgetPrefs,
  resetWidgetPrefs,
} from '../lib/dashboardPrefs';

interface Props {
  userId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: (prefs: Record<WidgetId, boolean>) => void;
}

export default function DashboardCustomizeModal({ userId, open, onClose, onSaved }: Props) {
  const [prefs, setPrefs] = useState<Record<WidgetId, boolean>>(() => readWidgetPrefs(userId));

  // Re-read on open in case user changed them from another session / tab
  useEffect(() => {
    if (open) setPrefs(readWidgetPrefs(userId));
  }, [open, userId]);

  // Escape key closes
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (id: WidgetId) => {
    setPrefs(p => ({ ...p, [id]: !p[id] }));
  };

  const save = () => {
    writeWidgetPrefs(userId, prefs);
    onSaved(prefs);
    onClose();
  };

  const reset = () => {
    resetWidgetPrefs(userId);
    setPrefs(readWidgetPrefs(userId));
  };

  const countOn = Object.values(prefs).filter(Boolean).length;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1500, padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-labelledby="customize-title"
        style={{
          background: '#fff', borderRadius: 14, padding: 0,
          width: '100%', maxWidth: 500, maxHeight: '85vh', overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 id="customize-title" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a2b3c' }}>
              ⚙️ Customize dashboard
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: 'pointer', lineHeight: 1, padding: 4 }}
            >×</button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Toggle widgets on or off. Your choices are saved per browser.
          </p>
        </div>

        <div style={{ padding: '6px 0' }}>
          {DASHBOARD_WIDGETS.map(w => {
            const on = prefs[w.id];
            return (
              <label
                key={w.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '12px 24px', cursor: 'pointer',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(w.id)}
                  style={{ marginTop: 4, width: 16, height: 16, accentColor: '#6d28d9' }}
                />
                <span style={{ fontSize: 18, lineHeight: 1, marginTop: 2 }} aria-hidden>{w.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c' }}>{w.label}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{w.description}</div>
                </div>
              </label>
            );
          })}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <button
            onClick={reset}
            style={{ padding: '7px 14px', background: 'transparent', color: '#64748b', border: 'none', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
          >
            Reset to defaults
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{countOn} of {DASHBOARD_WIDGETS.length} on</span>
            <button
              onClick={onClose}
              style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              style={{ padding: '8px 18px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
