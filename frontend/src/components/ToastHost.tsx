import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────
export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
  ttl: number;
}

interface ToastContextValue {
  push: (message: string, opts?: { kind?: ToastKind; ttl?: number; action?: Toast['action'] }) => void;
  success: (msg: string, opts?: Omit<Parameters<ToastContextValue['push']>[1] & object, 'kind'>) => void;
  error:   (msg: string, opts?: Omit<Parameters<ToastContextValue['push']>[1] & object, 'kind'>) => void;
  info:    (msg: string, opts?: Omit<Parameters<ToastContextValue['push']>[1] & object, 'kind'>) => void;
  warning: (msg: string, opts?: Omit<Parameters<ToastContextValue['push']>[1] & object, 'kind'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

// ─── Provider ───────────────────────────────────────────────────────────────
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push: ToastContextValue['push'] = useCallback((message, opts) => {
    const id = ++idRef.current;
    const t: Toast = {
      id,
      kind: opts?.kind ?? 'info',
      message,
      action: opts?.action,
      ttl: opts?.ttl ?? 5000,
    };
    setToasts((prev) => [...prev, t]);
    if (t.ttl > 0) window.setTimeout(() => remove(id), t.ttl);
  }, [remove]);

  const api: ToastContextValue = {
    push,
    success: (msg, opts) => push(msg, { ...(opts ?? {}), kind: 'success' }),
    error:   (msg, opts) => push(msg, { ...(opts ?? {}), kind: 'error' }),
    info:    (msg, opts) => push(msg, { ...(opts ?? {}), kind: 'info' }),
    warning: (msg, opts) => push(msg, { ...(opts ?? {}), kind: 'warning' }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

// ─── Viewport (fixed bottom-right stack) ────────────────────────────────────
function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 420,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

const KIND_STYLE: Record<ToastKind, { bg: string; fg: string; border: string; icon: string }> = {
  success: { bg: '#ecfdf5', fg: '#065f46', border: '#6ee7b7', icon: '✓' },
  error:   { bg: '#fef2f2', fg: '#991b1b', border: '#fca5a5', icon: '✕' },
  info:    { bg: '#eff6ff', fg: '#1e40af', border: '#93c5fd', icon: 'ℹ' },
  warning: { bg: '#fffbeb', fg: '#92400e', border: '#fcd34d', icon: '⚠' },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => { setEntered(true); }, []);

  const s = KIND_STYLE[toast.kind];
  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
        fontSize: 13,
        lineHeight: 1.5,
        transform: entered ? 'translateX(0)' : 'translateX(20px)',
        opacity: entered ? 1 : 0,
        transition: 'transform 0.2s ease, opacity 0.2s ease',
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 700 }}>{s.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ wordBreak: 'break-word' }}>{toast.message}</div>
        {toast.action && (
          <button
            onClick={() => {
              toast.action!.onClick();
              onDismiss();
            }}
            style={{
              marginTop: 6,
              background: 'transparent',
              border: 'none',
              color: s.fg,
              fontWeight: 700,
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: 0,
              fontSize: 12,
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: 'transparent',
          border: 'none',
          color: s.fg,
          opacity: 0.6,
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
