import type { ReactNode } from 'react';
import './Table.css';

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
}

/**
 * Zero-dependency table with loading/empty/error states and a card fallback
 * for mobile (see Table.css @media rule). Keeps the admin panel free of a
 * data-grid dependency; we only ever need read-only tables here.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  error,
  emptyMessage = 'Keine Einträge.',
}: TableProps<T>) {
  if (loading) {
    return <div className="rb-table__loading">Lädt…</div>;
  }
  if (error) {
    return (
      <div className="rb-table__error" role="alert">
        {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="rb-table__empty">{emptyMessage}</div>;
  }

  return (
    <table className="rb-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            data-clickable={onRowClick ? 'true' : 'false'}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((c) => (
              <td key={c.key} data-label={c.header}>
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
