import type { ReactNode } from 'react';
import { Skeleton } from './Skeleton';
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
    return <TableSkeleton columns={columns} rows={8} />;
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
    <div className="rb-table-scroll">
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
    </div>
  );
}

interface TableSkeletonProps<T> {
  columns: TableColumn<T>[];
  rows: number;
}

/**
 * Renders the real header row and `rows` placeholder rows with the same
 * column layout, so the table width doesn't jump when data lands. Uses the
 * card fallback automatically on narrow viewports because it reuses the
 * exact same DOM shape and CSS classes as the populated table.
 */
function TableSkeleton<T>({ columns, rows }: TableSkeletonProps<T>) {
  return (
    <div className="rb-table-scroll" aria-busy="true">
      <table className="rb-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r} data-clickable="false">
              {columns.map((c) => (
                <td key={c.key} data-label={c.header}>
                  <Skeleton variant="text" width={`${8 + ((r + c.key.length) % 8)}ch`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
