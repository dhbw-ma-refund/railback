import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../services/api/errors';
import { usersApi } from '../services/api/users';
import type { User } from '../services/types/user';
import { fmtDate } from '../services/format/date';
import { Table, type TableColumn } from '../ui/Table';
import { UserStateBadge } from '../ui/UserStateBadge';
import '../admin.css';

const COLUMNS: TableColumn<User>[] = [
  { key: 'email', header: 'E-Mail', render: (u) => u.email },
  { key: 'vorname', header: 'Vorname', render: (u) => u.vorname },
  { key: 'nachname', header: 'Nachname', render: (u) => u.nachname },
  { key: 'land', header: 'Land', render: (u) => u.adresse?.land ?? '—' },
  {
    key: 'state',
    header: 'Status',
    render: (u) => <UserStateBadge state={u.user_state} />,
  },
  { key: 'created_at', header: 'Anlage', render: (u) => fmtDate(u.created_at) },
];

export function UsersListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    usersApi
      .listUsers({ limit: 50 }, controller.signal)
      .then((page) => setRows(page.items))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : 'Benutzer konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="rb-admin-shell">
      <h1 className="rb-admin-shell__title">Benutzer</h1>
      <Table
        columns={COLUMNS}
        rows={rows}
        rowKey={(u) => u.email}
        onRowClick={(u) => navigate(`/admin-panel/users/${encodeURIComponent(u.email)}`)}
        loading={loading}
        error={error}
        emptyMessage="Keine Benutzer gefunden."
      />
    </div>
  );
}
