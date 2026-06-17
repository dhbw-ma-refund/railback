import { Show, createMemo, createSignal } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Form';
import { Modal } from '../components/Modal';
import { ticketsStore, usersStore } from '../lib/store';
import { TICKET_CLASS_VALUES, TICKET_STATUS_VALUES } from '../types';
import type { FieldChange, Ticket, TicketClass, TicketStatus } from '../types';
import { fmtDateTime } from '../lib/format';
import styles from './edit.module.css';

const REFUND_TRIGGER_FROM = new Set<TicketStatus>(['booked', 'pending', 'used']);
const REFUND_TRIGGER_TO   = new Set<TicketStatus>(['cancelled', 'refunded']);

export default function EditTicketPage() {
  const params = useParams();
  const navigate = useNavigate();

  const original = createMemo(() => (params.id ? ticketsStore.get(params.id) : undefined));

  const [draft, setDraft] = createSignal<Ticket | null>(null);
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [refundDone, setRefundDone] = createSignal(false);
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  createMemo(() => {
    const t = original();
    if (t && !draft()) setDraft({ ...t });
  });

  const set = <K extends keyof Ticket>(k: K, v: Ticket[K]) => {
    const d = draft();
    if (!d) return;
    setDraft({ ...d, [k]: v });
  };

  const passenger = createMemo(() => {
    const d = draft();
    return d ? usersStore.get(d.passengerId) : undefined;
  });

  const validate = (): boolean => {
    const d = draft();
    if (!d) return false;
    const errs: Record<string, string> = {};
    if (!d.source.trim()) errs.source = 'Source is required.';
    if (!d.destination.trim()) errs.destination = 'Destination is required.';
    if (d.source.trim() === d.destination.trim()) errs.destination = 'Destination must differ from source.';
    if (d.price < 0) errs.price = 'Price cannot be negative.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const willTriggerRefund = createMemo(() => {
    const o = original();
    const d = draft();
    if (!o || !d) return false;
    return (
      d.status !== o.status &&
      REFUND_TRIGGER_FROM.has(o.status) &&
      REFUND_TRIGGER_TO.has(d.status)
    );
  });

  const changes = createMemo<FieldChange[]>(() => {
    const o = original();
    const d = draft();
    if (!o || !d) return [];
    const out: FieldChange[] = [];
    const cmp = (label: string, key: keyof Ticket) => {
      if (String(o[key]) !== String(d[key])) {
        out.push({ field: label, oldValue: String(o[key]), newValue: String(d[key]) });
      }
    };
    cmp('Source', 'source');
    cmp('Destination', 'destination');
    cmp('Departure', 'departure');
    cmp('Train number', 'trainNumber');
    cmp('Class', 'class');
    cmp('Price', 'price');
    cmp('Status', 'status');
    return out;
  });

  const tryUpdate = (e: Event) => {
    e.preventDefault();
    if (!validate()) return;
    if (changes().length === 0) {
      navigate('/tickets', { replace: true });
      return;
    }
    setConfirmOpen(true);
  };

  const confirm = () => {
    const d = draft();
    if (!d) return;
    const result = ticketsStore.applyEditWithRefundLogic(d.id, {
      source: d.source.trim(),
      destination: d.destination.trim(),
      departure: d.departure,
      trainNumber: d.trainNumber.trim(),
      class: d.class,
      price: Number(d.price),
      status: d.status,
    });
    if (result.refunded) {
      setRefundDone(true);
      setConfirmOpen(false);
      // brief acknowledgement, then return
      setTimeout(() => navigate('/tickets', { replace: true }), 900);
    } else {
      setConfirmOpen(false);
      navigate('/tickets', { replace: true });
    }
  };

  // Convert ISO to <input type="datetime-local"> value (yyyy-MM-ddTHH:mm)
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fromLocalInput = (v: string) => new Date(v).toISOString();

  return (
    <div class="page">
      <Show
        when={draft()}
        fallback={
          <div class={styles.notfound}>
            <h1>Ticket not found</h1>
            <p class="muted" style="margin-top:6px">No ticket with ID “{params.id}”.</p>
            <div style="margin-top:16px">
              <Button variant="secondary" onClick={() => navigate('/tickets')}>Back to tickets</Button>
            </div>
          </div>
        }
      >
        {(d) => (
          <>
            <div class="page-header">
              <div>
                <div class="crumb">Tickets · Edit</div>
                <h1>{d().source} → {d().destination}</h1>
                <p class="muted mono" style="margin-top:4px;font-size:12px">
                  {d().id} · passenger: {passenger()?.name ?? '—'}
                </p>
              </div>
            </div>

            <form class={styles.form} onSubmit={tryUpdate} noValidate>
              <div class={styles.fields}>
                <div class={styles.row2}>
                  <Field label="Source" required error={errors().source}>
                    <Input
                      value={d().source}
                      onInput={(e) => set('source', e.currentTarget.value)}
                      invalid={!!errors().source}
                    />
                  </Field>
                  <Field label="Destination" required error={errors().destination}>
                    <Input
                      value={d().destination}
                      onInput={(e) => set('destination', e.currentTarget.value)}
                      invalid={!!errors().destination}
                    />
                  </Field>
                </div>

                <Field label="Departure">
                  <Input
                    type="datetime-local"
                    value={toLocalInput(d().departure)}
                    onInput={(e) => set('departure', fromLocalInput(e.currentTarget.value))}
                  />
                </Field>

                <div class={styles.row2}>
                  <Field label="Train number">
                    <Input
                      value={d().trainNumber}
                      onInput={(e) => set('trainNumber', e.currentTarget.value)}
                    />
                  </Field>
                  <Field label="Class">
                    <Select
                      value={d().class}
                      onChange={(e) => set('class', e.currentTarget.value as TicketClass)}
                    >
                      {TICKET_CLASS_VALUES.map(c => (
                        <option value={c}>{c === 'first' ? '1st class' : '2nd class'}</option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div class={styles.row2}>
                  <Field label="Price (€)" error={errors().price}>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={d().price}
                      onInput={(e) => set('price', Number(e.currentTarget.value))}
                      invalid={!!errors().price}
                    />
                  </Field>
                  <Field
                    label="Status"
                    hint={willTriggerRefund() ? 'This change will trigger a refund.' : undefined}
                  >
                    <Select
                      value={d().status}
                      onChange={(e) => set('status', e.currentTarget.value as TicketStatus)}
                    >
                      {TICKET_STATUS_VALUES.map(s => (
                        <option value={s}>{s}</option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div class={styles.meta}>
                  <span class="muted">Created</span>
                  <span>{fmtDateTime(d().createdAt)}</span>
                </div>
              </div>

              <div class={styles.actions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate('/tickets')}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={changes().length === 0}>
                  Update
                </Button>
              </div>
            </form>

            <Modal
              open={confirmOpen()}
              onClose={() => setConfirmOpen(false)}
              title="Confirm changes"
              footer={
                <>
                  <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={confirm}>
                    Yes, I'm sure
                  </Button>
                </>
              }
            >
              <p class="muted" style="margin-bottom:var(--s-3)">
                Are you sure you want to update the values?
              </p>
              <ul class={styles.diff}>
                {changes().map(c => (
                  <li>
                    <span class={styles.diff_label}>{c.field}</span>
                    <span class={styles.diff_pair}>
                      <span class={styles.diff_old}>{c.oldValue || '—'}</span>
                      <span class={styles.diff_arrow} aria-hidden="true">→</span>
                      <span class={styles.diff_new}>{c.newValue || '—'}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Show when={willTriggerRefund()}>
                <div class={styles.refund_warn}>
                  <strong>Refund will be processed.</strong> The ticket price
                  ({d().price.toFixed(2)} €) will be added to the passenger's
                  refund total and the ticket marked as refunded.
                </div>
              </Show>
            </Modal>

            <Modal
              open={refundDone()}
              onClose={() => setRefundDone(false)}
              title="Refund processed"
            >
              <p>The refund has been recorded and the ticket marked as refunded.</p>
            </Modal>
          </>
        )}
      </Show>
    </div>
  );
}
