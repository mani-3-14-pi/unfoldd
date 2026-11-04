import { useRef, useState } from 'react'
import { Building2, Check, ChevronsUpDown, Store } from 'lucide-react'
import { Popover } from '@/components/ui/Popover'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import type { Contexts } from './api'
import { agencyRoleLabel, clientRoleLabel } from './roles'
import { useSessionActions } from './session'

/**
 * The agency switcher (P04) and brand switcher (D43) in one: every agency and client space this login can open.
 * Shown as a plain label when there's nowhere else to go.
 */
export function ContextSwitcher({ current, label, contexts }: { current: { agencyId?: string; clientId?: string }; label: string; contexts: Contexts }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const { switchTo } = useSessionActions()
  const others = contexts.agencies.length + contexts.clients.length > 1

  const card = 'flex h-12 w-full items-center gap-2.5 rounded-xl border border-sidebar-line bg-sidebar-card px-3 text-left'
  if (!others) {
    return (
      <div className={card}>
        <Building2 size={17} strokeWidth={1.7} className="shrink-0 text-sidebar-muted" />
        <span className="truncate text-[13px] font-medium">{label}</span>
      </div>
    )
  }

  const go = async (target: { agencyId: string } | { clientId: string }) => {
    setOpen(false)
    setBusy(true)
    try {
      await switchTo(target)
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const item = (key: string, selected: boolean, icon: React.ReactNode, title: string, detail: string, onSelect: () => void) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      onClick={onSelect}
      disabled={selected}
      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-surface-input disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-input text-text-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text">{title}</span>
        <span className="block truncate text-[11px] text-text-3">{detail}</span>
      </span>
      {selected && <Check size={16} className="shrink-0 text-brand" />}
    </button>
  )

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className={`${card} hover:bg-white/8 disabled:opacity-60`}
      >
        <Building2 size={17} strokeWidth={1.7} className="shrink-0 text-sidebar-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{label}</span>
          <span className="block text-[11px] text-sidebar-muted">Switch workspace</span>
        </span>
        <ChevronsUpDown size={16} className="shrink-0 text-sidebar-muted" />
      </button>
      {open && (
        <Popover anchor={trigger} onClose={() => setOpen(false)} width={280} align="start" label="Switch workspace" role="menu">
          <div className="py-1.5">
            {contexts.agencies.length > 0 && <div className="px-3.5 pt-1 pb-1 text-[11px] font-medium text-text-4">Agencies</div>}
            {contexts.agencies.map((a) =>
              item(a.agencyId, a.agencyId === current.agencyId && !current.clientId, <Building2 size={16} />, a.name, agencyRoleLabel[a.role], () =>
                void go({ agencyId: a.agencyId }),
              ),
            )}
            {contexts.clients.length > 0 && <div className="mt-1 border-t border-border px-3.5 pt-2.5 pb-1 text-[11px] font-medium text-text-4">Client spaces</div>}
            {contexts.clients.map((c) =>
              item(c.clientId, c.clientId === current.clientId, <Store size={16} />, c.brandName, `${c.agencyName} · ${clientRoleLabel[c.role]}`, () =>
                void go({ clientId: c.clientId }),
              ),
            )}
          </div>
        </Popover>
      )}
    </>
  )
}
