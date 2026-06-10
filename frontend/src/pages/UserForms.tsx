import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Card } from '@shared/components';
import './UserForms.css';

export const UserForms = () => {
  const [ticketNumber, setTicketNumber] = useState('');
  const [trainNumber, setTrainNumber] = useState('');
  const [date, setDate] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="user-forms-page">
        <Card elevated className="success-card">
          <div className="success-icon">✓</div>
          <h1>Gute Nachrichten!</h1>
          <p className="body">
            Dein Antrag ist bei der Bahn eingegangen. Wir melden uns, sobald es Geld zurück gibt.
          </p>
          <div className="success-actions">
            <Link to="/">
              <Button variant="primary">Zur Startseite</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="user-forms-page">
      <div className="user-forms-header">
        <Link to="/" className="back-link">← Zurück</Link>
        <h1>Deine Erstattungen</h1>
      </div>

      <Card elevated className="user-forms-card">
        <h2>Antrag einreichen</h2>
        <p className="caption">Reiche dein erstes Ticket in weniger als 1 Minute ein.</p>

        <form onSubmit={handleSubmit} className="user-form">
          <Input
            label="Ticketnummer"
            placeholder="z.B. 7313005"
            value={ticketNumber}
            onChange={(e) => setTicketNumber(e.target.value)}
            required
          />

          <Input
            label="Zugnummer"
            placeholder="z.B. ICE 123"
            value={trainNumber}
            onChange={(e) => setTrainNumber(e.target.value)}
            required
          />

          <Input
            label="Reisedatum"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />

          <Button type="submit" variant="primary" size="large">
            Antrag senden
          </Button>
        </form>
      </Card>
    </div>
  );
};
