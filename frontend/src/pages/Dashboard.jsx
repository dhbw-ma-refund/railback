import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../api/client';
import './Dashboard.css';

function Dashboard() {
  const { user, logout } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiClient.getTickets();
      setTickets(result.items || []);
    } catch (err) {
      setError(err.message || 'Fehler beim Laden der Tickets');
    } finally {
      setLoading(false);
    }
  };

  const getStateLabel = (state) => {
    const labels = {
      VALIDATING: 'Wird geprüft',
      READY: 'Bereit zum Absenden',
      EMAIL_SENDING: 'Antrag wird versendet',
      PENDING_DB_PAYMENT: 'Bei DB eingereicht',
      APPROVED: 'Bewilligt',
      REJECTED: 'Abgelehnt',
      COMPLETED: 'Abgeschlossen',
      EMAIL_FAILED: 'Versand fehlgeschlagen',
      INVALID: 'Gelöscht'
    };
    return labels[state] || state;
  };

  const getStateClass = (state) => {
    if (state === 'COMPLETED' || state === 'APPROVED') return 'state-success';
    if (state === 'REJECTED' || state === 'EMAIL_FAILED') return 'state-error';
    if (state === 'PENDING_DB_PAYMENT') return 'state-pending';
    return 'state-info';
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>Willkommen, {user?.vorname || 'User'}!</h1>
          <button onClick={logout} className="btn-secondary">
            Abmelden
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="tickets-section">
          <div className="section-header">
            <h2>Meine Anträge</h2>
            <button className="btn-primary">Neuer Antrag</button>
          </div>

          {loading && <div className="loading">Lädt...</div>}

          {error && (
            <div className="error-message">
              {error}
              <button onClick={loadTickets}>Erneut versuchen</button>
            </div>
          )}

          {!loading && !error && tickets.length === 0 && (
            <div className="empty-state">
              <p>Du hast noch keine Anträge gestellt.</p>
              <button className="btn-primary">Ersten Antrag erstellen</button>
            </div>
          )}

          {!loading && !error && tickets.length > 0 && (
            <div className="tickets-grid">
              {tickets.map((ticket) => (
                <div key={ticket.ticketId} className="ticket-card">
                  <div className="ticket-header">
                    <span className={`ticket-state ${getStateClass(ticket.ticket_state)}`}>
                      {getStateLabel(ticket.ticket_state)}
                    </span>
                    <span className="ticket-date">
                      {new Date(ticket.abreisedatum).toLocaleDateString('de-DE')}
                    </span>
                  </div>

                  <div className="ticket-route">
                    <div className="route-station">{ticket.abreisebahnhof}</div>
                    <div className="route-arrow">→</div>
                    <div className="route-station">{ticket.zielbahnhof}</div>
                  </div>

                  <div className="ticket-details">
                    <div className="detail-row">
                      <span className="detail-label">Ticketpreis:</span>
                      <span className="detail-value">{ticket.fahrkartenpreis} €</span>
                    </div>
                    {ticket.erwartete_erstattung && (
                      <div className="detail-row">
                        <span className="detail-label">Erwartete Erstattung:</span>
                        <span className="detail-value highlight">
                          {ticket.erwartete_erstattung} €
                        </span>
                      </div>
                    )}
                    {ticket.submitted_at && (
                      <div className="detail-row">
                        <span className="detail-label">Eingereicht am:</span>
                        <span className="detail-value">
                          {new Date(ticket.submitted_at).toLocaleDateString('de-DE')}
                        </span>
                      </div>
                    )}
                  </div>

                  <button className="btn-link">Details anzeigen →</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="quick-actions">
          <h3>Schnellzugriff</h3>
          <div className="action-cards">
            <div className="action-card">
              <h4>Profil bearbeiten</h4>
              <p>Adresse und Bankdaten aktualisieren</p>
              <button className="btn-secondary">Zum Profil →</button>
            </div>
            <div className="action-card">
              <h4>Gespeicherte Strecken</h4>
              <p>Häufig genutzte Verbindungen verwalten</p>
              <button className="btn-secondary">Strecken verwalten →</button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Dashboard;
