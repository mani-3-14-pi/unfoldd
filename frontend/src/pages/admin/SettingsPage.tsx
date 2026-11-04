import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Field, Input, Select } from '@/components/ui/Field'
import { Switch } from '@/components/ui/Switch'
import { adminApi, type Settings } from '@/features/admin/api'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'

const SESSION_LENGTHS = [15, 30, 60, 120, 240, 480]

export function SettingsPage() {
  const query = useQuery({ queryKey: ['admin', 'settings'], queryFn: adminApi.settings })
  return (
    <>
      <PageHeader title="Settings" description="Platform-wide settings and your admin account." />
      <div className="flex max-w-3xl flex-col gap-6">
        {query.isPending ? null : query.isError ? (
          <EmptyState title="Couldn’t load settings">{errorMessage(query.error)}</EmptyState>
        ) : (
          <PlatformSettings key={query.data.settings.updatedAt} initial={query.data.settings} />
        )}
        <ChangePassword />
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

function PlatformSettings({ initial }: { initial: Settings }) {
  const qc = useQueryClient()
  const [enabled, setEnabled] = useState(initial.signups.enabled)
  const [autoApprove, setAutoApprove] = useState(initial.signups.autoApprove)
  const [minutes, setMinutes] = useState(initial.supportSessionMinutes)
  const dirty =
    enabled !== initial.signups.enabled || autoApprove !== initial.signups.autoApprove || minutes !== initial.supportSessionMinutes

  const save = useMutation({
    mutationFn: () => adminApi.updateSettings({ signups: { enabled, autoApprove }, supportSessionMinutes: minutes }),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'settings'], data)
      void qc.invalidateQueries({ queryKey: ['admin', 'overview'] })
      toast('Settings saved')
    },
  })
  const reset = () => {
    setEnabled(initial.signups.enabled)
    setAutoApprove(initial.signups.autoApprove)
    setMinutes(initial.supportSessionMinutes)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
      className="flex flex-col gap-6"
    >
      <Card title="Agency signups" description={initial.updatedAt && `Last changed ${formatDateTime(initial.updatedAt)}`}>
        <div className="divide-y divide-border">
          <Row title="Accept new signups" description="When off, the public signup page tells agencies that signups are closed.">
            <Switch label="Accept new signups" checked={enabled} onChange={setEnabled} />
          </Row>
          <Row
            title="Auto-approve new agencies"
            description="When on, agencies can log in as soon as they sign up. When off, each signup waits in Approvals for a platform admin."
          >
            <Switch label="Auto-approve new agencies" checked={autoApprove} onChange={setAutoApprove} disabled={!enabled} />
          </Row>
        </div>
      </Card>

      <Card title="Support access">
        <Row
          title="Support session length"
          htmlFor="support-minutes"
          description="How long “Open admin portal” keeps you signed in to an agency’s portal before it ends on its own."
        >
          <Select id="support-minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-36">
            {SESSION_LENGTHS.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}
              </option>
            ))}
          </Select>
        </Row>
      </Card>

      {save.isError && <p className="text-[13px] text-negative">{errorMessage(save.error)}</p>}
      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-end gap-2 rounded-xl border border-border-strong bg-white px-4 py-3 shadow-lg">
          <span className="mr-auto text-[13px] text-text-2">You have unsaved changes</span>
          <Button size="sm" onClick={reset}>
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

function ChangePassword() {
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)

  const change = useMutation({
    mutationFn: () => adminApi.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrent('')
      setNew('')
      setConfirm('')
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
    <Card title="Your password" description="Changing it signs you out everywhere else.">
      <form onSubmit={submit} className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        <Field label="Current password" htmlFor="pw-current" error={errors.currentPassword}>
          <Input id="pw-current" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!errors.currentPassword} required />
        </Field>
        <Field label="New password" htmlFor="pw-new" error={errors.newPassword} hint="At least 10 characters">
          <Input id="pw-new" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} aria-invalid={!!errors.newPassword} required minLength={10} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={mismatch ? 'Passwords don’t match' : undefined}>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} required />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" variant="primary" loading={change.isPending}>
            Change password
          </Button>
          {change.isError && Object.keys(errors).length === 0 && <span className="text-[13px] text-negative">{errorMessage(change.error)}</span>}
        </div>
      </form>
    </Card>
  )
}
