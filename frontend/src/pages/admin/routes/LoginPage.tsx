import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input } from '../ui-library';
import { login } from '../services/auth';
import './LoginPage.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailValid = EMAIL_RE.test(email);
  const canSubmit = emailValid && password.length > 0 && !submitting;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result = await login(email, password);
    setSubmitting(false);
    if (result.ok) {
      const next = params.get('next');
      navigate(next && next.startsWith('/admin-panel') ? next : '/admin-panel', {
        replace: true,
      });
      return;
    }
    setError(result.error ?? '');
  }

  return (
    <div className="rb-admin-login">
      <form className="rb-admin-login__card" onSubmit={onSubmit} noValidate>
        <h1 className="rb-admin-login__title">Admin-Login</h1>
        <p className="rb-admin-login__subtitle">Zugang nur für Konten mit Admin-Rolle.</p>

        <div className="rb-admin-login__field">
          <Input
            label="E-Mail"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
        </div>
        <div className="rb-admin-login__field">
          <Input
            label="Passwort"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          className="rb-admin-login__submit"
          disabled={!canSubmit}
        >
          {submitting ? 'Anmelden…' : 'Anmelden'}
        </Button>

        {error !== null && (
          <div role="alert" className="rb-admin-login__error">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
