import { JSX, Show, createMemo, createSignal } from 'solid-js';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Form';
import { Modal } from '../components/Modal';
import { useNavigate, useParams } from '@solidjs/router';
import { usersStore } from '../lib/store';
import { USER_STATUS_VALUES } from '../types';
import type { FieldChange, User, UserStatus } from '../types';
import styles from './edit.module.css';

export default function EditUserPage() {
  const params = useParams();
  const navigate = useNavigate();

  const original = createMemo(() => (params.id ? usersStore.get(params.id) : undefined));

  const [draft, setDraft] = createSignal<User | null>(null);
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  // Initialize draft when original loads.
  createMemo(() => {
    const u = original();
    if (u && !draft()) setDraft({ ...u });
  });

  const set = <K extends keyof User>(k: K, v: User[K]) => {
    const d = draft();
    if (!d) return;
    setDraft({ ...d, [k]: v });
  };

  const validate = (): boolean => {
    const d = draft();
    if (!d) return false;
    const errs: Record<string, string> = {};
    if (!d.name.trim()) errs.name = 'Name is required.';
    if (!/^\S+@\S+\.\S+$/.test(d.email)) errs.email = 'Enter a valid email.';
    if (d.age < 0 || d.age > 130) errs.age = 'Enter a valid age.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const changes = createMemo<FieldChange[]>(() => {
    const o = original();
    const d = draft();
    if (!o || !d) return [];
    const out: FieldChange[] = [];
    const cmp = (label: string, key: keyof User) => {
      if (String(o[key]) !== String(d[key])) {
        out.push({
          field: label,
          oldValue: String(o[key]),
          newValue: String(d[key]),
        });
      }
    };
    cmp('Name', 'name');
    cmp('Email', 'email');
    cmp('Age', 'age');
    cmp('Phone', 'phone');
    cmp('Status', 'status');
    return out;
  });

  const tryUpdate = (e: Event) => {
    e.preventDefault();
    if (!validate()) return;
    if (changes().length === 0) {
      navigate('/users', { replace: true });
      return;
    }
    setConfirmOpen(true);
  };

  const confirm = () => {
    const d = draft();
    if (!d) return;
    usersStore.update(d.id, {
      name: d.name.trim(),
      email: d.email.trim(),
      age: Number(d.age),
      phone: d.phone.trim(),
      status: d.status,
    });
    setConfirmOpen(false);
    navigate('/users', { replace: true });
  };

  return (
    <div class="page">
      <Show
        when={draft()}
        fallback={
          <div class={styles.notfound}>
            <h1>User not found</h1>
            <p class="muted" style="margin-top:6px">No user with ID “{params.id}”.</p>
            <div style="margin-top:16px">
              <Button variant="secondary" onClick={() => navigate('/users')}>Back to users</Button>
            </div>
          </div>
        }
      >
        {(d) => (
          <>
            <div class="page-header">
              <div>
                <div class="crumb">Users · Edit</div>
                <h1>{d().name}</h1>
                <p class="muted mono" style="margin-top:4px;font-size:12px">{d().id}</p>
              </div>
            </div>

            <form class={styles.form} onSubmit={tryUpdate} noValidate>
              <div class={styles.fields}>
                <Field label="Name" required error={errors().name}>
                  <Input
                    value={d().name}
                    onInput={(e) => set('name', e.currentTarget.value)}
                    invalid={!!errors().name}
                  />
                </Field>
                <Field label="Email" required error={errors().email}>
                  <Input
                    type="email"
                    value={d().email}
                    onInput={(e) => set('email', e.currentTarget.value)}
                    invalid={!!errors().email}
                  />
                </Field>
                <div class={styles.row2}>
                  <Field label="Age" required error={errors().age}>
                    <Input
                      type="number"
                      min="0"
                      max="130"
                      value={d().age}
                      onInput={(e) => set('age', Number(e.currentTarget.value))}
                      invalid={!!errors().age}
                    />
                  </Field>
                  <Field label="Status">
                    <Select
                      value={d().status}
                      onChange={(e) => set('status', e.currentTarget.value as UserStatus)}
                    >
                      {USER_STATUS_VALUES.map(s => (
                        <option value={s}>{s}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label="Phone">
                  <Input
                    value={d().phone}
                    onInput={(e) => set('phone', e.currentTarget.value)}
                  />
                </Field>
              </div>

              <div class={styles.actions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate('/users')}
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
            </Modal>
          </>
        )}
      </Show>
    </div>
  );
}
