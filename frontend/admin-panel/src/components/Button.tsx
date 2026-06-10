import { JSX, splitProps } from 'solid-js';
import styles from './ui.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['variant', 'size', 'block', 'class', 'children']);
  const cls = () => [
    styles.btn,
    styles[`btn_${local.variant ?? 'primary'}`],
    styles[`btn_size_${local.size ?? 'md'}`],
    local.block ? styles.btn_block : '',
    local.class ?? '',
  ].filter(Boolean).join(' ');
  return (
    <button type="button" {...rest} class={cls()}>
      {local.children}
    </button>
  );
}
