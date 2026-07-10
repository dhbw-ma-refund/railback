import { CampaignLandingPage } from '../CampaignLandingPage';
import type { CampaignContent } from '../CampaignLandingPage';

/**
 * Campaign 2 — railback.de/deutschlandticket-erstattung
 * Focus: automatic compensation for Deutschlandticket & other long-term tickets.
 *
 * To use a campaign photo, import it and set `heroVisual`, e.g.:
 *   import heroImg from '../../../shared/assets/deutschlandticket-hero.png';
 *   heroVisual: <img src={heroImg} alt="…" />
 */
const content: CampaignContent = {
  title: 'Automatische Entschädigung für\nDeutschlandticket & Langzeit Tickets',
  mobileTitle: 'Entschädigung für\nDeutschlandticket',
  ctaLabel: 'Jetzt Erstattung starten',
  mobileCtaLabel: 'Erstattung starten',
};

export const DeutschlandticketErstattungPage = () => <CampaignLandingPage content={content} />;
