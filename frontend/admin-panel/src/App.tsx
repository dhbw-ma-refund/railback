import { JSX, Show } from 'solid-js';
import { Route, Router, Navigate } from '@solidjs/router';
import { Shell } from './components/Shell';
import { auth } from './lib/auth';

import LoginPage from './routes/Login';
import DashboardPage from './routes/Dashboard';
import OverviewPage from './routes/Overview';
import UsersPage from './routes/Users';
import TicketsPage from './routes/Tickets';
import EditUserPage from './routes/EditUser';
import EditTicketPage from './routes/EditTicket';

function ProtectedShell(props: { children?: JSX.Element }) {
  return (
    <Show when={auth.isAuthenticated()} fallback={<Navigate href="/login" />}>
      <Shell>{props.children}</Shell>
    </Show>
  );
}

function LoginGate(props: { children?: JSX.Element }) {
  return (
    <Show when={!auth.isAuthenticated()} fallback={<Navigate href="/" />}>
      {props.children}
    </Show>
  );
}

export default function App() {
  return (
    <Router>
      <Route path="/login" component={() => <LoginGate><LoginPage /></LoginGate>} />

      <Route path="/" component={ProtectedShell}>
        <Route path="/" component={DashboardPage} />
        <Route path="/overview" component={OverviewPage} />
        <Route path="/users" component={UsersPage} />
        <Route path="/users/:id/edit" component={EditUserPage} />
        <Route path="/tickets" component={TicketsPage} />
        <Route path="/tickets/:id/edit" component={EditTicketPage} />
        <Route path="*" component={() => <Navigate href="/" />} />
      </Route>
    </Router>
  );
}
