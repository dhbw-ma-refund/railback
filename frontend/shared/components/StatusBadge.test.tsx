import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, type StatusType } from './StatusBadge';

/**
 * Locks the StatusBadge public contract that admin/ui/UserStateBadge depends
 * on. origin/frontend replaces the default icon representation (emoji vs
 * Lucide CSS-mask). We must not assert the default icon markup itself —
 * only that the slot exists, the label renders, and per-status classes stay
 * correct.
 */
describe('StatusBadge', () => {
  const statuses: StatusType[] = ['pending', 'approved', 'rejected'];

  it.each(statuses)(
    'renders the wrapper class and modifier class for status "%s"',
    (status) => {
      const { container } = render(<StatusBadge status={status} label="L" />);
      const wrapper = container.querySelector('.rb-status-badge');
      expect(wrapper).not.toBeNull();
      expect(wrapper!.classList.contains(`rb-status-badge--${status}`)).toBe(
        true,
      );
    },
  );

  it.each(statuses)(
    'renders an aria-hidden icon slot for status "%s"',
    (status) => {
      const { container } = render(<StatusBadge status={status} label="L" />);
      const icon = container.querySelector('.rb-status-badge-icon');
      expect(icon).not.toBeNull();
      expect(icon!.getAttribute('aria-hidden')).toBe('true');
    },
  );

  it('renders the label text verbatim, including non-ASCII characters', () => {
    render(<StatusBadge status="approved" label="Beispiel — abgeschlossen" />);
    expect(screen.getByText('Beispiel — abgeschlossen')).toBeInTheDocument();
  });

  it('lets a custom icon prop override the default icon', () => {
    render(
      <StatusBadge
        status="pending"
        label="Wartend"
        icon={<span data-testid="custom-icon">X</span>}
      />,
    );
    const custom = screen.getByTestId('custom-icon');
    expect(custom).toBeInTheDocument();
    // Custom icon lives inside the icon slot, not next to it.
    const slot = custom.closest('.rb-status-badge-icon');
    expect(slot).not.toBeNull();
  });

  it('keeps label independent from icon — label is not swallowed by the icon slot', () => {
    render(
      <StatusBadge
        status="rejected"
        label="Abgelehnt"
        icon={<span>ignored</span>}
      />,
    );
    const label = screen.getByText('Abgelehnt');
    expect(label.closest('.rb-status-badge-icon')).toBeNull();
  });
});
