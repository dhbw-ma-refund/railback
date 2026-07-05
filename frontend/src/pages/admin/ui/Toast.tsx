import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './Toast.css';

export type ToastTone = 'error' | 'warn' | 'info';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastCtx {
  show: (message: string, tone?: ToastTone) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

const DISMISS_MS = 4500;

/**
 * Provides a global toast queue for transient error/status messages. Timers
 * are real DOM timers (this is user-visible latency, not test-controlled
 * scheduling), each toast is dismissed after 4.5 s.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, tone: ToastTone = 'error') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DISMISS_MS);
  }, []);

  const value = useMemo<ToastCtx>(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="rb-toast-viewport" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`rb-toast rb-toast--${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const value = useContext(Ctx);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
