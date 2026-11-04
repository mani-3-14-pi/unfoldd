/** The Unfoldd mark: a sheet with its corner folded open. */
export function BrandMark({ size = 34, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M6 4h16l8 8v18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill={color} />
      <path d="M22 4v6a2 2 0 0 0 2 2h6" fill={color} fillOpacity={0.55} />
      <path d="M11 15v6.5a5 5 0 0 0 10 0V15" stroke="#15362d" strokeWidth={3} strokeLinecap="round" />
    </svg>
  )
}
