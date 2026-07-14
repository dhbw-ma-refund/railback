import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from './Input';

/**
 * Locks the Input contract that the admin panel depends on. The incoming
 * merge of origin/frontend touches Input's error icon representation (CSS
 * mask vs inline SVG) and disabled tokens. These tests must survive that
 * change, so they assert observable behavior + a11y, not implementation
 * details of the icon.
 */
describe('Input', () => {
  it('exposes error state to assistive tech and links input to the error node', () => {
    render(<Input label="E-Mail" error="Ungültige Adresse" defaultValue="x" />);

    const input = screen.getByLabelText('E-Mail') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('rb-input--error');

    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const errorNode = document.getElementById(describedBy!);
    expect(errorNode).not.toBeNull();
    expect(errorNode!.textContent).toContain('Ungültige Adresse');
  });

  it('renders an aria-hidden error icon slot next to the error message', () => {
    const { container } = render(<Input label="E-Mail" error="Fehler" />);
    const icon = container.querySelector('.rb-input-error-icon');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders helperText when no error is set and hides the error region', () => {
    render(<Input label="Name" helperText="Wie im Ausweis" />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;

    // aria-invalid must coerce to false — either literally "false" or absent.
    const invalid = input.getAttribute('aria-invalid');
    expect(invalid === null || invalid === 'false').toBe(true);

    expect(screen.getByText('Wie im Ausweis')).toBeInTheDocument();
    expect(document.querySelector('.rb-input-error')).toBeNull();
  });

  it('prefers error over helperText when both are provided', () => {
    render(<Input label="F" error="err" helperText="help" />);
    expect(screen.getByText('err')).toBeInTheDocument();
    expect(screen.queryByText('help')).toBeNull();
  });

  it('associates the label with the input via matching htmlFor/id', () => {
    render(<Input label="Passwort" />);
    const input = screen.getByLabelText('Passwort') as HTMLInputElement;
    expect(input.id).toBeTruthy();

    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${input.id}"]`,
    );
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('Passwort');
  });

  it('honors an explicit id prop instead of auto-generating one', () => {
    render(<Input label="Zug" id="train-nr" />);
    const input = screen.getByLabelText('Zug') as HTMLInputElement;
    expect(input.id).toBe('train-nr');
  });

  it('generates distinct ids for two unlabeled instances so a11y links do not collide', () => {
    render(
      <>
        <Input label="A" error="a-err" />
        <Input label="B" error="b-err" />
      </>,
    );
    const a = screen.getByLabelText('A') as HTMLInputElement;
    const b = screen.getByLabelText('B') as HTMLInputElement;
    expect(a.id).not.toBe(b.id);
    expect(a.getAttribute('aria-describedby')).not.toBe(
      b.getAttribute('aria-describedby'),
    );
  });

  it('forwards refs to the underlying <input> element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} label="Ref" />);
    expect(ref.current).not.toBeNull();
    expect(ref.current!.tagName).toBe('INPUT');
  });

  it('spreads arbitrary InputHTMLAttributes onto the <input>', () => {
    render(
      <Input
        label="Attr"
        placeholder="type here"
        disabled
        data-testid="attr-input"
      />,
    );
    const input = screen.getByTestId('attr-input') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.placeholder).toBe('type here');
    expect(input.disabled).toBe(true);
  });
});
