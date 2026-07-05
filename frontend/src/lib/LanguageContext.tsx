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
      title: 'Deine Bahnverspätung kostet dich Zeit.\nHol dir wenigstens dein Geld zurück.',
      mobileTitle: 'Bahnverspätung? Wir helfen bei der Entschädigung!',
      sub: 'Du musst dich nicht durch Formulare kämpfen. RailBack prüft deine Reise, zeigt dir deinen möglichen Anspruch und führt dich bis zur Auszahlung.',
      mobileSub: 'Ticket hochladen, Verspätung prüfen und Entschädigung erhalten.',
      cta1: 'Lass dich entschädigen!',
      mobileCta: 'Jetzt Anspruch prüfen',
      cta2: 'Wann bekomme ich Geld?',
      tag: ['EINFACH.', 'DIGITAL.', 'STRESSFREI.'],
      proof: [
        'Lade dein Ticket hoch',
        'Die Verspätung wird geprüft',
        'Erhalte deine Entschädigung',
      ],
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
    eligibility: {
      eyebrow: 'Wann ist Entschädigung möglich?',
      title: 'Wenn die Bahn dich warten lässt, muss es nicht bei Ärger bleiben.',
      lead: 'Die Höhe hängt von Verspätung, Ticketpreis und Reisesituation ab. RailBack zeigt dir vor dem Antrag, was realistisch möglich ist.',
      items: [
        {
          amount: '25%',
          title: 'Ab 60 Minuten am Ziel',
          text: 'Bei vielen Bahnreisen kann ab einer Stunde Verspätung ein Teil des Ticketpreises erstattet werden.',
        },
        {
          amount: '50%',
          title: 'Ab 120 Minuten am Ziel',
          text: 'Bei sehr langen Verzögerungen kann der Anspruch deutlich höher ausfallen.',
        },
        {
          amount: 'Prüfung',
          title: 'Ausfall oder Anschluss verpasst',
          text: 'Auch Zugausfälle und verpasste Anschlüsse können relevant sein. Wir prüfen die konkrete Reise.',
        },
        {
          amount: 'Klarheit',
          title: 'Vorher wissen, ob es sich lohnt',
          text: 'Du siehst den möglichen Betrag und die Bedingungen, bevor ein Antrag rausgeht.',
        },
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
      prices: 'Pricing',
      support: 'Support',
      legal: 'Legal',
      imprint: 'Imprint',
      back: 'Back',
    },
    hero: {
      claim: 'From Delay to Pay',
      title: 'Train Delayed? We Help with Your Compensation!',
      mobileTitle: 'Train delayed? We help with your compensation!',
      sub: 'Skip the paperwork maze. RailBack checks your trip, shows your possible claim and guides you through to payout.',
      mobileSub: 'Upload ticket, check delay and receive compensation.',
      cta1: 'Get compensated!',
      mobileCta: 'Check claim now',
      cta2: 'When do I get money?',
      tag: ['SIMPLE.', 'DIGITAL.', 'STRESS-FREE.'],
      proof: [
        'Upload your ticket',
        'The delay is checked',
        'Receive your compensation',
      ],
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
    eligibility: {
      eyebrow: 'When is compensation possible?',
      title: 'If the railway makes you wait, frustration does not have to be the end of it.',
      lead: 'The amount depends on delay, ticket price and trip situation. RailBack shows what is realistically possible before you file.',
      items: [
        {
          amount: '25%',
          title: 'From 60 minutes at arrival',
          text: 'For many train journeys, a one-hour delay can qualify for a partial ticket refund.',
        },
        {
          amount: '50%',
          title: 'From 120 minutes at arrival',
          text: 'Very long delays can lead to a significantly higher claim.',
        },
        {
          amount: 'Check',
          title: 'Cancellation or missed connection',
          text: 'Cancelled trains and missed connections can also matter. We check your specific journey.',
        },
        {
          amount: 'Clarity',
          title: 'Know before you proceed',
          text: 'You see the possible amount and conditions before any claim is submitted.',
        },
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
