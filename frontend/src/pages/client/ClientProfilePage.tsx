import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Details } from '@/components/ui/Details'
import { Field, Input, Select } from '@/components/ui/Field'
import { Switch } from '@/components/ui/Switch'
import { accountApi, describeAgent, type Profile } from '@/features/account/api'
import { sessionKey } from '@/features/agency/api'
import { clientRoleLabel } from '@/features/agency/roles'
import { ClientPageHeader } from '@/features/client-app/ClientPageHeader'
import { peopleApi } from '@/features/client-app/people/api'
import { notificationCategoryLabel, workspaceApi, type NotificationPref } from '@/features/workspace/api'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { TIMEZONES, timezoneLabel } from '@/lib/timezones'
import { toast } from '@/lib/toast'

const profileKey = ['client', 'account', 'profile'] as const
const devicesKey = ['client', 'account', 'sessions'] as const
const prefsKey = ['client', 'notifications', 'preferences'] as const

/** F70 profile, F72 notification preferences, F73 settings, and the person's signed-in devices. */
export function ClientProfilePage() {
  const profile = useQuery({ queryKey: profileKey, queryFn: accountApi.profile })
  return (
    <>
      <ClientPageHeader title="Profile" back={{ to: '/c/more', label: 'More' }} />
      <div className="flex flex-col gap-6">
        {profile.isPending ? (
          <Card title="You">
            <div className="h-32" />
          </Card>
        ) : profile.isError ? (
          <EmptyState title="Couldn’t load your profile">{errorMessage(profile.error)}</EmptyState>
        ) : (
          <ProfileForm key={profile.data.profile.name + (profile.data.profile.timezone ?? '')} profile={profile.data.profile} />
        )}
        <PasswordForm />
        <NotificationPrefs />
        <Devices />
        <SpaceSettings />
      </div>
    </>
  )
}

function ProfileForm({ profile: p }: { profile: Profile }) {
  const qc = useQueryClient()
  const [name, setName] = useState(p.name)
  const [timezone, setTimezone] = useState(p.timezone ?? '')
  const save = useMutation({
    mutationFn: () => accountApi.updateProfile({ name: name.trim(), timezone }),
    onSuccess: (data) => {
      qc.setQueryData(profileKey, data)
      // The name also shows in the shell and the greeting.
      void qc.invalidateQueries({ queryKey: sessionKey })
      void qc.invalidateQueries({ queryKey: ['client', 'home'] })
      toast('Profile saved')
    },
  })
  const errors = fieldErrors(save.error)
  const dirty = name.trim() !== p.name || timezone !== (p.timezone ?? '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Card title="You">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-4 py-4">
        <Field label="Name" htmlFor="cp-name" error={errors.name}>
          <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" aria-invalid={!!errors.name} />
        </Field>
        <Field label="Email" htmlFor="cp-email" hint="To change it, ask your agency.">
          <Input id="cp-email" value={p.email} disabled />
        </Field>
        <Field label="Your timezone" htmlFor="cp-tz" error={errors.timezone} hint="Times are shown in your brand’s timezone, with yours alongside when it’s different.">
          <Select id="cp-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="">Use this device’s</option>
            {timezone && !TIMEZONES.includes(timezone) && <option value={timezone}>{timezoneLabel(timezone)}</option>}
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {timezoneLabel(tz)}
              </option>
            ))}
          </Select>
        </Field>
        {save.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(save.error)}</p>}
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty || name.trim().length < 2} className="self-start">
          Save
        </Button>
      </form>
    </Card>
  )
}

function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const change = useMutation({
    mutationFn: () => accountApi.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      toast('Password changed. Your other devices were signed out.')
    },
  })
  const errors = fieldErrors(change.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setMismatch(next !== confirm)
    if (next === confirm) change.mutate()
  }

  return (
    <Card title="Password" description="Changing it signs you out on your other devices.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-4 py-4">
        <Field label="Current password" htmlFor="cp-pw-current" error={errors.currentPassword}>
          <Input id="cp-pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!errors.currentPassword} />
        </Field>
        <Field label="New password" htmlFor="cp-pw-new" error={errors.newPassword} hint="At least 8 characters">
          <Input id="cp-pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={!!errors.newPassword} />
        </Field>
        <Field label="Confirm new password" htmlFor="cp-pw-confirm" error={mismatch ? 'Passwords don’t match' : undefined}>
          <Input id="cp-pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
        </Field>
        {change.isError && Object.keys(errors).length === 0 && <p className="text-[13px] text-negative">{errorMessage(change.error)}</p>}
        <Button type="submit" variant="primary" loading={change.isPending} disabled={!current || !next} className="self-start">
          Change password
        </Button>
      </form>
    </Card>
  )
}

/** F72 / D68: per category, by email and push. Invitations and security can't be switched off. */
function NotificationPrefs() {
  const qc = useQueryClient()
  const prefs = useQuery({ queryKey: prefsKey, queryFn: workspaceApi.preferences })
  const update = useMutation({
    mutationFn: (item: NotificationPref) => workspaceApi.updatePreferences([item]),
    onSuccess: (data) => qc.setQueryData(prefsKey, data),
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  return (
    <section id="notifications" className="scroll-mt-20">
      <Card title="Notifications" description="You always see them here in the app. Choose what also reaches you by email or on your phone.">
        {prefs.isPending ? (
          <div className="h-40" />
        ) : prefs.isError ? (
          <EmptyState title="Couldn’t load your preferences">{errorMessage(prefs.error)}</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            <li className="flex justify-end gap-6 px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-text-3 uppercase">
              <span className="w-10 text-center">Email</span>
              <span className="w-10 text-center">Push</span>
            </li>
            {prefs.data.items.map((p) => {
              const { label, hint } = notificationCategoryLabel[p.category]
              return (
                <li key={p.category} className="flex items-center gap-4 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">{label}</span>
                    <span className="block text-xs text-text-3">{p.mandatory ? `${hint}. Always on.` : hint}</span>
                  </span>
                  <span className="grid w-10 place-items-center">
                    <Switch label={`Email: ${label}`} checked={p.email} disabled={p.mandatory || update.isPending} onChange={(email) => update.mutate({ ...p, email })} />
                  </span>
                  <span className="grid w-10 place-items-center">
                    <Switch label={`Push: ${label}`} checked={p.push} disabled={p.mandatory || update.isPending} onChange={(push) => update.mutate({ ...p, push })} />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </section>
  )
}

function Devices() {
  const qc = useQueryClient()
  const devices = useQuery({ queryKey: devicesKey, queryFn: accountApi.sessions })
  const refresh = () => void qc.invalidateQueries({ queryKey: devicesKey })
  const onError = (err: unknown) => toast(errorMessage(err), 'error')
  const end = useMutation({ mutationFn: accountApi.endSession, onSuccess: refresh, onError })
  const endOthers = useMutation({
    mutationFn: accountApi.endOthers,
    onSuccess: ({ revoked }) => {
      toast(revoked ? `Signed out on ${revoked} other device${revoked === 1 ? '' : 's'}` : 'No other devices were signed in')
      refresh()
    },
    onError,
  })
  const others = devices.data?.items.filter((d) => !d.current).length ?? 0

  return (
    <Card
      title="Signed-in devices"
      action={
        others > 0 && (
          <Button size="sm" onClick={() => endOthers.mutate()} loading={endOthers.isPending}>
            Sign out others
          </Button>
        )
      }
    >
      {devices.isPending ? (
        <div className="h-24" />
      ) : devices.isError ? (
        <EmptyState title="Couldn’t load your devices">{errorMessage(devices.error)}</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {devices.data.items.map((d) => (
            <li key={d._id} className="flex min-h-14 items-center gap-3 px-4 py-3">
              <Monitor size={18} className="shrink-0 text-text-3" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">
                  {describeAgent(d.userAgent)}
                  {d.current && <span className="ml-1.5 text-xs font-medium text-positive">this device</span>}
                </span>
                <span className="block text-xs text-text-3">Signed in {timeAgo(d.createdAt)}</span>
              </span>
              {!d.current && (
                <Button size="sm" variant="ghost" aria-label="Sign out this device" onClick={() => end.mutate(d._id)} disabled={end.isPending}>
                  <LogOut size={15} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** F73: the space as the client sees it. The contract stays with the agency. */
function SpaceSettings() {
  const settings = useQuery({ queryKey: ['client', 'settings'], queryFn: peopleApi.settings })
  if (!settings.isSuccess) return null
  const { settings: s, role } = settings.data
  return (
    <Card title="This space" description="Set by your agency. Ask them if something needs to change.">
      <Details
        rows={[
          { label: 'Brand', value: s.brandName },
          { label: 'Company', value: s.name },
          { label: 'Timezone', value: timezoneLabel(s.timezone) },
          { label: 'Your role', value: clientRoleLabel[role] },
        ]}
      />
    </Card>
  )
}
