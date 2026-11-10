import { useEffect, useState } from 'react'
import { ApiError, invites, type InviteInfo } from './api.ts'
import { useDebouncedAction } from './useDebouncedAction.ts'

/** Pulls the token out of a pasted invite link, or takes a bare code as is. */
function tokenFrom(input: string) {
  const s = input.trim()
  const match = s.match(/\/invite\/([^/?#\s]+)/)
  return match ? match[1] : s
}

/**
 * Client registration. Access to a brand always starts with an invitation from the agency, so registering
 * means opening that invitation (from the email link, or by pasting the link or code here) and choosing a
 * name and password.
 */
export function RegisterPage({ token: initial, onDone, onLogin }: { token?: string; onDone: () => void; onLogin: () => void }) {
  const [token, setToken] = useState(initial ?? '')
  const [code, setCode] = useState('')
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(!!initial)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const debounce = useDebouncedAction()

  useEffect(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    invites
      .get(token)
      .then(setInfo)
      .catch((err) => {
        setInfo(null)
        setError(err instanceof ApiError ? err.message : 'Could not open this invitation.')
      })
      .finally(() => setLoading(false))
  }, [token])

  async function submit() {
    if (!info) return
    setError(null)
    if (!info.accountExists) {
      if (name.trim().length < 2) return setError('Enter your full name.')
      if (password.length < 8) return setError('Use at least 8 characters for your password.')
      if (password !== confirm) return setError('The two passwords do not match.')
    }
    setBusy(true)
    try {
      const result = await invites.accept(token, password, info.accountExists ? undefined : name.trim())
      if (result.mfa) {
        setError('Your account needs two-factor authentication. Please finish signing in through the main Unfoldd app.')
        return
      }
      window.history.replaceState(null, '', '/')
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const place = info?.client ? info.client.brandName || info.client.name : info?.agency?.name

  return (
    <div className="auth">
      <div className="auth-card">
        <h1 className="brand">Unfoldd</h1>

        {!token && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (code.trim()) setToken(tokenFrom(code))
            }}
          >
            <p className="sub">Create your client account</p>
            <p className="meta" style={{ marginBottom: 16 }}>
              Your agency sends you an invitation by email. Open the link in it, or paste the link or code here.
            </p>
            {error && <div className="error">{error}</div>}
            <div className="field">
              <label htmlFor="code">Invitation link or code</label>
              <input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="http://localhost:5176/invite/…" required />
            </div>
            <button className="btn block" type="submit">Continue</button>
          </form>
        )}

        {token && loading && <p className="empty">Opening your invitation…</p>}

        {token && !loading && !info && (
          <>
            <p className="sub">Create your client account</p>
            <div className="error">{error ?? 'This invitation link is not valid.'}</div>
            <button className="btn ghost block" onClick={() => { setToken(''); setError(null); window.history.replaceState(null, '', '/register') }}>
              Try another link or code
            </button>
          </>
        )}

        {info && info.status !== 'pending' && (
          <>
            <p className="sub">Invitation to {place}</p>
            <div className="error">
              {info.status === 'expired'
                ? 'This invitation has expired. Ask your agency to send a new one.'
                : info.status === 'accepted'
                  ? 'This invitation was already used. Sign in with your email and password.'
                  : `This invitation was ${info.status}. Ask your agency for a new one.`}
            </div>
            <button className="btn block" onClick={onLogin}>Go to sign in</button>
          </>
        )}

        {info && info.status === 'pending' && (
          <form onSubmit={(e) => { e.preventDefault(); void debounce(submit)() }}>
            <p className="sub">
              {info.invitedBy ?? 'Your agency'} invited you to <b>{place}</b> as {info.role}.
            </p>
            {info.message && <p className="meta" style={{ marginBottom: 12 }}>“{info.message}”</p>}
            {error && <div className="error">{error}</div>}
            <div className="field">
              <label htmlFor="reg-email">Email</label>
              <input id="reg-email" value={info.email} disabled />
            </div>
            {info.accountExists ? (
              <>
                <p className="meta" style={{ marginBottom: 12 }}>You already have an Unfoldd login. Enter its password to join.</p>
                <div className="field">
                  <label htmlFor="reg-password">Password</label>
                  <input id="reg-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="reg-name">Full name</label>
                  <input id="reg-name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="reg-password">Password</label>
                  <input id="reg-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="reg-confirm">Confirm password</label>
                  <input id="reg-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
              </>
            )}
            <button className="btn block" type="submit" disabled={busy}>
              {busy ? 'Setting up…' : info.accountExists ? 'Join' : 'Create account'}
            </button>
          </form>
        )}

        <p className="meta" style={{ marginTop: 16, textAlign: 'center' }}>
          Already have an account?{' '}
          <a href="/" onClick={(e) => { e.preventDefault(); onLogin() }}>Sign in</a>
        </p>
      </div>
    </div>
  )
}
