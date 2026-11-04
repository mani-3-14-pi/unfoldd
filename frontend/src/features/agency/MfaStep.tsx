import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Copy, LoaderCircle, ShieldCheck } from 'lucide-react'
import { renderSVG } from 'uqr'
import { AuthAlert, AuthField } from '@/components/AuthField'
import { authSubmitClass } from '@/layouts/authStyles'
import { ApiError } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { sessionApi, type MfaChallenge, type SignedIn } from './api'

/** The two 2FA calls; agency people and platform admins each have their own (`/auth/2fa/*`, `/admin/auth/2fa/*`). */
export interface MfaApi<R> {
  setup: (challenge: string) => Promise<{ secret: string; otpauthUrl: string }>
  verify: (body: { challenge: string; code?: string; backupCode?: string }) => Promise<R & { backupCodes?: string[] }>
}

const agencyMfa: MfaApi<SignedIn> = { setup: sessionApi.mfaSetup, verify: sessionApi.mfaVerify }

/**
 * The mandatory second sign-in step for agency owners and platform admins. `setup` shows a QR code for an
 * authenticator app and, once confirmed, the one-time backup codes; `verify` asks for the current code or a backup code.
 */
export function MfaStep<R = SignedIn>({
  challenge,
  onDone,
  onRestart,
  mfaApi = agencyMfa as unknown as MfaApi<R>,
}: {
  challenge: MfaChallenge
  onDone: (result: R) => void
  onRestart: () => void
  mfaApi?: MfaApi<R>
}) {
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [backupCodes, setBackupCodes] = useState<{ codes: string[]; result: R } | null>(null)
  const setup = challenge.mfa === 'setup'

  const secret = useQuery({
    queryKey: ['mfa-setup', challenge.challenge],
    queryFn: () => mfaApi.setup(challenge.challenge),
    enabled: setup,
    retry: false,
    staleTime: Infinity,
  })

  const verify = useMutation({
    mutationFn: () =>
      mfaApi.verify({ challenge: challenge.challenge, ...(useBackup ? { backupCode: code.trim() } : { code: code.replace(/\s/g, '') }) }),
    onSuccess: ({ backupCodes: codes, ...result }) => {
      if (codes?.length) setBackupCodes({ codes, result: result as R })
      else onDone(result as R)
    },
  })
  const expired = [secret.error, verify.error].some((e) => e instanceof ApiError && e.code === 'mfa_challenge_expired')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (code.trim()) verify.mutate()
  }

  if (backupCodes) {
    return (
      <div>
        <Heading title="Save your backup codes" text="Each code works once, if you lose your phone. Keep them somewhere safe: they won’t be shown again." />
        <ul className="mt-6 grid grid-cols-2 gap-2 rounded-xl border border-[#e3e3e6] bg-[#f6f6f7] p-4 font-mono text-sm">
          {backupCodes.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(backupCodes.codes.join('\n')).then(() => toast('Backup codes copied'))
          }}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0d5c37] hover:underline"
        >
          <Copy size={15} /> Copy codes
        </button>
        <button type="button" className={`${authSubmitClass} mt-6`} onClick={() => onDone(backupCodes.result)}>
          I’ve saved them, continue
        </button>
      </div>
    )
  }

  if (expired) {
    return (
      <div>
        <Heading title="Your sign-in timed out" text="For your security, the second step has to be finished within a few minutes." />
        <button type="button" className={`${authSubmitClass} mt-6`} onClick={onRestart}>
          Start again
        </button>
      </div>
    )
  }

  return (
    <div>
      <Heading
        title={setup ? 'Set up two-factor sign-in' : 'Enter your sign-in code'}
        text={
          setup
            ? 'Your account signs in with a code from an authenticator app (Google Authenticator, 1Password, Authy…). Scan this code with it.'
            : useBackup
              ? 'Enter one of the backup codes you saved when you set up two-factor sign-in.'
              : 'Open your authenticator app and enter the 6-digit code for Unfoldd.'
        }
      />

      {setup && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-[#e3e3e6] p-5">
          {secret.isPending ? (
            <div className="grid size-44 place-items-center text-text-3">
              <LoaderCircle className="animate-spin" />
            </div>
          ) : secret.isError ? (
            <p className="text-sm text-negative">{errorMessage(secret.error)}</p>
          ) : (
            <>
              {/* The SVG is generated locally from the otpauth URL; nothing from it is interpreted as markup input. */}
              <div className="size-44 [&>svg]:size-full" aria-label="QR code for your authenticator app" role="img" dangerouslySetInnerHTML={{ __html: renderSVG(secret.data.otpauthUrl, { border: 1 }) }} />
              <p className="text-center text-xs text-[#6b6f76]">
                Can’t scan it? Enter this key instead:
                <br />
                <code className="mt-1 inline-block rounded bg-[#f6f6f7] px-2 py-1 text-[13px] break-all text-[#111a16]">{secret.data.secret}</code>
              </p>
            </>
          )}
        </div>
      )}

      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
        {verify.isError && <AuthAlert>{errorMessage(verify.error)}</AuthAlert>}
        <AuthField
          id="mfa-code"
          label={useBackup ? 'Backup code' : '6-digit code'}
          inputMode={useBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={useBackup ? 'xxxx-xxxx' : '123 456'}
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            if (verify.isError) verify.reset()
          }}
          autoFocus
          maxLength={useBackup ? 20 : 7}
        />
        <button type="submit" className={authSubmitClass} disabled={verify.isPending || !code.trim() || (setup && !secret.isSuccess)}>
          {verify.isPending ? <LoaderCircle className="animate-spin" size={20} /> : setup ? 'Turn on and continue' : 'Verify'}
        </button>
      </form>

      <div className="mt-6 flex justify-between text-sm">
        {!setup ? (
          <button
            type="button"
            onClick={() => {
              setUseBackup((v) => !v)
              setCode('')
              verify.reset()
            }}
            className="font-semibold text-[#0d5c37] hover:underline"
          >
            {useBackup ? 'Use a code from my app' : 'Use a backup code'}
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onRestart} className="text-[#6b6f76] hover:underline">
          Back
        </button>
      </div>
    </div>
  )
}

function Heading({ title, text }: { title: string; text: string }) {
  return (
    <>
      <span className="grid size-14 place-items-center rounded-2xl bg-green-soft text-green-ink">
        <ShieldCheck size={28} />
      </span>
      <h1 className="mt-6 text-[32px] leading-tight font-bold tracking-tight text-[#0f2f24]">{title}</h1>
      <p className="mt-1.5 text-base text-[#6b6f76]">{text}</p>
    </>
  )
}
