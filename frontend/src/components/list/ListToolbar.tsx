import type { ReactNode } from 'react'
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react'
import { Menu } from '@/components/ui/Menu'
import type { ListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { plural } from '@/lib/format'
import { FilterButton } from './FilterButton'
import { FilterChips } from './FilterChips'
import { filterChips, filterKeys, type FilterChip, type FilterDef } from './filters'
import { SearchInput } from './SearchInput'

export interface SortOption {
  value: string
  label: string
}

export interface ListTabs {
  /** URL key the tabs write a single value to, e.g. "status". */
  key: string
  allLabel: string
  allCount?: number
  options: { value: string; label: string; count?: number }[]
}

/**
 * The bar above every list: status tabs, search, filter panel and sort, then the active-filter chips.
 * Everything reads and writes the URL through `state`.
 */
export function ListToolbar({
  state,
  searchPlaceholder,
  filters,
  sorts,
  defaultSort,
  tabs,
  total,
  noun,
  extraFilter,
  extraChips = [],
}: {
  state: ListState
  searchPlaceholder: string
  filters: FilterDef[]
  sorts: SortOption[]
  defaultSort: string
  tabs?: ListTabs
  total?: number
  noun: string
  /** A custom control at the top of the filter panel (e.g. an agency picker) and its chips. */
  extraFilter?: ReactNode
  extraChips?: FilterChip[]
}) {
  const sort = state.get('sort', defaultSort)
  const sortLabel = sorts.find((s) => s.value === sort)?.label ?? sorts[0]?.label
  const chips = [...extraChips, ...filterChips(filters, state)]
  const query = state.get('q')
  const tabValue = tabs ? state.getList(tabs.key) : []

  const tab = (value: string, label: string, count?: number) => {
    // A tab's value can cover several states ("planned,in_production").
    const selected = value ? tabValue.join(',') === value : tabValue.length === 0
    return (
      <button
        key={value || 'all'}
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={() => state.update({ [tabs!.key]: value })}
        className={cn(
          'flex h-9 shrink-0 items-center gap-2.5 rounded-full px-3.5 text-xs whitespace-nowrap',
          selected ? 'bg-white font-medium text-text shadow-sm ring-1 ring-border-strong' : 'text-[#2d2c34] hover:bg-black/4',
        )}
      >
        {label}
        {count !== undefined && (
          <span
            className={cn(
              'grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-medium',
              selected ? 'bg-brand-strong text-white' : 'bg-[#edecf0] text-[#313038]',
            )}
          >
            {count.toLocaleString()}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Tabs and controls share a row only on very wide screens; below that the tabs get their own row so none are cut off. */}
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        {tabs ? (
          <div role="tablist" aria-label={`Filter by ${tabs.key}`} className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 py-0.5">
            {tab('', tabs.allLabel, tabs.allCount)}
            {tabs.options.map((o) => tab(o.value, o.label, o.count))}
          </div>
        ) : (
          <div />
        )}
        {/* Search, filter and sort stay on one line; the tabs scroll instead when space runs out. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-nowrap">
          <SearchInput value={query} onChange={(q) => state.update({ q })} placeholder={searchPlaceholder} />
          {(filters.length > 0 || extraFilter) && <FilterButton defs={filters} state={state} extra={extraFilter} extraCount={extraChips.length} />}
          <Menu
            label={`Sort: ${sortLabel}`}
            heading="Sort by"
            className="flex h-9 items-center gap-2 rounded-lg border border-[#eceaeb] bg-surface px-3 text-xs font-medium whitespace-nowrap hover:bg-surface-input"
            items={sorts.map((s) => ({
              label: s.label,
              icon: s.value === sort ? Check : undefined,
              onSelect: () => state.update({ sort: s.value === defaultSort ? null : s.value }),
            }))}
          >
            <ArrowUpDown size={15} strokeWidth={1.7} />
            {sortLabel}
            <ChevronDown size={15} strokeWidth={1.8} />
          </Menu>
        </div>
      </div>
      <FilterChips
        chips={chips}
        query={query}
        onClearQuery={() => state.update({ q: null })}
        onClearAll={() => {
          extraChips.forEach((c) => c.remove())
          state.clear(['q', ...filterKeys(filters)])
        }}
        summary={total === undefined ? '' : `${plural(total, noun)} match`}
      />
    </div>
  )
}
