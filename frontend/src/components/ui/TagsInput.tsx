import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Free-text tags (services, titles, departments). Enter or comma adds one, Backspace on empty removes the last. */
export function TagsInput({
  id,
  value,
  onChange,
  placeholder,
  max = 30,
  disabled,
}: {
  id: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  max?: number
  disabled?: boolean
}) {
  const [text, setText] = useState('')

  const add = (raw: string) => {
    const tag = raw.trim().slice(0, 60)
    if (tag && !value.some((v) => v.toLowerCase() === tag.toLowerCase()) && value.length < max) onChange([...value, tag])
    setText('')
  }

  return (
    <div
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-white px-2 py-1.5',
        'focus-within:border-brand-border focus-within:ring-4 focus-within:ring-brand/10',
        disabled && 'bg-surface-input',
      )}
    >
      {value.map((tag) => (
        <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-md bg-surface-input pr-1 pl-2 text-xs">
          {tag}
          {!disabled && (
            <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((v) => v !== tag))} className="grid size-4 place-items-center rounded text-text-3 hover:bg-black/5">
              <X size={11} strokeWidth={2.2} />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        value={text}
        disabled={disabled}
        placeholder={value.length ? undefined : placeholder}
        onChange={(e) => {
          const v = e.target.value
          if (v.includes(',')) v.split(',').slice(0, -1).forEach(add)
          else setText(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(text)
          } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={() => text && add(text)}
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-text-4"
      />
    </div>
  )
}
