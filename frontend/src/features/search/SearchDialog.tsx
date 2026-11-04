import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { CalendarRange, FileText, Inbox, LayoutGrid, ListTodo, LoaderCircle, Megaphone, Search, Store, UserRound, Video } from 'lucide-react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { MIN_QUERY, searchApi, searchKey, type SearchApp, type SearchResult, type SearchType } from './api'

const TYPE: Record<SearchType, { label: string; icon: LucideIcon }> = {
  clients: { label: 'Clients', icon: Store },
  content: { label: 'Content', icon: LayoutGrid },
  campaigns: { label: 'Campaigns', icon: Megaphone },
  plans: { label: 'Content plans', icon: CalendarRange },
  tasks: { label: 'Tasks', icon: ListTodo },
  requests: { label: 'Requests', icon: Inbox },
  meetings: { label: 'Meetings', icon: Video },
  files: { label: 'Files', icon: FileText },
  people: { label: 'People', icon: UserRound },
}

/**
 * The search palette: type, see grouped results, pick one with the arrow keys and Enter (or a click).
 * Render it only while open, like the other dialogs; Escape or a backdrop click closes it.
 */
export function SearchDialog({ app, onClose }: { app: SearchApp; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  // Ask the server once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])

  const ready = q.length >= MIN_QUERY
  const query = useQuery({ queryKey: searchKey(app, q), queryFn: () => searchApi.search(q), enabled: ready, placeholderData: keepPreviousData, staleTime: 30_000 })
  const groups = useMemo(() => (ready ? (query.data?.groups ?? []) : []), [ready, query.data])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // A new result list starts at the top (adjusted during render, as SearchInput does).
  const [seen, setSeen] = useState(groups)
  if (seen !== groups) {
    setSeen(groups)
    setActive(0)
  }

  const open = (r: SearchResult) => {
    onClose()
    navigate(r.link)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!flat.length) return
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length)
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault()
      open(flat[active])
    }
  }

  // Keep the highlighted row in view.
  useEffect(() => {
    ref.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let index = -1
  return (
    <dialog
      ref={ref}
      aria-label="Search"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className="mx-auto mt-[12vh] w-[calc(100%-32px)] max-w-xl rounded-2xl border border-border bg-white p-0 text-text shadow-2xl backdrop:bg-[#0a1325]/40"
    >
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search size={18} className="shrink-0 text-text-3" />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={app === 'agency' ? 'Search clients, content, tasks, people…' : 'Search content, plans, requests, files…'}
          aria-label="Search"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="search-results"
          aria-activedescendant={flat[active] ? `search-result-${active}` : undefined}
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-4"
        />
        {query.isFetching && ready && <LoaderCircle size={16} className="shrink-0 animate-spin text-text-3" />}
        <kbd className="hidden shrink-0 rounded border border-border-strong px-1.5 py-0.5 text-[10px] text-text-4 sm:block">Esc</kbd>
      </div>

      <div id="search-results" role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto py-2">
        {!ready ? (
          <p className="px-5 py-6 text-center text-[13px] text-text-3">Type at least {MIN_QUERY} characters.</p>
        ) : query.isError ? (
          <p className="px-5 py-6 text-center text-[13px] text-negative">{errorMessage(query.error)}</p>
        ) : query.isPending ? (
          <p className="px-5 py-6 text-center text-[13px] text-text-3">Searching…</p>
        ) : groups.length === 0 ? (
          <p className="px-5 py-6 text-center text-[13px] text-text-3">Nothing matches “{q}”.</p>
        ) : (
          groups.map((g) => {
            const { label, icon: Icon } = TYPE[g.type]
            return (
              <section key={g.type} aria-label={label} className="pb-1">
                <h3 className="px-5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-text-4 uppercase">{label}</h3>
                {g.items.map((r) => {
                  index += 1
                  const i = index
                  return (
                    <button
                      key={`${g.type}-${r.id}`}
                      id={`search-result-${i}`}
                      data-index={i}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={() => open(r)}
                      className={cn('flex w-full items-center gap-3 px-5 py-2 text-left', i === active ? 'bg-surface-input' : 'hover:bg-surface-input')}
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-text-2 ring-1 ring-border-strong">
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{r.title}</span>
                        {r.subtitle && <span className="block truncate text-xs text-text-3">{r.subtitle}</span>}
                      </span>
                    </button>
                  )
                })}
              </section>
            )
          })
        )}
      </div>
    </dialog>
  )
}
