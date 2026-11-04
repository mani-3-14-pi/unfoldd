import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'

/** Search box that reports its value 300 ms after typing stops. */
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)

  // Follow outside changes, e.g. "Clear filters" or back/forward navigation.
  if (value !== synced) {
    setSynced(value)
    setText(value)
  }

  useEffect(() => {
    if (text.trim() === value) return
    const timer = setTimeout(() => onChange(text.trim()), 300)
    return () => clearTimeout(timer)
  }, [text, value, onChange])

  return (
    <label className="flex h-9 w-full items-center gap-2.5 rounded-lg border border-[#eceaeb] bg-surface px-3 text-text-2 focus-within:border-brand-border focus-within:ring-4 focus-within:ring-brand/10 sm:w-64">
      <Search size={17} strokeWidth={1.8} className="shrink-0" />
      <input
        type="search"
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChange(text.trim())
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-4 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setText('')
            onChange('')
          }}
          className="grid size-5 place-items-center rounded text-text-3 hover:bg-black/5"
        >
          <X size={14} />
        </button>
      )}
    </label>
  )
}
