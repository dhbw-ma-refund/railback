import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type Language = 'de' | 'en';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: any;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};

// Translations
const translations = {
  de: {
    menu: {
      login: 'Anmelden',
      logout: 'Abmelden',
      account: 'Konto',
      faq: 'FAQ',
      prices: 'Preise',
      support: 'Support',
      legal: 'Rechtliches',
      imprint: 'Impressum',
      back: 'Zurück',
    },
    hero: {
      claim: 'From Delay to Pay',
      title: 'Deine Bahnverspätung kostet dich Zeit. Hol dir wenigstens dein Geld zurück.',
      sub: 'Lade dein Ticket hoch, lass die Verspätung prüfen und erhalte eine klare Übersicht über mögliche Entschädigungen.',
      cta1: 'Entschädigung sichern',
      cta2: 'FAQ',
      tag: ['EINFACH.', 'DIGITAL.', 'STRESSFREI.'],
      trust: [
        'Kein Antrag ohne deine Freigabe',
        'Antrag in unter 60 Sekunden',
        'DSGVO-konform aus Mannheim',
      ],
      phone: {
        greeting: 'Hallo Tobias!',
        overview: 'Hier ist dein Reiseüberblick.',
        route: 'München → Berlin',
        meta: '24.06.2026 • ICE 1232',
        amount: '24,50 €',
        amountLabel: 'Erwartete Entschädigung',
        delay: 'Verspätung erkannt · 78 Min',
        ticketChecked: 'Ticket geprüft',
        claimCalculated: 'Anspruch berechnet',
        refundPossible: 'Erstattung möglich',
        refundBasis: 'Basierend auf Ticketpreis und erkannter Verspätung.',
      },
    },
    faq: {
      title: 'Häufig gestellte Fragen',
      lead: 'Hier findest du Antworten auf die wichtigsten Fragen rund um RailBack und Bahnerstattungen.',
      topics: [
        { id: 'ticket', t: 'Ticket & Upload', d: 'Wie du dein Ticket hinzufügst und was wir unterstützen', icon: 'ticket' },
        { id: 'reise', t: 'Reise & Verspätung', d: 'Wie die Prüfung läuft und ab wann du Anspruch hast', icon: 'clock' },
        { id: 'anspruch', t: 'Anspruch & Erstattung', d: 'Wie die Berechnung funktioniert und was du erwarten kannst', icon: 'euro' },
        { id: 'antrag', t: 'Antrag & Auszahlung', d: 'Was nach der Freigabe passiert und wann du dein Geld bekommst', icon: 'checkCircle' },
      ],
    },
    footer: {
      tagline: 'From Delay to Pay.',
      copyright: '© 2026 RailBack GmbH · Alle Rechte vorbehalten.',
    },
  },
  en: {
    menu: {
      login: 'Log in',
      logout: 'Log out',
      account: 'Account',
      faq: 'FAQ',
      prices: 'Pricing',
      support: 'Support',
      legal: 'Legal',
      imprint: 'Imprint',
      back: 'Back',
    },
    hero: {
      claim: 'From Delay to Pay',
      title: 'Train Delayed? We Help with Your Compensation!',
      sub: 'Upload your ticket, have the delay checked and get a clear overview of possible compensations.',
      cta1: 'Check claim',
      cta2: 'FAQ',
      tag: ['SIMPLE.', 'DIGITAL.', 'STRESS-FREE.'],
      trust: [
        'No claim without your approval',
        'Claim in under 60 seconds',
        'GDPR-compliant from Mannheim',
      ],
      phone: {
        greeting: 'Hello Tobias!',
        overview: 'Here is your trip overview.',
        route: 'Munich → Berlin',
        meta: '24 Jun 2026 • ICE 1232',
        amount: '€24.50',
        amountLabel: 'Expected compensation',
        delay: 'Delay detected · 78 min',
        ticketChecked: 'Ticket checked',
        claimCalculated: 'Claim calculated',
        refundPossible: 'Refund possible',
        refundBasis: 'Based on ticket price and detected delay.',
      },
    },
    faq: {
      title: 'Frequently Asked Questions',
      lead: 'Here you can find answers to the most important questions about RailBack and train refunds.',
      topics: [
        { id: 'ticket', t: 'Ticket & Upload', d: 'How to add your ticket and what we support', icon: 'ticket' },
        { id: 'reise', t: 'Journey & Delay', d: 'How the check works and when you are entitled to compensation', icon: 'clock' },
        { id: 'anspruch', t: 'Claim & Refund', d: 'How the calculation works and what you can expect', icon: 'euro' },
        { id: 'antrag', t: 'Application & Payout', d: 'What happens after approval and when you receive your money', icon: 'checkCircle' },
      ],
    },
    footer: {
      tagline: 'From Delay to Pay.',
      copyright: '© 2026 RailBack GmbH · All rights reserved.',
    },
  },
};

const isLanguage = (value: string | null): value is Language => value === 'de' || value === 'en';

const getInitialLanguage = (): Language => {
  const savedLanguage = window.localStorage.getItem('rb_lang');
  return isLanguage(savedLanguage) ? savedLanguage : 'de';
};

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    window.localStorage.setItem('rb_lang', lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const value = {
    lang,
    setLang: setLangState,
    t: translations[lang],
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};
