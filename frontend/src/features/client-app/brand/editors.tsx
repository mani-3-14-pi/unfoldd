import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileUp, ImagePlus, Link2, Plus, Trash2, X } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { useClientSession } from '@/features/agency/session'
import { SOCIALS, type BrandReference, type IntroData, type PersonalityData, type TasteData } from '@/features/brand/api'
import { assetCategoryLabel, leaning, tagLabel } from '@/features/brand/labels'
import { useUpload } from '@/hooks/useUpload'
import { cn } from '@/lib/cn'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { clientLibraryApi } from '../library/api'
import { clientBrandApi, clientReferencesKey, type AssetRequest } from './api'

const socialLabel: Record<(typeof SOCIALS)[number], string> = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', youtube: 'YouTube', x: 'X', tiktok: 'TikTok' }

/** One of the three open questions of the Brand Introduction (F03), up to 500 characters each. */
export function IntroQuestion({ id, label, hint, value, onChange, disabled }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Field label={label} htmlFor={id} hint={`${hint} ${value.length}/500`}>
      <Textarea id={id} value={value} maxLength={500} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="min-h-32 text-[15px]" />
    </Field>
  )
}

/** Offerings: a short repeatable list of what the brand sells or does. */
export function OfferingsEditor({ value, onChange, disabled }: { value: IntroData['offerings']; onChange: (v: IntroData['offerings']) => void; disabled?: boolean }) {
  const set = (i: number, patch: Partial<IntroData['offerings'][number]>) => onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)))
  return (
    <div className="flex flex-col gap-3">
      {value.map((o, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-border-strong bg-white p-3">
          <div className="flex items-center gap-2">
            <Input aria-label={`Offering ${i + 1} name`} placeholder="e.g. Signature cakes" value={o.name} maxLength={100} disabled={disabled} onChange={(e) => set(i, { name: e.target.value })} />
            {!disabled && (
              <button type="button" aria-label={`Remove offering ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="grid size-9 shrink-0 place-items-center rounded-lg text-text-3 hover:bg-black/5">
                <X size={16} />
              </button>
            )}
          </div>
          <Textarea aria-label={`Offering ${i + 1} description`} placeholder="A line about it (optional)" value={o.description} maxLength={300} disabled={disabled} onChange={(e) => set(i, { description: e.target.value })} className="min-h-14" />
        </div>
      ))}
      {!disabled && value.length < 30 && (
        <Button onClick={() => onChange([...value, { name: '', description: '' }])} className="self-start">
          <Plus size={15} /> Add an offering
        </Button>
      )}
    </div>
  )
}

/** Website and social handles (optional). */
export function LinksEditor({ value, onChange, disabled }: { value: IntroData; onChange: (patch: Partial<IntroData>) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Website" htmlFor="intro-website" hint="Starting with https://">
        <Input id="intro-website" type="url" inputMode="url" placeholder="https://" value={value.website} disabled={disabled} onChange={(e) => onChange({ website: e.target.value })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {SOCIALS.map((s) => (
          <Field key={s} label={socialLabel[s]} htmlFor={`intro-${s}`}>
            <Input
              id={`intro-${s}`}
              placeholder="@handle or link"
              value={value.socials[s] ?? ''}
              maxLength={200}
              disabled={disabled}
              onChange={(e) => onChange({ socials: { ...value.socials, [s]: e.target.value } })}
            />
          </Field>
        ))}
      </div>
    </div>
  )
}

/**
 * F04 personality: one continuous slider per axis (the axes are data, D42) and a live preview that names the
 * pole each one leans to.
 */
export function PersonalityEditor({
  axes,
  value,
  onChange,
  disabled,
}: {
  axes: { key: string; left: string; right: string }[]
  value: PersonalityData
  onChange: (patch: Partial<PersonalityData>) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      {axes.map((a) => {
        const v = value.axes[a.key]
        return (
          <div key={a.key} className="flex flex-col gap-2">
            <div className="flex justify-between text-[13px] font-medium">
              <span>{a.left}</span>
              <span>{a.right}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={v ?? 50}
              disabled={disabled}
              aria-label={`${a.left} to ${a.right}`}
              aria-valuetext={leaning(v, a.left, a.right)}
              onChange={(e) => onChange({ axes: { ...value.axes, [a.key]: Number(e.target.value) } })}
              className={cn('h-2 w-full cursor-pointer accent-brand', v == null && 'opacity-50')}
            />
            <span className="text-xs text-text-3">{leaning(v, a.left, a.right)}</span>
          </div>
        )
      })}

      <section aria-label="Preview" className="rounded-xl bg-green-soft/60 p-4">
        <h3 className="text-xs font-semibold tracking-wide text-green-ink uppercase">Your brand feels</h3>
        <p className="mt-1.5 text-[15px] text-text">
          {axes
            .map((a) => leaning(value.axes[a.key], a.left, a.right))
            .filter((l) => l !== 'Not set')
            .join(' · ') || 'Move the sliders to see it.'}
        </p>
      </section>

      <Field label="Words that describe the brand (optional)" htmlFor="personality-keywords" hint={`${value.keywords.length}/200`}>
        <Textarea id="personality-keywords" value={value.keywords} maxLength={200} disabled={disabled} placeholder="e.g. warm, honest, a little cheeky" onChange={(e) => onChange({ keywords: e.target.value })} />
      </Field>
    </div>
  )
}

/** F05/F06: style tags and a note, for likes or dislikes. */
export function TasteEditor({ tags, value, onChange, disabled, sentiment }: { tags: string[]; value: TasteData; onChange: (patch: Partial<TasteData>) => void; disabled?: boolean; sentiment: 'like' | 'dislike' }) {
  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-text-2">{sentiment === 'like' ? 'Styles you like' : 'Styles to avoid'}</legend>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => {
            const on = value.tags.includes(t)
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onChange({ tags: on ? value.tags.filter((x) => x !== t) : [...value.tags, t] })}
                className={cn('h-10 rounded-full border px-4 text-[13px] disabled:opacity-60', on ? 'border-brand bg-brand text-white' : 'border-border-strong bg-white text-text hover:bg-surface')}
              >
                {tagLabel(t)}
              </button>
            )
          })}
        </div>
      </fieldset>
      <Field label="Anything else? (optional)" htmlFor={`taste-note-${sentiment}`} hint={`${value.note.length}/200`}>
        <Textarea id={`taste-note-${sentiment}`} value={value.note} maxLength={200} disabled={disabled} onChange={(e) => onChange({ note: e.target.value })} />
      </Field>
    </div>
  )
}

const sentimentCopy = {
  like: { title: 'Examples you like', add: 'Add something you like', empty: 'Add images or links of work you love.' },
  dislike: { title: 'Examples you don’t like', add: 'Add something you dislike', empty: 'Add images or links of what to avoid.' },
  neutral: { title: 'References', add: 'Add a reference', empty: 'Mood boards, competitors, past campaigns: anything useful.' },
}

/** Likes, dislikes and references are one list filtered by sentiment (D40). People remove only their own. */
export function ReferenceList({ sentiment, canEdit }: { sentiment: BrandReference['sentiment']; canEdit: boolean }) {
  const s = useClientSession()
  const qc = useQueryClient()
  const key = [...clientReferencesKey, sentiment]
  const refs = useQuery({ queryKey: key, queryFn: () => clientBrandApi.references(sentiment) })
  const [adding, setAdding] = useState(false)
  const remove = useMutation({
    mutationFn: (id: string) => clientBrandApi.removeReference(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: clientReferencesKey }),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const copy = sentimentCopy[sentiment]

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{copy.title}</h3>
        {canEdit && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add
          </Button>
        )}
      </div>
      {refs.isPending ? (
        <div className="h-24 animate-pulse rounded-xl bg-surface-input" />
      ) : !refs.data?.items.length ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-[13px] text-text-3">{copy.empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {refs.data.items.map((r) => (
            <li key={r._id} className="flex flex-col overflow-hidden rounded-xl border border-border-strong bg-white">
              {r.imageUrl ? (
                <img src={r.imageUrl} alt={r.note || 'Reference image'} className="aspect-square w-full object-cover" />
              ) : r.image ? (
                <div className="grid aspect-square place-items-center bg-surface-input text-xs text-text-4">Image</div>
              ) : (
                <a href={r.link} target="_blank" rel="noreferrer" className="flex aspect-square flex-col items-center justify-center gap-2 bg-surface-input px-3 text-center text-xs break-all text-blue-ink hover:underline">
                  <Link2 size={20} />
                  {r.link.replace(/^https?:\/\//, '').slice(0, 60)}
                </a>
              )}
              <div className="flex items-start gap-1 p-2.5">
                <div className="min-w-0 flex-1">
                  {r.note && <p className="text-xs text-text-2">{r.note}</p>}
                  <p className="mt-0.5 truncate text-[11px] text-text-4">
                    {r.category ? `${r.category} · ` : ''}
                    {r.addedBy.side === 'agency' ? `${r.addedBy.name} (agency)` : r.addedBy.name}
                  </p>
                </div>
                {canEdit && r.addedBy.side === 'client' && r.addedBy.id === s.user.id && (
                  <button type="button" aria-label="Remove" onClick={() => remove.mutate(r._id)} className="grid size-7 shrink-0 place-items-center rounded text-text-3 hover:bg-black/5">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddReferenceDialog sentiment={sentiment} title={copy.add} onClose={() => setAdding(false)} />}
    </section>
  )
}

/** An image (JPG/PNG up to 10 MB) or a link, with a short note and an optional category (F05–F07). */
function AddReferenceDialog({ sentiment, title, onClose }: { sentiment: BrandReference['sentiment']; title: string; onClose: () => void }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const { state, upload } = useUpload()
  const [image, setImage] = useState<{ id: string; preview: string } | null>(null)
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [category, setCategory] = useState('')
  const busy = state.phase === 'uploading' || state.phase === 'processing'

  const pick = async (file: File | undefined) => {
    if (!file) return
    if (!/^image\/(jpeg|png)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
      toast('Use a JPG or PNG up to 10 MB.', 'error')
      return
    }
    // An attachment, not a library file: references live in the Brand DNA, not the resource library.
    const done = await upload(file, { purpose: 'attachment' })
    if (done) setImage({ id: done.id, preview: URL.createObjectURL(file) })
  }

  const save = useMutation({
    mutationFn: () => clientBrandApi.addReference({ sentiment, image: image?.id, link: link.trim(), note: note.trim(), category: category.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clientReferencesKey })
      onClose()
    },
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="ref-form" loading={save.isPending} disabled={busy || (!image && !link.trim())}>
            Add
          </Button>
        </>
      }
    >
      <form id="ref-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {image ? (
          <div className="relative">
            <img src={image.preview} alt="" className="max-h-56 w-full rounded-xl object-cover" />
            <button type="button" aria-label="Remove image" onClick={() => setImage(null)} className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-white/90 shadow">
              <X size={15} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-6 text-[13px] text-text-2 hover:bg-surface-input disabled:opacity-60"
          >
            <ImagePlus size={22} />
            {state.phase === 'uploading' ? `Uploading… ${Math.round(state.progress * 100)}%` : state.phase === 'processing' ? 'Checking…' : 'Choose an image'}
            {state.phase === 'failed' && <span className="text-xs text-negative">{state.message}</span>}
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {!image && (
          <Field label="…or a link" htmlFor="ref-link" error={errors.link}>
            <Input id="ref-link" type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} aria-invalid={!!errors.link} />
          </Field>
        )}
        <Field label="Why? (optional)" htmlFor="ref-note" hint={`${note.length}/200`} error={errors.note}>
          <Textarea id="ref-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {sentiment === 'neutral' && (
          <Field label="Category (optional)" htmlFor="ref-category" hint="e.g. Competitor, Mood board">
            <Input id="ref-category" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} />
          </Field>
        )}
        {save.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(save.error)}</p>}
      </form>
    </Dialog>
  )
}

/**
 * F08 brand assets: uploads straight into the resource library (category Brand), plus the specific files the
 * agency asked for (P16 "Assets — 2 remaining"), which are answered in Needed From You.
 */
export function AssetsPanel({ canUpload, requests }: { canUpload: boolean; requests: AssetRequest[] }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const { state, upload } = useUpload()
  const files = useQuery({ queryKey: ['client', 'library', 'files', 'category=brand'], queryFn: () => clientLibraryApi.files('category=brand&pageSize=50') })
  const busy = state.phase === 'uploading' || state.phase === 'processing'

  const pick = async (list: FileList | null) => {
    for (const file of [...(list ?? [])]) {
      const done = await upload(file, { purpose: 'library', category: 'brand' })
      if (!done) break
    }
    void qc.invalidateQueries({ queryKey: ['client', 'library'] })
  }

  return (
    <div className="flex flex-col gap-6">
      {requests.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Your agency asked for</h3>
          <ul className="flex flex-col gap-2">
            {requests.map((r) => (
              <li key={r._id}>
                <Link to={`/c/requests/${r._id}`} className="flex items-center gap-3 rounded-xl border border-border-strong bg-white px-4 py-3 hover:bg-surface">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">{r.title}</span>
                    <span className="block text-xs text-text-3">{assetCategoryLabel[r.uploadCategory as keyof typeof assetCategoryLabel] ?? r.uploadCategory}</span>
                  </span>
                  <span className={cn('text-xs font-medium', r.status === 'open' ? 'text-amber-ink' : 'text-positive')}>{r.status === 'open' ? 'Needed' : r.status === 'submitted' ? 'Sent' : 'Done'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Logos, fonts, guidelines, photos</h3>
        {canUpload && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-7 text-[14px] text-text-2 hover:bg-surface-input disabled:opacity-60"
          >
            <FileUp size={22} />
            {state.phase === 'uploading' ? `Uploading ${state.name}… ${Math.round(state.progress * 100)}%` : state.phase === 'processing' ? 'Checking…' : 'Upload brand files'}
            {state.phase === 'failed' && <span className="text-xs text-negative">{state.message}</span>}
          </button>
        )}
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files)
            e.target.value = ''
          }}
        />
        {files.data?.items.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border-strong bg-white">
            {files.data.items.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Open ${f.name}`}
                  onClick={() => void clientLibraryApi.download(f.id, true).then(({ url }) => window.open(url, '_blank', 'noopener'), (err) => toast(errorMessage(err), 'error'))}
                  className="grid size-8 place-items-center rounded-lg text-text-3 hover:bg-black/5"
                >
                  <ExternalLink size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !canUpload && <p className="text-[13px] text-text-3">No brand files yet.</p>
        )}
      </section>
    </div>
  )
}
