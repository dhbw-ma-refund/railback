import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../services/api/errors';
import { ticketsApi } from '../services/api/tickets';
import type { TicketListItem } from '../services/types/ticket';
import { fmtDate, fmtDateTime } from '../services/format/date';
import { Table, type TableColumn } from '../ui/Table';
import { TicketStateBadge } from '../ui/TicketStateBadge';
import '../admin.css';

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

export function TicketsListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    ticketsApi
      .listTickets({ limit: 50 }, controller.signal)
      .then((page) => setRows(page.items))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : 'Tickets konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="rb-admin-shell">
      <h1 className="rb-admin-shell__title">Tickets</h1>
      <Table
        columns={COLUMNS}
        rows={rows}
        rowKey={(t) => t.ticketId}
        onRowClick={(t) =>
          navigate(`/admin-panel/tickets/${encodeURIComponent(t.ticketId)}`)
        }
        loading={loading}
        error={error}
        emptyMessage="Keine Tickets gefunden."
      />
    </div>
  );
}
