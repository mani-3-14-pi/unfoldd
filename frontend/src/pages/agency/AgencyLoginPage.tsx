import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AuthAlert, AuthField } from '@/components/AuthField'
import { homeFor, isMfa, sessionApi, type MfaChallenge, type SignedIn } from '@/features/agency/api'
import { agencyHighlights } from '@/features/agency/highlights'
import { MfaStep } from '@/features/agency/MfaStep'
import { ApiError } from '@/lib/api'
import { AuthLayout } from '@/layouts/AuthLayout'
import { authSubmitClass } from '@/layouts/authStyles'
import { errorMessage, fieldErrors } from '@/lib/errors'

/** Only same-app paths, so `?next=` can't send anyone to another site. */
const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : null)

export function AgencyLoginPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null)

  const finish = (result: SignedIn) => {
    qc.clear()
    const next = safeNext(params.get('next'))
    // `next` belongs to the app it was saved in: /app for the agency portal, /c for the client app.
    const prefix = result.context === 'agency' ? '/app' : '/c'
    navigate(next?.startsWith(prefix) ? next : homeFor(result.context), { replace: true })
  }

  const login = useMutation({
    mutationFn: sessionApi.login,
    onSuccess: (result) => (isMfa(result) ? setChallenge(result) : finish(result)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ email: email.trim(), password })
  }

  const errors = fieldErrors(login.error)
  const err = login.error instanceof ApiError ? login.error : null
  const blocked = err && ['agency_pending', 'agency_rejected', 'agency_suspended'].includes(err.code)
  const reason = (err?.details as { reason?: string } | undefined)?.reason

  return (
    <AuthLayout
      eyebrow="Agency portal"
      title={
        <>
          Where agency work
          <br />
          unfolds.
        </>
      }
      description="Plan, produce and get client approval on content, all in one place."
      highlights={agencyHighlights}
      footer="© Unfoldd"
    >
      {challenge ? (
        <MfaStep
          challenge={challenge}
          onDone={finish}
          onRestart={() => {
            setChallenge(null)
            setPassword('')
            login.reset()
          }}
        />
      ) : (
        <>
          <h1 className="text-[34px] leading-tight font-bold tracking-tight text-[#0f2f24]">Log in to Unfoldd</h1>
          <p className="mt-1.5 text-base text-[#6b6f76]">Access your agency workspace</p>

          <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
            {login.isError && Object.keys(errors).length === 0 && (
              <AuthAlert tone={err?.code === 'agency_pending' ? 'info' : 'error'}>
                {errorMessage(login.error)}
                {reason && <div className="mt-1">Reason: {reason}</div>}
              </AuthAlert>
            )}
            <AuthField
              id="login-email"
              label="Work email"
              type="email"
              autoComplete="email"
              placeholder="Enter your work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              autoFocus
            />
            <AuthField
              id="login-password"
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
          {!blocked && (
            <p className="mt-8 text-center text-sm text-[#6b6f76]">
              New to Unfoldd?{' '}
              <Link to="/signup" className="font-semibold text-[#0d5c37] hover:underline">
                Create an agency account
              </Link>
            </p>
          )}
        </>
      )}
    </AuthLayout>
  )
}
