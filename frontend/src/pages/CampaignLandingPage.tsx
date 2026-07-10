import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@shared/components';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { useLanguage } from '../lib/LanguageContext';
import './LandingPage.css';
import railbackLogo from '../../shared/assets/railback-logo.png';

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

/**
 * Campaign-specific copy that overrides the shared landing hero. Everything
 * else (proof points, trust badges, phone mock, eligibility) is intentionally
 * shared across campaigns so only the headline and CTA change per page.
 */
export interface CampaignContent {
  /** Hero headline. Use `\n` for a manual line break. */
  title: string;
  /** Separate headline for narrow screens. Falls back to `title`. */
  mobileTitle?: string;
  /** Primary CTA label (desktop). */
  ctaLabel: string;
  /** Shorter CTA label for narrow screens. Falls back to `ctaLabel`. */
  mobileCtaLabel?: string;
  /** Campaign-specific benefit list. Falls back to the shared landing copy. */
  proof?: string[];
  /**
   * Optional hero visual shown on the right (e.g. a campaign illustration).
   * When set it replaces the default phone mock and renders in the shared
   * `.hero-photo` container.
   */
  heroVisual?: ReactNode;
  /** Show the shared phone mock inside the default two-column hero layout. */
  phoneAsHeroVisual?: boolean;
  /**
   * Optional extra root class for per-campaign CSS tweaks (e.g. a smaller
   * headline for a longer, multi-line title).
   */
  className?: string;
}

interface CampaignLandingPageProps {
  content: CampaignContent;
}

/**
 * Reusable campaign landing page. Each marketing campaign renders this with its
 * own {@link CampaignContent} so headline/CTA can differ while the rest of the
 * page stays consistent. New campaigns should add a thin page + route rather
 * than editing this component.
 */
export const CampaignLandingPage = ({ content }: CampaignLandingPageProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const mobileTitle = content.mobileTitle ?? content.title;
  const mobileCta = content.mobileCtaLabel ?? content.ctaLabel;
  const proof = content.proof ?? t.hero.proof;

  const handleCheckClaim = () => {
    navigate('/user');
  };

  // The default layout matches the main landing page and can show either a
  // supplied visual or the shared phone mock in the right column.
  const rootModifier = content.heroVisual || content.phoneAsHeroVisual ? 'landing-page--default' : 'landing-page--campaign';
  const phoneVisualClass = content.phoneAsHeroVisual ? 'landing-page--phone-visual' : '';

  return (
    <div className={`landing-page landing-campaign ${content.className ?? ''} ${rootModifier} ${phoneVisualClass}`}>
      <Header ctaLabel={content.ctaLabel} />
      <section className="hero">
        <div className="hero__bg"></div>
        <div className="wrap container">
          <div className="hero__grid">
            <div className="hero__mobile-logo">
              <div className="hero__mobile-logo-card">
                <img src={railbackLogo} alt="RailBack Logo" />
              </div>
              <span className="hero__mobile-logo-name">RailBack</span>
            </div>
            <div className="hero__copy fade-in">
              <h1 className="h1 hero__title hero__title--desktop">{content.title}</h1>
              <h1 className="h1 hero__title hero__title--mobile">{mobileTitle}</h1>
              <ul className="hero__proof" aria-label="RailBack Vorteile">
                {proof.map((item: string) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="hero__sub hero__sub--mobile">{t.hero.mobileSub}</p>
              <div className="hero__cta">
                <Button variant="primary" size="large" onClick={handleCheckClaim}>
                  <span style={{ fontSize: '18px', fontWeight: 'bold' }}>€</span>
                  <span className="hero__cta-label hero__cta-label--desktop">{content.ctaLabel}</span>
                  <span className="hero__cta-label hero__cta-label--mobile">{mobileCta}</span>
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
            {content.heroVisual ? (
              <div className="hero-photo-col">
                <div className="hero-photo hero-photo--illustration">{content.heroVisual}</div>
              </div>
            ) : (
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
            )}
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
              <article
                className={`eligibility-card${item.amount.includes('%') ? ' eligibility-card--percentage' : ''}`}
                key={item.title}
              >
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
