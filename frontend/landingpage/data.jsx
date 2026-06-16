/* ============================================================
   RailBack — Inhalte & i18n
   UI/Hero/FAQ und Rechtstexte zweisprachig (DE/EN).
   ============================================================ */

const I18N = {
  de: {
    nav: { faq: "FAQ", impressum: "Impressum", rechtliches: "Rechtliches", konto: "Konto", support: "Support", sprache: "Sprache" },
    auth: { signin: "Anmelden", signout: "Abmelden", loggedInAs: "Angemeldet als", guest: "Gast" },
    menu: { back: "Zurück", language: "Sprache wählen" },
    hero: {
      claim: "From Delay to Pay",
      title: "Bahnverspätung? Wir helfen bei der Entschädigung!",
      sub: "Lade dein Ticket hoch, lass die Verspätung prüfen und erhalte eine klare Übersicht über mögliche Entschädigungen. Kein Antrag wird ohne deine Freigabe versendet.",
      cta1: "Anspruch prüfen", cta2: "FAQ",
      tag: ["EINFACH.", "DIGITAL.", "STRESSFREI."],
      trust: ["Kein Antrag ohne deine Freigabe", "Antrag in unter 60 Sekunden", "DSGVO-konform aus Mannheim"],
    },
    phone: {
      time: "9:41", hi: "Hallo!", sub: "Hier ist dein Reiseüberblick.",
      route: ["Berlin Hbf", "München Hbf"], meta: "12. Mai 2025 · ICE 783",
      amt: "36,75 €", amtLabel: "mögliche Erstattung",
      delay: "Verspätung erkannt · 78 Min",
      miniT: "Ticket geprüft", miniS: "Anspruch berechnet",
      badgeT: "Erstattung möglich", badgePct: "25%",
      badgeSub: "Basierend auf Ticketpreis und erkannter Verspätung.",
    },
    faq: {
      title: "Häufige Fragen", lead: "Alles, was du über RailBack wissen musst – von der ersten Reise bis zur Auszahlung. Wähle ein Thema.",
      topics: [
        { id: "ticket", t: "Ticket hinzufügen", d: "Reise erfassen & Ticket hochladen" },
        { id: "reise", t: "Reise prüfen", d: "Verspätung automatisch erkennen" },
        { id: "anspruch", t: "Anspruch berechnen", d: "Mögliche Erstattung verstehen" },
        { id: "antrag", t: "Antrag freigeben", d: "Erst nach deiner Freigabe" },
      ],
    },
    impressum: { title: "Impressum" },
    rechtliches: { title: "Rechtliches" },
    footer: { tagline: "From Delay to Pay.", rights: "© 2026 RailBack GmbH · Alle Rechte vorbehalten." },
    toast: { soon: "Dieser Bereich liegt bei einem anderen Department – hier nur verlinkt.", login: "Du bist jetzt angemeldet.", logout: "Du wurdest abgemeldet." },
  },
  en: {
    nav: { faq: "FAQ", impressum: "Imprint", rechtliches: "Legal", konto: "Account", support: "Support", sprache: "Language" },
    auth: { signin: "Sign in", signout: "Sign out", loggedInAs: "Signed in as", guest: "Guest" },
    menu: { back: "Back", language: "Choose language" },
    hero: {
      claim: "From Delay to Pay",
      title: "Train delayed? We help you get compensated!",
      sub: "Upload your ticket, let us check the delay and get a clear overview of possible compensation. No claim is filed without your approval.",
      cta1: "Check claim", cta2: "FAQ",
      tag: ["SIMPLE.", "DIGITAL.", "STRESS-FREE."],
      trust: ["No claim without your approval", "Claim in under 60 seconds", "GDPR-compliant, made in Mannheim"],
    },
    phone: {
      time: "9:41", hi: "Hi there!", sub: "Here's your travel overview.",
      route: ["Berlin Hbf", "Munich Hbf"], meta: "12 May 2025 · ICE 783",
      amt: "€36.75", amtLabel: "possible refund",
      delay: "Delay detected · 78 min",
      miniT: "Ticket checked", miniS: "Claim calculated",
      badgeT: "Refund possible", badgePct: "25%",
      badgeSub: "Based on ticket price and detected delay.",
    },
    faq: {
      title: "Frequently asked questions", lead: "Everything you need to know about RailBack – from your first trip to the payout. Pick a topic.",
      topics: [
        { id: "ticket", t: "Add ticket", d: "Capture trip & upload ticket" },
        { id: "reise", t: "Check trip", d: "Detect delays automatically" },
        { id: "anspruch", t: "Calculate claim", d: "Understand possible refund" },
        { id: "antrag", t: "Approve claim", d: "Only after your approval" },
      ],
    },
    impressum: { title: "Imprint" },
    rechtliches: { title: "Legal" },
    footer: { tagline: "From Delay to Pay.", rights: "© 2026 RailBack GmbH · All rights reserved." },
    toast: { soon: "This area belongs to another department – linked here only.", login: "You are now signed in.", logout: "You have been signed out." },
  },
};

/* FAQ-Detailinhalte. Q/A + optionale Bild-Platzhalter, je Sprache. */
const FAQ_CONTENT = {
  de: {
    ticket: {
      img: "Screenshot: Ticket-Upload-Screen",
      qa: [
        { q: "Wie füge ich ein Ticket hinzu?", a: ["Tippe auf „Anspruch prüfen“, fotografiere dein Ticket oder lade ein PDF hoch. RailBack liest Strecke, Datum und Zugnummer automatisch aus."] },
        { q: "Welche Tickets werden unterstützt?", a: ["Einzel- und Sparpreis-Tickets im Fernverkehr sowie viele Nahverkehrstickets. Du brauchst nur den QR-Code oder die Buchungsnummer."] },
        { q: "Was, wenn die Daten falsch erkannt wurden?", a: ["Du kannst jedes Feld vor dem Absenden korrigieren. Wir zeigen dir die erkannten Werte immer zur Kontrolle an."] },
      ],
    },
    reise: {
      img: "Screenshot: Reise-/Verspätungsprüfung",
      qa: [
        { q: "Wie wird die Verspätung geprüft?", a: ["Wir gleichen deine Zugverbindung mit den offiziellen Ist-Fahrplandaten ab und ermitteln die tatsächliche Ankunftsverspätung in Minuten."] },
        { q: "Ab wann habe ich Anspruch?", a: ["Ab 60 Minuten Verspätung erhältst du in der Regel 25 %, ab 120 Minuten 50 % des Ticketpreises. RailBack rechnet das automatisch für dich aus."] },
        { q: "Muss ich die Verspätung selbst nachweisen?", a: ["Nein. Wir dokumentieren die Verspätung automatisch und hinterlegen den Nachweis für deinen Antrag."] },
      ],
    },
    anspruch: {
      img: "Screenshot: Anspruchsberechnung",
      img2: "Diagramm: Erstattungsstufen 25 % / 50 %",
      qa: [
        { q: "Wie wird meine Erstattung berechnet?", a: ["Grundlage ist dein Ticketpreis multipliziert mit der gesetzlichen Erstattungsstufe (25 % oder 50 %), die sich aus der erkannten Verspätung ergibt."] },
        { q: "Was bedeutet „mögliche Erstattung“?", a: ["Das ist der voraussichtliche Betrag auf Basis der aktuellen Daten. Der final bewilligte Betrag wird von der Bahn bestätigt."] },
        { q: "Fallen für mich Kosten an?", a: ["Die Prüfung und Berechnung sind kostenlos. Eventuelle Servicegebühren werden dir immer transparent vor der Freigabe angezeigt."] },
      ],
    },
    antrag: {
      img: "Screenshot: Antrag-Freigabe & Status",
      qa: [
        { q: "Wird der Antrag automatisch versendet?", a: ["Nein. Kein Antrag verlässt RailBack ohne deine ausdrückliche Freigabe. Du behältst die volle Kontrolle."] },
        { q: "Was passiert nach der Freigabe?", a: ["Wir reichen deinen Antrag bei der Bahn ein. Die Prüfung dauert meist 3–5 Tage – du siehst den Status jederzeit in der App."] },
        { q: "Wohin wird die Erstattung ausgezahlt?", a: ["Auf das von dir hinterlegte Konto (IBAN). Sobald die Auszahlung initiiert ist, bekommst du eine Benachrichtigung."] },
      ],
    },
  },
  en: {
    ticket: {
      img: "Screenshot: ticket upload screen",
      qa: [
        { q: "How do I add a ticket?", a: ["Tap “Check claim”, take a photo of your ticket or upload a PDF. RailBack reads route, date and train number automatically."] },
        { q: "Which tickets are supported?", a: ["Single and saver fares on long-distance trains plus many regional tickets. All we need is the QR code or booking number."] },
        { q: "What if the data was read incorrectly?", a: ["You can correct every field before submitting. We always show you the detected values for review."] },
      ],
    },
    reise: {
      img: "Screenshot: trip / delay check",
      qa: [
        { q: "How is the delay verified?", a: ["We match your connection against the official actual timetable data and determine the real arrival delay in minutes."] },
        { q: "When am I entitled to a refund?", a: ["From 60 minutes you usually get 25 %, from 120 minutes 50 % of the ticket price. RailBack calculates this automatically."] },
        { q: "Do I have to prove the delay myself?", a: ["No. We document the delay automatically and store the evidence for your claim."] },
      ],
    },
    anspruch: {
      img: "Screenshot: claim calculation",
      img2: "Chart: refund tiers 25 % / 50 %",
      qa: [
        { q: "How is my refund calculated?", a: ["It is based on your ticket price multiplied by the statutory refund tier (25 % or 50 %) derived from the detected delay."] },
        { q: "What does “possible refund” mean?", a: ["It is the expected amount based on current data. The final approved amount is confirmed by the railway."] },
        { q: "Are there any costs for me?", a: ["Checking and calculating are free. Any service fees are always shown transparently before you approve."] },
      ],
    },
    antrag: {
      img: "Screenshot: claim approval & status",
      qa: [
        { q: "Is the claim sent automatically?", a: ["No. No claim leaves RailBack without your explicit approval. You stay in full control."] },
        { q: "What happens after I approve?", a: ["We file your claim with the railway. Review usually takes 3–5 days – you can see the status in the app anytime."] },
        { q: "Where is the refund paid out?", a: ["To the account (IBAN) you provided. As soon as the payout is initiated, you get a notification."] },
      ],
    },
  },
};

Object.assign(window, { I18N, FAQ_CONTENT });
