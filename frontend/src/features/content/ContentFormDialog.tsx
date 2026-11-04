import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useClientPeople } from './useClientPeople'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useAgencySession } from '@/features/agency/session'
import { clientsApi } from '@/features/clients/api'
import { templatesApi, type Template } from '@/features/templates/api'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { fieldErrors } from '@/lib/errors'
import { formatInZone, isoToZonedInput, zonedInputToIso } from '@/lib/zonedTime'
import { contentApi, FORMATS, PLATFORMS, PRIORITIES, SHIFT_REASONS, type ContentInput, type ContentRecord, type Format, type Platform, type Priority, type ShiftReason } from './api'
import { formatLabel, platformLabel, priorityLabel, shiftReasonLabel } from './labels'

/**
 * New content (P44) or the brief and details of existing content (P45–P47). The publish date is entered in the
 * client's timezone; once the client has seen a date, moving it asks why (D29/D30).
 */
export function ContentFormDialog({
  content,
  clientId: fixedClient,
  onClose,
  onSaved,
  onReload,
}: {
  content?: ContentRecord
  /** Pre-picks the client when creating from a client's page. */
  clientId?: string
  onClose: () => void
  onSaved: (id: string) => void
  onReload?: () => void
}) {
  const s = useAgencySession()
  const idem = useIdempotencyKey()
  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name'), enabled: !content })
  const [clientId, setClientId] = useState(content?.client._id ?? fixedClient ?? '')
  const people = useClientPeople(clientId)
  const tz = content?.client.timezone ?? clients.data?.items.find((c) => c._id === clientId)?.timezone ?? s.agency.timezone

  const [f, setF] = useState({
    title: content?.title ?? '',
    platform: (content?.platform ?? 'instagram') as Platform,
    format: (content?.format ?? 'feed_4x5') as Format,
    owner: content ? (content.owner ?? '') : s.user.id,
    reviewer: content?.reviewer ?? '',
    priority: (content?.priority ?? 'normal') as Priority,
    due: content?.due ?? '',
    publishLocal: isoToZonedInput(content?.publishDate, content?.client.timezone ?? s.agency.timezone),
    idea: content?.idea ?? '',
    concept: content?.concept ?? '',
    objective: content?.objective ?? '',
    brief: content?.brief ?? '',
    revisionLimit: content?.revisionLimit == null ? '' : String(content.revisionLimit),
  })
  const [shiftReason, setShiftReason] = useState<ShiftReason | ''>('')
  // P44/D55: a content template prefills the fields and adds its production tasks on create.
  const templates = useQuery({ queryKey: ['agency', 'templates', 'content'], queryFn: () => templatesApi.list('type=content&pageSize=100'), enabled: !content })
  const [templateId, setTemplateId] = useState('')
  const pickTemplate = (id: string) => {
    setTemplateId(id)
    const t = templates.data?.items.find((x) => x._id === id) as Template<'content'> | undefined
    if (!t) return
    const b = t.body
    setF((x) => ({
      ...x,
      platform: b.platform ?? x.platform,
      format: b.format ?? x.format,
      priority: b.priority ?? x.priority,
      idea: b.idea || x.idea,
      concept: b.concept || x.concept,
      objective: b.objective || x.objective,
      brief: b.brief || x.brief,
    }))
  }
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [key]: e.target.value }))

  const publishIso = f.publishLocal ? zonedInputToIso(f.publishLocal, tz) : null
  const lockedDate = !!content && ['scheduled', 'publishing'].includes(content.state)
  const dateMoved = !!content && !lockedDate && publishIso !== (content.publishDate ? new Date(content.publishDate).toISOString() : null)
  const needsReason = dateMoved && !!content?.clientVisibleAt && !!content?.publishDate

  const save = useMutation({
    mutationFn: async () => {
      const body: ContentInput = {
        title: f.title.trim(),
        platform: f.platform,
        format: f.format,
        owner: f.owner || null,
        reviewer: f.reviewer || null,
        priority: f.priority,
        due: f.due,
        idea: f.idea,
        concept: f.concept,
        objective: f.objective,
        brief: f.brief,
        revisionLimit: f.revisionLimit === '' ? null : Number(f.revisionLimit),
      }
      if (!content) {
        // `template` isn't part of ContentInput; the server reads it on create only.
        const input = { ...body, client: clientId, publishDate: publishIso, ...(templateId ? { template: templateId } : {}) }
        const { content: created } = await contentApi.create(input, idem.key)
        return created._id
      }
      await contentApi.update(content._id, {
        ...body,
        rev: content.rev,
        ...(dateMoved ? { publishDate: publishIso } : {}),
        ...(needsReason && shiftReason ? { shiftReason } : {}),
      })
      return content._id
    },
    onSuccess: onSaved,
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  const person = (id: string, label: string, value: string, onChange: (e: { target: { value: string } }) => void, error?: string) => (
    <Field label={label} htmlFor={id} error={error}>
      <Select id={id} value={value} onChange={onChange} disabled={!clientId || people.isPending}>
        <option value="">{label === 'Reviewer' ? 'Any manager' : 'No one'}</option>
        {people.data?.map((u) => (
          <option key={u._id} value={u._id}>
            {u.name}
            {u._id === s.user.id ? ' (you)' : ''}
          </option>
        ))}
      </Select>
    </Field>
  )

  return (
    <Dialog
      title={content ? `Edit ${content.title}` : 'New content'}
      description={content ? undefined : 'One post, reel, carousel or story. You’ll upload the creative as V01 next.'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="content-form" loading={save.isPending} disabled={!clientId}>
            {content ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form id="content-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {!content && (
          <Field label="Client" htmlFor="ct-client" error={errors.client}>
            <Select id="ct-client" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!!fixedClient} autoFocus={!fixedClient}>
              <option value="">Choose a client…</option>
              {clients.data?.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.brandName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!content && (templates.data?.items.length ?? 0) > 0 && (
          <Field label="Template (optional)" htmlFor="ct-template" error={errors.template} hint="Fills in the fields below and adds its production tasks.">
            <Select id="ct-template" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
              <option value="">No template</option>
              {templates.data?.items.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Title" htmlFor="ct-title" error={errors.title} hint="Your team and the client both see it.">
          <Input id="ct-title" value={f.title} onChange={set('title')} maxLength={200} autoFocus={!!fixedClient || !!content} aria-invalid={!!errors.title} placeholder="e.g. Diwali menu launch carousel" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Platform" htmlFor="ct-platform" error={errors.platform}>
            <Select id="ct-platform" value={f.platform} onChange={set('platform')}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {platformLabel[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Format" htmlFor="ct-format" error={errors.format}>
            <Select id="ct-format" value={f.format} onChange={set('format')}>
              {FORMATS.map((x) => (
                <option key={x} value={x}>
                  {formatLabel[x]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="ct-priority" error={errors.priority}>
            <Select id="ct-priority" value={f.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {person('ct-owner', 'Owner', f.owner, set('owner'), errors.owner)}
          {person('ct-reviewer', 'Reviewer', f.reviewer, set('reviewer'), errors.reviewer)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Production deadline" htmlFor="ct-due" error={errors.due}>
            <Input id="ct-due" type="date" value={f.due} onChange={set('due')} />
          </Field>
          <Field
            label="Publish date"
            htmlFor="ct-publish"
            error={errors.publishDate}
            hint={lockedDate ? 'Unschedule it to change the date.' : f.publishLocal ? `${formatInZone(publishIso, tz)} · client time` : `In the client’s time (${tz.replace(/_/g, ' ')}).`}
          >
            <Input id="ct-publish" type="datetime-local" value={f.publishLocal} onChange={set('publishLocal')} disabled={lockedDate} />
          </Field>
        </div>
        {needsReason && (
          <Field label="Why is the date moving?" htmlFor="ct-shift" error={errors.shiftReason} hint="Kept for your team. The client only sees “Schedule shifted”.">
            <Select id="ct-shift" value={shiftReason} onChange={(e) => setShiftReason(e.target.value as ShiftReason)}>
              <option value="">Choose a reason…</option>
              {SHIFT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {shiftReasonLabel[r]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Brief" htmlFor="ct-brief" error={errors.brief} hint="What to make and why: copy direction, references, must-haves.">
          <Textarea id="ct-brief" value={f.brief} onChange={set('brief')} maxLength={20_000} className="min-h-28" />
        </Field>
        {content && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Idea" htmlFor="ct-idea">
              <Textarea id="ct-idea" value={f.idea} onChange={set('idea')} maxLength={5000} />
            </Field>
            <Field label="Concept" htmlFor="ct-concept">
              <Textarea id="ct-concept" value={f.concept} onChange={set('concept')} maxLength={5000} />
            </Field>
            <Field label="Objective" htmlFor="ct-objective">
              <Textarea id="ct-objective" value={f.objective} onChange={set('objective')} maxLength={2000} />
            </Field>
          </div>
        )}
        <Field
          label="Revisions included"
          htmlFor="ct-revisions"
          error={errors.revisionLimit}
          hint={`Leave empty to use the client’s contract${content ? ` (${content.client.contract.revisionsIncluded})` : ''}.`}
          className="sm:w-1/3"
        >
          <Input id="ct-revisions" type="number" min={0} max={50} value={f.revisionLimit} onChange={set('revisionLimit')} />
        </Field>
        {save.isError && Object.keys(errors).length === 0 && <FormError error={save.error} onReload={onReload} />}
      </form>
    </Dialog>
  )
}
