import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../services/api/errors';
import { usersApi } from '../services/api/users';
import type { User, UserState } from '../services/types/user';
import { fmtDate } from '../services/format/date';
import { useDebouncedValue } from '../services/hooks/useDebouncedValue';
import { Input } from '../ui-library';
import { Table, type TableColumn } from '../ui/Table';
import { UserStateBadge } from '../ui/UserStateBadge';
import { FilterBar } from '../ui/FilterBar';
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

const STATE_OPTIONS: { value: '' | UserState; label: string }[] = [
  { value: '', label: 'Alle' },
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'SUSPENDED', label: 'SUSPENDED' },
  { value: 'DELETION_SCHEDULED', label: 'DELETION_SCHEDULED' },
];

function parseState(raw: string | null): '' | UserState {
  if (raw === 'ACTIVE' || raw === 'SUSPENDED' || raw === 'DELETION_SCHEDULED') return raw;
  return '';
}

export function UsersListPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // URL is the source of truth for filters. Local email state exists purely
  // so typing does not thrash history on every keystroke — we debounce before
  // syncing back into the URL.
  const [emailInput, setEmailInput] = useState(params.get('email') ?? '');
  const debouncedEmail = useDebouncedValue(emailInput, 300);
  const state = parseState(params.get('user_state'));

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debouncedEmail) next.set('email', debouncedEmail);
        else next.delete('email');
        next.delete('cursor'); // filter change resets pagination cursor.
        return next;
      },
      { replace: true },
    );
  }, [debouncedEmail, setParams]);

  function onChangeState(value: '' | UserState) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('user_state', value);
        else next.delete('user_state');
        next.delete('cursor');
        return next;
      },
      { replace: true },
    );
  }

  function onReset() {
    setEmailInput('');
    setParams({}, { replace: true });
  }

  const activeEmail = params.get('email') ?? '';
  const hasActiveFilters = activeEmail !== '' || state !== '';

  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ({ email: activeEmail, state, limit: 50 }),
    [activeEmail, state],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    usersApi
      .listUsers(
        {
          email: queryKey.email || undefined,
          user_state: queryKey.state || undefined,
          limit: queryKey.limit,
        },
        controller.signal,
      )
      .then((page) => setRows(page.items))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : 'Benutzer konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [queryKey]);

  return (
    <div className="rb-admin-shell">
      <h1 className="rb-admin-shell__title">Benutzer</h1>

      <FilterBar onReset={onReset} hasActiveFilters={hasActiveFilters}>
        <div className="rb-filter-bar__field">
          <Input
            label="E-Mail (Prefix)"
            type="search"
            value={emailInput}
            onChange={(e) => setEmailInput(e.currentTarget.value)}
            placeholder="anfangen mit …"
          />
        </div>
        <label className="rb-filter-bar__label">
          <span>Status</span>
          <select
            className="rb-filter-bar__select"
            value={state}
            onChange={(e) => onChangeState(parseState(e.currentTarget.value || null))}
          >
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>

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
