import type { ReactNode } from 'react';
import { cn } from './cn';
import { Skeleton } from './Feedback';

export interface Column<T> {
  /** Stable key, also used for the React key of the cell. */
  id: string;
  header: ReactNode;
  /** Rendered cell. Kept as a render function so the table stays domain-free. */
  cell: (row: T) => ReactNode;
  /** Tailwind width/alignment classes applied to both header and cell. */
  className?: string;
  /** Hide below the `md` breakpoint — used to keep dense tables usable on tablets. */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  className?: string;
  /** Highlights rows needing attention without the caller restyling the table. */
  rowTone?: (row: T) => 'danger' | 'warn' | undefined;
}

const ROW_TONE = {
  danger: 'border-l-2 border-l-state-danger',
  warn: 'border-l-2 border-l-state-warn',
} as const;

/**
 * Dense operational table.
 *
 * Deliberately not a generic grid: no built-in sorting, filtering, or
 * pagination. Those are data concerns, and pushing them up to the caller keeps
 * this component presentational and keeps the query logic testable without a DOM.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  loading = false,
  empty,
  className,
  rowTone,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className={cn('space-y-px', className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-11 w-full rounded-none first:rounded-t-lg last:rounded-b-lg"
          />
        ))}
      </div>
    );
  }

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-white/10">
            {columns.map((col) => (
              <th
                key={col.id}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-3 py-2 text-2xs font-medium uppercase tracking-wide text-gray-500',
                  col.hideOnMobile && 'hidden md:table-cell',
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = rowTone?.(row);
            return (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={cn(
                  'border-b border-white/5 transition last:border-0',
                  onRowClick &&
                    'cursor-pointer hover:bg-white/[0.03] focus-visible:bg-white/[0.05] focus-visible:outline-none',
                  tone && ROW_TONE[tone],
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      'px-3 py-2.5 align-middle text-sm text-gray-300',
                      col.hideOnMobile && 'hidden md:table-cell',
                      col.className,
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
