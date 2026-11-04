import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormError } from '@/components/FormError'
import { LogoPicker } from '@/components/LogoPicker'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Switch } from '@/components/ui/Switch'
import { TagsInput } from '@/components/ui/TagsInput'
import { sessionKey } from '@/features/agency/api'
import { isAgencyAdmin } from '@/features/agency/roles'
import { PermissionsCard } from '@/features/permissions/PermissionsCard'
import { useAgencySession } from '@/features/agency/session'
import {
  AGENCY_TYPES,
  agencyTypeLabel,
  notificationCategoryLabel,
  profileKey,
  TEAM_SIZES,
  workspaceApi,
  type AgencyProfile,
  type NotificationPref,
  type ProfileUpdate,
} from '@/features/workspace/api'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { TIMEZONES, timezoneLabel } from '@/lib/timezones'
import { toast } from '@/lib/toast'

/** P154–P156: the agency profile and workspace defaults (Owner/Admin edit), plus each person's own notifications. */
export function SettingsPage() {
  const s = useAgencySession()
  const profile = useQuery({ queryKey: profileKey, queryFn: workspaceApi.profile })
  return (
    <>
      <PageHeader title="Settings" description={isAgencyAdmin(s.role) ? 'Your agency’s profile and defaults, and your own notifications.' : 'Your notifications. Only owners and admins can change agency settings.'} />
      <div className="flex max-w-3xl flex-col gap-6">
        {profile.isPending ? (
          <Card title="Agency profile">
            <div className="h-48" />
          </Card>
        ) : profile.isError ? (
          <EmptyState title="Couldn’t load settings">{errorMessage(profile.error)}</EmptyState>
        ) : (
          <AgencySettings key={`${profile.data.agency.rev}`} initial={profile.data.agency} editable={isAgencyAdmin(s.role)} />
        )}
        <NotificationSettings />
        <PermissionsCard />
      </div>
    </>
  )
}

function Row({ title, description, children, htmlFor }: { title: string; description: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div>
        <label htmlFor={htmlFor} className="text-[13px] font-medium">
          {title}
        </label>
        <p className="mt-0.5 text-xs text-text-3">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

type Editable = Omit<AgencyProfile, 'id' | 'slug' | 'status' | 'logoUrl' | 'rev' | 'updatedAt'>

const editableOf = ({ id: _i, slug: _s, status: _st, logoUrl: _l, rev: _r, updatedAt: _u, ...rest }: AgencyProfile): Editable => rest

/** Remounted (via `key`) whenever the saved profile's `rev` changes, so it always starts from the latest. */
function AgencySettings({ initial, editable }: { initial: AgencyProfile; editable: boolean }) {
  const qc = useQueryClient()
  const [form, setForm] = useState(() => editableOf(initial))
  const [logoPreview, setLogoPreview] = useState(initial.logoUrl)
  const discard = () => {
    setForm(editableOf(initial))
    setLogoPreview(initial.logoUrl)
    save.reset()
  }
  const set = <K extends keyof Editable>(key: K, value: Editable[K]) => setForm((f) => ({ ...f, [key]: value }))
  const text = (key: keyof Editable) => (e: { target: { value: string } }) => set(key, e.target.value as never)

  const changed = (Object.keys(form) as (keyof Editable)[]).filter((k) => JSON.stringify(form[k]) !== JSON.stringify(initial[k]))
  const dirty = changed.length > 0

  const save = useMutation({
    mutationFn: () => {
      const body: ProfileUpdate = { rev: initial.rev }
      for (const k of changed) (body as Record<string, unknown>)[k] = form[k]
      return workspaceApi.updateProfile(body)
    },
    onSuccess: (data) => {
      qc.setQueryData(profileKey, data)
      // The agency name and timezone also live in the session (sidebar, defaults for new clients).
      void qc.invalidateQueries({ queryKey: sessionKey })
      toast('Settings saved')
    },
  })
  const errors = fieldErrors(save.error)
  const reload = () => void qc.invalidateQueries({ queryKey: profileKey })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const d = form.clientDefaults

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Card title="Agency profile" description={`Last changed ${formatDateTime(initial.updatedAt)}`}>
        <fieldset disabled={!editable} className="flex flex-col gap-4 px-5 py-4">
          <LogoPicker
            name={form.name}
            url={logoPreview}
            disabled={!editable}
            onChange={(next) => {
              set('logo', next?.id ?? null)
              setLogoPreview(next?.preview ?? null)
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Agency name" htmlFor="ag-name" error={errors.name}>
              <Input id="ag-name" value={form.name} onChange={text('name')} aria-invalid={!!errors.name} maxLength={100} />
            </Field>
            <Field label="Type" htmlFor="ag-type" error={errors.type}>
              <Select id="ag-type" value={form.type} onChange={text('type')}>
                <option value="">Not set</option>
                {AGENCY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {agencyTypeLabel[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="About" htmlFor="ag-description" error={errors.description} hint="Shown to clients on their invitation.">
            <Textarea id="ag-description" value={form.description} onChange={text('description')} maxLength={1000} />
          </Field>
          <Field label="Services" htmlFor="ag-services" error={errors.services}>
            <TagsInput id="ag-services" value={form.services} onChange={(v) => set('services', v)} placeholder="Add a service" disabled={!editable} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person" htmlFor="ag-contact" error={errors.contactName}>
              <Input id="ag-contact" value={form.contactName} onChange={text('contactName')} maxLength={100} />
            </Field>
            <Field label="Email" htmlFor="ag-email" error={errors.email}>
              <Input id="ag-email" type="email" value={form.email} onChange={text('email')} aria-invalid={!!errors.email} />
            </Field>
            <Field label="Phone" htmlFor="ag-phone" error={errors.phone}>
              <Input id="ag-phone" type="tel" value={form.phone} onChange={text('phone')} maxLength={30} />
            </Field>
            <Field label="Website" htmlFor="ag-website" error={errors.website}>
              <Input id="ag-website" value={form.website} onChange={text('website')} maxLength={200} placeholder="example.com" />
            </Field>
            <Field label="Country" htmlFor="ag-country" error={errors.country}>
              <Input id="ag-country" value={form.country} onChange={text('country')} maxLength={60} />
            </Field>
            <Field label="Team size" htmlFor="ag-team" error={errors.teamSize}>
              <Select id="ag-team" value={form.teamSize} onChange={text('teamSize')}>
                <option value="">Not set</option>
                {TEAM_SIZES.map((t) => (
                  <option key={t} value={t}>
                    {t} people
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Timezone" htmlFor="ag-tz" error={errors.timezone} hint="The default for new clients.">
            <Select id="ag-tz" value={form.timezone} onChange={text('timezone')}>
              {!TIMEZONES.includes(form.timezone) && <option value={form.timezone}>{timezoneLabel(form.timezone)}</option>}
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {timezoneLabel(tz)}
                </option>
              ))}
            </Select>
          </Field>
          {errors.logo && <p className="text-[13px] text-negative">{errors.logo}</p>}
        </fieldset>
      </Card>

      <Card title="Defaults for new clients" description="Copied into each new client’s contract. Changing them doesn’t affect existing clients.">
        <div className="divide-y divide-border">
          <Row title="Revisions included per post" htmlFor="ag-revisions" description="Rounds of client changes in the contract. Going over is flagged, never blocked.">
            <Input
              id="ag-revisions"
              type="number"
              min={0}
              max={50}
              disabled={!editable}
              className="w-24"
              value={d.revisionsIncluded}
              onChange={(e) => set('clientDefaults', { ...d, revisionsIncluded: Number(e.target.value) })}
            />
          </Row>
          <Row title="Approval lead time (hours)" htmlFor="ag-lead" description="How long before the publish time the client must approve.">
            <Input
              id="ag-lead"
              type="number"
              min={0}
              max={720}
              disabled={!editable}
              className="w-24"
              value={d.approvalLeadHours}
              onChange={(e) => set('clientDefaults', { ...d, approvalLeadHours: Number(e.target.value) })}
            />
          </Row>
          <Row title="Internal review" description="A manager approves work before the client sees it.">
            <Switch label="Internal review" disabled={!editable} checked={d.internalReview} onChange={(on) => set('clientDefaults', { ...d, internalReview: on })} />
          </Row>
        </div>
        {errors.clientDefaults && <p className="px-5 pb-4 text-[13px] text-negative">{errors.clientDefaults}</p>}
      </Card>

      {save.isError && Object.keys(errors).length === 0 && <FormError error={save.error} onReload={reload} />}
      {editable && dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-end gap-2 rounded-xl border border-border-strong bg-white px-4 py-3 shadow-lg">
          <span className="mr-auto text-[13px] text-text-2">You have unsaved changes</span>
          <Button size="sm" onClick={discard}>
            Discard
          </Button>
          <Button size="sm" variant="primary" type="submit" loading={save.isPending}>
            Save changes
          </Button>
        </div>
      )}
    </form>
  )
}

function NotificationSettings() {
  const qc = useQueryClient()
  const key = ['agency', 'notifications', 'preferences']
  const prefs = useQuery({ queryKey: key, queryFn: workspaceApi.preferences })
  const update = useMutation({
    mutationFn: (item: NotificationPref) => workspaceApi.updatePreferences([item]),
    onSuccess: (data) => qc.setQueryData(key, data),
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  return (
    <Card title="Your notifications" description="In-app notifications always arrive. Choose what else reaches you by email. Urgent ones are sent at once, the rest in a digest.">
      {prefs.isPending ? (
        <div className="h-40" />
      ) : prefs.isError ? (
        <EmptyState title="Couldn’t load your preferences">{errorMessage(prefs.error)}</EmptyState>
      ) : (
        <div className="divide-y divide-border">
          {prefs.data.items.map((p) => (
            <Row key={p.category} title={notificationCategoryLabel[p.category].label} description={p.mandatory ? `${notificationCategoryLabel[p.category].hint}. Always on.` : notificationCategoryLabel[p.category].hint}>
              <Switch label={`Email me about ${notificationCategoryLabel[p.category].label.toLowerCase()}`} checked={p.email} disabled={p.mandatory || update.isPending} onChange={(email) => update.mutate({ ...p, email })} />
            </Row>
          ))}
        </div>
      )}
    </Card>
  )
}
