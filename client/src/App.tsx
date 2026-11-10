import { useEffect, useState } from 'react'
import { auth, type Me } from './api.ts'
import { BrandPage } from './BrandPage.tsx'
import { ContentDetail } from './ContentDetail.tsx'
import { ContentPage } from './ContentPage.tsx'
import { HomePage } from './HomePage.tsx'
import { LoginPage } from './LoginPage.tsx'
import { RegisterPage } from './RegisterPage.tsx'
import { TasksPage } from './TasksPage.tsx'
import { useDebouncedAction } from './useDebouncedAction.ts'

type Session = { status: 'loading' } | { status: 'out' } | { status: 'in'; me: Me }

/** `/invite/<token>` (the emailed link) and `/register` show registration; everything else is the app. */
function readPath(): { page: 'register'; token?: string } | { page: 'app' } {
  const invite = window.location.pathname.match(/^\/invite\/([^/]+)/)
  if (invite) return { page: 'register', token: decodeURIComponent(invite[1]) }
  if (window.location.pathname.startsWith('/register')) return { page: 'register' }
  return { page: 'app' }
}

/** Screens inside the app live in the hash: `#/content`, `#/content/<id>`, `#/tasks`, `#/brand`. */
export type View = { name: 'home' } | { name: 'content'; status?: string } | { name: 'detail'; id: string } | { name: 'tasks' } | { name: 'brand' }

function readHash(): View {
  const [path, query] = window.location.hash.replace(/^#/, '').split('?')
  const [, first, second] = path.split('/')
  if (first === 'content') {
    if (second) return { name: 'detail', id: second }
    const status = new URLSearchParams(query).get('status')
    return status !== null ? { name: 'content', status } : { name: 'content' }
  }
  if (first === 'tasks') return { name: 'tasks' }
  if (first === 'brand') return { name: 'brand' }
  return { name: 'home' }
}

export const hrefFor = (v: View) =>
  v.name === 'home'
    ? '#/'
    : v.name === 'detail'
      ? `#/content/${v.id}`
      : v.name === 'content' && v.status !== undefined
        ? `#/content?status=${v.status}`
        : `#/${v.name}`

const NAV: { view: View; label: string }[] = [
  { view: { name: 'home' }, label: 'Home' },
  { view: { name: 'content' }, label: 'Content' },
  { view: { name: 'tasks' }, label: 'Tasks' },
  { view: { name: 'brand' }, label: 'Brand DNA' },
]

export function App() {
  const [route, setRoute] = useState(readPath)
  const go = (path: string) => {
    window.history.pushState(null, '', path)
    setRoute(readPath())
  }
  useEffect(() => {
    const onPop = () => setRoute(readPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (route.page === 'register') {
    return <RegisterPage key={route.token ?? ''} token={route.token} onDone={() => setRoute({ page: 'app' })} onLogin={() => go('/')} />
  }
  return <PortalApp onRegister={() => go('/register')} />
}

function PortalApp({ onRegister }: { onRegister: () => void }) {
  const [session, setSession] = useState<Session>({ status: 'loading' })
  const debounce = useDebouncedAction()
  const [view, setView] = useState<View>(readHash)

  async function refresh() {
    try {
      const me = await auth.me()
      // A login that opened an agency context first: move to the first client space.
      if (me.context !== 'client') {
        const first = me.contexts.clients[0]
        if (!first) {
          await auth.logout().catch(() => undefined)
          setSession({ status: 'out' })
          return
        }
        await auth.switchClient(first.clientId)
        setSession({ status: 'in', me: await auth.me() })
        return
      }
      setSession({ status: 'in', me })
    } catch {
      setSession({ status: 'out' })
    }
  }

  useEffect(() => {
    void refresh()
    const onHash = () => {
      setView(readHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const open = (v: View) => {
    window.location.hash = hrefFor(v)
  }

  async function logout() {
    await auth.logout().catch(() => undefined)
    window.location.hash = ''
    setSession({ status: 'out' })
  }

  if (session.status === 'loading') return <p className="empty">Loading…</p>
  if (session.status === 'out') return <LoginPage onLoggedIn={refresh} onRegister={onRegister} />

  const { me } = session
  const brandName = me.client?.brandName || me.client?.name || 'Unfoldd'
  // The detail screen belongs to Content in the nav.
  const active = view.name === 'detail' ? 'content' : view.name

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="identity">
            <span className="avatar" aria-hidden>{initials(brandName)}</span>
            <div>
              <strong>{brandName}</strong>
              <div className="who">{me.user.name} · {me.agency.name}</div>
            </div>
          </div>
          <button className="btn ghost sm" onClick={debounce(logout)}>Sign out</button>
        </div>
        <nav className="nav" aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.view.name} href={hrefFor(n.view)} className={`nav-link ${active === n.view.name ? 'active' : ''}`} aria-current={active === n.view.name ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="page">
        {view.name === 'home' && <HomePage me={me} onOpen={open} />}
        {view.name === 'content' && <ContentPage key={view.status ?? ''} initialStatus={view.status} onOpen={(id) => open({ name: 'detail', id })} />}
        {view.name === 'detail' && <ContentDetail id={view.id} onBack={() => open({ name: 'content' })} />}
        {view.name === 'tasks' && <TasksPage />}
        {view.name === 'brand' && <BrandPage me={me} />}
      </main>
    </>
  )
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
