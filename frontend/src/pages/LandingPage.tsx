import { useNavigate } from 'react-router-dom';
import { Button } from '@shared/components';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { useLanguage } from '../lib/LanguageContext';
import './LandingPage.css';

// Simple Icon component for landing page
const Icon = ({ name, size = 20, color }: { name: string; size?: number; color?: string }) => {
  const icons: Record<string, JSX.Element> = {
    euro: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 10h12" />
        <path d="M4 14h12" />
        <path d="M19 6a8 8 0 0 0-8 8 8 8 0 0 0 8 8" />
        <path d="M5 6a8 8 0 0 1 8 8 8 8 0 0 1-8 8" />
      </svg>
    ),
    checkCircle: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
    shield: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    bolt: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
      </svg>
    ),
    check: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    ),
  };

  return icons[name] || null;
};

export const LandingPage = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleCheckClaim = () => {
    navigate('/user');
  };

  return (
    <div className="landing-page landing-page--default">
      <Header />
      <section className="hero">
        <div className="hero__bg"></div>
        <div className="wrap container">
          <div className="hero__grid">
            <div className="hero__mobile-logo">
              <div className="hero__mobile-logo-card">
                <img src="/shared/assets/railback-logo.png" alt="RailBack Logo" />
              </div>
              <span className="hero__mobile-logo-name">RailBack</span>
            </div>
            <div className="hero__copy fade-in">
              <h1 className="h1 hero__title hero__title--desktop">{t.hero.title}</h1>
              <h1 className="h1 hero__title hero__title--mobile">{t.hero.mobileTitle}</h1>
              <ul className="hero__proof" aria-label="RailBack Vorteile">
                {t.hero.proof.map((item: string) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="hero__sub hero__sub--mobile">{t.hero.mobileSub}</p>
              <div className="hero__cta">
                <Button variant="primary" size="large" onClick={handleCheckClaim}>
                  <span style={{ fontSize: '18px', fontWeight: 'bold' }}>€</span>
                  <span className="hero__cta-label hero__cta-label--desktop">{t.hero.cta1}</span>
                  <span className="hero__cta-label hero__cta-label--mobile">{t.hero.mobileCta}</span>
                </Button>
              </div>
              <div className="hero__tag">
                {t.hero.tag.map((w: string, i: number) => (
                  <b key={i} style={{ color: i === 1 ? 'var(--color-landing-green-ink)' : 'var(--color-deep-trust-blue)' }}>
                    {w}{' '}
                  </b>
                ))}
              </div>
              <div className="trust">
                {t.hero.trust.map((tr: string, i: number) => (
                  <span className="trust__item" key={i}>
                    <Icon name={['shield', 'bolt', 'check'][i]} size={18} />
                    {tr}
                  </span>
                ))}
              </div>
            </div>
            <div className="hero-photo-col">
              <div className="hero-photo">
                <img
                  src="/shared/assets/home-hero-passenger-2.png"
                  alt="Zufriedene Bahnreisende prüft ihre Entschädigung am Smartphone"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="eligibility" id="eligibility" aria-labelledby="eligibility-title">
        <div className="wrap container">
          <div className="eligibility__head">
            <span className="eligibility__eyebrow">{t.eligibility.eyebrow}</span>
            <h2 id="eligibility-title">{t.eligibility.title}</h2>
            <p>{t.eligibility.lead}</p>
          </div>
          <div className="eligibility__rail" aria-label={t.eligibility.eyebrow}>
            {t.eligibility.items.map((item: { amount: string; title: string; text: string }) => (
              <article className="eligibility-card" key={item.title}>
                <div className="eligibility-card__amount">{item.amount}</div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};
