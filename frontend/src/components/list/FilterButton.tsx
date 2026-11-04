import { useRef, useState, type ReactNode } from 'react'
import { Funnel } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Popover } from '@/components/ui/Popover'
import { Switch } from '@/components/ui/Switch'
import type { ListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { filterChips, filterKeys, type FilterDef } from './filters'

const dateInput =
  'h-9 w-full rounded-lg border border-border-strong bg-white px-2.5 text-[13px] focus:border-brand-border focus:outline-none focus:ring-4 focus:ring-brand/10'

/** "Filter" button with a panel of every facet. Changes apply as you make them, like the prototype. */
export function FilterButton({ defs, state, extra, extraCount = 0 }: { defs: FilterDef[]; state: ListState; extra?: ReactNode; extraCount?: number }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const active = filterChips(defs, state).length + extraCount

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-9 items-center gap-2 rounded-lg border bg-surface px-3 text-xs font-medium whitespace-nowrap hover:bg-surface-input',
          active ? 'border-brand-border text-brand' : 'border-[#eceaeb] text-text',
        )}
      >
        <Funnel size={16} strokeWidth={1.7} />
        Filters
        {active > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[10px] text-white" aria-label={`${active} active`}>
            {active}
          </span>
        )}
      </button>
      {open && (
        <Popover anchor={trigger} onClose={() => setOpen(false)} width={340} label="Filters">
          <div className="flex flex-col divide-y divide-border">
            {extra && <div className="px-4 py-3">{extra}</div>}
            {defs.map((def) => (
              <fieldset key={def.kind === 'dateRange' ? def.fromKey : def.key} className="px-4 py-3">
                <legend className="float-left mb-2 w-full text-[11px] font-semibold tracking-wide text-text-3 uppercase">{def.label}</legend>
                {def.kind === 'multi' && (
                  <div className="clear-both flex flex-col">
                    {def.options.map((option) => {
                      const selected = state.getList(def.key)
                      const checked = selected.includes(option.value)
                      return (
                        <label key={option.value} className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-1 text-[13px] hover:bg-surface-input">
                          <input
                            type="checkbox"
                            className="size-4 accent-brand"
                            checked={checked}
                            onChange={() =>
                              state.update({ [def.key]: checked ? selected.filter((v) => v !== option.value) : [...selected, option.value] })
                            }
                          />
                          <span className="flex-1 truncate">{option.label}</span>
                          {option.count !== undefined && <span className="text-xs text-text-4">{option.count}</span>}
                        </label>
                      )
                    })}
                    {def.options.length === 0 && <p className="text-xs text-text-4">Nothing to filter by yet.</p>}
                  </div>
                )}
                {def.kind === 'dateRange' && (
                  <div className="clear-both grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-[11px] text-text-3">
                      From
                      <input
                        type="date"
                        className={dateInput}
                        value={state.get(def.fromKey)}
                        max={state.get(def.toKey) || undefined}
                        onChange={(e) => state.update({ [def.fromKey]: e.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-text-3">
                      To
                      <input
                        type="date"
                        className={dateInput}
                        value={state.get(def.toKey)}
                        min={state.get(def.fromKey) || undefined}
                        onChange={(e) => state.update({ [def.toKey]: e.target.value })}
                      />
                    </label>
                  </div>
                )}
                {def.kind === 'toggle' && (
                  <div className="clear-both flex items-center justify-between gap-3">
                    <span className="text-xs text-text-3">{def.description}</span>
                    <Switch label={def.label} checked={state.get(def.key) === 'true'} onChange={(on) => state.update({ [def.key]: on })} />
                  </div>
                )}
              </fieldset>
            ))}
          </div>
          <div className="sticky bottom-0 flex justify-between gap-2 border-t border-border bg-white px-4 py-2.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={active === 0}
              onClick={() => state.clear(filterKeys(defs))}
            >
              Clear all
            </Button>
            <Button size="sm" variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </Popover>
      )}
    </>
  )
}
