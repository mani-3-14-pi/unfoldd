import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, LoaderCircle } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { AuthAlert, AuthField } from '@/components/AuthField'
import { isMfa, sessionApi, type SignupInput } from '@/features/agency/api'
import { MfaStep } from '@/features/agency/MfaStep'
import { AuthLayout } from '@/layouts/AuthLayout'
import { authInputClass, authSubmitClass } from '@/layouts/authStyles'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { agencyHighlights } from '@/features/agency/highlights'

const TEAM_SIZES = ['1-5', '6-15', '16-50', '51-200', '200+']

export function AgencySignupPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const config = useQuery({ queryKey: ['session', 'signup-config'], queryFn: sessionApi.signupConfig })
  const [form, setForm] = useState<SignupInput>({ name: '', email: '', password: '', agencyName: '', country: '', teamSize: '' })
  const set = (key: keyof SignupInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const signup = useMutation({
    mutationFn: sessionApi.signup,
    onSuccess: (data) => {
      // Auto-approved without 2FA: the session is already open.
      if (data.status === 'active' && !isMfa(data)) {
        qc.clear()
        navigate('/app', { replace: true })
      }
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    signup.mutate(form)
  }
  const errors = fieldErrors(signup.error)

  const layout = (children: React.ReactNode) => (
    <AuthLayout
      eyebrow="Get started"
      title={
        <>
          Bring your agency
          <br />
          to Unfoldd.
        </>
      }
      description="Set up your agency workspace in a minute, then invite your team and your clients."
      highlights={agencyHighlights}
      footer="© Unfoldd"
    >
      {children}
    </AuthLayout>
  )

  // Auto-approved: the new owner sets up 2FA before the first session (mandatory for owners).
  if (signup.data?.status === 'active' && isMfa(signup.data)) {
    return layout(
      <MfaStep
        challenge={signup.data}
        onDone={() => {
          qc.clear()
          navigate('/app', { replace: true })
        }}
        onRestart={() => navigate('/login', { replace: true })}
      />,
    )
  }

  if (signup.data?.status === 'pending') {
    return layout(
      <div className="flex flex-col items-start">
        <span className="grid size-14 place-items-center rounded-2xl bg-amber-soft text-amber-ink">
          <Clock size={28} />
        </span>
        <h1 className="mt-6 text-[32px] leading-tight font-bold tracking-tight text-[#0f2f24]">Thanks, we’ve got it</h1>
        <p className="mt-2 text-base text-[#6b6f76]">
          <strong className="font-semibold text-[#111a16]">{form.agencyName}</strong> is waiting for approval from the Unfoldd team. You’ll be
          able to log in with <strong className="font-semibold text-[#111a16]">{form.email}</strong> as soon as it’s approved.
        </p>
        <Link to="/login" className={`${authSubmitClass} mt-8`}>
          Back to log in
        </Link>
      </div>,
    )
  }

  if (config.data && !config.data.enabled) {
    return layout(
      <>
        <h1 className="text-[32px] leading-tight font-bold tracking-tight text-[#0f2f24]">Signups are closed</h1>
        <p className="mt-2 text-base text-[#6b6f76]">We’re not accepting new agencies right now. Please check back soon.</p>
        <Link to="/login" className={`${authSubmitClass} mt-8`}>
          Back to log in
        </Link>
      </>,
    )
  }

  return layout(
    <>
      <h1 className="text-[34px] leading-tight font-bold tracking-tight text-[#0f2f24]">Create your agency</h1>
      <p className="mt-1.5 text-base text-[#6b6f76]">You’ll be the owner of the workspace</p>

      <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-4">
        {signup.isError && Object.keys(errors).length === 0 && <AuthAlert>{errorMessage(signup.error)}</AuthAlert>}
        <AuthField id="su-name" label="Full name" autoComplete="name" placeholder="Enter your full name" value={form.name} onChange={set('name')} error={errors.name} autoFocus />
        <AuthField id="su-email" label="Work email" type="email" autoComplete="email" placeholder="Enter your work email" value={form.email} onChange={set('email')} error={errors.email} />
        <AuthField id="su-agency" label="Agency name" autoComplete="organization" placeholder="Enter your agency name" value={form.agencyName} onChange={set('agencyName')} error={errors.agencyName} />
        <div className="grid grid-cols-2 gap-3">
          <AuthField id="su-country" label="Country" autoComplete="country-name" placeholder="e.g. India" value={form.country} onChange={set('country')} error={errors.country} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="su-team" className="text-sm font-semibold">
              Team size
            </label>
            <select id="su-team" value={form.teamSize} onChange={set('teamSize')} className={authInputClass}>
              <option value="">Select…</option>
              {TEAM_SIZES.map((t) => (
                <option key={t} value={t}>
                  {t} people
                </option>
              ))}
            </select>
          </div>
        </div>
        <AuthField
          id="su-password"
          label="Password"
          password
          autoComplete="new-password"
          placeholder="Create a password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint="At least 8 characters"
        />
        <button type="submit" className={authSubmitClass} disabled={signup.isPending}>
          {signup.isPending ? (
            <>
              <LoaderCircle className="animate-spin" size={20} /> Creating…
            </>
          ) : (
            'Create agency'
          )}
        </button>
      </form>
      <p className="mt-7 text-center text-sm text-[#6b6f76]">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-[#0d5c37] hover:underline">
          Log in
        </Link>
      </p>
    </>,
  )
}
