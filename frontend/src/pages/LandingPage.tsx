import { Link } from 'react-router-dom';
import { Button, Card } from '@shared/components';
import './LandingPage.css';

export const LandingPage = () => {
  return (
    <div className="landing-page">
      <div className="landing-hero">
        <h1 className="landing-title">
          Fahrgastrechte demokratisieren
        </h1>

        <p className="landing-subtitle body">
          Wir nehmen Menschen den bürokratischen Stress nach Verspätungen und Zugausfällen ab
          und wandeln Frust in finanzielle Entschädigung – schnell, automatisiert und stressfrei.
        </p>

        <div className="landing-actions">
          <Link to="/user">
            <Button variant="primary" size="large">
              Antrag einreichen
            </Button>
          </Link>
          <a href="http://localhost:3005" target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" size="large">
              Admin-Bereich
            </Button>
          </a>
        </div>
      </div>

      <div className="landing-features">
        <Card elevated>
          <h3>Schnell</h3>
          <p className="body">
            Antrag in unter 60 Sekunden stellen
          </p>
        </Card>

        <Card elevated>
          <h3>Automatisiert</h3>
          <p className="body">
            Die Bahn prüft jetzt; das dauert meist 3-5 Tage
          </p>
        </Card>

        <Card elevated>
          <h3>Stressfrei</h3>
          <p className="body">
            Keine komplizierten Formulare mehr
          </p>
        </Card>
      </div>
    </div>
  );
};
