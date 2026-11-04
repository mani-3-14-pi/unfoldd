import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

const PAGE_SIZES = [10, 25, 50, 100]

/** Page numbers to show: always the first and last, the current one and its neighbours, gaps as null. */
function pageList(page: number, totalPages: number): (number | null)[] {
  const pages = new Set([1, totalPages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= totalPages))
  const sorted = [...pages].sort((a, b) => a - b)
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1]! > 1 ? [null, p] : [p]))
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  noun,
  onPage,
  onPageSize,
}: {
  page: number
  pageSize: number
  total: number
  totalPages: number
  noun: string
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const btn = 'grid h-8 min-w-8 place-items-center rounded-lg px-2 text-xs disabled:opacity-40'

  return (
    <nav aria-label="Pagination" className="flex flex-col gap-3 border-t border-[#f2f0f1] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-xs text-text-3">
        <span>
          Showing <strong className="font-medium text-text">{from.toLocaleString()}–{to.toLocaleString()}</strong> of{' '}
          <strong className="font-medium text-text">{total.toLocaleString()}</strong> {noun}
        </span>
        <label className="flex items-center gap-1.5">
          <span className="sr-only sm:not-sr-only">Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-border-strong bg-white px-2 text-xs"
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={cn(btn, 'hover:bg-black/5')} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        {pageList(page, totalPages).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="px-1 text-xs text-text-4">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Page ${p}`}
              onClick={() => onPage(p)}
              className={cn(btn, p === page ? 'bg-brand font-medium text-white' : 'hover:bg-black/5')}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className={cn(btn, 'hover:bg-black/5')}
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  )
}
