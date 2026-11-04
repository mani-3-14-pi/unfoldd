import { X } from 'lucide-react'
import type { FilterChip } from './filters'

/** The active filters (and search) as removable chips, with the result count and "Clear". */
export function FilterChips({
  chips,
  query,
  onClearQuery,
  onClearAll,
  summary,
}: {
  chips: FilterChip[]
  query: string
  onClearQuery: () => void
  onClearAll: () => void
  summary: string
}) {
  if (chips.length === 0 && !query) return null
  const all = query ? [{ id: 'q', facet: 'Search', label: `“${query}”`, remove: onClearQuery }, ...chips] : chips
  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <span className="mr-1 text-xs text-text-3">{summary}</span>
      {all.map((chip) => (
        <span key={chip.id} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-strong bg-white pr-1 pl-3 text-xs">
          <span className="text-text-3">{chip.facet}:</span> {chip.label}
          <button
            type="button"
            aria-label={`Remove ${chip.facet.toLowerCase()} filter ${chip.label}`}
            onClick={chip.remove}
            className="grid size-5 place-items-center rounded-full text-text-3 hover:bg-black/5"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className="text-xs font-medium text-brand underline-offset-2 hover:underline">
        Clear all
      </button>
    </div>
  )
}
