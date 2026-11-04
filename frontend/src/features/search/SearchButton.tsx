import { useCallback, useState } from 'react'
import { Search } from 'lucide-react'
import { SearchDialog } from './SearchDialog'
import { isMac, useSearchShortcut } from './useSearchShortcut'

/** The search field in the agency portal's dark sidebar. Also wires Ctrl/⌘+K. */
export function SearchButton() {
  const [open, setOpen] = useState(false)
  const show = useCallback(() => setOpen(true), [])
  useSearchShortcut(show)

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-sidebar-line bg-sidebar-card px-3 text-left text-[13px] text-sidebar-muted hover:bg-white/8"
      >
        <Search size={16} strokeWidth={1.8} className="shrink-0" />
        <span className="flex-1">Search</span>
        <kbd className="rounded border border-sidebar-line px-1.5 py-0.5 text-[10px]">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {open && <SearchDialog app="agency" onClose={() => setOpen(false)} />}
    </>
  )
}
