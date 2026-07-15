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
import { validateIban, validateBic } from '../lib/validators/iban';
import './Auth.css';

/** Shape of the router state LoginPage passes across when the user clicks
 *  "register now" — carries anything they already typed so they don't have
 *  to retype it on the register form. */
interface LoginHandoff {
  email?: string;
  password?: string;
}

/**
 * Per-field validation state. Ordered by user-facing severity:
 *   - `null`   → field is fine
 *   - `empty`  → required but blank → silent invalid style (red border, no
 *                per-input text — the summary banner explains)
 *   - `invalid`→ user typed something malformed → inline error message
 *                because the summary banner can't teach the user how to
 *                fix "abc@" or a wrong-checksum IBAN.
 */
type FieldState = 'empty' | 'invalid' | null;

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

// Format checks. Kept intentionally lenient — the backend does authoritative
// validation, we're just catching the obvious cases here so the user gets
// feedback without a round-trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLZ_RE = /^\d{5}$/;
const MIN_PASSWORD = 8;

function checkField(key: StepFields, formData: RegisterRequest): FieldState {
  switch (key) {
    case 'vorname':
      return formData.vorname ? null : 'empty';
    case 'nachname':
      return formData.nachname ? null : 'empty';
    case 'email':
      if (!formData.email) return 'empty';
      return EMAIL_RE.test(formData.email) ? null : 'invalid';
    case 'password':
      if (!formData.password) return 'empty';
      return formData.password.length >= MIN_PASSWORD ? null : 'invalid';
    case 'telefon':
      return formData.telefon ? null : 'empty';
    case 'strasse':
      return formData.adresse.strasse ? null : 'empty';
    case 'hausnr':
      return formData.adresse.hausnr ? null : 'empty';
    case 'plz':
      if (!formData.adresse.plz) return 'empty';
      return PLZ_RE.test(formData.adresse.plz) ? null : 'invalid';
    case 'ort':
      return formData.adresse.ort ? null : 'empty';
    case 'iban':
      if (!formData.iban) return 'empty';
      return validateIban(formData.iban) ? null : 'invalid';
    case 'bic':
      if (!formData.bic) return 'empty';
      return validateBic(formData.bic) ? null : 'invalid';
    case 'datenschutz':
      return formData.datenschutz_einwilligung ? null : 'empty';
    case 'agb':
      return formData.agb_akzeptiert ? null : 'empty';
  }
}

export const RegisterPage = () => {
  const { t } = useLanguage();
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const handoff = (location.state as LoginHandoff | null) ?? {};
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
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

  // Compute per-field state for every possible field. Cheap — 13 boolean
  // checks per keystroke, all local.
  const fieldStates: Record<StepFields, FieldState> = {
    vorname: checkField('vorname', formData),
    nachname: checkField('nachname', formData),
    email: checkField('email', formData),
    password: checkField('password', formData),
    telefon: checkField('telefon', formData),
    strasse: checkField('strasse', formData),
    hausnr: checkField('hausnr', formData),
    plz: checkField('plz', formData),
    ort: checkField('ort', formData),
    iban: checkField('iban', formData),
    bic: checkField('bic', formData),
    datenschutz: checkField('datenschutz', formData),
    agb: checkField('agb', formData),
  };

  const stepFields = FIELDS_BY_STEP[step];
  const problemsOnStep = stepFields.filter((k) => fieldStates[k] !== null);
  const hasProblemsOnStep = problemsOnStep.length > 0;
  const hasInvalidOnStep = problemsOnStep.some((k) => fieldStates[k] === 'invalid');

  const bannerRef = useScrollIntoViewOn(showErrors[step] && hasProblemsOnStep);

  useEffect(() => {
    if (!hasProblemsOnStep && showErrors[step]) {
      setShowErrors((s) => ({ ...s, [step]: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProblemsOnStep, step]);

  /**
   * Inline error text for a field — only when showErrors is on AND the
   * field is `invalid` (not empty). Empty fields get silent style; the
   * summary banner tells the user to fill them.
   */
  const inlineError = (key: StepFields): string | undefined => {
    if (!showErrors[step]) return undefined;
    if (fieldStates[key] !== 'invalid') return undefined;
    switch (key) {
      case 'email': return t.auth.register.emailInvalid;
      case 'password': return t.auth.register.passwordTooShort;
      case 'plz': return t.auth.register.plzInvalid;
      case 'iban': return t.auth.register.ibanInvalid;
      case 'bic': return t.auth.register.bicInvalid;
      default: return undefined;
    }
  };

  /** Silent invalid signal — for empty fields only (no inline text). */
  const invEmpty = (key: StepFields) =>
    showErrors[step] && fieldStates[key] === 'empty';

  const handleNext = (e?: FormEvent) => {
    e?.preventDefault();
    if (hasProblemsOnStep) {
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
    if (hasProblemsOnStep) {
      setShowErrors((s) => ({ ...s, [step]: true }));
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await register(formData);
      navigate('/user');
    } catch (err) {
      setError(mapError(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Pick the summary banner copy: "some are invalid" beats "some are empty"
  // because malformed-input is the more surprising problem to flag.
  const summaryText = hasInvalidOnStep
    ? t.auth.register.invalidSummary
    : t.wizard.reise.missingSummary;

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
              invalid={invEmpty('vorname')}
            />
            <Input
              label={t.auth.register.nachname}
              name="family-name"
              autoComplete="family-name"
              value={formData.nachname}
              onChange={(e) => setFormData({ ...formData, nachname: e.target.value })}
              required
              invalid={invEmpty('nachname')}
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
              error={inlineError('email')}
              invalid={invEmpty('email')}
            />
            <Input
              label={t.auth.register.password}
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              error={inlineError('password')}
              invalid={invEmpty('password')}
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
              invalid={invEmpty('telefon')}
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
              invalid={invEmpty('strasse')}
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
              invalid={invEmpty('hausnr')}
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
              error={inlineError('plz')}
              invalid={invEmpty('plz')}
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
              invalid={invEmpty('ort')}
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
              error={inlineError('iban')}
              invalid={invEmpty('iban')}
            />
            <Input
              label={t.auth.register.bic}
              name="bic"
              autoCapitalize="characters"
              spellCheck={false}
              value={formData.bic}
              onChange={(e) => setFormData({ ...formData, bic: e.target.value })}
              required
              error={inlineError('bic')}
              invalid={invEmpty('bic')}
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
      case 4: {
        const consentErr = showErrors[step]
          ? fieldStates.datenschutz === 'empty' || fieldStates.agb === 'empty'
            ? t.auth.register.consentRequired
            : undefined
          : undefined;
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
              error={
                showErrors[step] && fieldStates.datenschutz === 'empty'
                  ? consentErr
                  : undefined
              }
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
              error={
                showErrors[step] && fieldStates.agb === 'empty'
                  ? consentErr
                  : undefined
              }
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
      }
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
          {showErrors[step] && hasProblemsOnStep && (
            <div ref={bannerRef} className="error-message">
              {summaryText}
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
