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
      profile: 'Profil',
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
    auth: {
      login: {
        title: 'Anmelden',
        email: 'E-Mail',
        password: 'Passwort',
        submit: 'Anmelden',
        noAccount: 'Noch kein Konto?',
        register: 'Registrieren',
        error: 'Anmeldung fehlgeschlagen',
      },
      register: {
        title: 'Registrieren',
        step1Title: 'Persönliche Daten',
        step2Title: 'Adresse',
        step3Title: 'Bankdaten',
        step4Title: 'Bestätigung',
        vorname: 'Vorname',
        nachname: 'Nachname',
        email: 'E-Mail',
        password: 'Passwort',
        telefon: 'Telefon',
        strasse: 'Straße',
        hausnr: 'Hausnummer',
        plz: 'PLZ',
        ort: 'Ort',
        land: 'Land',
        iban: 'IBAN',
        bic: 'BIC',
        skipBank: 'Später hinzufügen',
        datenschutz: 'Ich akzeptiere die Datenschutzerklärung',
        agb: 'Ich akzeptiere die AGB',
        next: 'Weiter',
        back: 'Zurück',
        submit: 'Registrieren',
        haveAccount: 'Bereits ein Konto?',
        login: 'Anmelden',
        error: 'Registrierung fehlgeschlagen',
      },
      profile: {
        title: 'Profil',
        personalTitle: 'Persönliche Daten',
        bankTitle: 'Bankdaten',
        accountTitle: 'Konto',
        edit: 'Bearbeiten',
        save: 'Speichern',
        cancel: 'Abbrechen',
        deleteAccount: 'Konto löschen',
        deleteConfirm: 'Möchtest du dein Konto wirklich löschen?',
        confirmPassword: 'Passwort bestätigen',
        updateSuccess: 'Erfolgreich aktualisiert',
        updateError: 'Aktualisierung fehlgeschlagen',
      },
    },
  },
  en: {
    menu: {
      login: 'Log in',
      logout: 'Log out',
      account: 'Account',
      profile: 'Profile',
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
    auth: {
      login: {
        title: 'Login',
        email: 'Email',
        password: 'Password',
        submit: 'Login',
        noAccount: "Don't have an account?",
        register: 'Register',
        error: 'Login failed',
      },
      register: {
        title: 'Register',
        step1Title: 'Personal Information',
        step2Title: 'Address',
        step3Title: 'Bank Details',
        step4Title: 'Confirmation',
        vorname: 'First Name',
        nachname: 'Last Name',
        email: 'Email',
        password: 'Password',
        telefon: 'Phone',
        strasse: 'Street',
        hausnr: 'House Number',
        plz: 'Postal Code',
        ort: 'City',
        land: 'Country',
        iban: 'IBAN',
        bic: 'BIC',
        skipBank: 'Add Later',
        datenschutz: 'I accept the privacy policy',
        agb: 'I accept the terms and conditions',
        next: 'Next',
        back: 'Back',
        submit: 'Register',
        haveAccount: 'Already have an account?',
        login: 'Login',
        error: 'Registration failed',
      },
      profile: {
        title: 'Profile',
        personalTitle: 'Personal Information',
        bankTitle: 'Bank Details',
        accountTitle: 'Account',
        edit: 'Edit',
        save: 'Save',
        cancel: 'Cancel',
        deleteAccount: 'Delete Account',
        deleteConfirm: 'Do you really want to delete your account?',
        confirmPassword: 'Confirm Password',
        updateSuccess: 'Successfully updated',
        updateError: 'Update failed',
      },
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
