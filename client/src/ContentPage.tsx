import { useEffect, useState } from 'react'
import { ApiError, content, type ContentCard } from './api.ts'
import { fmtDate, formatLabel, platformLabel } from './format.ts'

const BUCKETS: { key: string; label: string }[] = [
  { key: 'review_required', label: 'To review' },
  { key: 'changes_requested', label: 'Changes requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
  { key: '', label: 'All' },
]

const EMPTY: Record<string, string> = {
  review_required: 'Nothing waiting for your review. You’re all caught up.',
  changes_requested: 'No content waiting on changes.',
  approved: 'Nothing approved yet.',
  scheduled: 'Nothing scheduled right now.',
  published: 'Nothing published yet.',
  '': 'Your agency hasn’t shared any content yet.',
}

export function ContentPage({ initialStatus, onOpen }: { initialStatus?: string; onOpen: (id: string) => void }) {
  const [bucket, setBucket] = useState(() => (BUCKETS.some((b) => b.key === initialStatus) ? initialStatus! : 'review_required'))
  const [sort, setSort] = useState<'updated' | 'publish_date'>('publish_date')
  const [items, setItems] = useState<ContentCard[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setItems(null)
    setError(null)
    content
      .list(bucket || undefined, sort)
      .then((r) => {
        setItems(r.items)
        setCounts(r.counts)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load content.'))
  }, [bucket, sort])

  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Content</h1>
          <p className="sub">Everything your agency has shared with you.</p>
        </div>
        <label className="select">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="publish_date">Publish date</option>
            <option value="updated">Latest activity</option>
          </select>
        </label>
      </div>

      <div className="tabs" role="tablist">
        {BUCKETS.map((b) => {
          const n = b.key ? counts[b.key] : total
          return (
            <button key={b.key || 'all'} role="tab" aria-selected={bucket === b.key} className={`tab ${bucket === b.key ? 'active' : ''}`} onClick={() => setBucket(b.key)}>
              {b.label}
              {n !== undefined && <span className="count">{n}</span>}
            </button>
          )
        })}
      </div>

      {error && <div className="error">{error}</div>}
      {items === null && !error && <p className="empty">Loading…</p>}
      {items?.length === 0 && <p className="empty">{EMPTY[bucket]}</p>}
      <div className="list">
        {items?.map((c) => <ContentRow key={c.id} item={c} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

/** One content card: thumbnail, title, where and when, status. Also used on Home. */
export function ContentRow({ item: c, onOpen }: { item: ContentCard; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="card content-row" onClick={() => onOpen(c.id)}>
      <span className="thumb">
        {c.cover?.url ? <img src={c.cover.url} alt="" /> : <span>{platformLabel(c.platform).slice(0, 2)}</span>}
      </span>
      <span className="content-main">
        <span className="title">{c.title}</span>
        <span className="meta">
          {platformLabel(c.platform)} · {formatLabel(c.format)}
          {c.versionNumber ? ` · V${String(c.versionNumber).padStart(2, '0')}` : ''}
        </span>
        <span className="meta">
          {c.publishDate ? `Goes live ${fmtDate(c.publishDate)}` : 'No publish date yet'}
          {c.status.delayed && <span className="flag"> · Delayed</span>}
        </span>
      </span>
      <span className={`pill ${c.status.bucket ?? ''}`}>{c.status.label}</span>
    </button>
  )
}
