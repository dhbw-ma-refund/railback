import { JSX } from 'solid-js';
import styles from './ui.module.css';

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: JSX.Element;
}
export function KpiCard(props: KpiCardProps) {
  return (
    <div class={styles.kpi}>
      <div class={styles.kpi_top}>
        <span class={styles.kpi_label}>{props.label}</span>
        {props.icon && <span class={styles.kpi_icon}>{props.icon}</span>}
      </div>
      <div class={styles.kpi_value}>{props.value}</div>
      {props.hint && <div class={styles.kpi_hint}>{props.hint}</div>}
    </div>
  );
}

interface KpiRowProps {
  children: JSX.Element;
}
export function KpiRow(props: KpiRowProps) {
  return <div class={styles.kpi_row}>{props.children}</div>;
}
