import { useState } from 'react'
import { Input } from '@/components/ui/Field'
import { cn } from '@/lib/cn'
import { periodPresets } from './labels'

/** Quick periods plus custom from/to dates. Dates are date-only; the server reads them in the client's timezone. */
export function PeriodPicker({ from, to, onChange }: { from: string; to: string; onChange: (period: { from: string; to: string }) => void }) {
  const [presets] = useState(() => periodPresets(new Date()))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
        {presets.map((p) => {
          const active = p.from === from && p.to === to
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ from: p.from, to: p.to })}
              className={cn('h-9 rounded-full px-3.5 text-xs', active ? 'bg-white font-medium shadow-sm ring-1 ring-border-strong' : 'text-[#2d2c34] hover:bg-black/4')}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-text-3">
        <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to })} className="w-36" />
        –
        <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => e.target.value && onChange({ from, to: e.target.value })} className="w-36" />
      </div>
    </div>
  )
}
