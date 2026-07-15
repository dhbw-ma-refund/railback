import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Button } from '@shared/components';
import { Input } from '@shared/components';
import { Card } from '@shared/components';
import { useLanguage } from '../lib/LanguageContext';
import { useAuth } from '../lib/AuthContext';
import { ApiError } from '@shared/api/errors';
import './Auth.css';

export const LoginPage = () => {
  const { t } = useLanguage();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const mapError = (err: unknown): string => {
    if (err instanceof ApiError) {
      // ERR_AUTH_INVALID → wrong email/password; the backend also uses this
      // code for malformed login bodies, so keep the message generic here.
      if (err.code === 'ERR_AUTH_INVALID') return t.auth.login.invalid;
      if (err.code === 'ERR_FORBIDDEN') {
        const details = err.body.details as { user_state?: string } | undefined;
        if (details?.user_state === 'SUSPENDED') return t.auth.login.suspended;
        if (details?.user_state === 'DELETION_SCHEDULED') return t.auth.login.deletionScheduled;
      }
      return err.body.message || t.auth.login.error;
    }
    // Non-ApiError (network failure, aborted fetch) — no wire body available.
    return t.auth.login.network;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/user');
    } catch (err) {
      setError(mapError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <Header />
      <main className="auth-container">
        <Card className="auth-card">
          <h1 className="h1">{t.auth.login.title}</h1>
          <p className="auth-subtitle">{t.auth.login.subtitle}</p>
          {error && <div className="error-message">{error}</div>}
          <form onSubmit={handleSubmit}>
            <Input
              label={t.auth.login.email}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label={t.auth.login.password}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" variant="primary" size="large" disabled={submitting}>
              {t.auth.login.submit}
            </Button>
          </form>
          <p className="auth-link">
            {t.auth.login.noAccount}{' '}
            <a
              href="/register"
              onClick={(e) => {
                // Client-side nav so we can hand off whatever the user typed —
                // an <a href> would drop the state on a full page load.
                e.preventDefault();
                navigate('/register', { state: { email, password } });
              }}
            >
              {t.auth.login.register}
            </a>
          </p>
        </Card>
      </main>
      <Footer />
    </div>
  );
};
