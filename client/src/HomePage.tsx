import { useEffect, useState } from 'react'
import { CalendarClock, Eye, ListChecks, MessageSquareWarning } from 'lucide-react'
import type { View } from './App.tsx'
import { ApiError, brand, canEditBrand, content, requests, type ClientRequest, type ContentCard, type Me, type Onboarding } from './api.ts'
import { ContentRow } from './ContentPage.tsx'
import { fmtDate } from './format.ts'
import { sortTasks } from './TasksPage.tsx'

/** Home: what needs the client now, at a glance. */
export function HomePage({ me, onOpen }: { me: Me; onOpen: (v: View) => void }) {
  const [review, setReview] = useState<ContentCard[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [tasks, setTasks] = useState<ClientRequest[] | null>(null)
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load everything. Try refreshing.')
    content
      .list('review_required', 'publish_date')
      .then((r) => {
        setReview(r.items)
        setCounts(r.counts)
      })
      .catch(fail)
    requests
      .list()
      .then((r) => setTasks(sortTasks(r.items).open))
      .catch(fail)
    // Brand DNA is a nice-to-have here: a failure just hides the card.
    brand
      .onboarding()
      .then((r) => setOnboarding(r.onboarding))
      .catch(() => undefined)
  }, [])

  const firstName = me.user.name.split(/\s+/)[0]
  const stats = [
    { label: 'To review', value: counts.review_required, view: { name: 'content', status: 'review_required' } as View, tone: 'amber', icon: Eye },
    { label: 'Changes requested', value: counts.changes_requested, view: { name: 'content', status: 'changes_requested' } as View, tone: 'red', icon: MessageSquareWarning },
    { label: 'Scheduled', value: counts.scheduled, view: { name: 'content', status: 'scheduled' } as View, tone: 'blue', icon: CalendarClock },
    { label: 'Open tasks', value: tasks?.length, view: { name: 'tasks' } as View, tone: 'green', icon: ListChecks },
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Hi {firstName}</h1>
          <p className="sub">Here’s what needs you today.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="stats">
        {stats.map((s) => (
          <button key={s.label} type="button" className={`stat ${s.tone}`} onClick={() => onOpen(s.view)}>
            <span className="stat-icon" aria-hidden="true">
              <s.icon size={22} strokeWidth={1.8} />
            </span>
            <span className="stat-text">
              <span className="stat-label">{s.label}</span>
              <span className="stat-value">{s.value ?? '–'}</span>
            </span>
          </button>
        ))}
      </div>

      {onboarding && <BrandCard onboarding={onboarding} canEdit={canEditBrand(me.role)} onOpen={() => onOpen({ name: 'brand' })} />}

      <section className="group">
        <div className="group-head">
          <h2 className="group-title">Waiting for your review</h2>
          <a href="#/content">See all content</a>
        </div>
        {review === null && !error && <p className="empty">Loading…</p>}
        {review?.length === 0 && <p className="empty small">Nothing to review. You’re all caught up.</p>}
        <div className="list">
          {review?.slice(0, 5).map((c) => <ContentRow key={c.id} item={c} onOpen={(id) => onOpen({ name: 'detail', id })} />)}
        </div>
      </section>

      <section className="group">
        <div className="group-head">
          <h2 className="group-title">Your tasks</h2>
          <a href="#/tasks">See all tasks</a>
        </div>
        {tasks === null && !error && <p className="empty">Loading…</p>}
        {tasks?.length === 0 && <p className="empty small">Nothing your agency needs from you right now.</p>}
        <div className="list">
          {tasks?.slice(0, 3).map((t) => (
            <button key={t.id} type="button" className="card row clickable-row" onClick={() => onOpen({ name: 'tasks' })}>
              <span>
                <span className="title">{t.title}</span>
                <span className="meta">
                  {t.due ? `Due ${fmtDate(t.due)}` : 'No due date'}
                  {t.overdue && <span className="flag"> · Overdue</span>}
                </span>
              </span>
              <span className={`pill ${t.status}`}>{t.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function BrandCard({ onboarding: o, canEdit, onOpen }: { onboarding: Onboarding; canEdit: boolean; onOpen: () => void }) {
  const complete = o.done === o.total
  return (
    <div className={`card brand-card ${complete ? 'complete' : ''}`}>
      <div className="brand-card-text">
        <p className="eyebrow">Brand DNA</p>
        <p className="title">{complete ? 'Your Brand DNA is complete' : o.done === 0 ? 'Tell us about your brand' : 'Finish your Brand DNA'}</p>
        <p className="meta">
          {complete
            ? 'Your agency uses it for every post. Update it any time.'
            : 'Who you are, how you sound, and the styles you love and avoid. It helps your agency get your content right the first time.'}
        </p>
        <div className="progress" aria-label={`${o.done} of ${o.total} sections done`}>
          <span style={{ width: `${o.percent}%` }} />
        </div>
        <p className="meta">{o.done} of {o.total} sections done</p>
      </div>
      <button className={`btn ${complete ? 'ghost' : ''}`} onClick={onOpen}>
        {complete || !canEdit ? 'View Brand DNA' : o.done === 0 ? 'Get started' : 'Continue'}
      </button>
    </div>
  )
}
