import { createMemo, createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { KpiCard, KpiRow } from '../components/Kpi';
import { Column, DataTable } from '../components/DataTable';
import { Input } from '../components/Form';
import { Badge } from '../components/Badge';
import { usersStore } from '../lib/store';
import { fmtCount, fmtEUR } from '../lib/format';
import type { User } from '../types';

export default function UsersPage() {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal('');

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const all = usersStore.list();
    if (!q) return all;
    return all.filter(
      u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
    );
  });

  const totalUsers = () => usersStore.list().length;
  const totalRefundAmount = () =>
    usersStore.list().reduce((s, u) => s + u.totalRefunds, 0);
  const blockedUsers = () =>
    usersStore.list().filter(u => u.status === 'blocked').length;

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (u) => (
        <div>
          <div style="font-weight:500">{u.name}</div>
          <div class="faint" style="font-size:12px" class:hide-mobile={false}>
            {u.email}
          </div>
        </div>
      ),
    },
    {
      key: 'id',
      header: 'ID',
      hideOnMobile: true,
      render: (u) => <span class="mono faint" style="font-size:12px">{u.id}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => (
        <Badge tone={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge>
      ),
    },
    {
      key: 'refunds',
      header: 'Total refunds',
      align: 'right',
      hideOnMobile: true,
      render: (u) => fmtEUR(u.totalRefunds),
    },
  ];

  return (
    <div class="page">
      <div class="page-header">
        <div>
          <div class="crumb">Users</div>
          <h1>User View</h1>
          <p class="muted" style="margin-top:4px">All registered users and their refund totals.</p>
        </div>
      </div>

      <KpiRow>
        <KpiCard
          label="Total Users"
          value={fmtCount(totalUsers())}
          hint="registered"
        />
        <KpiCard
          label="Total User Refund Amount"
          value={fmtEUR(totalRefundAmount())}
          hint="across all users"
        />
        <KpiCard
          label="Blocked Users"
          value={fmtCount(blockedUsers())}
          hint="status = blocked"
        />
      </KpiRow>

      <div style={{ 'margin-top': 'var(--s-5)', 'margin-bottom': 'var(--s-3)' }}>
        <Input
          placeholder="Search by name, email, or ID…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>

      <DataTable
        rows={filtered()}
        columns={columns}
        rowKey={(u) => u.id}
        onEdit={(u) => navigate(`/users/${u.id}/edit`)}
        emptyMessage="No users match your search."
      />
    </div>
  );
}
