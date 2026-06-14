import { Button, Card, Input, StatusBadge } from '../ui-library';
import '../admin.css';

/**
 * Dashboard placeholder. Also acts as the smoke screen for WP #718: renders
 * a Button, Input, Card and StatusBadge from the shared library so the
 * design-token wire-up is visible at a glance.
 */
export function DashboardPage() {
  return (
    <div className="rb-admin-shell">
      <h1 className="rb-admin-shell__title">Admin Dashboard</h1>
      <p>Willkommen im Admin-Bereich. Wähle links einen Bereich aus.</p>

      <section className="rb-admin-shell__section">
        <h2 className="rb-admin-shell__section-title">Component-Library Smoke</h2>
        <div className="rb-admin-shell__row">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div className="rb-admin-shell__row" style={{ marginTop: 12 }}>
          <Input label="E-Mail" type="email" placeholder="admin@railback.example" />
          <StatusBadge status="approved" label="APPROVED" />
          <StatusBadge status="pending" label="PENDING" />
          <StatusBadge status="rejected" label="REJECTED" />
        </div>
        <div className="rb-admin-shell__row" style={{ marginTop: 12 }}>
          <Card>Card body — reads tokens from :root.</Card>
        </div>
      </section>
    </div>
  );
}
