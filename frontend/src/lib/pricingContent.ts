import type { Language } from './LanguageContext';

export const pricingContent: Record<
  Language,
  {
    title: string;
    lead: string;
    cardTitle: string;
    price: string;
    priceMeta: string;
    features: string[];
    cta: string;
    note: string;
  }
> = {
  de: {
    title: 'Erst prüfen, dann entscheiden.',
    lead: 'Prüfung deiner Berechtigung. Nur bei einem erfolgreichen Antrag fällt eine Servicegebühr von 0,75€ an.',
    cardTitle: 'Einfach und transparent',
    price: '0€',
    priceMeta: 'für die Prüfung deiner Berechtigung',
    features: [
      'Bei erfolgreichem Antrag: 0,75€ Servicegebühr',
      'Möglichen Erstattungsbetrag vor der Freigabe sehen',
      'Kein Antrag ohne deine ausdrückliche Zustimmung',
    ],
    cta: 'Anspruch prüfen',
    note: 'Ohne erfolgreichen Antrag fällt keine Servicegebühr an.',
  },
  en: {
    title: 'Check first, decide afterwards.',
    lead: 'Eligibility check = €0. We only charge a €0.75 service fee if your claim is successful.',
    cardTitle: 'Simple and transparent',
    price: '€0',
    priceMeta: 'for checking your eligibility',
    features: [
      'For a successful claim: €0.75 service fee',
      'See the possible refund before approval',
      'No claim without your explicit consent',
    ],
    cta: 'Check claim',
    note: 'There is no service fee if your claim is unsuccessful.',
  },
};
