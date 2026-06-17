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
    <div className="landing-page">
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
              <span className="hero__claim">
                <span className="hero__claim-dot" aria-hidden="true"></span>
                {t.hero.claim}
              </span>
              <h1 className="h1">{t.hero.title}</h1>
              <p className="hero__sub">{t.hero.sub}</p>
              <div className="hero__cta">
                <Button variant="primary" size="large" onClick={handleCheckClaim}>
                  <span style={{ fontSize: '18px', fontWeight: 'bold' }}>€</span>
                  {t.hero.cta1}
                </Button>
                <Button variant="secondary" size="large" onClick={() => navigate('/faq')}>
                  {t.hero.cta2}
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
            <div className="phone-col">
              <div className="phone">
                <div className="phone__notch"></div>
                <div className="phone__screen">
                  <div className="phone__status">
                    <span>9:41</span>
                    <span className="sig">100%</span>
                  </div>
                  <div className="phone__body">
                    <p className="phone__hi">{t.hero.phone.greeting}</p>
                    <p>{t.hero.phone.overview}</p>
                    <div className="tripcard">
                      <div className="tripcard__route">
                        {t.hero.phone.route}
                      </div>
                      <div className="tripcard__meta">{t.hero.phone.meta}</div>
                      <div className="tripcard__amt">{t.hero.phone.amount}</div>
                      <div className="tripcard__amtlabel">{t.hero.phone.amountLabel}</div>
                      <div className="chip-delay">
                        <Icon name="check" size={14} />
                        {t.hero.phone.delay}
                      </div>
                    </div>
                    <div className="minicard">
                      <div className="badge-ic">
                        <Icon name="checkCircle" size={18} color="var(--color-landing-green-ink)" />
                      </div>
                      <div>
                        <div className="minicard__title">{t.hero.phone.ticketChecked}</div>
                        <div className="minicard__sub">{t.hero.phone.claimCalculated}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="floating-badge">
                <div className="infocard">
                  <div className="infocard__badge">25%</div>
                  <div className="infocard__copy">
                    <div className="infocard__title">{t.hero.phone.refundPossible}</div>
                    <div className="infocard__sub">{t.hero.phone.refundBasis}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};
