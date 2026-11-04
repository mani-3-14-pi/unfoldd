import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useAgencySession } from '@/features/agency/session'
import { PLATFORMS, type Platform } from '@/features/content/api'
import { platformLabel } from '@/features/content/labels'
import { ClientSelect } from '@/features/planning/ClientSelect'
import { TemplateSelect } from '@/features/planning/TemplateSelect'
import { activeTeamQuery } from '@/features/team/api'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { cn } from '@/lib/cn'
import { fieldErrors } from '@/lib/errors'
import { campaignsApi, type Campaign, type CampaignBrief, type CampaignInput } from './api'

const BRIEF_FIELDS: { key: keyof CampaignBrief; label: string; hint: string }[] = [
  { key: 'background', label: 'Background', hint: 'Why this campaign, why now.' },
  { key: 'strategy', label: 'Strategy', hint: 'How you’ll get there.' },
  { key: 'deliverables', label: 'Deliverables', hint: 'What the team will make.' },
  { key: 'references', label: 'References', hint: 'Links, moodboards, past work.' },
  { key: 'successCriteria', label: 'Success criteria', hint: 'How you’ll know it worked.' },
]

/**
 * New campaign (P33) or edit one (P34–P35). The brief is internal to the agency; the client sees the name,
 * objective, key message, dates and progress.
 */
export function CampaignFormDialog({
  campaign,
  clientId: fixedClient,
  onClose,
  onSaved,
  onReload,
}: {
  campaign?: Campaign
  clientId?: string
  onClose: () => void
  onSaved: (id: string) => void
  onReload?: () => void
}) {
  const s = useAgencySession()
  const idem = useIdempotencyKey()
  const team = useQuery(activeTeamQuery)
  const [clientId, setClientId] = useState(campaign?.client ?? fixedClient ?? '')
  const [template, setTemplate] = useState('')
  const [f, setF] = useState({
    name: campaign?.name ?? '',
    objective: campaign?.objective ?? '',
    audience: campaign?.audience ?? '',
    keyMessage: campaign?.keyMessage ?? '',
    startDate: campaign?.startDate ?? '',
    endDate: campaign?.endDate ?? '',
    owner: campaign ? (campaign.owner ?? '') : s.user.id,
  })
  const [platforms, setPlatforms] = useState<Platform[]>(campaign?.platforms ?? [])
  const [brief, setBrief] = useState<CampaignBrief>(
    campaign?.brief ?? { background: '', strategy: '', deliverables: '', references: '', successCriteria: '' },
  )
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: async () => {
      const body: CampaignInput = { ...f, name: f.name.trim(), owner: f.owner || null, platforms, brief }
      if (campaign) {
        await campaignsApi.update(campaign._id, { ...body, rev: campaign.rev })
        return campaign._id
      }
      const { campaign: created } = await campaignsApi.create({ ...body, client: clientId, ...(template ? { template } : {}) }, idem.key)
      return created._id
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
      title={campaign ? `Edit ${campaign.name}` : 'New campaign'}
      description={campaign ? undefined : 'Group content under one objective, with dates and a brief.'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="campaign-form" loading={save.isPending} disabled={!clientId}>
            {campaign ? 'Save' : 'Create campaign'}
          </Button>
        </>
      }
    >
      <form id="campaign-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        {!campaign && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" htmlFor="cmp-client" error={errors.client}>
              <ClientSelect id="cmp-client" value={clientId} onChange={setClientId} allLabel="Choose a client…" disabled={!!fixedClient} />
            </Field>
            <TemplateSelect type="campaign" value={template} onChange={setTemplate} />
          </div>
        )}
        <Field label="Name" htmlFor="cmp-name" error={errors.name}>
          <Input id="cmp-name" value={f.name} onChange={set('name')} maxLength={150} autoFocus aria-invalid={!!errors.name} placeholder="e.g. Diwali 2026" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Starts" htmlFor="cmp-start" error={errors.startDate}>
            <Input id="cmp-start" type="date" value={f.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="Ends" htmlFor="cmp-end" error={errors.endDate}>
            <Input id="cmp-end" type="date" value={f.endDate} min={f.startDate || undefined} onChange={set('endDate')} />
          </Field>
          <Field label="Owner" htmlFor="cmp-owner" error={errors.owner}>
            <Select id="cmp-owner" value={f.owner} onChange={set('owner')} disabled={team.isPending}>
              <option value="">No one</option>
              {team.data?.items.map((m) => (
                <option key={m.user._id} value={m.user._id}>
                  {m.user.name}
                  {m.user._id === s.user.id ? ' (you)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-text-2">Platforms</legend>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => {
              const on = platforms.includes(p)
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPlatforms((x) => (on ? x.filter((y) => y !== p) : [...x, p]))}
                  className={cn('h-8 rounded-full border px-3 text-xs', on ? 'border-brand-border bg-green-soft font-medium text-green-ink' : 'border-border-strong bg-white text-text-2 hover:bg-surface')}
                >
                  {platformLabel[p]}
                </button>
              )
            })}
          </div>
          {errors.platforms && <p className="text-xs text-negative">{errors.platforms}</p>}
        </fieldset>

        <Section title="Shared with the client">
          <Field label="Objective" htmlFor="cmp-objective" error={errors.objective}>
            <Textarea id="cmp-objective" value={f.objective} onChange={set('objective')} maxLength={2000} />
          </Field>
          <Field label="Key message" htmlFor="cmp-message" error={errors.keyMessage}>
            <Textarea id="cmp-message" value={f.keyMessage} onChange={set('keyMessage')} maxLength={2000} />
          </Field>
        </Section>

        <Section title="Brief · only your team sees this">
          <Field label="Audience" htmlFor="cmp-audience" error={errors.audience}>
            <Textarea id="cmp-audience" value={f.audience} onChange={set('audience')} maxLength={2000} />
          </Field>
          {BRIEF_FIELDS.map((b) => (
            <Field key={b.key} label={b.label} htmlFor={`cmp-${b.key}`} hint={b.hint}>
              <Textarea id={`cmp-${b.key}`} value={brief[b.key]} onChange={(e) => setBrief((x) => ({ ...x, [b.key]: e.target.value }))} maxLength={10_000} />
            </Field>
          ))}
          {errors.brief && <p className="text-xs text-negative">{errors.brief}</p>}
        </Section>

        {save.isError && Object.keys(errors).length === 0 && <FormError error={save.error} onReload={onReload} />}
      </form>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 w-full border-b border-border pb-2 text-xs font-semibold tracking-wide text-text-3 uppercase">{title}</legend>
      {children}
    </fieldset>
  )
}
