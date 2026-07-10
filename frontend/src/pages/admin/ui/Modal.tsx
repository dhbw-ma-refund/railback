import { useEffect, type ReactNode } from 'react';
import { Button } from '../ui-library';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryBusyLabel?: string;
  primaryBusy?: boolean;
}

/**
 * Bare-bones modal. Locks background scroll while open and closes on Escape
 * or scrim click. Callers pass the form body as `children` and wire the
 * primary button through `onPrimary` / `primaryBusy` / `primaryDisabled`.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryBusyLabel,
  primaryBusy,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="rb-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rb-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="rb-modal">
        <h2 id="rb-modal-title" className="rb-modal__title">
          {title}
        </h2>
        <div>{children}</div>
        <div className="rb-modal__actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Schließen
          </Button>
          {onPrimary && (
            <Button
              type="button"
              variant="primary"
              onClick={onPrimary}
              disabled={primaryDisabled || primaryBusy}
            >
              {primaryBusy ? (primaryBusyLabel ?? 'Speichert…') : (primaryLabel ?? 'OK')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
