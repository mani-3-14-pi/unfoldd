import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'

/**
 * A panel anchored under a trigger. Positioned `fixed`, so table cards with overflow don't clip it.
 * Closes on outside click and Escape (focus returns to the trigger).
 */
export function Popover({
  anchor,
  onClose,
  width,
  align = 'end',
  children,
  label,
  role = 'dialog',
}: {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  width: number
  align?: 'start' | 'end'
  children: ReactNode
  label: string
  role?: 'dialog' | 'menu'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    const place = () => {
      const t = anchor.current?.getBoundingClientRect()
      if (!t) return
      const w = Math.min(width, window.innerWidth - 16)
      const preferred = align === 'end' ? t.right - w : t.left
      const left = Math.min(Math.max(8, preferred), window.innerWidth - w - 8)
      const below = window.innerHeight - t.bottom - 16
      const height = ref.current?.offsetHeight ?? 0
      // Flip above the trigger when there isn't room below.
      const top = height > below && t.top > below ? Math.max(8, t.top - height - 6) : t.bottom + 6
      setStyle({ top, left, width: w, maxHeight: Math.max(220, Math.max(below, t.top - 16)) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, width, align])

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) onClose()
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [anchor, onClose])

  return (
    <div
      ref={ref}
      role={role}
      aria-label={label}
      style={style}
      className="fixed z-50 overflow-y-auto rounded-xl border border-border-strong bg-white shadow-xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          anchor.current?.focus()
        }
      }}
    >
      {children}
    </div>
  )
}
