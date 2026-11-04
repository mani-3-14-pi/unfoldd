import { useRef } from 'react'
import { ImageUp, LoaderCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useUpload } from '@/hooks/useUpload'
import { initials } from '@/lib/format'

/**
 * A square logo with upload and remove. Uploads straight away (purpose `logo`) and reports the new file id;
 * the form saves that id with the rest of its fields.
 */
export function LogoPicker({
  name,
  url,
  onChange,
  client,
  disabled,
}: {
  name: string
  /** What to show right now: the saved logo, or a local preview of a new one. */
  url: string | null
  onChange: (change: { id: string; preview: string } | null) => void
  client?: string
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const { state, upload } = useUpload()
  const busy = state.phase === 'uploading' || state.phase === 'processing'

  const pick = async (file: File | undefined) => {
    if (!file) return
    const done = await upload(file, { purpose: 'logo', client })
    if (done) onChange({ id: done.id, preview: URL.createObjectURL(file) })
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border-strong bg-surface-input text-lg font-semibold text-text-3">
        {url ? <img src={url} alt="" className="size-full object-cover" /> : initials(name || '?')}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-white/75">
            <LoaderCircle className="animate-spin text-brand" size={20} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Button size="sm" disabled={disabled || busy} onClick={() => input.current?.click()}>
            <ImageUp size={14} /> {url ? 'Replace logo' : 'Upload logo'}
          </Button>
          {url && (
            <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => onChange(null)} aria-label="Remove logo">
              <Trash2 size={14} />
            </Button>
          )}
        </div>
        <p className="text-xs text-text-4">
          {state.phase === 'uploading'
            ? `Uploading… ${Math.round(state.progress * 100)}%`
            : state.phase === 'processing'
              ? 'Checking the upload…'
              : state.phase === 'failed'
                ? <span className="text-negative">{state.message}</span>
                : 'PNG, JPG or SVG, square works best.'}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
