import { CampaignLandingPage } from '../CampaignLandingPage';
import type { CampaignContent } from '../CampaignLandingPage';
import heroImage from '../../../shared/assets/deutschlandticket-erstattung.png';

/**
 * Campaign 2 — railback.de/deutschlandticket-erstattung
 * Focus: automatic compensation for Deutschlandticket & other long-term tickets.
 */
const content: CampaignContent = {
  title: 'Automatische Entschädigung\nfür Deutschlandticket &\nLangzeittickets',
  mobileTitle: 'Automatische Entschädigung\nfür Deutschlandticket &\nLangzeittickets',
  ctaLabel: 'Jetzt Erstattung starten',
  mobileCtaLabel: 'Erstattung starten',
  className: 'campaign-dticket',
  heroVisual: (
    <img
      src={heroImage}
      alt="Lächelnde Reisende am Bahnsteig mit gültigem Deutschlandticket auf dem Smartphone"
    />
  ),
};

export const DeutschlandticketErstattungPage = () => <CampaignLandingPage content={content} />;
