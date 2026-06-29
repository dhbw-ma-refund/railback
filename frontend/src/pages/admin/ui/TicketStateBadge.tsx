import type { TicketState } from '../services/types/ticket';
import './TicketStateBadge.css';

type Tone = 'info' | 'warn' | 'success' | 'neutral' | 'danger';

const STATE_TONE: Record<TicketState, Tone> = {
  VALIDATING: 'info',
  READY: 'info',
  EMAIL_SENDING: 'info',
  PENDING_DB_PAYMENT: 'warn',
  APPROVED: 'success',
  COMPLETED: 'neutral',
  REJECTED: 'danger',
  INVALID: 'danger',
  EMAIL_FAILED: 'danger',
};

/**
 * Nine-state ticket badge. Palette mirrors BACKEND_CONTRACT.md tone mapping:
 * info → in-flight, warn → awaiting external action, success → approved,
 * neutral → completed, danger → terminal failure states.
 */
export function TicketStateBadge({ state }: { state: TicketState }) {
  const tone = STATE_TONE[state];
  return <span className={`rb-ticket-badge rb-ticket-badge--${tone}`}>{state}</span>;
}
