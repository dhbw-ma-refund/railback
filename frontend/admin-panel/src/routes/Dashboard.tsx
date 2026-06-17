import { A } from '@solidjs/router';
import { auth } from '../lib/auth';
import { ticketsStore, usersStore } from '../lib/store';
import styles from './dashboard.module.css';

export default function DashboardPage() {
  const userCount = () => usersStore.list().length;
  const ticketCount = () => ticketsStore.list().length;
  const pendingCount = () =>
    ticketsStore.list().filter(t => t.status === 'pending').length;

  const tiles: {
    to: string;
    title: string;
    description: string;
    stat: () => string;
  }[] = [
    {
      to: '/overview',
      title: 'Overview',
      description: 'High-level statistics and recent activity.',
      stat: () => `${ticketCount()} tickets · ${userCount()} users`,
    },
    {
      to: '/tickets',
      title: 'Ticket View',
      description: 'Review, edit, and refund tickets.',
      stat: () => `${pendingCount()} pending`,
    },
    {
      to: '/users',
      title: 'User View',
      description: 'Manage user accounts and refund history.',
      stat: () => `${userCount()} registered`,
    },
  ];

  return (
    <div class="page">
      <div class="page-header">
        <div>
          <div class="crumb">Home</div>
          <h1>Welcome back, {auth.session()?.username ?? 'admin'}</h1>
          <p class="muted" style="margin-top:4px">Choose a section to begin.</p>
        </div>
      </div>

      <div class={styles.grid}>
        {tiles.map(t => (
          <A href={t.to} class={styles.tile}>
            <div class={styles.tile_label}>
              <h2>{t.title}</h2>
              <p class="muted">{t.description}</p>
            </div>
            <div class={styles.tile_stat}>{t.stat()}</div>
            <span class={styles.tile_arrow} aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16">
                <path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </A>
        ))}
      </div>
    </div>
  );
}
