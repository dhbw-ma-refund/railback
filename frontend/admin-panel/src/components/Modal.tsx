import { JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import styles from './ui.module.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
  footer?: JSX.Element;
}

export function Modal(props: ModalProps) {
  return (
    <Show when={props.open}>
      <Portal>
        <div
          class={styles.modal_backdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) props.onClose();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div class={styles.modal_card} role="document">
            <Show when={props.title}>
              <div class={styles.modal_head}>
                <h2>{props.title}</h2>
                <button
                  class={styles.modal_close}
                  onClick={props.onClose}
                  aria-label="Close"
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                </button>
              </div>
            </Show>
            <div class={styles.modal_body}>{props.children}</div>
            <Show when={props.footer}>
              <div class={styles.modal_foot}>{props.footer}</div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
