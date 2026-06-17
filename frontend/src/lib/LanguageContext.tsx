import { createContext, useContext, useState, ReactNode } from 'react';

type Language = 'de' | 'en';

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
      support: 'Support',
      legal: 'Rechtliches',
      imprint: 'Impressum',
      back: 'Zurück',
    },
    hero: {
      claim: 'From Delay to Pay',
      title: 'Bahnverspätung? Wir helfen bei der Entschädigung!',
      sub: 'Lade dein Ticket hoch, lass die Verspätung prüfen und erhalte eine klare Übersicht über mögliche Entschädigungen. Kein Antrag wird ohne deine Freigabe versendet.',
      cta1: 'Anspruch prüfen',
      cta2: 'FAQ',
      tag: ['EINFACH.', 'DIGITAL.', 'STRESSFREI.'],
      trust: [
        'Kein Antrag ohne deine Freigabe',
        'Antrag in unter 60 Sekunden',
        'DSGVO-konform aus Mannheim',
      ],
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
      support: 'Support',
      legal: 'Legal',
      imprint: 'Imprint',
      back: 'Back',
    },
    hero: {
      claim: 'From Delay to Pay',
      title: 'Train Delayed? We Help with Your Compensation!',
      sub: 'Upload your ticket, have the delay checked and get a clear overview of possible compensations. No claim is sent without your approval.',
      cta1: 'Check claim',
      cta2: 'FAQ',
      tag: ['SIMPLE.', 'DIGITAL.', 'STRESS-FREE.'],
      trust: [
        'No claim without your approval',
        'Claim in under 60 seconds',
        'GDPR-compliant from Mannheim',
      ],
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

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLang] = useState<Language>('de');

  const value = {
    lang,
    setLang,
    t: translations[lang],
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};
