import { JSX, Show, createSignal, onCleanup } from 'solid-js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import { Portal } from 'solid-js/web';
import { auth } from '../lib/auth';
import styles from './layout.module.css';

interface ShellProps {
  children: JSX.Element;
}

export function Shell(props: ShellProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const navigate = useNavigate();
  const location = useLocation();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setMenuOpen(false);
  };
  document.addEventListener('keydown', onKey);
  onCleanup(() => document.removeEventListener('keydown', onKey));

  const close = () => setMenuOpen(false);

  const logout = () => {
    auth.logout();
    setMenuOpen(false);
    navigate('/login', { replace: true });
  };

  const navItems: { to: string; label: string }[] = [
    { to: '/',         label: 'Dashboard' },
    { to: '/overview', label: 'Overview' },
    { to: '/tickets',  label: 'Tickets' },
    { to: '/users',    label: 'Users' },
  ];

  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname === to || location.pathname.startsWith(to + '/');
  };

  return (
    <div class={styles.shell}>
      <header class={styles.header}>
        <div class={styles.header_inner}>
          <A href="/" class={styles.brand} aria-label="Home">
            <span class={styles.brand_mark} aria-hidden="true">B</span>
            <span class={styles.brand_text}>BahnTicket Admin</span>
          </A>
          <button
            class={styles.hamburger}
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Open menu"
            aria-expanded={menuOpen()}
          >
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <main class={styles.main}>{props.children}</main>

      <Show when={menuOpen()}>
        <Portal>
          <div class={styles.drawer_backdrop} onClick={close} />
          <aside class={styles.drawer} role="dialog" aria-label="Navigation">
            <div class={styles.drawer_head}>
              <span class={styles.drawer_user}>
                <span class={styles.drawer_avatar}>
                  {(auth.session()?.username ?? 'A').charAt(0).toUpperCase()}
                </span>
                <span class="stack-2">
                  <span style="font-weight:500">{auth.session()?.username ?? 'admin'}</span>
                  <span class="faint" style="font-size:12px">Administrator</span>
                </span>
              </span>
              <button
                class={styles.drawer_close}
                onClick={close}
                aria-label="Close menu"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </button>
            </div>
            <nav class={styles.drawer_nav}>
              {navItems.map(item => (
                <A
                  href={item.to}
                  end={item.to === '/'}
                  onClick={close}
                  class={`${styles.drawer_link} ${isActive(item.to) ? styles.drawer_link_active : ''}`}
                >
                  {item.label}
                </A>
              ))}
            </nav>
            <div class={styles.drawer_foot}>
              <button class={styles.drawer_logout} onClick={logout}>
                Sign out
              </button>
            </div>
          </aside>
        </Portal>
      </Show>
    </div>
  );
}
