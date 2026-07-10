import { CampaignLandingPage } from '../CampaignLandingPage';
import type { CampaignContent } from '../CampaignLandingPage';

/**
 * Campaign 1 — railback.de/ticket-erstattung
 * Focus: automatic refund of a single (delayed) train ticket.
 */
const content: CampaignContent = {
  title: 'Verspätung?\nTicket automatisch erstatten lassen!',
  ctaLabel: 'Jetzt Ticket erstatten!',
  mobileCtaLabel: 'Ticket erstatten',
  proof: [
    'Ticket hochladen',
    'Verspätung automatisch prüfen lassen',
    'Erstattung erhalten',
  ],
  className: 'campaign-ticket',
  phoneAsHeroVisual: true,
};

export const TicketErstattungPage = () => <CampaignLandingPage content={content} />;
