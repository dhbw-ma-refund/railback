import { useEffect, useState, FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Button } from '@shared/components';
import { Input } from '@shared/components';
import { Card } from '@shared/components';
import { Checkbox } from '@shared/components';
import { useLanguage } from '../lib/LanguageContext';
import { useAuth } from '../lib/AuthContext';
import { RegisterRequest } from '../lib/api';
import { ApiError } from '@shared/api/errors';
import { useScrollIntoViewOn } from '../hooks/useScrollIntoViewOn';
import './Auth.css';

/** Shape of the router state LoginPage passes across when the user clicks
 *  "register now" — carries anything they already typed so they don't have
 *  to retype it on the register form. */
interface LoginHandoff {
  email?: string;
  password?: string;
}

/**
 * Which fields are required per step. Used to compute `missing` and
 * decide whether Weiter should navigate or reveal errors. Mirrors the
 * ticket wizard's per-step validation pattern (see FahrtStep, PersonStep,
 * etc.): Weiter is always clickable, clicking with any field missing
 * reds the offending inputs and scrolls the summary banner into view.
 */
type StepFields =
  | 'vorname' | 'nachname' | 'email' | 'password' | 'telefon'
  | 'strasse' | 'hausnr' | 'plz' | 'ort'
  | 'iban' | 'bic'
  | 'datenschutz' | 'agb';

const FIELDS_BY_STEP: Record<1 | 2 | 3 | 4, StepFields[]> = {
  1: ['vorname', 'nachname', 'email', 'password', 'telefon'],
  2: ['strasse', 'hausnr', 'plz', 'ort'],
  3: ['iban', 'bic'],
  4: ['datenschutz', 'agb'],
};

export const RegisterPage = () => {
  const { t } = useLanguage();
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const handoff = (location.state as LoginHandoff | null) ?? {};
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** Per-step flag: once the user clicks Weiter/Submit with any field
   *  missing on THIS step, flip to true so inputs show the red border. */
  const [showErrors, setShowErrors] = useState<Record<1 | 2 | 3 | 4, boolean>>({
    1: false, 2: false, 3: false, 4: false,
  });

  const [formData, setFormData] = useState<RegisterRequest>({
    email: handoff.email ?? '',
    password: handoff.password ?? '',
    vorname: '',
    nachname: '',
    telefon: '',
    adresse: {
      strasse: '',
      hausnr: '',
      plz: '',
      ort: '',
      land: 'DE',
    },
    iban: '',
    bic: '',
    datenschutz_einwilligung: false,
    agb_akzeptiert: false,
  });

  // Which required fields for the CURRENT step are still empty.
  const missing: Record<StepFields, boolean> = {
    vorname: !formData.vorname,
    nachname: !formData.nachname,
    email: !formData.email,
    password: !formData.password,
    telefon: !formData.telefon,
    strasse: !formData.adresse.strasse,
    hausnr: !formData.adresse.hausnr,
    plz: !formData.adresse.plz,
    ort: !formData.adresse.ort,
    iban: !formData.iban,
    bic: !formData.bic,
    datenschutz: !formData.datenschutz_einwilligung,
    agb: !formData.agb_akzeptiert,
  };
  const missingOnStep = FIELDS_BY_STEP[step].some((k) => missing[k]);
  const bannerRef = useScrollIntoViewOn(showErrors[step] && missingOnStep);

  // Auto-clear the current step's showErrors flag once every required
  // field on it is filled — users don't get stuck seeing red on a field
  // they just fixed.
  useEffect(() => {
    if (!missingOnStep && showErrors[step]) {
      setShowErrors((s) => ({ ...s, [step]: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingOnStep, step]);

  const inv = (key: StepFields) => showErrors[step] && missing[key];

  const handleNext = (e?: FormEvent) => {
    e?.preventDefault();
    if (missingOnStep) {
      setShowErrors((s) => ({ ...s, [step]: true }));
      return;
    }
    setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  };

  const handleBack = () => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s));

  const mapError = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.code === 'ERR_CONFLICT') return t.auth.register.emailTaken;
      if (err.code === 'ERR_VALIDATION') return t.auth.register.validation;
      return err.body.message || t.auth.register.error;
    }
    return t.auth.register.network;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Even at the final step: if the two consent checkboxes aren't ticked,
    // reveal the missing state instead of firing the network call.
    if (missingOnStep) {
      setShowErrors((s) => ({ ...s, [step]: true }));
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      // iban/bic are required at the backend — send whatever the form holds
      // and let ERR_VALIDATION surface if they are blank or badly formatted.
      await register(formData);
      navigate('/user');
    } catch (err) {
      setError(mapError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <form className="wizard-step-content" onSubmit={handleNext} noValidate>
            <h2 className="h2">{t.auth.register.step1Title}</h2>
            <Input
              label={t.auth.register.vorname}
              name="given-name"
              autoComplete="given-name"
              value={formData.vorname}
              onChange={(e) => setFormData({ ...formData, vorname: e.target.value })}
              required
              invalid={inv('vorname')}
            />
            <Input
              label={t.auth.register.nachname}
              name="family-name"
              autoComplete="family-name"
              value={formData.nachname}
              onChange={(e) => setFormData({ ...formData, nachname: e.target.value })}
              required
              invalid={inv('nachname')}
            />
            <Input
              label={t.auth.register.email}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              invalid={inv('email')}
            />
            <Input
              label={t.auth.register.password}
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              invalid={inv('password')}
            />
            <Input
              label={t.auth.register.telefon}
              type="tel"
              name="tel"
              autoComplete="tel"
              inputMode="tel"
              value={formData.telefon}
              onChange={(e) => setFormData({ ...formData, telefon: e.target.value })}
              required
              invalid={inv('telefon')}
            />
            <Button type="submit" variant="primary">
              {t.auth.register.next}
            </Button>
          </form>
        );
      case 2:
        return (
          <form className="wizard-step-content" onSubmit={handleNext} noValidate>
            <h2 className="h2">{t.auth.register.step2Title}</h2>
            <Input
              label={t.auth.register.strasse}
              name="address-line1"
              autoComplete="address-line1"
              value={formData.adresse.strasse}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  adresse: { ...formData.adresse, strasse: e.target.value },
                })
              }
              required
              invalid={inv('strasse')}
            />
            <Input
              label={t.auth.register.hausnr}
              name="address-line2"
              autoComplete="address-line2"
              value={formData.adresse.hausnr}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  adresse: { ...formData.adresse, hausnr: e.target.value },
                })
              }
              required
              invalid={inv('hausnr')}
            />
            <Input
              label={t.auth.register.plz}
              name="postal-code"
              autoComplete="postal-code"
              inputMode="numeric"
              value={formData.adresse.plz}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  adresse: { ...formData.adresse, plz: e.target.value },
                })
              }
              required
              invalid={inv('plz')}
            />
            <Input
              label={t.auth.register.ort}
              name="address-level2"
              autoComplete="address-level2"
              value={formData.adresse.ort}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  adresse: { ...formData.adresse, ort: e.target.value },
                })
              }
              required
              invalid={inv('ort')}
            />
            <div className="button-group">
              <Button type="button" variant="secondary" onClick={handleBack}>
                {t.auth.register.back}
              </Button>
              <Button type="submit" variant="primary">
                {t.auth.register.next}
              </Button>
            </div>
          </form>
        );
      case 3:
        return (
          <form className="wizard-step-content" onSubmit={handleNext} noValidate>
            <h2 className="h2">{t.auth.register.step3Title}</h2>
            <Input
              label={t.auth.register.iban}
              name="iban"
              /* No standard WHATWG autocomplete token for IBAN — leaving the
                 default (on) with a stable name so the browser can still
                 offer/remember values on repeat visits. */
              autoCapitalize="characters"
              spellCheck={false}
              value={formData.iban}
              onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
              required
              invalid={inv('iban')}
            />
            <Input
              label={t.auth.register.bic}
              name="bic"
              autoCapitalize="characters"
              spellCheck={false}
              value={formData.bic}
              onChange={(e) => setFormData({ ...formData, bic: e.target.value })}
              required
              invalid={inv('bic')}
            />
            <div className="button-group">
              <Button type="button" variant="secondary" onClick={handleBack}>
                {t.auth.register.back}
              </Button>
              <Button type="submit" variant="primary">
                {t.auth.register.next}
              </Button>
            </div>
          </form>
        );
      case 4:
        return (
          <form onSubmit={handleSubmit} className="wizard-step-content" noValidate>
            <h2 className="h2">{t.auth.register.step4Title}</h2>
            <Checkbox
              checked={formData.datenschutz_einwilligung}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  datenschutz_einwilligung: e.target.checked,
                })
              }
              required
              label={
                <>
                  {t.auth.register.datenschutzPrefix}
                  <Link
                    className="auth-legal-link"
                    to="/rechtliches#datenschutz"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {t.auth.register.datenschutzLink}
                  </Link>
                </>
              }
            />
            <Checkbox
              checked={formData.agb_akzeptiert}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  agb_akzeptiert: e.target.checked,
                })
              }
              required
              label={
                <>
                  {t.auth.register.agbPrefix}
                  <Link
                    className="auth-legal-link"
                    to="/rechtliches#agb"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {t.auth.register.agbLink}
                  </Link>
                </>
              }
            />
            {error && <div className="error-message">{error}</div>}
            <div className="button-group">
              <Button type="button" variant="secondary" onClick={handleBack}>
                {t.auth.register.back}
              </Button>
              <Button type="submit" variant="primary" disabled={submitting}>
                {t.auth.register.submit}
              </Button>
            </div>
          </form>
        );
      default:
        return null;
    }
  };

  return (
    <div className="auth-page">
      <Header />
      <main className="auth-container">
        <Card className="auth-card">
          <h1 className="h1">{t.auth.register.title}</h1>
          <p className="auth-subtitle">{t.auth.register.subtitle}</p>
          <div className="wizard-progress">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`wizard-step${s === step ? ' active' : ''}${
                  s < step ? ' completed' : ''
                }`}
              >
                {s}
              </div>
            ))}
          </div>
          {renderStep()}
          {showErrors[step] && missingOnStep && (
            <div ref={bannerRef} className="error-message">
              {t.wizard.reise.missingSummary}
            </div>
          )}
          <p className="auth-link">
            {t.auth.register.haveAccount}{' '}
            <a href="/login">{t.auth.register.login}</a>
          </p>
        </Card>
      </main>
      <Footer />
    </div>
  );
};
