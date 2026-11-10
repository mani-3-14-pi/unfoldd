import { useState } from 'react'
import { ApiError, auth } from './api.ts'
import { useDebouncedAction } from './useDebouncedAction.ts'

export function LoginPage({ onLoggedIn, onRegister }: { onLoggedIn: () => void; onRegister: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const debounce = useDebouncedAction()

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const result = await auth.login(email, password)
      if (result.mfa) {
        setError('This account needs two-factor authentication. Please sign in through the main Unfoldd app.')
        return
      }
      if (result.context !== 'client') {
        // An agency user: the main portal is the right place; end the session so nothing is left half-open.
        await auth.logout().catch(() => undefined)
        setError('This login belongs to an agency account. Please use the agency portal.')
        return
      }
      onLoggedIn()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={(e) => { e.preventDefault(); void debounce(submit)() }}>
        <h1 className="brand">Unfoldd</h1>
        <p className="sub">Client sign in</p>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="meta" style={{ marginTop: 16, textAlign: 'center' }}>
          Invited by your agency?{' '}
          <a href="/register" onClick={(e) => { e.preventDefault(); onRegister() }}>Create an account</a>
        </p>
      </form>
    </div>
  )
}
