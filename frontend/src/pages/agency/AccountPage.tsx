import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, Monitor } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Field, Input, Select } from '@/components/ui/Field'
import { sessionKey } from '@/features/agency/api'
import { accountApi, describeAgent, devicesKey, profileKey, type Profile } from '@/features/account/api'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { formatDateTime, timeAgo } from '@/lib/format'
import { TIMEZONES, timezoneLabel } from '@/lib/timezones'
import { toast } from '@/lib/toast'

/** P156: your own name, timezone and password, and the browsers you're signed in on. */
export function AccountPage() {
  const profile = useQuery({ queryKey: profileKey, queryFn: accountApi.profile })
  return (
    <>
      <PageHeader title="Your account" description="Your own details. They follow you into every agency and client space you belong to." />
      <div className="flex max-w-3xl flex-col gap-6">
        {profile.isPending ? (
          <Card title="Profile">
            <div className="h-32" />
          </Card>
        ) : profile.isError ? (
          <EmptyState title="Couldn’t load your profile">{errorMessage(profile.error)}</EmptyState>
        ) : (
          <ProfileCard key={`${profile.data.profile.name}|${profile.data.profile.timezone ?? ''}`} initial={profile.data.profile} />
        )}
        <PasswordCard />
        <DevicesCard />
      </div>
    </>
  )
}

function ProfileCard({ initial }: { initial: Profile }) {
  const qc = useQueryClient()
  const [name, setName] = useState(initial.name)
  const [timezone, setTimezone] = useState(initial.timezone ?? '')
  const dirty = name.trim() !== initial.name || timezone !== (initial.timezone ?? '')
  const save = useMutation({
    mutationFn: () => accountApi.updateProfile({ name: name.trim(), timezone }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileKey })
      // The name also shows in the sidebar.
      void qc.invalidateQueries({ queryKey: sessionKey })
      toast('Profile saved')
    },
  })
  const errors = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <Card title="Profile" description={initial.lastLoginAt ? `Last signed in ${formatDateTime(initial.lastLoginAt)}` : undefined}>
      <form onSubmit={submit} className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="me-name" error={errors.name}>
          <Input id="me-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-invalid={!!errors.name} />
        </Field>
        <Field label="Email" htmlFor="me-email" hint="To change it, ask an admin or Unfoldd support.">
          <Input id="me-email" value={initial.email} disabled />
        </Field>
        <Field label="Your timezone" htmlFor="me-tz" hint="Times are shown in it. Publish times always use the client’s timezone." error={errors.timezone} className="sm:col-span-2">
          <Select id="me-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="">Use this browser’s timezone</option>
            {timezone && !TIMEZONES.includes(timezone) && <option value={timezone}>{timezoneLabel(timezone)}</option>}
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {timezoneLabel(tz)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty || name.trim().length < 2}>
            Save
          </Button>
          {save.isError && Object.keys(errors).length === 0 && <span className="text-[13px] text-negative">{errorMessage(save.error)}</span>}
        </div>
      </form>
    </Card>
  )
}

function PasswordCard() {
  const qc = useQueryClient()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const change = useMutation({
    mutationFn: () => accountApi.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrent('')
      setNew('')
      setConfirm('')
      void qc.invalidateQueries({ queryKey: devicesKey })
      toast('Password changed. Your other browsers were signed out.')
    },
  })
  const errors = fieldErrors(change.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setMismatch(newPassword !== confirm)
    if (newPassword === confirm) change.mutate()
  }
  return (
    <Card title="Password" description="Changing it signs you out on every other browser and emails you a notice.">
      <form onSubmit={submit} className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        <Field label="Current password" htmlFor="pw-current" error={errors.currentPassword}>
          <Input id="pw-current" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!errors.currentPassword} required />
        </Field>
        <Field label="New password" htmlFor="pw-new" error={errors.newPassword} hint="At least 8 characters">
          <Input id="pw-new" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} aria-invalid={!!errors.newPassword} required minLength={8} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={mismatch ? 'Passwords don’t match' : undefined}>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} required />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" variant="primary" loading={change.isPending} disabled={!currentPassword || !newPassword}>
            Change password
          </Button>
          {change.isError && Object.keys(errors).length === 0 && <span className="text-[13px] text-negative">{errorMessage(change.error)}</span>}
        </div>
      </form>
    </Card>
  )
}

function DevicesCard() {
  const qc = useQueryClient()
  const devices = useQuery({ queryKey: devicesKey, queryFn: accountApi.sessions })
  const refresh = () => void qc.invalidateQueries({ queryKey: devicesKey })
  const end = useMutation({
    mutationFn: (id: string) => accountApi.endSession(id),
    onSuccess: () => {
      toast('Signed out of that browser')
      refresh()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const endOthers = useMutation({
    mutationFn: accountApi.endOthers,
    onSuccess: ({ revoked }) => {
      toast(revoked ? `Signed out of ${revoked} other browser${revoked === 1 ? '' : 's'}` : 'No other browsers were signed in')
      refresh()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const others = devices.data?.items.filter((d) => !d.current).length ?? 0

  return (
    <Card
      title="Where you’re signed in"
      description="Sign out of a browser you don’t recognise, or one you no longer use."
      action={
        others > 0 && (
          <Button size="sm" onClick={() => endOthers.mutate()} loading={endOthers.isPending}>
            <LogOut size={14} /> Sign out everywhere else
          </Button>
        )
      }
    >
      {devices.isPending ? (
        <div className="h-24" />
      ) : devices.isError ? (
        <EmptyState title="Couldn’t load your sessions">{errorMessage(devices.error)}</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {devices.data.items.map((d) => (
            <li key={d._id} className="flex items-center gap-3 px-5 py-3">
              <Monitor size={18} className="shrink-0 text-text-3" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">
                  {describeAgent(d.userAgent)}
                  {d.current && <span className="ml-2 text-xs font-normal text-positive">This browser</span>}
                </div>
                <div className="text-xs text-text-3">
                  Signed in {timeAgo(d.createdAt)}
                  {d.ip && ` · ${d.ip}`}
                </div>
              </div>
              {!d.current && (
                <Button size="sm" variant="ghost" loading={end.isPending && end.variables === d._id} onClick={() => end.mutate(d._id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
