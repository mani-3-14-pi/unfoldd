import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Popover } from './Popover'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onSelect?: () => void
  /** In-app route to navigate to. */
  to?: string
  tone?: 'danger'
  separated?: boolean
  disabled?: boolean
}

/** A button that opens a list of actions. Arrow keys move between items. */
export function Menu({
  label,
  items,
  children,
  className,
  heading,
  width = 220,
}: {
  label: string
  items: MenuItem[]
  children: ReactNode
  className?: string
  heading?: string
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (open) requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus())
  }, [open])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLElement)
    buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  }

  const select = (item: MenuItem) => {
    setOpen(false)
    if (item.to) navigate(item.to)
    item.onSelect?.()
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        {children}
      </button>
      {open && (
        <Popover anchor={trigger} onClose={() => setOpen(false)} width={width} label={label} role="menu">
          <div ref={list} className="py-1.5" onKeyDown={onKeyDown}>
            {heading && <div className="truncate px-3.5 pt-1 pb-1.5 text-[11px] font-medium text-text-4">{heading}</div>}
            {items.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label}>
                  {item.separated && <hr className="my-1.5 border-border" />}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      select(item)
                    }}
                    className={cn(
                      'flex h-9 w-full items-center gap-2.5 px-3.5 text-left text-[13px] outline-none hover:bg-surface-input focus-visible:bg-surface-input disabled:opacity-45',
                      item.tone === 'danger' ? 'text-negative' : 'text-text',
                    )}
                  >
                    {Icon ? <Icon size={16} strokeWidth={1.8} /> : <span className="w-4" />}
                    {item.label}
                  </button>
                </div>
              )
            })}
          </div>
        </Popover>
      )}
    </>
  )
}
