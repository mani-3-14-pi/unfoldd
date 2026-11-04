import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ImageUp, LoaderCircle, Trash2 } from 'lucide-react'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { clientsApi } from '@/features/clients/api'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { useUpload } from '@/hooks/useUpload'
import { fieldErrors } from '@/lib/errors'
import { isoToZonedInput, zonedInputToIso } from '@/lib/zonedTime'
import { bannersApi, type Banner, type BannerInput } from './api'

/**
 * Create or edit a manual banner for a client's Home (D52). Dates are in the client's timezone; the CTA opens a
 * page in the client app. The image is uploaded to the client's library as shared, because the client sees it.
 */
export function BannerFormDialog({
  banner,
  clientId: fixedClient,
  onClose,
  onSaved,
  onReload,
}: {
  banner?: Banner
  clientId?: string
  onClose: () => void
  onSaved: () => void
  onReload?: () => void
}) {
  const idem = useIdempotencyKey()
  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name') })
  const [client, setClient] = useState(banner?.client ?? fixedClient ?? '')
  const tz = clients.data?.items.find((c) => c._id === client)?.timezone ?? 'UTC'
  const [f, setF] = useState({
    headline: banner?.headline ?? '',
    text: banner?.text ?? '',
    ctaLabel: banner?.cta.label ?? '',
    ctaLink: banner?.cta.link ?? '',
  })
  // Kept as ISO instants, shown in the client's timezone.
  const [startAt, setStartAt] = useState(banner?.startAt ?? null)
  const [endAt, setEndAt] = useState(banner?.endAt ?? null)
  const [image, setImage] = useState<{ id: string | null; preview: string | null }>({ id: banner?.image ?? null, preview: banner?.imageUrl ?? null })
  const [publish, setPublish] = useState(false)
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [key]: e.target.value }))

  const { state: upload, upload: start } = useUpload()
  const input = useRef<HTMLInputElement>(null)
  const pick = async (file: File | undefined) => {
    if (!file || !client) return
    // Shared with the client: they see the banner. Extra fields go straight into the file record.
    const options = { purpose: 'library' as const, client, category: 'brand', visibility: 'client' }
    const done = await start(file, options)
    if (done) setImage({ id: done.id, preview: URL.createObjectURL(file) })
  }
  const busy = upload.phase === 'uploading' || upload.phase === 'processing'

  const save = useMutation({
    mutationFn: () => {
      const body: BannerInput = {
        headline: f.headline.trim(),
        text: f.text.trim(),
        image: image.id,
        // An empty link means no button: left out on create, removed (null) on edit.
        ...(f.ctaLink.trim() ? { cta: { label: f.ctaLabel.trim(), link: f.ctaLink.trim() } } : banner ? { cta: null } : {}),
        startAt,
        endAt,
      }
      return banner ? bannersApi.update(banner._id, { ...body, rev: banner.rev }) : bannersApi.create({ ...body, client, publish }, idem.key)
    },
    onSuccess: onSaved,
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Dialog
      title={banner ? 'Edit banner' : 'New banner'}
      description="Shown at the top of the client’s Home in the client app."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="banner-form" loading={save.isPending} disabled={!client || busy}>
            {banner ? 'Save' : publish ? 'Publish' : 'Save draft'}
          </Button>
        </>
      }
    >
      <form id="banner-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {!banner && (
          <Field label="Client" htmlFor="bn-client" error={errors.client}>
            <Select id="bn-client" value={client} onChange={(e) => setClient(e.target.value)} disabled={!!fixedClient} autoFocus={!fixedClient}>
              <option value="">Choose a client…</option>
              {clients.data?.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.brandName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Headline" htmlFor="bn-headline" error={errors.headline}>
          <Input id="bn-headline" value={f.headline} onChange={set('headline')} maxLength={120} aria-invalid={!!errors.headline} placeholder="e.g. Your November plan is ready" />
        </Field>
        <Field label="Text (optional)" htmlFor="bn-text" error={errors.text}>
          <Textarea id="bn-text" value={f.text} onChange={set('text')} maxLength={500} />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-2">Image (optional)</span>
          <div className="flex items-center gap-3">
            <div className="relative grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-border-strong bg-surface-input text-xs text-text-4">
              {image.preview ? <img src={image.preview} alt="" className="size-full object-cover" /> : 'No image'}
              {busy && (
                <div className="absolute inset-0 grid place-items-center bg-white/75">
                  <LoaderCircle className="animate-spin text-brand" size={18} />
                </div>
              )}
            </div>
            <Button size="sm" disabled={!client || busy} onClick={() => input.current?.click()}>
              <ImageUp size={14} /> {image.preview ? 'Replace' : 'Upload'}
            </Button>
            {image.id && (
              <Button size="sm" variant="ghost" aria-label="Remove image" onClick={() => setImage({ id: null, preview: null })}>
                <Trash2 size={14} />
              </Button>
            )}
          </div>
          <p className="text-xs text-text-4">
            {upload.phase === 'failed' ? <span className="text-negative">{upload.message}</span> : !client ? 'Choose a client first.' : 'Wide images work best. The client will see it.'}
          </p>
          {errors.image && <p className="text-xs text-negative">{errors.image}</p>}
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Button label" htmlFor="bn-cta-label" error={errors.cta}>
            <Input id="bn-cta-label" value={f.ctaLabel} onChange={set('ctaLabel')} maxLength={40} placeholder="Review plan" />
          </Field>
          <Field label="Button opens" htmlFor="bn-cta-link" hint="A page in the client app, starting with /c/" error={errors.cta}>
            <Input id="bn-cta-link" value={f.ctaLink} onChange={set('ctaLink')} maxLength={500} placeholder="/c/plans" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Shows from (client time)" htmlFor="bn-start" hint="Empty: as soon as it’s published." error={errors.startAt}>
            <Input id="bn-start" type="datetime-local" value={isoToZonedInput(startAt, tz)} onChange={(e) => setStartAt(e.target.value ? zonedInputToIso(e.target.value, tz) : null)} disabled={!client} />
          </Field>
          <Field label="Until (client time)" htmlFor="bn-end" hint="Empty: until you end it." error={errors.endAt}>
            <Input id="bn-end" type="datetime-local" value={isoToZonedInput(endAt, tz)} onChange={(e) => setEndAt(e.target.value ? zonedInputToIso(e.target.value, tz) : null)} disabled={!client} />
          </Field>
        </div>

        {!banner && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="size-4 accent-brand" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
            Publish now (otherwise it’s saved as a draft)
          </label>
        )}

        {save.isError && Object.keys(errors).length === 0 && <FormError error={save.error} onReload={onReload} />}
      </form>
    </Dialog>
  )
}
