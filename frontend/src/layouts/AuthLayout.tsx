import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'

/**
 * Login / signup shell from the prototype: the gradient brand panel and the form column.
 * The form comes first in the DOM so keyboard and screen-reader users reach it first.
 */
export function AuthLayout({
  eyebrow,
  title,
  description,
  highlights,
  children,
  footer,
}: {
  eyebrow: string
  title: ReactNode
  description: string
  highlights: { label: string; icon: LucideIcon }[]
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="grid min-h-screen bg-white p-2 font-display text-[#111a16] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <main className="flex flex-col px-4 py-8 sm:px-10 lg:order-2">
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center">{children}</div>
        {footer && <footer className="mx-auto mt-8 text-center text-xs text-[#6b6f76]">{footer}</footer>}
      </main>

      <aside className="auth-gradient relative isolate hidden min-h-[calc(100vh-16px)] flex-col overflow-hidden rounded-2xl px-12 pt-9 pb-14 text-white lg:order-1 lg:flex">
        <div className="absolute top-[-24%] left-[63%] -z-10 h-full w-[123%] rounded-full bg-[radial-gradient(34%_34%_at_31%_18%,#b0e8a8_0%,transparent_100%),radial-gradient(46%_50%_at_16%_52%,#46c09c_0%,transparent_100%),linear-gradient(rgb(46_168_136/0.78),rgb(38_156_126/0.7))] blur-[5px]" />
        <div className="inline-flex items-center gap-3 text-[28px] font-bold tracking-tight">
          <BrandMark size={38} />
          unfoldd
        </div>
        <div className="mt-auto pt-10">
          <span className="inline-flex h-8 items-center rounded-full bg-white/16 px-3.5 text-xs font-semibold tracking-wider uppercase backdrop-blur">
            {eyebrow}
          </span>
          <h2 className="mt-4 max-w-xl text-5xl leading-[1.05] font-bold tracking-tight">{title}</h2>
          <p className="mt-3.5 max-w-md text-lg leading-7 text-white/92">{description}</p>
          <ul className="mt-9 grid max-w-xl grid-cols-3 gap-4">
            {highlights.map(({ label, icon: Icon }) => (
              <li key={label} className="flex min-h-28 flex-col justify-between gap-3 rounded-2xl border border-white/12 bg-white/14 p-4 backdrop-blur-md">
                <Icon size={30} strokeWidth={1.5} />
                <span className="text-sm leading-5 font-semibold whitespace-pre-line">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}
