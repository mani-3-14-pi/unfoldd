import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { campaignsApi } from '@/features/campaigns/api'
import { contentApi, PRIORITIES, type Priority } from '@/features/content/api'
import { priorityLabel } from '@/features/content/labels'
import { ClientSelect } from '@/features/planning/ClientSelect'
import { TemplateSelect } from '@/features/planning/TemplateSelect'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { fieldErrors } from '@/lib/errors'
import { FILE_CATEGORIES, requestsApi, type ClientRequest, type FileCategory, type RequestInput } from './api'
import { fileCategoryLabel } from './labels'

/**
 * Ask the client for something (P91): files, an answer, a decision. Saved as a draft, or sent at once, which
 * puts it in their Needed From You list with a notification.
 */
export function RequestFormDialog({
  request,
  clientId: fixedClient,
  onClose,
  onSaved,
  onReload,
}: {
  request?: ClientRequest
  clientId?: string
  onClose: () => void
  onSaved: (id: string) => void
  onReload?: () => void
}) {
  const idem = useIdempotencyKey()
  const [clientId, setClientId] = useState(request?.client ?? fixedClient ?? '')
  const [template, setTemplate] = useState('')
  const [f, setF] = useState({
    title: request?.title ?? '',
    description: request?.description ?? '',
    why: request?.why ?? '',
    due: request?.due ?? '',
    priority: (request?.priority ?? 'normal') as Priority,
    uploadCategory: (request?.uploadCategory ?? 'other') as FileCategory,
    campaign: request?.campaign ?? '',
    content: request?.content ?? '',
  })
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [key]: e.target.value }))
  const campaigns = useQuery({
    queryKey: ['agency', 'campaigns', 'list', `client=${clientId}&pageSize=100`],
    queryFn: () => campaignsApi.list(`client=${clientId}&pageSize=100`),
    enabled: !!clientId,
  })
  const content = useQuery({
    queryKey: ['agency', 'content', 'list', `client=${clientId}&pageSize=100&sort=title`],
    queryFn: () => contentApi.list(`client=${clientId}&pageSize=100&sort=title`),
    enabled: !!clientId,
  })

  const save = useMutation({
    mutationFn: async (draft: boolean) => {
      const body: RequestInput = { ...f, title: f.title.trim(), campaign: f.campaign || null, content: f.content || null }
      if (request) {
        await requestsApi.update(request._id, { ...body, rev: request.rev })
        return request._id
      }
      const { request: created } = await requestsApi.create({ ...body, client: clientId, draft, ...(template ? { template } : {}) }, idem.key)
      return created._id
    },
    onSuccess: onSaved,
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(false)
  }

  return (
    <Dialog
      title={request ? `Edit ${request.title}` : 'Ask the client for something'}
      description={request ? undefined : 'It shows up in their Needed From You list. Uploads go to their resource library.'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {!request && (
            <Button loading={save.isPending && save.variables} disabled={!clientId || save.isPending} onClick={() => save.mutate(true)}>
              Save as draft
            </Button>
          )}
          <Button variant="primary" type="submit" form="request-form" loading={save.isPending && !save.variables} disabled={!clientId || save.isPending}>
            {request ? 'Save' : 'Send to client'}
          </Button>
        </>
      }
    >
      <form id="request-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {!request && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" htmlFor="rq-client" error={errors.client}>
              <ClientSelect id="rq-client" value={clientId} onChange={setClientId} allLabel="Choose a client…" disabled={!!fixedClient} />
            </Field>
            <TemplateSelect type="request" value={template} onChange={setTemplate} />
          </div>
        )}
        <Field label="What do you need?" htmlFor="rq-title" error={errors.title}>
          <Input id="rq-title" value={f.title} onChange={set('title')} maxLength={200} autoFocus placeholder="e.g. Product photos of the new menu" />
        </Field>
        <Field label="Details" htmlFor="rq-description" error={errors.description}>
          <Textarea id="rq-description" value={f.description} onChange={set('description')} maxLength={5000} />
        </Field>
        <Field label="Why we need it" htmlFor="rq-why" hint="Shown to the client: it helps them prioritise." error={errors.why}>
          <Textarea id="rq-why" value={f.why} onChange={set('why')} maxLength={2000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Due" htmlFor="rq-due" error={errors.due}>
            <Input id="rq-due" type="date" value={f.due} onChange={set('due')} />
          </Field>
          <Field label="Priority" htmlFor="rq-priority" error={errors.priority}>
            <Select id="rq-priority" value={f.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Uploads go to" htmlFor="rq-category" error={errors.uploadCategory}>
            <Select id="rq-category" value={f.uploadCategory} onChange={set('uploadCategory')}>
              {FILE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {fileCategoryLabel[c]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="For campaign (optional)" htmlFor="rq-campaign" error={errors.campaign}>
            <Select id="rq-campaign" value={f.campaign} onChange={set('campaign')} disabled={!clientId}>
              <option value="">None</option>
              {campaigns.data?.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="For content (optional)" htmlFor="rq-content" error={errors.content} hint="Tasks can wait on this request until it’s done.">
            <Select id="rq-content" value={f.content} onChange={set('content')} disabled={!clientId}>
              <option value="">None</option>
              {content.data?.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {save.isError && Object.keys(errors).length === 0 && <FormError error={save.error} onReload={onReload} />}
      </form>
    </Dialog>
  )
}
