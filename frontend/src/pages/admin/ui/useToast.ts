import { useContext } from 'react';
import { ToastContext, type ToastCtx } from './ToastContext';

export function useToast(): ToastCtx {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
