import { useNavigate } from 'react-router-dom';
import { Button } from '@shared/components';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { useLanguage } from '../lib/LanguageContext';
import { pricingContent } from '../lib/pricingContent';
import { useSmartBack } from '../hooks/useSmartBack';
import './PricingPage.css';

export const PricingPage = () => {
  const navigate = useNavigate();
  const goBack = useSmartBack('/');
  const { lang, t } = useLanguage();
  const text = pricingContent[lang];

  return (
    <div className="pricing-page">
      <Header />
      <main className="pricing-main">
        <div className="pricing-page__head fade-in">
          <button
            type="button"
            className="rb-button rb-button--secondary rb-button--medium pricing-page__back"
            onClick={goBack}
          >
            {/* Gleiches Pfeil-Icon wie der Zurück-Button auf der FAQ-Seite, damit
                der Innenabstand zwischen Pfeil und Text identisch ist. */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            {t.menu.back}
          </button>
        </div>
        <section className="pricing-hero wrap container fade-in">
          <div className="pricing-hero__copy">
            <h1>{text.title}</h1>
            <p>{text.lead}</p>
          </div>
          <div className="pricing-card" aria-label={text.cardTitle}>
            <div>
              <h2>{text.cardTitle}</h2>
              <div className="pricing-card__price">{text.price}</div>
              <p className="pricing-card__meta">{text.priceMeta}</p>
            </div>
            <ul>
              {text.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <Button variant="primary" size="large" onClick={() => navigate('/user')}>
              {text.cta}
            </Button>
            <p className="pricing-card__note">{text.note}</p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};
