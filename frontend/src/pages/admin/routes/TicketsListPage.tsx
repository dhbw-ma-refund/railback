import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../services/api/errors';
import { ticketsApi } from '../services/api/tickets';
import type { TicketListItem, TicketState } from '../services/types/ticket';
import { TICKET_STATES } from '../services/types/ticket';
import { fmtDate, fmtDateTime } from '../services/format/date';
import { useDebouncedValue } from '../services/hooks/useDebouncedValue';
import { useCursorPagination } from '../services/hooks/useCursorPagination';
import { useRememberListUrl } from '../services/hooks/useRememberListUrl';
import { Input } from '../ui-library';
import { Table, type TableColumn } from '../ui/Table';
import { TicketStateBadge } from '../ui/TicketStateBadge';
import { FilterBar } from '../ui/FilterBar';
import { Pagination } from '../ui/Pagination';
import { useToast } from '../ui/useToast';
import '../admin.css';

const PAGE_LIMIT = 50;

const COLUMNS: TableColumn<TicketListItem>[] = [
  { key: 'ticketId', header: 'Ticket', render: (t) => t.ticketId },
  { key: 'email', header: 'User', render: (t) => t.email },
  { key: 'zug', header: 'Zug', render: (t) => t.zugnummer_plan },
  { key: 'abreisedatum', header: 'Datum', render: (t) => fmtDate(t.abreisedatum) },
  { key: 'start', header: 'Start', render: (t) => t.abreisebahnhof },
  { key: 'ziel', header: 'Ziel', render: (t) => t.zielbahnhof },
  {
    key: 'state',
    header: 'State',
    render: (t) => <TicketStateBadge state={t.ticket_state} />,
  },
  { key: 'submitted_at', header: 'Angelegt', render: (t) => fmtDateTime(t.submitted_at) },
];

const TICKET_STATE_SET: ReadonlySet<TicketState> = new Set(TICKET_STATES);

function parseState(raw: string | null): '' | TicketState {
  if (raw && TICKET_STATE_SET.has(raw as TicketState)) return raw as TicketState;
  return '';
}

export function TicketsListPage() {
  const navigate = useNavigate();
  const toast = useToast();
  useRememberListUrl();
  const [params, setParams] = useSearchParams();

  const [emailInput, setEmailInput] = useState(params.get('email') ?? '');
  const [trainInput, setTrainInput] = useState(params.get('trainNr') ?? '');
  const debEmail = useDebouncedValue(emailInput, 300);
  const debTrain = useDebouncedValue(trainInput, 300);
  const state = parseState(params.get('state'));
  const date = params.get('date') ?? '';
  const activeEmail = params.get('email') ?? '';
  const activeTrain = params.get('trainNr') ?? '';
  const cursor = params.get('cursor') ?? undefined;

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debEmail) next.set('email', debEmail);
        else next.delete('email');
        next.delete('cursor');
        return next;
      },
      { replace: true },
    );
  }, [debEmail, setParams]);

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debTrain) next.set('trainNr', debTrain);
        else next.delete('trainNr');
        next.delete('cursor');
        return next;
      },
      { replace: true },
    );
  }, [debTrain, setParams]);

  function onChangeState(value: '' | TicketState) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('state', value);
        else next.delete('state');
        next.delete('cursor');
        return next;
      },
      { replace: true },
    );
  }

  function onChangeDate(value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('date', value);
        else next.delete('date');
        next.delete('cursor');
        return next;
      },
      { replace: true },
    );
  }

  function onReset() {
    setEmailInput('');
    setTrainInput('');
    setParams({}, { replace: true });
  }

  const hasActiveFilters =
    activeEmail !== '' || activeTrain !== '' || state !== '' || date !== '';

  const [rows, setRows] = useState<TicketListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const resetKey = useMemo(
    () => `${activeEmail}|${activeTrain}|${state}|${date}`,
    [activeEmail, activeTrain, state, date],
  );

  const pager = useCursorPagination({
    urlCursor: cursor,
    nextCursorFromLoad: nextCursor,
    resetKey,
    onCursorChange: (c) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (c) next.set('cursor', c);
          else next.delete('cursor');
          return next;
        },
        { replace: true },
      ),
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setForbidden(false);
    ticketsApi
      .listTickets(
        {
          email: activeEmail || undefined,
          trainNr: activeTrain || undefined,
          state: state || undefined,
          date: date || undefined,
          limit: PAGE_LIMIT,
          cursor,
        },
        controller.signal,
      )
      .then((page) => {
        setRows(page.items);
        setNextCursor(page.nextCursor);
        pager.advance(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError) {
          if (err.status === 403) {
            setForbidden(true);
            return;
          }
          if (err.status >= 500) {
            toast.show('Serverfehler beim Laden der Tickets. Bitte erneut versuchen.');
            setError(err.message);
            return;
          }
          setError(err.message);
          return;
        }
        setError('Tickets konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEmail, activeTrain, state, date, cursor]);

  return (
    <div className="rb-admin-shell">
      <h1 className="rb-admin-shell__title">Tickets</h1>

      <FilterBar onReset={onReset} hasActiveFilters={hasActiveFilters}>
        <label className="rb-filter-bar__label">
          <span>State</span>
          <select
            className="rb-filter-bar__select"
            value={state}
            onChange={(e) => onChangeState(parseState(e.currentTarget.value || null))}
          >
            <option value="">Alle</option>
            {TICKET_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="rb-filter-bar__field">
          <Input
            label="E-Mail (exakt)"
            type="search"
            value={emailInput}
            onChange={(e) => setEmailInput(e.currentTarget.value)}
          />
        </div>
        <div className="rb-filter-bar__field">
          <Input
            label="Zugnummer"
            type="search"
            value={trainInput}
            onChange={(e) => setTrainInput(e.currentTarget.value)}
            placeholder="z. B. ICE 500"
          />
        </div>
        <div className="rb-filter-bar__field">
          <Input
            label="Datum"
            type="date"
            value={date}
            onChange={(e) => onChangeDate(e.currentTarget.value)}
          />
        </div>
      </FilterBar>

      {forbidden ? (
        <div
          role="alert"
          style={{
            padding: '32px 16px',
            textAlign: 'center',
            color: 'var(--color-error-red)',
          }}
        >
          Keine Berechtigung, diese Tickets zu sehen.
        </div>
      ) : (
        <>
          <Table
            columns={COLUMNS}
            rows={rows}
            rowKey={(t) => t.ticketId}
            onRowClick={(t) =>
              navigate(`/admin-panel/tickets/${encodeURIComponent(t.ticketId)}`)
            }
            loading={loading}
            error={error}
            emptyMessage={
              hasActiveFilters
                ? 'Keine Tickets passen zu diesen Filtern.'
                : 'Noch keine Tickets vorhanden.'
            }
          />
          <Pagination
            hasPrev={pager.hasPrev}
            hasNext={pager.hasNext}
            onPrev={pager.goPrev}
            onNext={pager.goNext}
          />
        </>
      )}
    </div>
  );
}
