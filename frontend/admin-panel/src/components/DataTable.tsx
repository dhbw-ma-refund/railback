import { For, JSX, Show } from 'solid-js';
import styles from './table.module.css';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => JSX.Element;
  // Hide on narrow screens (< 640px)
  hideOnMobile?: boolean;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onEdit?: (row: T) => void;
  emptyMessage?: string;
}

export function DataTable<T>(props: DataTableProps<T>) {
  return (
    <div class={styles.tableWrap}>
      <table class={styles.table}>
        <thead>
          <tr>
            <For each={props.columns}>
              {(col) => (
                <th
                  class={col.hideOnMobile ? styles.hide_mobile : ''}
                  style={{
                    width: col.width,
                    'text-align': col.align ?? 'left',
                  }}
                >
                  {col.header}
                </th>
              )}
            </For>
            <Show when={props.onEdit}>
              <th class={styles.action_col} aria-label="Actions"></th>
            </Show>
          </tr>
        </thead>
        <tbody>
          <Show
            when={props.rows.length > 0}
            fallback={
              <tr>
                <td
                  colspan={props.columns.length + (props.onEdit ? 1 : 0)}
                  class={styles.empty}
                >
                  {props.emptyMessage ?? 'No records.'}
                </td>
              </tr>
            }
          >
            <For each={props.rows}>
              {(row) => (
                <tr>
                  <For each={props.columns}>
                    {(col) => (
                      <td
                        class={col.hideOnMobile ? styles.hide_mobile : ''}
                        style={{ 'text-align': col.align ?? 'left' }}
                      >
                        {col.render(row)}
                      </td>
                    )}
                  </For>
                  <Show when={props.onEdit}>
                    <td class={styles.action_col}>
                      <button
                        class={styles.edit_btn}
                        onClick={() => props.onEdit?.(row)}
                        aria-label="Edit"
                      >
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                          <path d="M11.3 2.7l2 2-7.6 7.6-2.7.7.7-2.7 7.6-7.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
                        </svg>
                        <span class={styles.edit_label}>Edit</span>
                      </button>
                    </td>
                  </Show>
                </tr>
              )}
            </For>
          </Show>
        </tbody>
      </table>
    </div>
  );
}
