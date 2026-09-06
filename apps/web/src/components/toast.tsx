'use client';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Variant = 'success' | 'error' | 'info';
export type ToastAction = { label: string; onClick: () => void };
export type ToastInput = {
  title: string;
  description?: string;
  variant?: Variant;
  /** Optional button inside the toast, e.g. "Undo". */
  action?: ToastAction;
};
type Toast = ToastInput & { id: number; variant: Variant };

const ToastCtx = createContext<(t: ToastInput) => void>(() => {});

/** Fire a toast. No-op outside a ToastProvider (safe on the login page). */
export const useToast = () => useContext(ToastCtx);

const AUTO_DISMISS_MS = 5000;
const AUTO_DISMISS_WITH_ACTION_MS = 8000;

const ICON: Record<Variant, string> = { success: '✓', error: '!', info: 'ℹ' };
const TONE: Record<Variant, string> = {
  success: 'text-ok border-l-ok',
  error: 'text-crit border-l-crit',
  info: 'text-steel border-l-steel',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const push = useCallback((t: ToastInput) => {
    const id = ++idRef.current;
    const toast: Toast = { variant: 'info', ...t, id };
    setToasts((ts) => [...ts.slice(-3), toast]);
    // Errors stay until the person dismisses them; good news clears itself.
    if (toast.variant !== 'error') {
      setTimeout(() => dismiss(id), toast.action ? AUTO_DISMISS_WITH_ACTION_MS : AUTO_DISMISS_MS);
    }
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="fixed z-[100] bottom-20 md:bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-stretch sm:items-end pointer-events-none"
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-in pointer-events-auto w-full sm:w-[22rem] rounded-lg border border-line border-l-[3px] ${TONE[t.variant]} bg-surface shadow-lg pl-4 pr-1 py-2 flex gap-3 items-start`}
          >
            <span className={`shrink-0 mt-2 font-bold ${TONE[t.variant].split(' ')[0]}`} aria-hidden>{ICON[t.variant]}</span>
            <div className="min-w-0 flex-1 py-1.5">
              <div className="text-sm font-medium text-ink">{t.title}</div>
              {t.description && <div className="text-xs text-muted mt-0.5 break-words">{t.description}</div>}
              {t.action && (
                <button
                  type="button"
                  onClick={() => { t.action?.onClick(); dismiss(t.id); }}
                  className="btn-ghost !py-1 text-xs mt-2"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-faint hover:text-ink rounded"
              aria-label="Dismiss"
            ><span aria-hidden>✕</span></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
