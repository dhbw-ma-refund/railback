import styles from './ui.module.css';

type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'info';

interface BadgeProps {
  tone?: Tone;
  children: any;
}
export function Badge(props: BadgeProps) {
  return (
    <span class={`${styles.badge} ${styles[`badge_${props.tone ?? 'neutral'}`]}`}>
      {props.children}
    </span>
  );
}
