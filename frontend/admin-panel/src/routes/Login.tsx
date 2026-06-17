import { createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Form';
import { auth } from '../lib/auth';
import styles from './login.module.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  const submit = (e: Event) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = auth.login(username(), password());
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <div class={styles.wrap}>
      <div class={styles.card}>
        <div class={styles.brand}>
          <span class={styles.brand_mark} aria-hidden="true">B</span>
          <span class={styles.brand_text}>BahnTicket Admin</span>
        </div>
        <h1 class={styles.heading}>Sign in</h1>
        <p class={styles.sub}>Use your administrator credentials to continue.</p>

        <form class="stack-4" onSubmit={submit} novalidate>
          <Field label="Username" required>
            <Input
              autofocus
              autocomplete="username"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              placeholder="admin"
              invalid={!!error() && !username().trim()}
            />
          </Field>
          <Field label="Password" required>
            <Input
              type="password"
              autocomplete="current-password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              placeholder="••••••••"
              invalid={!!error() && !password()}
            />
          </Field>

          {error() && <div class={styles.alert}>{error()}</div>}

          <Button
            type="submit"
            size="lg"
            block
            disabled={submitting()}
          >
            {submitting() ? 'Signing in…' : 'Log in'}
          </Button>

          <p class={styles.hint}>
            Demo: any non-empty credentials are accepted.
          </p>
        </form>
      </div>
    </div>
  );
}
