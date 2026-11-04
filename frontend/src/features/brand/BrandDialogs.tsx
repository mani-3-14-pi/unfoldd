import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { ASSET_CATEGORIES, brandApi, type AssetCategory, type BrandSection } from './api'
import { assetCategoryLabel, sectionLabel } from './labels'

/** P23 "Request client update": becomes a request in the client's Needed From You, linked to the section. */
export function RequestUpdateDialog({ clientId, section, onClose, onDone }: { clientId: string; section: BrandSection; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [due, setDue] = useState('')
  const m = useMutation({
    mutationFn: () => brandApi.requestUpdate(clientId, { section, note: note.trim(), ...(due ? { due } : {}) }),
    onSuccess: () => {
      toast('Request sent to the client')
      onDone()
      onClose()
    },
  })
  const errors = fieldErrors(m.error)
  return (
    <Dialog
      title={`Ask the client to update ${sectionLabel[section].toLowerCase()}`}
      description="It appears in their Needed From You list, and they’re notified."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!note.trim()} onClick={() => m.mutate()}>
            Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What should they update?" htmlFor="ru-note" error={errors.note}>
          <Textarea id="ru-note" autoFocus maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Needed by (optional)" htmlFor="ru-due" error={errors.due}>
          <Input id="ru-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        {m.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(m.error)}</p>}
      </div>
    </Dialog>
  )
}

/** Flow 3: a specific asset the client should upload during onboarding ("Logo in SVG"). */
export function AssetRequestDialog({ clientId, onClose, onDone }: { clientId: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<AssetCategory>('brand')
  const m = useMutation({
    mutationFn: () => brandApi.assetRequest(clientId, { title: title.trim(), description: description.trim(), uploadCategory: category }),
    onSuccess: () => {
      toast('Asset requested')
      onDone()
      onClose()
    },
  })
  const errors = fieldErrors(m.error)
  return (
    <Dialog
      title="Ask for an asset"
      description="Counts toward the client’s onboarding: “Assets — n remaining”. Their upload lands in the library."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!title.trim()} onClick={() => m.mutate()}>
            Request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What do you need?" htmlFor="ar-title" error={errors.title}>
          <Input id="ar-title" autoFocus maxLength={200} placeholder="e.g. Logo in SVG" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Details (optional)" htmlFor="ar-desc">
          <Textarea id="ar-desc" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Library category" htmlFor="ar-cat">
          <Select id="ar-cat" value={category} onChange={(e) => setCategory(e.target.value as AssetCategory)}>
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {assetCategoryLabel[c]}
              </option>
            ))}
          </Select>
        </Field>
        {m.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(m.error)}</p>}
      </div>
    </Dialog>
  )
}
