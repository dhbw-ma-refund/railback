import { CampaignLandingPage } from '../CampaignLandingPage';
import type { CampaignContent } from '../CampaignLandingPage';
import { useLanguage } from '../../lib/LanguageContext';
import type { Language } from '../../lib/LanguageContext';

/**
 * Campaign 1 — railback.de/ticket-erstattung
 * Focus: automatic refund of a single (delayed) train ticket.
 */
const content: Record<Language, CampaignContent> = {
  de: {
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
  },
  en: {
    title: 'Delay?\nGet your ticket refunded automatically!',
    ctaLabel: 'Get ticket refunded',
    mobileCtaLabel: 'Refund ticket',
    proof: [
      'Upload your ticket',
      'Have the delay checked automatically',
      'Receive your refund',
    ],
    className: 'campaign-ticket',
    phoneAsHeroVisual: true,
  },
};

export const TicketErstattungPage = () => {
  const { lang } = useLanguage();

  return <CampaignLandingPage content={content[lang]} />;
};
