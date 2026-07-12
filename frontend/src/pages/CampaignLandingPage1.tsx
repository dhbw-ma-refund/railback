import { CampaignLandingPage } from './CampaignLandingPage';
import { useLanguage } from '../lib/LanguageContext';

/**
 * Legacy campaign route (/campaign-landing-page-1). Renders the shared campaign
 * layout with the default hero copy from the language context. Kept so the
 * original URL stays valid; new campaigns live under src/pages/campaigns.
 */
export const CampaignLandingPage1 = () => {
  const { t } = useLanguage();

  return (
    <CampaignLandingPage
      content={{
        title: t.hero.title,
        mobileTitle: t.hero.mobileTitle,
        ctaLabel: t.hero.cta1,
        mobileCtaLabel: t.hero.mobileCta,
      }}
    />
  );
};
