import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useAgencySession } from '@/features/agency/session'
import { campaignsApi } from '@/features/campaigns/api'
import { FORMATS, PLATFORMS, type Format, type Platform } from '@/features/content/api'
import { formatLabel, platformLabel } from '@/features/content/labels'
import { activeTeamQuery } from '@/features/team/api'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { formatInZone, zonedInputToIso } from '@/lib/zonedTime'
import { plansApi, type BulkGroup, type PlanDetail } from './api'

/** P39: one planned item with its idea and planned date (in the client's timezone). */
export function AddPlanItemDialog({ plan, timezone, onClose, onDone }: { plan: PlanDetail; timezone: string; onClose: () => void; onDone: () => void }) {
  const s = useAgencySession()
  const idem = useIdempotencyKey()
  const team = useQuery(activeTeamQuery)
  const campaigns = useQuery({
    queryKey: ['agency', 'campaigns', 'list', `client=${plan.client}&pageSize=100`],
    queryFn: () => campaignsApi.list(`client=${plan.client}&pageSize=100`),
  })
  const [f, setF] = useState({
    title: '',
    platform: 'instagram' as Platform,
    format: 'feed_4x5' as Format,
    when: '',
    idea: '',
    concept: '',
    objective: '',
    owner: s.user.id,
    campaign: '',
  })
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [key]: e.target.value }))
  const iso = f.when ? zonedInputToIso(f.when, timezone) : null

  const save = useMutation({
    mutationFn: () =>
      plansApi.addItem(
        plan._id,
        {
          title: f.title.trim(),
          platform: f.platform,
          format: f.format,
          idea: f.idea,
          concept: f.concept,
          objective: f.objective,
          publishDate: iso,
          owner: f.owner || null,
          campaign: f.campaign || null,
        },
        idem.key,
      ),
    onSuccess: () => {
      onDone()
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
      title="Add an item"
      description={plan.status === 'draft' ? undefined : 'The client already has this plan: they’ll see the new item right away.'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="plan-item-form" loading={save.isPending} disabled={!f.title.trim()}>
            Add item
          </Button>
        </>
      }
    >
      <form id="plan-item-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Title" htmlFor="pi-title" error={errors.title}>
          <Input id="pi-title" value={f.title} onChange={set('title')} maxLength={200} autoFocus placeholder="e.g. Festive menu reveal" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Platform" htmlFor="pi-platform" error={errors.platform}>
            <Select id="pi-platform" value={f.platform} onChange={set('platform')}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {platformLabel[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Format" htmlFor="pi-format" error={errors.format}>
            <Select id="pi-format" value={f.format} onChange={set('format')}>
              {FORMATS.map((x) => (
                <option key={x} value={x}>
                  {formatLabel[x]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Planned date" htmlFor="pi-when" error={errors.publishDate} hint={iso ? formatInZone(iso, timezone) : 'Client time'}>
            <Input id="pi-when" type="datetime-local" value={f.when} onChange={set('when')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner" htmlFor="pi-owner" error={errors.owner}>
            <Select id="pi-owner" value={f.owner} onChange={set('owner')}>
              <option value="">No one</option>
              {team.data?.items.map((m) => (
                <option key={m.user._id} value={m.user._id}>
                  {m.user.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Campaign" htmlFor="pi-campaign" error={errors.campaign}>
            <Select id="pi-campaign" value={f.campaign} onChange={set('campaign')}>
              <option value="">None</option>
              {campaigns.data?.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Idea" htmlFor="pi-idea" hint="The client sees this when reviewing the plan.">
          <Textarea id="pi-idea" value={f.idea} onChange={set('idea')} maxLength={5000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Concept" htmlFor="pi-concept">
            <Textarea id="pi-concept" value={f.concept} onChange={set('concept')} maxLength={5000} />
          </Field>
          <Field label="Objective" htmlFor="pi-objective">
            <Textarea id="pi-objective" value={f.objective} onChange={set('objective')} maxLength={2000} />
          </Field>
        </div>
        {save.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(save.error)}</p>}
      </form>
    </Dialog>
  )
}

/** P40: rough out a month at once, e.g. 12 Instagram posts + 6 LinkedIn posts. Titles and dates come later. */
export function BulkAddDialog({ plan, onClose, onDone }: { plan: PlanDetail; onClose: () => void; onDone: () => void }) {
  const idem = useIdempotencyKey()
  const [groups, setGroups] = useState<BulkGroup[]>([
    { platform: 'instagram', format: 'feed_4x5', count: 12 },
    { platform: 'linkedin', format: 'linkedin', count: 4 },
  ])
  const total = groups.reduce((n, g) => n + (g.count || 0), 0)
  const update = (i: number, patch: Partial<BulkGroup>) => setGroups((x) => x.map((g, j) => (j === i ? { ...g, ...patch } : g)))

  const save = useMutation({
    mutationFn: () => plansApi.addBulk(plan._id, groups.map((g) => ({ ...g, title: g.title?.trim() || undefined })), idem.key),
    onSuccess: () => {
      onDone()
      onClose()
    },
  })
  const errors = fieldErrors(save.error)

  return (
    <Dialog
      title="Add many items"
      description="Each becomes a planned item, numbered, e.g. “Instagram post 1”. Fill in titles, ideas and dates afterwards."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-text-3">{total} item{total === 1 ? '' : 's'} (100 at most)</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!total || total > 100} onClick={() => save.mutate()}>
            Add {total} item{total === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {groups.map((g, i) => (
          <div key={i} className="grid grid-cols-[72px_1fr_1fr_1.2fr_auto] items-end gap-2">
            <Field label={i === 0 ? 'Count' : ' '} htmlFor={`bulk-count-${i}`}>
              <Input id={`bulk-count-${i}`} type="number" min={1} max={60} value={g.count} onChange={(e) => update(i, { count: Number(e.target.value) })} />
            </Field>
            <Field label={i === 0 ? 'Platform' : ' '} htmlFor={`bulk-platform-${i}`}>
              <Select id={`bulk-platform-${i}`} value={g.platform} onChange={(e) => update(i, { platform: e.target.value as Platform })}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {platformLabel[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={i === 0 ? 'Format' : ' '} htmlFor={`bulk-format-${i}`}>
              <Select id={`bulk-format-${i}`} value={g.format} onChange={(e) => update(i, { format: e.target.value as Format })}>
                {FORMATS.map((x) => (
                  <option key={x} value={x}>
                    {formatLabel[x]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={i === 0 ? 'Title prefix (optional)' : ' '} htmlFor={`bulk-title-${i}`}>
              <Input id={`bulk-title-${i}`} value={g.title ?? ''} onChange={(e) => update(i, { title: e.target.value })} maxLength={150} placeholder="e.g. Festive post" />
            </Field>
            <Button variant="ghost" aria-label="Remove this row" disabled={groups.length === 1} onClick={() => setGroups((x) => x.filter((_, j) => j !== i))}>
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
        {groups.length < 10 && (
          <Button size="sm" className="self-start" onClick={() => setGroups((x) => [...x, { platform: 'instagram', format: 'story_9x16', count: 4 }])}>
            <Plus size={14} /> Add a row
          </Button>
        )}
        {(errors.groups || (save.isError && Object.keys(errors).length === 0)) && <p className="text-[13px] text-negative">{errors.groups ?? errorMessage(save.error)}</p>}
      </div>
    </Dialog>
  )
}
