import { useSmartBack } from '../hooks/useSmartBack';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { useLanguage } from '../lib/LanguageContext';
import type { ReactNode } from 'react';
import type { Language } from '../lib/LanguageContext';
import './LegalPage.css';

type LegalPageType = 'impressum' | 'rechtliches';

interface LegalPageProps {
  type: LegalPageType;
}

const LEGAL_CONTENT: Record<
  Language,
  {
    impressum: {
      title: string;
      provider: string;
      company: ReactNode;
      management: string;
      managers: ReactNode;
      seatTitle: string;
      seat: string;
      bankTitle: string;
      bank: ReactNode;
      vatTitle: string;
      vat: string;
      contentTitle: string;
      content: ReactNode;
      copyrightTitle: string;
      copyright: string[];
      disputeTitle: string;
      dispute: string;
    };
    legal: {
      title: string;
      termsTitle: string;
      validityTitle: string;
      validity: string[];
      definitionsTitle: string;
      definitions: string[];
      servicesTitle: string;
      services: string;
      version: string;
      privacyTitle: string;
      personalDataTitle: string;
      personalData: string;
      storageTitle: string;
      storage: string;
      objectionTitle: string;
      objection: string;
      cookiesTitle: string;
      cookies: string;
      privacyContact: string;
    };
  }
> = {
  de: {
    impressum: {
      title: 'Impressum',
      provider: 'Anbieterkennzeichnung',
      company: (
        <>
          Elaspix UG<br />
          Schliffkopfstraße 25<br />
          D - 68163 Mannheim<br />
          Fon: 0621 586 799 21<br />
          Mobil: 0176 226 945 84<br />
          E-Mail: support@railback.de
        </>
      ),
      management: 'Geschäftsführung',
      managers: (
        <>
          Dr. Tobias Günther
        </>
      ),
      seatTitle: 'Sitz der Gesellschaft',
      seat: 'Mannheim, eingetragen beim Amtsgericht Mannheim unter HRB 705891.',
      bankTitle: 'Bankverbindung',
      bank: (
        <>
          Deutsche Bank Mannheim<br />
          BIC: DEUTDEDBMAN<br />
          IBAN: DE68 6707 0024 0019 5917 00
        </>
      ),
      vatTitle: 'Umsatzsteuer-Identifikationsnummer',
      vat: 'gemäß § 27 a Umsatzsteuergesetz: DE263390229',
      contentTitle: 'Verantwortlich für den Inhalt',
      content: (
        <>
          Elaspix UG<br />
          Dr. Tobias Günther<br />
          Schliffkopfstraße 25<br />
          D - 68163 Mannheim
        </>
      ),
      copyrightTitle: 'Urheberrecht',
      copyright: [
        'Die durch RailBack erstellten Inhalte und Werke auf dieser Seite unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechts bedürfen der schriftlichen Zustimmung der Elaspix UG.',
        'Downloads und Kopien dieser Seite sind nur für den privaten, nicht kommerziellen Gebrauch gestattet. Soweit die Inhalte auf dieser Seite nicht von RailBack erstellt wurden, werden die Urheberrechte Dritter beachtet.',
      ],
      disputeTitle: 'Streitschlichtung',
      dispute:
        'Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.',
    },
    legal: {
      title: 'Rechtliches',
      termsTitle: 'I. Allgemeine Geschäftsbedingungen von RailBack',
      validityTitle: '§ 1 Geltung',
      validity: [
        'Diese Allgemeinen Geschäftsbedingungen enthalten die zwischen der Elaspix UG, Schliffkopfstraße 25, D - 68163 Mannheim (nachfolgend „RailBack“) und dem jeweiligen Nutzer (nachfolgend „Nutzer“) geltenden Bedingungen für die Nutzung der RailBack-Dienste zur Geltendmachung von Fahrgastrechten.',
        'Änderungen dieser Allgemeinen Geschäftsbedingungen werden dem Nutzer rechtzeitig in Textform mitgeteilt. Sie gelten als genehmigt, wenn der Nutzer nicht innerhalb von sechs Wochen nach Mitteilung widerspricht.',
      ],
      definitionsTitle: '§ 2 Definitionen',
      definitions: [
        'Nutzer im Sinne dieser Allgemeinen Geschäftsbedingungen können Verbraucher und Unternehmer sein.',
        '„Anspruch“ bezeichnet den auf Grundlage der Fahrgastrechte bestehenden Entschädigungsanspruch des Nutzers gegenüber dem jeweiligen Verkehrsunternehmen wegen Verspätung oder Ausfall.',
      ],
      servicesTitle: '§ 3 Leistungen von RailBack',
      services:
        'RailBack unterstützt den Nutzer bei der Prüfung, Berechnung und Einreichung von Entschädigungsansprüchen. Ein Antrag wird ausschließlich nach ausdrücklicher Freigabe durch den Nutzer übermittelt.',
      version: 'Version 1.0 · Mai 2026',
      privacyTitle: 'II. Datenschutzbestimmungen',
      personalDataTitle: 'Definition von personenbezogenen Daten',
      personalData:
        'Als personenbezogene Daten werden alle Informationen bezeichnet, die sich auf eine identifizierte oder identifizierbare natürliche Person beziehen. Dazu zählen insbesondere Name, Kontaktdaten, Ticket- und Reisedaten sowie Zahlungsinformationen.',
      storageTitle: 'Erhebung personenbezogener Daten und Speicherdauer',
      storage:
        'Wir erheben personenbezogene Daten ausschließlich zum Zweck der Prüfung und Durchsetzung deines Entschädigungsanspruchs. Die Daten werden nur so lange gespeichert, wie es für diesen Zweck oder aufgrund gesetzlicher Aufbewahrungsfristen erforderlich ist, und anschließend gelöscht.',
      objectionTitle: 'Allgemeines Widerspruchsrecht (Art. 21 DSGVO)',
      objection:
        'Du hast das Recht, aus Gründen, die sich aus deiner besonderen Situation ergeben, jederzeit gegen die Verarbeitung dich betreffender personenbezogener Daten Widerspruch einzulegen. Wir verarbeiten die Daten dann nicht mehr, es sei denn, es liegen zwingende schutzwürdige Gründe vor.',
      cookiesTitle: 'Einsatz von Cookies',
      cookies:
        'Wir setzen Cookies ein, um die Funktionalität der Anwendung sicherzustellen und das Nutzungserlebnis zu verbessern. Nicht notwendige Cookies werden nur mit deiner Einwilligung gesetzt. Du kannst deine Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen.',
      privacyContact: 'Bei Fragen zum Datenschutz erreichst du uns unter datenschutz@railback.de.',
    },
  },
  en: {
    impressum: {
      title: 'Imprint',
      provider: 'Provider identification',
      company: (
        <>
          Elaspix UG<br />
          Schliffkopfstraße 25<br />
          D - 68163 Mannheim<br />
          Phone: +49 621 586 799 21<br />
          Mobile: +49 176 226 945 84<br />
          Email: support@railback.de
        </>
      ),
      management: 'Management',
      managers: (
        <>
          Dr. Tobias Günther
        </>
      ),
      seatTitle: 'Registered office',
      seat: 'Mannheim, registered with the Local Court of Mannheim under HRB 705891.',
      bankTitle: 'Bank details',
      bank: (
        <>
          Deutsche Bank Mannheim<br />
          BIC: DEUTDEDBMAN<br />
          IBAN: DE68 6707 0024 0019 5917 00
        </>
      ),
      vatTitle: 'VAT identification number',
      vat: 'pursuant to Section 27a German VAT Act: DE263390229',
      contentTitle: 'Responsible for content',
      content: (
        <>
          Elaspix UG<br />
          Dr. Tobias Günther<br />
          Schliffkopfstraße 25<br />
          D - 68163 Mannheim
        </>
      ),
      copyrightTitle: 'Copyright',
      copyright: [
        'The content and works created by RailBack on this website are subject to German copyright law. Reproduction, editing, distribution and any kind of use beyond the limits of copyright require the written consent of Elaspix UG.',
        'Downloads and copies of this website are permitted for private, non-commercial use only. Where content on this website was not created by RailBack, third-party copyrights are respected.',
      ],
      disputeTitle: 'Dispute resolution',
      dispute:
        'We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.',
    },
    legal: {
      title: 'Legal',
      termsTitle: 'I. General Terms and Conditions of RailBack',
      validityTitle: 'Section 1 Scope',
      validity: [
        'These General Terms and Conditions set out the terms applicable between Elaspix UG, Schliffkopfstraße 25, D - 68163 Mannheim (hereinafter "RailBack") and the respective user (hereinafter "User") for the use of RailBack services for asserting passenger rights.',
        'Changes to these General Terms and Conditions will be communicated to the User in text form in good time. They are deemed approved if the User does not object within six weeks after notification.',
      ],
      definitionsTitle: 'Section 2 Definitions',
      definitions: [
        'Users within the meaning of these General Terms and Conditions may be consumers or entrepreneurs.',
        '"Claim" means the compensation claim of the User against the respective transport company based on passenger rights due to delay or cancellation.',
      ],
      servicesTitle: 'Section 3 RailBack services',
      services:
        'RailBack supports the User in checking, calculating and submitting compensation claims. A claim is transmitted only after the User has expressly approved it.',
      version: 'Version 1.0 · May 2026',
      privacyTitle: 'II. Privacy Policy',
      personalDataTitle: 'Definition of personal data',
      personalData:
        'Personal data means any information relating to an identified or identifiable natural person. This includes in particular name, contact details, ticket and travel data, and payment information.',
      storageTitle: 'Collection of personal data and storage period',
      storage:
        'We collect personal data exclusively for the purpose of checking and enforcing your compensation claim. The data is stored only for as long as necessary for this purpose or due to statutory retention periods and is then deleted.',
      objectionTitle: 'General right to object (Art. 21 GDPR)',
      objection:
        'You have the right to object at any time, on grounds relating to your particular situation, to the processing of personal data concerning you. We will then no longer process the data unless compelling legitimate grounds apply.',
      cookiesTitle: 'Use of cookies',
      cookies:
        'We use cookies to ensure the functionality of the application and improve the user experience. Non-essential cookies are set only with your consent. You can withdraw your consent at any time with effect for the future.',
      privacyContact: 'For questions about data protection, contact us at datenschutz@railback.de.',
    },
  },
};

const Paragraphs = ({ items }: { items: string[] }) => (
  <>
    {items.map((item) => (
      <p key={item}>{item}</p>
    ))}
  </>
);

const ImpressumContent = ({ lang }: { lang: Language }) => {
  const copy = LEGAL_CONTENT[lang].impressum;

  return (
    <article className="legal-card" lang={lang}>
      <h1>{copy.title}</h1>
      <h2>{copy.provider}</h2>
      <address>{copy.company}</address>

      <h2>{copy.management}</h2>
      <p className="legal-card__meta">{copy.managers}</p>

      <h2>{copy.seatTitle}</h2>
      <p className="legal-card__meta">{copy.seat}</p>

      <h2>{copy.bankTitle}</h2>
      <p className="legal-card__meta">{copy.bank}</p>

      <h2>{copy.vatTitle}</h2>
      <p className="legal-card__meta">{copy.vat}</p>

      <h2>{copy.contentTitle}</h2>
      <p className="legal-card__meta">{copy.content}</p>

      <h2>{copy.copyrightTitle}</h2>
      <Paragraphs items={copy.copyright} />

      <h2>{copy.disputeTitle}</h2>
      <p>{copy.dispute}</p>
    </article>
  );
};

const RechtlichesContent = ({ lang }: { lang: Language }) => {
  const copy = LEGAL_CONTENT[lang].legal;

  return (
    <article className="legal-card" lang={lang}>
      <h1>{copy.title}</h1>

      <h2>{copy.termsTitle}</h2>
      <h3>{copy.validityTitle}</h3>
      <Paragraphs items={copy.validity} />

      <h3>{copy.definitionsTitle}</h3>
      <Paragraphs items={copy.definitions} />

      <h3>{copy.servicesTitle}</h3>
      <p>{copy.services}</p>

      <p className="legal-card__version">{copy.version}</p>

      <h2>{copy.privacyTitle}</h2>

      <h3>{copy.personalDataTitle}</h3>
      <p>{copy.personalData}</p>

      <h3>{copy.storageTitle}</h3>
      <p>{copy.storage}</p>

      <h3>{copy.objectionTitle}</h3>
      <p>{copy.objection}</p>

      <h3>{copy.cookiesTitle}</h3>
      <p>{copy.cookies}</p>

      <p className="legal-card__meta">{copy.privacyContact}</p>
    </article>
  );
};

export const LegalPage = ({ type }: LegalPageProps) => {
  const goBack = useSmartBack('/');
  const { lang, t } = useLanguage();

  return (
    <div className="legal-page">
      <Header />
      <main className="legal-main">
        <div className="wrap container legal-page__content fade-in">
          <div className="legal-page__head">
            <button
              className="rb-button rb-button--secondary rb-button--medium legal-page__back"
              onClick={goBack}
            >
              {/* Gleiches Pfeil-Icon wie auf FAQ- und Preise-Seite, damit alle
                  Zurück-Buttons ein einheitliches Design haben. */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              {t.menu.back}
            </button>
          </div>
          {type === 'impressum' ? <ImpressumContent lang={lang} /> : <RechtlichesContent lang={lang} />}
        </div>
      </main>
      <Footer />
    </div>
  );
};
