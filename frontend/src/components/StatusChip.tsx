import './StatusChip.css';

// Mirrors backend TicketState enum from openapi.yaml.
// Kept as a string union so we don't couple to a shared type today.
export type TicketState =
  | 'VALIDATING'
  | 'READY'
  | 'EMAIL_SENDING'
  | 'PENDING_DB_PAYMENT'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'EMAIL_FAILED'
  | 'INVALID';

type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

const STATE_TO_TONE: Record<TicketState, Tone> = {
  VALIDATING: 'info',
  READY: 'warning',
  EMAIL_SENDING: 'info',
  PENDING_DB_PAYMENT: 'info',
  APPROVED: 'success',
  COMPLETED: 'success',
  REJECTED: 'danger',
  EMAIL_FAILED: 'danger',
  INVALID: 'neutral',
};

// Short German labels; long enough to be readable but fit on one line in a card header.
const STATE_LABELS_DE: Record<TicketState, string> = {
  VALIDATING: 'Wird geprüft',
  READY: 'Bereit zum Absenden',
  EMAIL_SENDING: 'Wird versendet',
  PENDING_DB_PAYMENT: 'Wartet auf DB',
  APPROVED: 'Bewilligt',
  COMPLETED: 'Abgeschlossen',
  REJECTED: 'Abgelehnt',
  EMAIL_FAILED: 'Versand fehlgeschlagen',
  INVALID: 'Gelöscht',
};

const STATE_LABELS_EN: Record<TicketState, string> = {
  VALIDATING: 'Checking',
  READY: 'Ready to submit',
  EMAIL_SENDING: 'Sending',
  PENDING_DB_PAYMENT: 'Awaiting DB',
  APPROVED: 'Approved',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  EMAIL_FAILED: 'Send failed',
  INVALID: 'Deleted',
};

interface Props {
  state: TicketState;
  lang?: 'de' | 'en';
}

export const StatusChip = ({ state, lang = 'de' }: Props) => {
  const tone = STATE_TO_TONE[state];
  const label = (lang === 'de' ? STATE_LABELS_DE : STATE_LABELS_EN)[state];
  return <span className={`status-chip status-chip--${tone}`}>{label}</span>;
};
