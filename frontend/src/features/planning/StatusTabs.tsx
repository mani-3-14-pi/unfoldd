import type { ListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'

/** Pill tabs that write one status (or none) to the URL, for lists without search or sort. */
export function StatusTabs({ state, label, allLabel, options }: { state: ListState; label: string; allLabel: string; options: { value: string; label: string }[] }) {
  const current = state.get('status')
  return (
    <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto px-1 py-0.5">
      {[{ value: '', label: allLabel }, ...options].map((t) => (
        <button
          key={t.value || 'all'}
          type="button"
          role="tab"
          aria-selected={current === t.value}
          onClick={() => state.update({ status: t.value })}
          className={cn(
            'h-9 shrink-0 rounded-full px-3.5 text-xs whitespace-nowrap',
            current === t.value ? 'bg-white font-medium shadow-sm ring-1 ring-border-strong' : 'text-[#2d2c34] hover:bg-black/4',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
