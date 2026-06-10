/* ============================================================
   RailBack — Rechtstexte (DE, juristischer Kontext)
   Plausible Platzhalter-Inhalte, Lorem-frei.
   ============================================================ */

function ImpressumBody() {
  return (
    <div className="legal">
      <h2>Impressum</h2>
      <h3>Anbieterkennzeichnung</h3>
      <address>
        RailBack GmbH<br/>
        Musterstraße 1a<br/>
        D-68163 Mannheim<br/>
        Tel.: +49 261 89428<br/>
        E-Mail: hallo@railback.de
      </address>

      <h3>Geschäftsführung</h3>
      <p className="meta">Dr. Vorname Nachname<br/>Dr. Vorname Nachname</p>

      <h3>Sitz der Gesellschaft</h3>
      <p className="meta">Mannheim, eingetragen beim Amtsgericht Mannheim unter HRB XXXX.</p>

      <h3>Umsatzsteuer-Identifikationsnummer</h3>
      <p className="meta">gemäß § 27 a Umsatzsteuergesetz: DE 897529687</p>

      <h3>Verantwortlich für den Inhalt</h3>
      <p className="meta">Dr. Vorname Nachname (Anschrift wie oben)</p>

      <h3>Urheberrecht</h3>
      <p>Die durch RailBack erstellten Inhalte und Werke auf dieser Seite unterliegen dem deutschen
      Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb
      der Grenzen des Urheberrechts bedürfen der schriftlichen Zustimmung der RailBack GmbH.</p>
      <p>Downloads und Kopien dieser Seite sind nur für den privaten, nicht kommerziellen Gebrauch gestattet.
      Soweit die Inhalte auf dieser Seite nicht von RailBack erstellt wurden, werden die Urheberrechte Dritter beachtet.</p>

      <h3>Streitschlichtung</h3>
      <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung bereit. RailBack ist
      nicht verpflichtet und nicht bereit, an einem Streitbeilegungsverfahren vor einer
      Verbraucherschlichtungsstelle teilzunehmen.</p>
    </div>
  );
}

function RechtlichesBody() {
  return (
    <div className="legal">
      <h2>I. Allgemeine Geschäftsbedingungen von RailBack</h2>

      <h3>§ 1 Geltung</h3>
      <p>(1) Diese Allgemeinen Geschäftsbedingungen enthalten die zwischen der RailBack GmbH, Musterstraße 1a,
      68163 Mannheim (nachfolgend „RailBack“) und dem jeweiligen Nutzer (nachfolgend „Nutzer“) geltenden
      Bedingungen für die Nutzung der RailBack-Dienste zur Geltendmachung von Fahrgastrechten.</p>
      <p>(2) Änderungen dieser Allgemeinen Geschäftsbedingungen werden dem Nutzer rechtzeitig in Textform
      mitgeteilt. Sie gelten als genehmigt, wenn der Nutzer nicht innerhalb von sechs Wochen nach Mitteilung
      widerspricht.</p>

      <h3>§ 2 Definitionen</h3>
      <p>(1) Nutzer im Sinne dieser Allgemeinen Geschäftsbedingungen können Verbraucher und Unternehmer sein.</p>
      <p>(2) „Anspruch“ bezeichnet den auf Grundlage der Fahrgastrechte bestehenden Entschädigungsanspruch
      des Nutzers gegenüber dem jeweiligen Verkehrsunternehmen wegen Verspätung oder Ausfall.</p>

      <h3>§ 3 Leistungen von RailBack</h3>
      <p>RailBack unterstützt den Nutzer bei der Prüfung, Berechnung und Einreichung von Entschädigungsansprüchen.
      Ein Antrag wird ausschließlich nach ausdrücklicher Freigabe durch den Nutzer übermittelt.</p>

      <p className="ver">Version 1.0 · Mai 2026</p>

      <h2>II. Datenschutzbestimmungen</h2>

      <h3>Definition von personenbezogenen Daten</h3>
      <p>Als personenbezogene Daten werden alle Informationen bezeichnet, die sich auf eine identifizierte oder
      identifizierbare natürliche Person beziehen. Dazu zählen insbesondere Name, Kontaktdaten, Ticket- und
      Reisedaten sowie Zahlungsinformationen.</p>

      <h3>Erhebung personenbezogener Daten und Speicherdauer</h3>
      <p>Wir erheben personenbezogene Daten ausschließlich zum Zweck der Prüfung und Durchsetzung deines
      Entschädigungsanspruchs. Die Daten werden nur so lange gespeichert, wie es für diesen Zweck oder aufgrund
      gesetzlicher Aufbewahrungsfristen erforderlich ist, und anschließend gelöscht.</p>

      <h3>Allgemeines Widerspruchsrecht (Art. 21 DSGVO)</h3>
      <p>Du hast das Recht, aus Gründen, die sich aus deiner besonderen Situation ergeben, jederzeit gegen die
      Verarbeitung dich betreffender personenbezogener Daten Widerspruch einzulegen. Wir verarbeiten die Daten
      dann nicht mehr, es sei denn, es liegen zwingende schutzwürdige Gründe vor.</p>

      <h3>Einsatz von Cookies</h3>
      <p>Wir setzen Cookies ein, um die Funktionalität der Anwendung sicherzustellen und das Nutzungserlebnis
      zu verbessern. Nicht notwendige Cookies werden nur mit deiner Einwilligung gesetzt. Du kannst deine
      Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen.</p>

      <p className="meta">Bei Fragen zum Datenschutz erreichst du uns unter datenschutz@railback.de.</p>
    </div>
  );
}

Object.assign(window, { ImpressumBody, RechtlichesBody });
