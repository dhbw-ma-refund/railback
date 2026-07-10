import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Button } from '@shared/components';
import { Input } from '@shared/components';
import { Card } from '@shared/components';
import { Checkbox } from '@shared/components';
import { useLanguage } from '../lib/LanguageContext';
import { useAuth } from '../lib/AuthContext';
import { RegisterRequest } from '../lib/api';
import './Auth.css';

export const RegisterPage = () => {
  const { t } = useLanguage();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState<RegisterRequest>({
    email: 'test@example.de',
    password: 'testpass123',
    vorname: 'Max',
    nachname: 'Mustermann',
    telefon: '+49 151 12345678',
    adresse: {
      strasse: 'Teststraße',
      hausnr: '42',
      plz: '68161',
      ort: 'Mannheim',
      land: 'DE',
    },
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    datenschutz_einwilligung: false,
    agb_akzeptiert: false,
  });

  const handleNext = () => setStep(step + 1);
  const handleBack = () => setStep(step - 1);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const submitData = { ...formData };
      if (!submitData.iban) delete submitData.iban;
      if (!submitData.bic) delete submitData.bic;

      await register(submitData);
      navigate('/user');
    } catch (err: any) {
      setError(err.message || t.auth.register.error);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="wizard-step-content">
            <h2 className="h2">{t.auth.register.step1Title}</h2>
            <Input
              label={t.auth.register.vorname}
              value={formData.vorname}
              onChange={(e) => setFormData({ ...formData, vorname: e.target.value })}
              required
            />
            <Input
              label={t.auth.register.nachname}
              value={formData.nachname}
              onChange={(e) => setFormData({ ...formData, nachname: e.target.value })}
              required
            />
            <Input
              label={t.auth.register.email}
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
            />
            <Input
              label={t.auth.register.password}
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
            />
            <Input
              label={t.auth.register.telefon}
              type="tel"
              value={formData.telefon}
              onChange={(e) => setFormData({ ...formData, telefon: e.target.value })}
              required
            />
            <Button variant="primary" onClick={handleNext}>
              {t.auth.register.next}
            </Button>
          </div>
        );
      case 2:
        return (
          <div className="wizard-step-content">
            <h2 className="h2">{t.auth.register.step2Title}</h2>
            <Input
              label={t.auth.register.strasse}
              value={formData.adresse.strasse}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  adresse: { ...formData.adresse, strasse: e.target.value },
                })
              }
              required
            />
            <Input
              label={t.auth.register.hausnr}
              value={formData.adresse.hausnr}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  adresse: { ...formData.adresse, hausnr: e.target.value },
                })
              }
              required
            />
            <Input
              label={t.auth.register.plz}
              value={formData.adresse.plz}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  adresse: { ...formData.adresse, plz: e.target.value },
                })
              }
              required
            />
            <Input
              label={t.auth.register.ort}
              value={formData.adresse.ort}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  adresse: { ...formData.adresse, ort: e.target.value },
                })
              }
              required
            />
            <div className="button-group">
              <Button variant="secondary" onClick={handleBack}>
                {t.auth.register.back}
              </Button>
              <Button variant="primary" onClick={handleNext}>
                {t.auth.register.next}
              </Button>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="wizard-step-content">
            <h2 className="h2">{t.auth.register.step3Title}</h2>
            <Input
              label={t.auth.register.iban}
              value={formData.iban}
              onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
            />
            <Input
              label={t.auth.register.bic}
              value={formData.bic}
              onChange={(e) => setFormData({ ...formData, bic: e.target.value })}
            />
            <div className="button-group">
              <Button variant="secondary" onClick={handleBack}>
                {t.auth.register.back}
              </Button>
              <Button variant="secondary" onClick={handleNext}>
                {t.auth.register.skipBank}
              </Button>
              <Button variant="primary" onClick={handleNext}>
                {t.auth.register.next}
              </Button>
            </div>
          </div>
        );
      case 4:
        return (
          <form onSubmit={handleSubmit} className="wizard-step-content">
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
              label={t.auth.register.datenschutz}
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
              label={t.auth.register.agb}
            />
            {error && <div className="error-message">{error}</div>}
            <div className="button-group">
              <Button variant="secondary" onClick={handleBack}>
                {t.auth.register.back}
              </Button>
              <Button type="submit" variant="primary">
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
