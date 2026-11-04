import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, ImageUp, Link2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { useUpload } from '@/hooks/useUpload'
import { cn } from '@/lib/cn'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { brandApi, type BrandReference } from './api'
import { sentimentLabel } from './labels'

type Sentiment = BrandReference['sentiment']
const FILTERS: { value: Sentiment | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'like', label: 'Likes' },
  { value: 'dislike', label: 'Dislikes' },
  { value: 'neutral', label: 'References' },
]

/** F05–F07, P26: likes, dislikes and references are one list with a sentiment (D40). Both sides add to it. */
export function BrandReferences({ clientId, writable }: { clientId: string; writable: boolean }) {
  const qc = useQueryClient()
  const key = ['agency', 'brand', clientId, 'references']
  const refs = useQuery({ queryKey: key, queryFn: () => brandApi.references(clientId) })
  const [filter, setFilter] = useState<Sentiment | ''>('')
  const [adding, setAdding] = useState(false)
  const remove = useMutation({
    mutationFn: (id: string) => brandApi.removeReference(clientId, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const items = (refs.data?.items ?? []).filter((r) => !filter || r.sentiment === filter)

  return (
    <Card
      title="Likes, dislikes and references"
      description="What the brand loves and avoids. The client adds these in onboarding; you can add too."
      action={
        writable && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <div role="tablist" aria-label="Filter references" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn('h-8 rounded-full px-3 text-xs', filter === f.value ? 'bg-white font-medium shadow-sm ring-1 ring-border-strong' : 'text-text-2 hover:bg-black/4')}
            >
              {f.label}
            </button>
          ))}
        </div>
        {refs.isPending ? (
          <div className="h-24" />
        ) : refs.isError ? (
          <EmptyState title="Couldn’t load references">{errorMessage(refs.error)}</EmptyState>
        ) : items.length === 0 ? (
          <p className="text-[13px] text-text-3">Nothing here yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((r) => (
              <li key={r._id} className="flex flex-col overflow-hidden rounded-lg border border-border-strong bg-white">
                {r.imageUrl ? (
                  <img src={r.imageUrl} alt={r.note || 'Reference image'} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="grid aspect-video place-items-center bg-surface-input text-text-4">{r.image ? <ImageUp size={22} /> : <Link2 size={22} />}</div>
                )}
                <div className="flex flex-1 flex-col gap-1 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={cn('font-semibold', r.sentiment === 'like' ? 'text-positive' : r.sentiment === 'dislike' ? 'text-negative' : 'text-text-2')}>{sentimentLabel[r.sentiment]}</span>
                    {r.category && <span className="text-text-4">· {r.category}</span>}
                  </div>
                  {r.note && <p className="text-[13px]">{r.note}</p>}
                  {r.link && (
                    <a href={r.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 truncate text-xs text-blue-ink hover:underline">
                      <ExternalLink size={12} /> {r.link.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  <div className="mt-auto flex items-center justify-between pt-1 text-[11px] text-text-4">
                    <span>
                      {r.addedBy.name} · {r.addedBy.side === 'client' ? 'client' : 'team'}
                    </span>
                    {writable && (
                      <button type="button" aria-label="Remove reference" onClick={() => remove.mutate(r._id)} className="grid size-6 place-items-center rounded text-text-3 hover:bg-black/5">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {adding && <AddReferenceDialog clientId={clientId} onClose={() => setAdding(false)} onDone={() => void qc.invalidateQueries({ queryKey: key })} />}
    </Card>
  )
}

function AddReferenceDialog({ clientId, onClose, onDone }: { clientId: string; onClose: () => void; onDone: () => void }) {
  const [sentiment, setSentiment] = useState<Sentiment>('like')
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [category, setCategory] = useState('')
  const [image, setImage] = useState<{ id: string; name: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const { state, upload } = useUpload()
  const busy = state.phase === 'uploading' || state.phase === 'processing'

  const m = useMutation({
    mutationFn: () => brandApi.addReference(clientId, { sentiment, link: link.trim(), note: note.trim(), category: category.trim(), ...(image ? { image: image.id } : {}) }),
    onSuccess: () => {
      toast('Reference added')
      onDone()
      onClose()
    },
  })
  const errors = fieldErrors(m.error)

  return (
    <Dialog
      title="Add a reference"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={busy || (!image && !link.trim())} onClick={() => m.mutate()}>
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Kind">
          {(['like', 'dislike', 'neutral'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={sentiment === s}
              onClick={() => setSentiment(s)}
              className={cn('rounded-lg border px-3 py-2 text-[13px]', sentiment === s ? 'border-brand-border bg-green-soft/40 font-medium' : 'border-border-strong hover:bg-surface')}
            >
              {sentimentLabel[s]}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-2">Image (JPG or PNG, up to 10 MB)</span>
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
              <ImageUp size={14} /> {image ? 'Replace image' : 'Upload image'}
            </Button>
            <span className="truncate text-xs text-text-3">
              {state.phase === 'uploading'
                ? `Uploading… ${Math.round(state.progress * 100)}%`
                : state.phase === 'processing'
                  ? 'Checking…'
                  : state.phase === 'failed'
                    ? <span className="text-negative">{state.message}</span>
                    : image?.name}
            </span>
          </div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const done = await upload(file, { purpose: 'library', client: clientId, category: 'brand' })
              if (done) setImage({ id: done.id, name: done.name })
            }}
          />
          {errors.image && <p className="text-xs text-negative">{errors.image}</p>}
        </div>
        <Field label="Or a link" htmlFor="ref-link" error={errors.link}>
          <Input id="ref-link" type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="ref-note" error={errors.note} hint="What about it, in a sentence.">
          <Textarea id="ref-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Category (optional)" htmlFor="ref-cat">
          <Input id="ref-cat" maxLength={60} placeholder="e.g. Packaging, Typography" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        {m.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(m.error)}</p>}
      </div>
    </Dialog>
  )
}
