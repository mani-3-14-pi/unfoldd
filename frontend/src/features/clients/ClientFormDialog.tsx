import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FormError } from '@/components/FormError'
import { LogoPicker } from '@/components/LogoPicker'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Switch } from '@/components/ui/Switch'
import { TagsInput } from '@/components/ui/TagsInput'
import { useAgencySession } from '@/features/agency/session'
import { activeTeamQuery } from '@/features/team/api'
import { profileKey, workspaceApi } from '@/features/workspace/api'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { fieldErrors } from '@/lib/errors'
import { TIMEZONES, timezoneLabel } from '@/lib/timezones'
import { clientsApi, type ClientDetail, type ClientInput, type Contract } from './api'

const FALLBACK_CONTRACT: Contract = { revisionsIncluded: 2, approvalLeadHours: 24, internalReview: true }

/**
 * Add a client (P14, Flow 2) or edit one. A new client starts in Onboarding with the agency's contract defaults;
 * the creator and the account manager get access straight away.
 */
export function ClientFormDialog({
  client,
  onClose,
  onSaved,
  onReload,
}: {
  /** Omit to create. */
  client?: ClientDetail
  onClose: () => void
  onSaved: (client: ClientDetail) => void
  /** Called on a stale-save conflict, so the page refetches and reopens with the latest data. */
  onReload?: () => void
}) {
  const s = useAgencySession()
  const team = useQuery(activeTeamQuery)
  const profile = useQuery({ queryKey: profileKey, queryFn: workspaceApi.profile, enabled: !client })
  const idem = useIdempotencyKey()

  const [form, setForm] = useState({
    brandName: client?.brandName ?? '',
    name: client?.name ?? '',
    contactName: client?.contact.name ?? '',
    contactEmail: client?.contact.email ?? '',
    contactPhone: client?.contact.phone ?? '',
    accountManager: client ? (client.accountManager?._id ?? '') : s.user.id,
    startDate: client?.startDate ?? '',
    timezone: client?.timezone ?? s.agency.timezone,
    notes: client?.notes ?? '',
  })
  const [services, setServices] = useState(client?.services ?? [])
  const [logo, setLogo] = useState<{ id: string | null; preview: string | null } | undefined>(undefined)
  // For a new client, the contract fields follow the agency defaults until someone edits them.
  const [contractEdit, setContractEdit] = useState<Partial<Contract>>({})
  const contract: Contract = { ...FALLBACK_CONTRACT, ...(client?.contract ?? profile.data?.agency.clientDefaults), ...contractEdit }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: () => {
      const body: ClientInput = {
        brandName: form.brandName.trim(),
        name: form.name.trim(),
        contact: { name: form.contactName.trim(), email: form.contactEmail.trim(), phone: form.contactPhone.trim() },
        services,
        accountManager: form.accountManager || null,
        startDate: form.startDate,
        timezone: form.timezone,
        notes: form.notes.trim(),
        contract,
        ...(logo !== undefined ? { logo: logo.id } : {}),
      }
      return client ? clientsApi.update(client._id, { ...body, rev: client.rev }) : clientsApi.create(body, idem.key)
    },
    onSuccess: ({ client: saved }) => onSaved(saved),
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  const logoUrl = logo !== undefined ? logo.preview : (client?.logoUrl ?? null)
  // Field errors without an input of their own here (e.g. `logo`) go in the general error line.
  const SHOWN = ['brandName', 'name', 'services', 'contact', 'accountManager', 'startDate', 'timezone', 'contract', 'notes']
  const unshown = Object.entries(errors).find(([k]) => !SHOWN.includes(k))?.[1]

  return (
    <Dialog
      title={client ? `Edit ${client.brandName}` : 'Add a client'}
      description={client ? undefined : 'One client is one brand. A company with three brands is three clients.'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="client-form" loading={save.isPending}>
            {client ? 'Save changes' : 'Add client'}
          </Button>
        </>
      }
    >
      <form id="client-form" onSubmit={submit} noValidate className="flex flex-col gap-6">
        <Section title="Brand">
          <LogoPicker
            name={form.brandName}
            url={logoUrl}
            client={client?._id}
            onChange={(next) => setLogo(next ? { id: next.id, preview: next.preview } : { id: null, preview: null })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand name" htmlFor="client-brand" error={errors.brandName} hint="What the client app shows.">
              <Input id="client-brand" value={form.brandName} onChange={set('brandName')} autoFocus={!client} aria-invalid={!!errors.brandName} maxLength={120} />
            </Field>
            <Field label="Company name" htmlFor="client-company" error={errors.name} hint="The legal or parent company.">
              <Input id="client-company" value={form.name} onChange={set('name')} aria-invalid={!!errors.name} maxLength={120} />
            </Field>
          </div>
          <Field label="Services" htmlFor="client-services" hint="What you do for them, e.g. Social media, Branding." error={errors.services}>
            <TagsInput id="client-services" value={services} onChange={setServices} placeholder="Add a service" />
          </Field>
        </Section>

        <Section title="Contact">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" htmlFor="client-contact-name">
              <Input id="client-contact-name" value={form.contactName} onChange={set('contactName')} maxLength={100} />
            </Field>
            <Field label="Email" htmlFor="client-contact-email" error={errors.contact}>
              <Input id="client-contact-email" type="email" value={form.contactEmail} onChange={set('contactEmail')} aria-invalid={!!errors.contact} />
            </Field>
            <Field label="Phone" htmlFor="client-contact-phone">
              <Input id="client-contact-phone" type="tel" value={form.contactPhone} onChange={set('contactPhone')} maxLength={30} />
            </Field>
          </div>
        </Section>

        <Section title="Account">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Account manager" htmlFor="client-am" error={errors.accountManager} hint="Gets access automatically.">
              <Select id="client-am" value={form.accountManager} onChange={set('accountManager')} disabled={team.isPending}>
                <option value="">No one yet</option>
                {team.data?.items.map((m) => (
                  <option key={m.user._id} value={m.user._id}>
                    {m.user.name}
                    {m.user._id === s.user.id ? ' (you)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Start date" htmlFor="client-start" error={errors.startDate}>
              <Input id="client-start" type="date" value={form.startDate} onChange={set('startDate')} />
            </Field>
            <Field label="Timezone" htmlFor="client-tz" error={errors.timezone} hint="Publish times use the client’s clock.">
              <Select id="client-tz" value={form.timezone} onChange={set('timezone')}>
                {!TIMEZONES.includes(form.timezone) && <option value={form.timezone}>{timezoneLabel(form.timezone)}</option>}
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {timezoneLabel(tz)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section title="Contract" description={client ? undefined : 'Prefilled from your workspace defaults.'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Revisions included per post" htmlFor="client-revisions" error={errors.contract} hint="Going over is flagged, never blocked.">
              <Input
                id="client-revisions"
                type="number"
                min={0}
                max={50}
                value={contract.revisionsIncluded}
                onChange={(e) => setContractEdit((c) => ({ ...c, revisionsIncluded: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Approval lead time (hours)" htmlFor="client-lead" hint="How long before publishing the client must approve.">
              <Input
                id="client-lead"
                type="number"
                min={0}
                max={720}
                value={contract.approvalLeadHours}
                onChange={(e) => setContractEdit((c) => ({ ...c, approvalLeadHours: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-6 rounded-lg border border-border-strong px-3.5 py-3">
            <div>
              <label htmlFor="client-internal" className="text-[13px] font-medium">
                Internal review
              </label>
              <p className="mt-0.5 text-xs text-text-3">A manager approves work before it goes to the client. Changes apply from the next submit.</p>
            </div>
            <Switch id="client-internal" label="Internal review" checked={contract.internalReview} onChange={(on) => setContractEdit((c) => ({ ...c, internalReview: on }))} />
          </div>
        </Section>

        <Section title="Notes">
          <Field label="Internal notes" htmlFor="client-notes" hint="Only your team sees these." error={errors.notes}>
            <Textarea id="client-notes" value={form.notes} onChange={set('notes')} maxLength={5000} />
          </Field>
        </Section>

        {save.isError && Object.keys(errors).length === 0 && <FormError error={save.error} onReload={onReload} />}
        {unshown && <p className="text-[13px] text-negative">{unshown}</p>}
      </form>
    </Dialog>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 w-full border-b border-border pb-2">
        <span className="text-xs font-semibold tracking-wide text-text-3 uppercase">{title}</span>
        {description && <span className="ml-2 text-xs text-text-4">{description}</span>}
      </legend>
      {children}
    </fieldset>
  )
}
