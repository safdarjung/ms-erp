'use client';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Variant = 'success' | 'error' | 'info';
export type ToastInput = { title: string; description?: string; variant?: Variant };
type Toast = ToastInput & { id: number; variant: Variant };

const ToastCtx = createContext<(t: ToastInput) => void>(() => {});

/** Fire a transient toast. No-op outside a ToastProvider (safe on the login page). */
export const useToast = () => useContext(ToastCtx);

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
    setToasts((ts) => [...ts.slice(-3), { id, variant: 'info', ...t }]);
    setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="fixed z-[100] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-stretch sm:items-end pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`toast-in pointer-events-auto w-full sm:w-[22rem] rounded-lg border border-line border-l-[3px] ${TONE[t.variant]} bg-surface shadow-lg px-4 py-3 flex gap-3`}
          >
            <span className={`shrink-0 mt-0.5 font-bold ${TONE[t.variant].split(' ')[0]}`} aria-hidden>{ICON[t.variant]}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink">{t.title}</div>
              {t.description && <div className="text-xs text-muted mt-0.5 break-words">{t.description}</div>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-faint hover:text-ink text-sm leading-none -mr-1"
              aria-label="Dismiss"
            >✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
