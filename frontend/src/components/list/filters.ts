import { formatDate } from '@/lib/format'
import type { ListState } from '@/hooks/useListState'

export interface FilterOption {
  value: string
  label: string
  count?: number
}

/** One section of a list's filter panel. Values are stored in the URL under `key` (or `fromKey`/`toKey`). */
export type FilterDef =
  | { kind: 'multi'; key: string; label: string; options: FilterOption[] }
  | { kind: 'dateRange'; label: string; fromKey: string; toKey: string }
  | { kind: 'toggle'; key: string; label: string; description?: string }

export interface FilterChip {
  id: string
  facet: string
  label: string
  remove: () => void
}

export const filterKeys = (defs: FilterDef[]) =>
  defs.flatMap((d) => (d.kind === 'dateRange' ? [d.fromKey, d.toKey] : [d.key]))

/** The active filters as removable chips. */
export function filterChips(defs: FilterDef[], state: ListState): FilterChip[] {
  return defs.flatMap((def): FilterChip[] => {
    if (def.kind === 'multi') {
      const selected = state.getList(def.key)
      return selected.map((value) => ({
        id: `${def.key}:${value}`,
        facet: def.label,
        label: def.options.find((o) => o.value === value)?.label ?? value,
        remove: () => state.update({ [def.key]: selected.filter((v) => v !== value) }),
      }))
    }
    if (def.kind === 'dateRange') {
      const from = state.get(def.fromKey)
      const to = state.get(def.toKey)
      if (!from && !to) return []
      const label = from && to ? `${formatDate(from)} – ${formatDate(to)}` : from ? `From ${formatDate(from)}` : `Until ${formatDate(to)}`
      return [{ id: def.fromKey, facet: def.label, label, remove: () => state.update({ [def.fromKey]: null, [def.toKey]: null }) }]
    }
    return state.get(def.key) === 'true'
      ? [{ id: def.key, facet: def.label, label: 'Yes', remove: () => state.update({ [def.key]: null }) }]
      : []
  })
}
