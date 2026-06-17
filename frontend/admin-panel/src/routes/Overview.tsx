import { KpiCard, KpiRow } from '../components/Kpi';
import { ticketsStore, usersStore } from '../lib/store';
import { fmtCount, fmtEUR } from '../lib/format';

export default function OverviewPage() {
  const stats = () => {
    const users = usersStore.list();
    const tickets = ticketsStore.list();
    const pending = tickets.filter(t => t.status === 'pending').length;
    const refunded = tickets.filter(t => t.status === 'refunded');
    const totalRefundedAmt = refunded.reduce((s, t) => s + t.price, 0);
    const revenue = tickets
      .filter(t => t.status === 'used' || t.status === 'booked')
      .reduce((s, t) => s + t.price, 0);
    return {
      users: users.length,
      tickets: tickets.length,
      pending,
      refundedCount: refunded.length,
      totalRefundedAmt,
      revenue,
      blockedUsers: users.filter(u => u.status === 'blocked').length,
    };
  };

  return (
    <div class="page">
      <div class="page-header">
        <div>
          <div class="crumb">Overview</div>
          <h1>Statistics</h1>
          <p class="muted" style="margin-top:4px">A snapshot of users, tickets, and refunds.</p>
        </div>
      </div>

      <KpiRow>
        <KpiCard label="Total Users" value={fmtCount(stats().users)} hint="registered accounts" />
        <KpiCard label="Total Tickets" value={fmtCount(stats().tickets)} hint="all time" />
        <KpiCard label="Pending Tickets" value={fmtCount(stats().pending)} hint="open / unprocessed" />
        <KpiCard label="Refunded Tickets" value={fmtCount(stats().refundedCount)} hint="count" />
        <KpiCard label="Total Refunded" value={fmtEUR(stats().totalRefundedAmt)} hint="sum of refunds" />
        <KpiCard label="Revenue" value={fmtEUR(stats().revenue)} hint="booked + used" />
        <KpiCard label="Blocked Users" value={fmtCount(stats().blockedUsers)} hint="status = blocked" />
      </KpiRow>

      <div style={{ 'margin-top': 'var(--s-6)' }}>
        <div
          style={{
            background: 'var(--c-bg)',
            border: '1px solid var(--c-border)',
            'border-radius': 'var(--radius-lg)',
            padding: 'var(--s-5)',
          }}
        >
          <h2 style="margin-bottom:6px">About this view</h2>
          <p class="muted">
            This page consolidates aggregate metrics across users and tickets.
            Drill into <strong>Tickets</strong> or <strong>Users</strong> from
            the menu for record-level views.
          </p>
        </div>
      </div>
    </div>
  );
}
