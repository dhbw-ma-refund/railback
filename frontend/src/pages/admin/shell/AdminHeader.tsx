import { NavLink, useNavigate } from 'react-router-dom';
import { Button } from '../ui-library';
import { clearTokens } from '../services/auth/storage';
import './AdminHeader.css';

/**
 * Top bar with brand, primary navigation and a logout button. Rendered only
 * on authenticated admin routes (AppShell decides). Logout wipes tokens and
 * bounces to /admin-panel/login.
 */
export function AdminHeader() {
  const navigate = useNavigate();

  function onLogout() {
    clearTokens();
    navigate('/admin-panel/login', { replace: true });
  }

  return (
    <header className="rb-admin-header">
      <div className="rb-admin-header__inner">
        <NavLink to="/admin-panel" end className="rb-admin-header__brand">
          RailBack Admin
        </NavLink>
        <nav className="rb-admin-header__nav" aria-label="Admin-Navigation">
          <NavLink to="/admin-panel" end>
            Dashboard
          </NavLink>
          <NavLink to="/admin-panel/users">Benutzer</NavLink>
          <NavLink to="/admin-panel/tickets">Tickets</NavLink>
          <NavLink to="/admin-panel/sepa">SEPA</NavLink>
        </nav>
        <Button variant="secondary" className="rb-admin-header__logout" onClick={onLogout}>
          Abmelden
        </Button>
      </div>
    </header>
  );
}
