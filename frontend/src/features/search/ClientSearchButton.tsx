import { useCallback, useState } from 'react'
import { Search } from 'lucide-react'
import { SearchDialog } from './SearchDialog'
import { useSearchShortcut } from './useSearchShortcut'

/** The search icon in the client app's header. Only finds what was shared with the client (F82). */
export function ClientSearchButton() {
  const [open, setOpen] = useState(false)
  const show = useCallback(() => setOpen(true), [])
  useSearchShortcut(show)

  return (
    <>
      <button type="button" onClick={show} aria-label="Search" className="grid size-10 place-items-center rounded-full hover:bg-black/5">
        <Search size={20} strokeWidth={1.8} />
      </button>
      {open && <SearchDialog app="client" onClose={() => setOpen(false)} />}
    </>
  )
}
