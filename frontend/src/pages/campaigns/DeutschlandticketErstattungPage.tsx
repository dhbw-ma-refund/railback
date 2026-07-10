import { CampaignLandingPage } from '../CampaignLandingPage';
import type { CampaignContent } from '../CampaignLandingPage';
import { useLanguage } from '../../lib/LanguageContext';
import type { Language } from '../../lib/LanguageContext';
import heroImage from '../../../shared/assets/deutschlandticket-erstattung.png';

/**
 * Campaign 2 — railback.de/deutschlandticket-erstattung
 * Focus: automatic compensation for Deutschlandticket & other long-term tickets.
 */
const content: Record<Language, CampaignContent> = {
  de: {
    title: 'Automatische Entschädigung für\nDeutschlandticket &\nLangzeittickets',
    mobileTitle: 'Automatische Entschädigung\nfür Deutschlandticket &\nLangzeittickets',
    ctaLabel: 'Jetzt Erstattung starten',
    mobileCtaLabel: 'Erstattung starten',
    proof: [
      'Deutschlandticket hinterlegen',
      'Verspätungen automatisch prüfen lassen',
      'Entschädigung erhalten',
    ],
    className: 'campaign-dticket',
    heroVisual: (
      <img
        src={heroImage}
        alt="Lächelnde Reisende am Bahnsteig mit gültigem Deutschlandticket auf dem Smartphone"
      />
    ),
  },
  en: {
    title: 'Automatic compensation for\nDeutschlandticket &\nlong-term tickets',
    mobileTitle: 'Automatic compensation for\nDeutschlandticket &\nlong-term tickets',
    ctaLabel: 'Start refund now',
    mobileCtaLabel: 'Start refund',
    proof: [
      'Add your Deutschlandticket',
      'Have delays checked automatically',
      'Receive compensation',
    ],
    className: 'campaign-dticket',
    heroVisual: (
      <img
        src={heroImage}
        alt="Smiling traveller at a train platform with a valid Deutschlandticket on her smartphone"
      />
    ),
  },
};

export const DeutschlandticketErstattungPage = () => {
  const { lang } = useLanguage();

  return <CampaignLandingPage content={content[lang]} />;
};
