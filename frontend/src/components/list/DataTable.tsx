import type { MouseEvent, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
}

/**
 * The card-style table from the prototype. While a new page loads the old rows stay, dimmed.
 * Row clicks are ignored when they land on a link, button or menu inside the row.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  fetching,
  empty,
  label,
  footer,
}: {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  loading?: boolean
  fetching?: boolean
  empty: ReactNode
  label: string
  footer?: ReactNode
}) {
  const click = (e: MouseEvent, row: T) => {
    if ((e.target as Element).closest('a, button, input, label, [role="menu"]')) return
    onRowClick?.(row)
  }

  return (
    <div className="rounded-xl border border-border bg-surface">
      {/* `relative` keeps absolutely positioned bits (sr-only labels) inside the scroller on narrow screens. */}
      <div className="relative overflow-x-auto">
        <table className={cn('w-full min-w-[760px] border-collapse text-left transition-opacity', fetching && 'opacity-60')} aria-label={label} aria-busy={loading || fetching}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('h-11 border-b border-[#f2f0f1] px-4 text-[11px] font-normal whitespace-nowrap text-[#565769]', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className="h-13 border-b border-[#f2f0f1] px-4">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-[#ecebee]" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows?.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? (e) => click(e, row) : undefined}
                  className={cn('group', onRowClick && 'cursor-pointer hover:bg-[#f6f5f6]')}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('h-13 border-b border-[#f2f0f1] px-4 py-2 align-middle text-[13px]', c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows?.length === 0 && (
              <tr>
                <td colSpan={columns.length}>{empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  )
}

/** Bold first line and muted second line, used in most cells. */
export function CellText({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[13px] font-semibold text-text">{primary}</div>
      {secondary && <div className="mt-px truncate text-xs text-text-3">{secondary}</div>}
    </div>
  )
}
