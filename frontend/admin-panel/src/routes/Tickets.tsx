import { createMemo, createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { KpiCard, KpiRow } from '../components/Kpi';
import { Column, DataTable } from '../components/DataTable';
import { Input } from '../components/Form';
import { Badge } from '../components/Badge';
import { ticketsStore } from '../lib/store';
import { fmtCount, fmtDate, fmtEUR } from '../lib/format';
import type { Ticket, TicketStatus } from '../types';

const statusTone: Record<TicketStatus, 'success' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  booked:    'info',
  pending:   'warn',
  cancelled: 'danger',
  refunded:  'danger',
  used:      'success',
};

export default function TicketsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal('');

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const all = ticketsStore.list();
    if (!q) return all;
    return all.filter(t =>
      t.id.toLowerCase().includes(q) ||
      t.source.toLowerCase().includes(q) ||
      t.destination.toLowerCase().includes(q) ||
      t.trainNumber.toLowerCase().includes(q)
    );
  });

  const totalTickets = () => ticketsStore.list().length;
  const pending = () =>
    ticketsStore.list().filter(t => t.status === 'pending').length;
  const refunded = () =>
    ticketsStore.list().filter(t => t.status === 'refunded');
  const totalRefunded = () =>
    refunded().reduce((s, t) => s + t.price, 0);

  const columns: Column<Ticket>[] = [
    {
      key: 'route',
      header: 'Source → Destination',
      render: (t) => (
        <div>
          <div style="font-weight:500">{t.source} → {t.destination}</div>
          <div class="faint" style="font-size:12px">
            {fmtDate(t.departure)} · {t.trainNumber}
          </div>
        </div>
      ),
    },
    {
      key: 'id',
      header: 'ID',
      hideOnMobile: true,
      render: (t) => <span class="mono faint" style="font-size:12px">{t.id}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => <Badge tone={statusTone[t.status]}>{t.status}</Badge>,
    },
    {
      key: 'class',
      header: 'Class',
      hideOnMobile: true,
      render: (t) => (t.class === 'first' ? '1st' : '2nd'),
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      hideOnMobile: true,
      render: (t) => fmtEUR(t.price),
    },
  ];

  return (
    <div class="page">
      <div class="page-header">
        <div>
          <div class="crumb">Tickets</div>
          <h1>Ticket View</h1>
          <p class="muted" style="margin-top:4px">All tickets, including refunds and cancellations.</p>
        </div>
      </div>

      <KpiRow>
        <KpiCard label="Total Tickets" value={fmtCount(totalTickets())} hint="all time" />
        <KpiCard label="Pending Tickets" value={fmtCount(pending())} hint="open / unprocessed" />
        <KpiCard label="Total Refunded" value={fmtEUR(totalRefunded())} hint="sum across refunds" />
        <KpiCard label="Refund Count" value={fmtCount(refunded().length)} hint="refunded tickets" />
      </KpiRow>

      <div style={{ 'margin-top': 'var(--s-5)', 'margin-bottom': 'var(--s-3)' }}>
        <Input
          placeholder="Search by ID, source, destination, or train…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>

      <DataTable
        rows={filtered()}
        columns={columns}
        rowKey={(t) => t.id}
        onEdit={(t) => navigate(`/tickets/${t.id}/edit`)}
        emptyMessage="No tickets match your search."
      />
    </div>
  );
}
