import { createContext } from 'react';

export type ToastTone = 'error' | 'warn' | 'info';

export interface ToastCtx {
  show: (message: string, tone?: ToastTone) => void;
}

export const ToastContext = createContext<ToastCtx | null>(null);
