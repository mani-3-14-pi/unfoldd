import { cn } from '@/lib/cn'

const variants = {
  primary: 'bg-brand text-white hover:enabled:bg-brand-hover',
  secondary: 'border-[#e6e5e8] bg-white text-text hover:enabled:bg-[#f6f6f7]',
  ghost: 'text-text-2 hover:enabled:bg-black/5',
  danger: 'bg-negative text-white hover:enabled:bg-negative-hover',
}

const sizes = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
}

export type ButtonVariant = keyof typeof variants
export type ButtonSize = keyof typeof sizes

/** Classes for anything that should look like a button, e.g. a router Link. */
export const buttonClass = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) =>
  cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-transparent font-medium transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-55',
    variants[variant],
    sizes[size],
    className,
  )
