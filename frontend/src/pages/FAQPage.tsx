import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../lib/LanguageContext';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import './FAQPage.css';

// Icon component
const Icon = ({
  name,
  size = 20,
  color = 'currentColor',
  className,
}: {
  name: string;
  size?: number;
  color?: string;
  className?: string;
}) => {
  const icons: Record<string, JSX.Element> = {
    ticket: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/>
        <path d="M8 9h5"/>
        <path d="M8 12h3"/>
        <polyline points="13.5 13.2 15.4 15 18.4 11.5"/>
      </svg>
    ),
    clock: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <polyline points="12 7 12 12 15 14"/>
      </svg>
    ),
    euro: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
        <path d="M15 21q-2.95 0-5.25-1.675T6.5 15H3v-2h3.05Q5.975 12.4 5.988 11.888T6.05 11H3V9h3.5q.95-2.65 3.25-4.325T15 3q1.725 0 3.263.613T21 5.3l-1.425 1.4q-.925-.8-2.087-1.25T15 5q-2.125 0-3.8 1.113T8.675 9H15v2H8.075q-.1.675-.075 1.188t.075.812H15v2H8.675q.85 1.775 2.525 2.888T15 19q1.325 0 2.488-.45t2.087-1.25L21 18.7q-1.2 1.075-2.738 1.688T15 21Z"/>
      </svg>
    ),
    checkCircle: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <polyline points="8 12 11 15 16 9"/>
      </svg>
    ),
    chevronRight: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 6 15 12 9 18" />
      </svg>
    ),
    chevronDown: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    ),
    arrowLeft: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
    ),
  };
  const icon = icons[name];
  return icon ? <span className={className}>{icon}</span> : null;
};

interface QA {
  q: string;
  a: string[];
}

interface TopicContent {
  img: string;
  img2?: string;
  qa: QA[];
}

const content: Record<string, Record<string, TopicContent>> = {
  de: {
    ticket: {
      img: 'Screenshot: Ticket-Upload-Screen',
      qa: [
        { q: 'Wie füge ich ein Ticket hinzu?', a: ['Tippe auf „Anspruch prüfen", fotografiere dein Ticket oder lade ein PDF hoch. RailBack liest Strecke, Datum und Zugnummer automatisch aus.'] },
        { q: 'Welche Tickets werden unterstützt?', a: ['Einzel- und Sparpreis-Tickets im Fernverkehr sowie viele Nahverkehrstickets. Du brauchst nur den QR-Code oder die Buchungsnummer.'] },
        { q: 'Was, wenn die Daten falsch erkannt wurden?', a: ['Du kannst jedes Feld vor dem Absenden korrigieren. Wir zeigen dir die erkannten Werte immer zur Kontrolle an.'] },
      ],
    },
    reise: {
      img: 'Screenshot: Reise-/Verspätungsprüfung',
      qa: [
        { q: 'Wie wird die Verspätung geprüft?', a: ['Wir gleichen deine Zugverbindung mit den offiziellen Ist-Fahrplandaten ab und ermitteln die tatsächliche Ankunftsverspätung in Minuten.'] },
        { q: 'Ab wann habe ich Anspruch?', a: ['Ab 60 Minuten Verspätung erhältst du in der Regel 25 %, ab 120 Minuten 50 % des Ticketpreises. RailBack rechnet das automatisch für dich aus.'] },
        { q: 'Muss ich die Verspätung selbst nachweisen?', a: ['Nein. Wir dokumentieren die Verspätung automatisch und hinterlegen den Nachweis für deinen Antrag.'] },
      ],
    },
    anspruch: {
      img: 'Screenshot: Anspruchsberechnung',
      img2: 'Diagramm: Erstattungsstufen 25 % / 50 %',
      qa: [
        { q: 'Wie wird meine Erstattung berechnet?', a: ['Grundlage ist dein Ticketpreis multipliziert mit der gesetzlichen Erstattungsstufe (25 % oder 50 %), die sich aus der erkannten Verspätung ergibt.'] },
        { q: 'Was bedeutet „mögliche Erstattung"?', a: ['Das ist der voraussichtliche Betrag auf Basis der aktuellen Daten. Der final bewilligte Betrag wird von der Bahn bestätigt.'] },
        { q: 'Fallen für mich Kosten an?', a: ['Die Prüfung und Berechnung sind kostenlos. Eventuelle Servicegebühren werden dir immer transparent vor der Freigabe angezeigt.'] },
      ],
    },
    antrag: {
      img: 'Screenshot: Antrag-Freigabe & Status',
      qa: [
        { q: 'Wird der Antrag automatisch versendet?', a: ['Nein. Kein Antrag verlässt RailBack ohne deine ausdrückliche Freigabe. Du behältst die volle Kontrolle.'] },
        { q: 'Was passiert nach der Freigabe?', a: ['Wir reichen deinen Antrag bei der Bahn ein. Die Prüfung dauert meist 3–5 Tage – du siehst den Status jederzeit in der App.'] },
        { q: 'Wohin wird die Erstattung ausgezahlt?', a: ['Auf das von dir hinterlegte Konto (IBAN). Sobald die Auszahlung initiiert ist, bekommst du eine Benachrichtigung.'] },
      ],
    },
  },
  en: {
    ticket: {
      img: 'Screenshot: ticket upload screen',
      qa: [
        { q: 'How do I add a ticket?', a: ['Tap "Check claim", take a photo of your ticket or upload a PDF. RailBack reads route, date and train number automatically.'] },
        { q: 'Which tickets are supported?', a: ['Single and saver fares on long-distance trains plus many regional tickets. All we need is the QR code or booking number.'] },
        { q: 'What if the data was read incorrectly?', a: ['You can correct every field before submitting. We always show you the detected values for review.'] },
      ],
    },
    reise: {
      img: 'Screenshot: trip / delay check',
      qa: [
        { q: 'How is the delay verified?', a: ['We match your connection against the official actual timetable data and determine the real arrival delay in minutes.'] },
        { q: 'When am I entitled to a refund?', a: ['From 60 minutes you usually get 25 %, from 120 minutes 50 % of the ticket price. RailBack calculates this automatically.'] },
        { q: 'Do I have to prove the delay myself?', a: ['No. We document the delay automatically and store the evidence for your claim.'] },
      ],
    },
    anspruch: {
      img: 'Screenshot: claim calculation',
      img2: 'Chart: refund tiers 25 % / 50 %',
      qa: [
        { q: 'How is my refund calculated?', a: ['It is based on your ticket price multiplied by the statutory refund tier (25 % or 50 %) derived from the detected delay.'] },
        { q: 'What does "possible refund" mean?', a: ['It is the expected amount based on current data. The final approved amount is confirmed by the railway.'] },
        { q: 'Are there any costs for me?', a: ['Checking and calculating are free. Any service fees are always shown transparently before you approve.'] },
      ],
    },
    antrag: {
      img: 'Screenshot: claim approval & status',
      qa: [
        { q: 'Is the claim sent automatically?', a: ['No. No claim leaves RailBack without your explicit approval. You stay in full control.'] },
        { q: 'What happens after I approve?', a: ['We file your claim with the railway. Review usually takes 3–5 days – you can see the status in the app anytime.'] },
        { q: 'Where is the refund paid out?', a: ['To the account (IBAN) you provided. As soon as the payout is initiated, you get a notification.'] },
      ],
    },
  },
};

const ImgPlaceholder = ({ label }: { label: string }) => (
  <div className="imgph">
    <div className="label">{label}</div>
  </div>
);

export const FAQPage = () => {
  const navigate = useNavigate();
  const { lang, t } = useLanguage();
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [openQA, setOpenQA] = useState<number>(0);

  const topics = t.faq.topics;
  const faqContent = content[lang];

  if (selectedTopic) {
    const topic = topics.find((t: any) => t.id === selectedTopic)!;
    const topicContent = faqContent[selectedTopic];

    return (
      <div className="faq-page">
        <Header />
        <main className="faq-main">
          <div className="wrap container page page--detail fade-in">
            <div className="page__head">
              <button
                className="rb-button rb-button--secondary rb-button--medium back"
                onClick={() => setSelectedTopic(null)}
              >
                <Icon name="arrowLeft" size={18} /> {t.menu.faq}
              </button>
            </div>
            <h1 className="h1 title">{topic.t}</h1>
            <p className="page__lead">{topic.d}</p>

            <ImgPlaceholder label={topicContent.img} />
            <div className="qa-wrap">
              {topicContent.qa.map((item, i) => (
                <div className={`qa${openQA === i ? ' open' : ''}`} key={i}>
                  <button
                    className="qa__q"
                    onClick={() => setOpenQA(openQA === i ? -1 : i)}
                  >
                    <span className="num">{i + 1}</span>
                    <span className="qa__q-text">{item.q}</span>
                    <Icon name="chevronDown" size={18} className="chev" />
                  </button>
                  <div className="qa__a">
                    <div className="qa__a-inner">
                      {item.a.map((para, j) => <p key={j}>{para}</p>)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {topicContent.img2 && (
              <div className="faq-detail__secondary-image">
                <ImgPlaceholder label={topicContent.img2} />
              </div>
            )}
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="faq-page">
      <Header />
      <main className="faq-main">
        <div className="wrap container page page--overview fade-in">
          <div className="page__head">
            <button
              className="rb-button rb-button--secondary rb-button--medium back"
              onClick={() => navigate('/')}
            >
              <Icon name="arrowLeft" size={18} /> {t.menu.back}
            </button>
          </div>
          <h1 className="h1 title">{t.faq.title}</h1>
          <p className="page__lead">{t.faq.lead}</p>
          <div className="faq-grid">
            {topics.map((topic: any) => (
              <button
                className="faq-tile"
                key={topic.id}
                onClick={() => setSelectedTopic(topic.id)}
              >
                <span className="faq-tile__ic">
                  <Icon name={topic.icon} size={24} />
                </span>
                <span>
                  <span className="faq-tile__t">{topic.t}</span>
                  <span className="faq-tile__d">{topic.d}</span>
                </span>
                <Icon name="chevronRight" size={20} className="faq-tile__arrow" color="var(--color-muted-gray-blue)" />
              </button>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};
