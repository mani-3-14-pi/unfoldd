import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useAgencySession } from '@/features/agency/session'
import { clientsApi } from '@/features/clients/api'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { fieldErrors } from '@/lib/errors'
import { formatInZone, isoToZonedInput, zonedInputToIso } from '@/lib/zonedTime'
import { MEETING_PLATFORMS, meetingsApi, type Meeting, type MeetingInput, type MeetingPlatform } from './api'
import { meetingPlatformLabel } from './labels'
import { useMeetingOptions } from './useMeetingOptions'

/** P104: schedule a meeting with a client, or edit a scheduled one. Times are entered in the client's timezone. */
export function MeetingFormDialog({
  meeting,
  clientId: fixedClient,
  timezone,
  onClose,
  onSaved,
  onReload,
}: {
  meeting?: Meeting
  clientId?: string
  /** The meeting's client's timezone, so an edit shows the saved times on the client's clock from the start. */
  timezone?: string
  onClose: () => void
  onSaved: (id: string) => void
  onReload?: () => void
}) {
  const s = useAgencySession()
  const idem = useIdempotencyKey()
  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name'), enabled: !meeting && !fixedClient })
  const fixed = useQuery({ queryKey: ['agency', 'clients', 'detail', meeting?.client ?? fixedClient ?? ''], queryFn: () => clientsApi.get(meeting?.client ?? fixedClient!), enabled: !timezone && !!(meeting?.client ?? fixedClient) })
  const [clientId, setClientId] = useState(meeting?.client ?? fixedClient ?? '')
  const tz = timezone ?? fixed.data?.client.timezone ?? clients.data?.items.find((c) => c._id === clientId)?.timezone ?? s.agency.timezone
  const options = useMeetingOptions(clientId)

  // Times are kept as typed (client clock) and converted on save, so changing the client re-reads them in its zone.
  const [f, setF] = useState({
    title: meeting?.title ?? '',
    start: meeting ? isoToZonedInput(meeting.startAt, timezone ?? s.agency.timezone) : '',
    end: meeting ? isoToZonedInput(meeting.endAt, timezone ?? s.agency.timezone) : '',
    platform: (meeting?.platform ?? 'google_meet') as MeetingPlatform,
    joinUrl: meeting?.joinUrl ?? '',
    location: meeting?.location ?? '',
    agenda: meeting?.agenda ?? '',
    campaign: meeting?.campaign ?? '',
  })
  const [agencyPeople, setAgencyPeople] = useState<string[]>(meeting?.participants.agency ?? [s.user.id])
  const [clientPeople, setClientPeople] = useState<string[]>(meeting?.participants.client ?? [])
  const [content, setContent] = useState<string[]>(meeting?.content ?? [])
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: async () => {
      const body: MeetingInput = {
        title: f.title.trim(),
        startAt: zonedInputToIso(f.start, tz),
        endAt: zonedInputToIso(f.end, tz),
        platform: f.platform,
        joinUrl: f.joinUrl.trim(),
        location: f.location.trim(),
        agenda: f.agenda,
        participants: { agency: agencyPeople, client: clientPeople },
        campaign: f.campaign || null,
        content,
      }
      if (meeting) return (await meetingsApi.update(meeting._id, { ...body, rev: meeting.rev })).meeting._id
      return (await meetingsApi.create({ ...body, client: clientId }, idem.key)).meeting._id
    },
    onSuccess: onSaved,
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  const people = (label: string, list: { _id: string; name: string }[] | undefined, value: string[], onChange: (v: string[]) => void, empty: string) => (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1.5 text-xs font-medium text-text-2">{label}</legend>
      {!list?.length ? (
        <p className="text-xs text-text-4">{empty}</p>
      ) : (
        <div className="flex max-h-36 flex-col overflow-y-auto">
          {list.map((u) => (
            <label key={u._id} className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-1 text-[13px] hover:bg-surface-input">
              <input
                type="checkbox"
                className="size-4 accent-brand"
                checked={value.includes(u._id)}
                onChange={(e) => onChange(e.target.checked ? [...value, u._id] : value.filter((x) => x !== u._id))}
              />
              {u.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )

  return (
    <Dialog
      title={meeting ? `Edit ${meeting.title}` : 'Schedule a meeting'}
      description={meeting ? 'The client is told if the time moves.' : 'The client’s people you add are notified and see it in their app.'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="meeting-form" loading={save.isPending} disabled={!clientId || !f.start || !f.end}>
            {meeting ? 'Save' : 'Schedule'}
          </Button>
        </>
      }
    >
      <form id="meeting-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {!meeting && !fixedClient && (
          <Field label="Client" htmlFor="mt-client" error={errors.client}>
            <Select
              id="mt-client"
              value={clientId}
              autoFocus
              onChange={(e) => {
                setClientId(e.target.value)
                setClientPeople([])
                setContent([])
                setF((x) => ({ ...x, campaign: '' }))
              }}
            >
              <option value="">Choose a client…</option>
              {clients.data?.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.brandName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Title" htmlFor="mt-title" error={errors.title}>
          <Input id="mt-title" maxLength={200} value={f.title} onChange={set('title')} placeholder="e.g. October plan review" aria-invalid={!!errors.title} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts (client time)" htmlFor="mt-start" error={errors.startAt} hint={f.start ? formatInZone(zonedInputToIso(f.start, tz), tz) : tz.replace(/_/g, ' ')}>
            <Input
              id="mt-start"
              type="datetime-local"
              value={f.start}
              onChange={(e) => {
                const start = e.target.value
                // Default to an hour long when the end isn't set yet, or would end before the start.
                setF((x) => {
                  const plusHour = start ? new Date(new Date(`${start}:00Z`).getTime() + 3_600_000).toISOString().slice(0, 16) : ''
                  return { ...x, start, end: !x.end || x.end <= start ? plusHour : x.end }
                })
              }}
            />
          </Field>
          <Field label="Ends" htmlFor="mt-end" error={errors.endAt}>
            <Input id="mt-end" type="datetime-local" value={f.end} min={f.start || undefined} onChange={set('end')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Where" htmlFor="mt-platform">
            <Select id="mt-platform" value={f.platform} onChange={set('platform')}>
              {MEETING_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {meetingPlatformLabel[p]}
                </option>
              ))}
            </Select>
          </Field>
          {f.platform === 'in_person' || f.platform === 'phone' ? (
            <Field label={f.platform === 'phone' ? 'Number' : 'Address'} htmlFor="mt-location" error={errors.location} className="sm:col-span-2">
              <Input id="mt-location" maxLength={300} value={f.location} onChange={set('location')} />
            </Field>
          ) : (
            <Field label="Join link" htmlFor="mt-join" error={errors.joinUrl} hint="Paste it from your calendar." className="sm:col-span-2">
              <Input id="mt-join" type="url" placeholder="https://meet.google.com/…" value={f.joinUrl} onChange={set('joinUrl')} aria-invalid={!!errors.joinUrl} />
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {people('From your team', options.agency.data, agencyPeople, setAgencyPeople, clientId ? 'No one assigned yet.' : 'Pick a client first.')}
          {people('From the client', options.client.data, clientPeople, setClientPeople, clientId ? 'The client has no people yet.' : 'Pick a client first.')}
        </div>
        {errors.participants && <p className="text-xs text-negative">{errors.participants}</p>}
        <Field label="Agenda" htmlFor="mt-agenda" error={errors.agenda}>
          <Textarea id="mt-agenda" maxLength={10_000} value={f.agenda} onChange={set('agenda')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Campaign (optional)" htmlFor="mt-campaign" error={errors.campaign}>
            <Select id="mt-campaign" value={f.campaign} onChange={set('campaign')} disabled={!clientId}>
              <option value="">None</option>
              {options.campaigns.data?.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Content to discuss (optional)" htmlFor="mt-content" error={errors.content} hint="Ctrl/⌘-click to pick several.">
            <select
              id="mt-content"
              multiple
              value={content}
              disabled={!clientId}
              onChange={(e) => setContent([...e.target.selectedOptions].map((o) => o.value))}
              className="h-24 w-full rounded-lg border border-border-strong bg-white px-2 py-1 text-[13px] focus:border-brand-border focus:outline-none focus:ring-4 focus:ring-brand/10"
            >
              {options.content.data?.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {save.isError && Object.keys(errors).length === 0 && <FormError error={save.error} onReload={onReload} />}
      </form>
    </Dialog>
  )
}
