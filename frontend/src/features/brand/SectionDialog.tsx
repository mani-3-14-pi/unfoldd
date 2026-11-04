import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { cn } from '@/lib/cn'
import { fieldErrors } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { brandApi, SOCIALS, type AudienceData, type Brand, type BrandSection, type IntroData, type PersonalityData, type TasteData, type TextData } from './api'
import { leaning, sectionHint, sectionLabel, tagLabel } from './labels'

const EMPTY_SOCIALS = { instagram: '', facebook: '', linkedin: '', youtube: '', x: '', tiktok: '', other: [] as string[] }

/**
 * Edits one Brand DNA section. Each section saves on its own `rev`, so a stale save is a 409 that only concerns
 * this section ("updated by X — reload", D41).
 */
export function SectionDialog({
  clientId,
  section,
  brand,
  onClose,
  onSaved,
  onReload,
}: {
  clientId: string
  section: BrandSection
  brand: Brand
  onClose: () => void
  onSaved: () => void
  onReload: () => void
}) {
  const current = brand.sections[section]
  const [data, setData] = useState<Record<string, unknown>>(() => structuredClone(current?.data ?? {}))
  const set = (key: string, value: unknown) => setData((d) => ({ ...d, [key]: value }))

  const save = useMutation({
    mutationFn: () => brandApi.saveSection(clientId, section, current?.rev ?? 1, data),
    onSuccess: () => {
      toast(`${sectionLabel[section]} saved`)
      onSaved()
      onClose()
    },
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  let body: React.ReactNode
  switch (section) {
    case 'intro': {
      const d = data as Partial<IntroData>
      const socials = { ...EMPTY_SOCIALS, ...d.socials }
      const offerings = d.offerings ?? []
      body = (
        <>
          <Field label="What the brand does" htmlFor="b-what" hint="Needed to complete onboarding.">
            <Textarea id="b-what" maxLength={500} value={d.whatWeDo ?? ''} onChange={(e) => set('whatWeDo', e.target.value)} />
          </Field>
          <Field label="What it stands for" htmlFor="b-stand">
            <Textarea id="b-stand" maxLength={500} value={d.standFor ?? ''} onChange={(e) => set('standFor', e.target.value)} />
          </Field>
          <Field label="Who it’s for" htmlFor="b-aud">
            <Textarea id="b-aud" maxLength={500} value={d.audience ?? ''} onChange={(e) => set('audience', e.target.value)} />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-xs font-medium text-text-2">Offerings</legend>
            {offerings.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  aria-label="Offering name"
                  placeholder="Name"
                  maxLength={100}
                  value={o.name}
                  className="w-48"
                  onChange={(e) => set('offerings', offerings.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <Input
                  aria-label="Offering description"
                  placeholder="Short description"
                  maxLength={300}
                  value={o.description}
                  onChange={(e) => set('offerings', offerings.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                />
                <Button variant="ghost" aria-label="Remove offering" onClick={() => set('offerings', offerings.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <Button size="sm" className="self-start" onClick={() => set('offerings', [...offerings, { name: '', description: '' }])} disabled={offerings.length >= 30}>
              <Plus size={14} /> Add offering
            </Button>
          </fieldset>
          <Field label="Website" htmlFor="b-web" error={errors.website}>
            <Input id="b-web" type="url" placeholder="https://" value={d.website ?? ''} onChange={(e) => set('website', e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {SOCIALS.map((s) => (
              <Field key={s} label={s === 'x' ? 'X' : tagLabel(s)} htmlFor={`b-${s}`}>
                <Input id={`b-${s}`} maxLength={200} placeholder="@handle or link" value={socials[s]} onChange={(e) => set('socials', { ...socials, [s]: e.target.value })} />
              </Field>
            ))}
          </div>
        </>
      )
      break
    }
    case 'personality': {
      const d = data as Partial<PersonalityData>
      const axes = d.axes ?? {}
      body = (
        <>
          {brand.meta.personalityAxes.map((a) => (
            <div key={a.key} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-text-2">
                <span>{a.left}</span>
                <span className="font-medium text-text">{leaning(axes[a.key], a.left, a.right)}</span>
                <span>{a.right}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                aria-label={`${a.left} to ${a.right}`}
                value={axes[a.key] ?? 50}
                onChange={(e) => set('axes', { ...axes, [a.key]: Number(e.target.value) })}
                className="accent-brand"
              />
            </div>
          ))}
          <Field label="Keywords" htmlFor="b-keywords" hint="A few words that capture the personality.">
            <Input id="b-keywords" maxLength={200} value={d.keywords ?? ''} onChange={(e) => set('keywords', e.target.value)} />
          </Field>
        </>
      )
      break
    }
    case 'likes':
    case 'dislikes': {
      const d = data as Partial<TasteData>
      const tags = d.tags ?? []
      body = (
        <>
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-text-2">Styles they {section === 'likes' ? 'like' : 'don’t like'}</legend>
            <div className="flex flex-wrap gap-1.5">
              {brand.meta.styleTags.map((t) => {
                const on = tags.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('tags', on ? tags.filter((x) => x !== t) : [...tags, t])}
                    className={cn('h-8 rounded-full border px-3 text-xs', on ? 'border-brand bg-brand text-white' : 'border-border-strong bg-white text-text-2 hover:bg-surface')}
                  >
                    {tagLabel(t)}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <Field label="Note" htmlFor="b-note">
            <Textarea id="b-note" maxLength={200} value={d.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </>
      )
      break
    }
    case 'audience': {
      const d = data as Partial<AudienceData>
      const field = (key: keyof AudienceData, label: string, max = 1000) => (
        <Field label={label} htmlFor={`b-${key}`}>
          <Textarea id={`b-${key}`} maxLength={max} value={d[key] ?? ''} onChange={(e) => set(key, e.target.value)} className="min-h-16" />
        </Field>
      )
      body = (
        <>
          {field('primary', 'Primary audience')}
          {field('secondary', 'Secondary audience')}
          <div className="grid gap-4 sm:grid-cols-2">
            {field('age', 'Age', 200)}
            {field('location', 'Location', 500)}
          </div>
          {field('behaviour', 'Behaviour')}
          {field('interests', 'Interests')}
        </>
      )
      break
    }
    default: {
      const d = data as Partial<TextData>
      body = (
        <Field label={sectionLabel[section]} htmlFor="b-text" hint={sectionHint[section]}>
          <Textarea id="b-text" maxLength={5000} value={d.text ?? ''} onChange={(e) => set('text', e.target.value)} className="min-h-40" />
        </Field>
      )
    }
  }

  return (
    <Dialog
      title={`Edit ${sectionLabel[section].toLowerCase()}`}
      description={current?.updatedBy ? `Last changed by ${current.updatedBy.name}. The client sees your changes and the history keeps both.` : undefined}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="section-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="section-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {body}
        {save.isError && <FormError error={save.error} onReload={onReload} />}
      </form>
    </Dialog>
  )
}
