import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────
interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in red. Use for destructive actions. */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return fn;
}

// ─── Provider ───────────────────────────────────────────────────────────────
interface OpenState extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenState | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm: ConfirmFn = useCallback(
    (opts) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setOpen({ ...opts, resolve });
      }),
    []
  );

  const close = (result: boolean) => {
    if (resolveRef.current) resolveRef.current(result);
    resolveRef.current = null;
    setOpen(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {open && (
        <ConfirmDialog
          options={open}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  options,
  onCancel,
  onConfirm,
}: {
  options: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          width: 'min(92vw, 440px)',
          padding: 24,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: options.description ? 8 : 16 }}>
          {options.title}
        </div>
        {options.description && (
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20, lineHeight: 1.55 }}>
            {options.description}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: '#f1f5f9',
              color: '#334155',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            style={{
              background: options.destructive ? '#dc2626' : 'var(--pr, #2563eb)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {options.confirmLabel ?? (options.destructive ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
