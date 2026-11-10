import { cn } from '@/lib/cn'
import { initials } from '@/lib/format'

/** Soft background and ink pairs from the prototype's client logos. A client keeps its pair everywhere. */
const PALETTE = [
  ['#fde1e0', '#8e1c26'],
  ['#e6ecfa', '#0d1838'],
  ['#fbf1e5', '#7a3412'],
  ['#e2efdb', '#1f5a2a'],
  ['#efebfb', '#4b47c4'],
  ['#f8eded', '#2a1717'],
  ['#e6f0eb', '#2f5c4c'],
  ['#f5f1ee', '#44403f'],
] as const

function paletteFor(id: string) {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

const sizes = {
  sm: 'size-10 rounded-lg text-[17px]',
  xl: 'size-16 rounded-xl text-[28px] tracking-[-0.02em] sm:size-[88px] sm:rounded-2xl sm:text-[40px]',
}

/** The client's logo, or its initials in serif on a per-client tint when there's no logo. */
export function ClientLogo({ id, name, url, size = 'sm' }: { id: string; name: string; url?: string | null; size?: keyof typeof sizes }) {
  const [bg, ink] = paletteFor(id)
  return (
    <span
      className={cn('grid shrink-0 place-items-center overflow-hidden font-serif leading-none', sizes[size])}
      style={url ? undefined : { background: bg, color: ink }}
      aria-hidden="true"
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  )
}
