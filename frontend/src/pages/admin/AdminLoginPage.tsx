import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, LoaderCircle, ScrollText, ShieldCheck } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { AuthAlert, AuthField } from '@/components/AuthField'
import { adminApi, adminMeKey, type Admin } from '@/features/admin/api'
import type { MfaChallenge } from '@/features/agency/api'
import { MfaStep } from '@/features/agency/MfaStep'
import { AuthLayout } from '@/layouts/AuthLayout'
import { authSubmitClass } from '@/layouts/authStyles'
import { errorMessage, fieldErrors } from '@/lib/errors'

export function AdminLoginPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [missing, setMissing] = useState<Record<string, string>>({})

  const [challenge, setChallenge] = useState<MfaChallenge | null>(null)

  // With 2FA on, the password step only opens a challenge and the session comes from verifying it.
  const login = useMutation({ mutationFn: adminApi.login, onSuccess: (r) => ('admin' in r ? finish(r) : setChallenge(r)) })
  const finish = (data: { admin: Admin }) => {
    qc.setQueryData(adminMeKey, { admin: data.admin })
    const next = params.get('next')
    // Only same-app admin paths, never an absolute URL.
    navigate(next?.startsWith('/admin') && !next.startsWith('//') ? next : '/admin', { replace: true })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!username.trim()) errs.username = 'Enter your username'
    if (!password) errs.password = 'Enter your password'
    setMissing(errs)
    if (Object.keys(errs).length === 0) login.mutate({ username: username.trim(), password })
  }

  const errors = { ...fieldErrors(login.error), ...missing }
  const formError = login.isError && Object.keys(fieldErrors(login.error)).length === 0 ? errorMessage(login.error) : null

  return (
    <AuthLayout
      eyebrow="Platform admin"
      title={
        <>
            Every agency,
            <br />
            one control room.
        </>
      }
      description="Approve new agencies, support their teams and keep an eye on everything happening across Unfoldd."
      highlights={[
        { label: 'Approve and\nmanage agencies', icon: Building2 },
        { label: 'Support view\ninto any portal', icon: ShieldCheck },
        { label: 'Full activity\naudit trail', icon: ScrollText },
      ]}
      footer="Unfoldd staff only. Every sign-in is logged."
    >
      {challenge ? (
        <MfaStep
          challenge={challenge}
          mfaApi={{ setup: adminApi.mfaSetup, verify: adminApi.mfaVerify }}
          onDone={finish}
          onRestart={() => {
            setChallenge(null)
            setPassword('')
            login.reset()
          }}
        />
      ) : (
      <>
        <h1 className="text-[34px] leading-tight font-bold tracking-tight text-[#0f2f24]">Platform admin</h1>
        <p className="mt-1.5 text-base text-[#6b6f76]">Log in with your Unfoldd admin account</p>

        <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
          {formError && <AuthAlert>{formError}</AuthAlert>}
          <AuthField
            id="admin-username"
            label="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={errors.username}
            autoFocus
          />
          <AuthField
            id="admin-password"
            label="Password"
            password
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <button type="submit" className={authSubmitClass} disabled={login.isPending}>
            {login.isPending ? (
              <>
                <LoaderCircle className="animate-spin" size={20} /> Logging in…
            </>
          ) : (
            'Log in'
          )}
        </button>
      </form>
      </>
      )}
    </AuthLayout>
  )
}
