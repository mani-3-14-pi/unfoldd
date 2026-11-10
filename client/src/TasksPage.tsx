import { useEffect, useState } from 'react'
import { ApiError, requests, type ClientRequest } from './api.ts'
import { fmtDate, titleCase } from './format.ts'
import { useDebouncedAction } from './useDebouncedAction.ts'

/** Open tasks soonest-due first (no due date last); everything else after, newest due first. */
export function sortTasks(items: ClientRequest[]) {
  const byDue = (a: ClientRequest, b: ClientRequest) => (a.due || '9999').localeCompare(b.due || '9999')
  const open = items.filter((r) => r.status === 'open').sort((a, b) => Number(b.overdue) - Number(a.overdue) || byDue(a, b))
  const rest = items.filter((r) => r.status !== 'open').sort((a, b) => byDue(b, a))
  return { open, rest }
}

export function TasksPage() {
  const [items, setItems] = useState<ClientRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    requests
      .list()
      .then((r) => setItems(r.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load tasks.'))

  useEffect(() => {
    void load()
  }, [])

  const { open, rest } = sortTasks(items ?? [])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <p className="sub">Things your agency needs from you: answers, files, sign-offs.</p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {items === null && !error && <p className="empty">Loading…</p>}
      {items?.length === 0 && <p className="empty">Your agency hasn’t asked you for anything.</p>}

      {open.length > 0 && (
        <section className="group">
          <h2 className="group-title">To do <span className="count">{open.length}</span></h2>
          <div className="list">
            {open.map((r) => <TaskCard key={r.id} task={r} onChanged={load} />)}
          </div>
        </section>
      )}
      {items !== null && items.length > 0 && open.length === 0 && <p className="notice">Nothing to do right now. Nice work.</p>}
      {rest.length > 0 && (
        <section className="group">
          <h2 className="group-title">Done <span className="count">{rest.length}</span></h2>
          <div className="list">
            {rest.map((r) => <TaskCard key={r.id} task={r} onChanged={load} />)}
          </div>
        </section>
      )}
    </div>
  )
}

function TaskCard({ task: r, onChanged }: { task: ClientRequest; onChanged: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounce = useDebouncedAction()

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await requests.submit(r.id, response.trim())
      setOpen(false)
      setResponse('')
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`card task ${r.status !== 'open' ? 'muted' : ''}`}>
      <div className="row">
        <div>
          <p className="title">{r.title}</p>
          <p className="meta">
            {r.due ? `Due ${fmtDate(r.due)}` : 'No due date'}
            {r.overdue && <span className="flag"> · Overdue</span>}
            {r.priority && r.priority !== 'normal' ? ` · ${titleCase(r.priority)} priority` : ''}
          </p>
        </div>
        <span className={`pill ${r.status}`}>{r.label}</span>
      </div>
      {r.description && <p className="body-text">{r.description}</p>}
      {r.why && <p className="meta">Why: {r.why}</p>}
      {r.returnNote && <div className="error" style={{ marginTop: 10 }}>Your agency needs something else: {r.returnNote}</div>}
      {r.response && r.status !== 'open' && <p className="meta">Your response: {r.response}</p>}
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      {r.status === 'open' &&
        (open ? (
          <div className="section">
            <div className="field">
              <label htmlFor={`resp-${r.id}`}>Your response</label>
              <textarea id={`resp-${r.id}`} value={response} onChange={(e) => setResponse(e.target.value)} />
            </div>
            <div className="actions">
              <button className="btn" disabled={busy || !response.trim()} onClick={debounce(submit)}>Submit</button>
              <button className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="actions">
            <button className="btn sm" onClick={() => { setOpen(true); setResponse('') }}>Respond</button>
          </div>
        ))}
    </div>
  )
}
