import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, content, type Anchor, type ContentDetail as Detail, type Thread } from './api.ts'
import { Creative } from './Creative.tsx'
import { fmtDateTime as fmt, formatLabel, platformLabel } from './format.ts'
import { useDebouncedAction } from './useDebouncedAction.ts'
import { VoicePlayer, VoiceRecorder, type RecordedVoice } from './VoiceNote.tsx'

export function ContentDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [item, setItem] = useState<Detail | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  // A new comment can have text, a voice note and marks drawn on the creative, all together.
  const [voice, setVoice] = useState<RecordedVoice | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [marks, setMarks] = useState<Anchor | null>(null)
  const [slide, setSlide] = useState(0)
  // A saved comment whose marks are shown on the creative.
  const [shownId, setShownId] = useState<string | null>(null)
  const creative = useRef<HTMLDivElement>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const debounce = useDebouncedAction()

  const load = useCallback(async () => {
    try {
      const [{ content: c }, { items }] = await Promise.all([content.get(id), content.threads(id)])
      setItem(c)
      setThreads(items)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this item.')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  // Every action on this screen goes through `run`, so one debounce covers them all.
  const run = debounce(runNow)
  async function runNow(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(done)
      await load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Someone else decided on this first. Showing the latest state.')
        await load()
      } else setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!item) {
    return (
      <div>
        <button className="back" onClick={onBack}>← Back</button>
        {error ? <div className="error">{error}</div> : <p className="empty">Loading…</p>}
      </div>
    )
  }

  const version = item.version
  // Approve and request changes while it's in review; once approved (or scheduled) only a withdrawal is left.
  const inReview = ['client_review', 'changes_requested'].includes(item.state)
  const canDecide = item.can.decide && !!version && inReview
  const canWithdraw = item.can.decide && !!version && ['approved', 'scheduled'].includes(item.state)
  const canComment = item.can.comment && !!version
  const drafts = threads.filter((t) => t.draft).length
  // The agency needs at least one comment saying what to change: without one, the note becomes that comment.
  const hasFeedback = threads.some((t) => t.version === version?._id && (t.draft || (t.status !== null && t.status !== 'resolved')))

  const slideOf = (a: Anchor | null | undefined) => Math.max(0, version?.files.findIndex((f) => f.id === a?.versionFile) ?? 0)
  const shown = threads.find((t) => t._id === shownId)?.anchor ?? null
  const markedSlide = marks?.shapes?.length ? slideOf(marks) : -1

  function showOnCreative(t: Thread) {
    setShownId(t._id === shownId ? null : t._id)
    setSlide(slideOf(t.anchor))
    creative.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function toggleDrawing() {
    if (!drawing) creative.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setDrawing(!drawing)
  }

  function addComment() {
    return run(async () => {
      await content.addComment(id, version!._id, comment.trim(), {
        ...(voice ? { voice: { file: voice.file, durationMs: voice.durationMs } } : {}),
        ...(marks?.shapes?.length ? { anchor: marks } : {}),
      })
      if (voice) URL.revokeObjectURL(voice.preview)
      setComment('')
      setVoice(null)
      setMarks(null)
      setDrawing(false)
    }, 'Comment saved as a draft. Send it when you are ready.')
  }

  function requestChanges() {
    const text = note.trim()
    return run(async () => {
      if (!hasFeedback) await content.addComment(id, version!._id, text)
      await content.requestChanges(id, version!._id, item!.state, hasFeedback ? text : '')
      setNote('')
    }, 'Changes requested.')
  }

  return (
    <div>
      <button className="back" onClick={onBack}>← All content</button>
      <div className="card">
        <div className="detail-head">
          <h2>{item.title}</h2>
          <span className={`pill ${item.status.bucket ?? ''}`}>{item.status.label}</span>
        </div>
        <div className="facts">
          <span className="fact">{platformLabel(item.platform)}</span>
          <span className="fact">{formatLabel(item.format)}</span>
          <span className="fact">{item.publishDate ? `Goes live ${fmt(item.publishDate)}` : 'No publish date yet'}</span>
          {version && <span className="fact">Version {version.number}</span>}
        </div>

        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
        {notice && <div className="notice" style={{ marginTop: 12 }}>{notice}</div>}

        {version ? (
          <>
            <div ref={creative}>
              <Creative files={version.files} slide={slide} onSlide={setSlide} drawing={drawing && canComment} draft={marks} onDraw={setMarks} shown={shown} />
            </div>
            {version.caption && <p className="caption">{version.caption}</p>}
            {version.hashtags.length > 0 && <p className="hashtags">{version.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}</p>}
          </>
        ) : (
          <p className="empty">Nothing has been sent for review yet.</p>
        )}

        {canDecide && (
          <div className="decision">
            <h3>Your decision</h3>
            <div className="field">
              <label htmlFor="note">{hasFeedback ? 'Note (optional)' : 'Note (optional, required when requesting changes)'}</label>
              <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the agency should know" />
            </div>
            <div className="actions">
              <button className="btn success" disabled={busy} onClick={() => run(() => content.approve(id, version!._id, item.state, note), 'Approved.')}>
                Approve
              </button>
              <button className="btn warn" disabled={busy || (!hasFeedback && !note.trim())} onClick={requestChanges}>
                Request changes
              </button>
            </div>
          </div>
        )}

        {canWithdraw && (
          <div className="decision">
            <h3>Changed your mind?</h3>
            <div className="field">
              <label htmlFor="note">What should change? (optional)</label>
              <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your agency is told straight away" />
            </div>
            <div className="actions">
              <button
                className="btn warn"
                disabled={busy}
                onClick={() => run(() => content.requestChanges(id, version!._id, item.state, note.trim()), 'Approval withdrawn. Your agency has been told.')}
              >
                Withdraw approval
              </button>
            </div>
          </div>
        )}

        {item.approved && (
          <p className="meta" style={{ marginTop: 12 }}>Approved by {item.approved.by} on {fmt(item.approved.at)}</p>
        )}
      </div>

      <div className="card section">
        <h3>Comments</h3>
        {threads.length === 0 && <p className="empty">No comments yet.</p>}
        {threads.map((t) => (
          <div className="thread" key={t._id}>
            {t.draft && <div className="draft">Draft, only you can see this until it is sent</div>}
            {t.messages.map((m) => (
              <div className="msg" key={m._id}>
                <b>{m.author.name}</b>
                <span className="side">{m.author.side === 'agency' ? 'Agency' : 'You / your team'} · {fmt(m.createdAt)}</span>
                {m.body && <div>{m.body}</div>}
                {m.voice && <VoicePlayer voice={m.voice} />}
              </div>
            ))}
            {!!t.anchor?.shapes?.length && (
              <button type="button" className="link-btn" onClick={() => showOnCreative(t)}>
                {t._id === shownId ? 'Hide drawing' : `Show drawing${(version?.files.length ?? 0) > 1 ? ` (slide ${slideOf(t.anchor) + 1})` : ''}`}
              </button>
            )}
            {!t.draft && canComment && <ReplyBox onSend={(body) => run(() => content.reply(id, t._id, body), 'Reply posted.')} busy={busy} />}
          </div>
        ))}

        {canComment && (
          <div className="section">
            <div className="field">
              <label htmlFor="comment">New comment</label>
              <textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write your feedback" />
            </div>
            <div className="composer-tools">
              <button type="button" className={`draw-toggle${drawing ? ' on' : ''}`} aria-pressed={drawing} onClick={toggleDrawing}>
                <span className="switch" aria-hidden="true" /> Draw on the creative
              </button>
              <VoiceRecorder value={voice} onChange={setVoice} disabled={busy} />
            </div>
            {markedSlide >= 0 && (
              <div className="marks-chip">
                {marks!.shapes!.length} {marks!.shapes!.length === 1 ? 'mark' : 'marks'} on {(version?.files.length ?? 0) > 1 ? `slide ${markedSlide + 1}` : 'the creative'}
                <button type="button" className="link-btn" onClick={() => setMarks({ ...marks!, shapes: marks!.shapes!.slice(0, -1) })}>Undo</button>
                <button type="button" className="link-btn" onClick={() => setMarks(null)}>Clear</button>
              </div>
            )}
            <div className="actions">
              <button className="btn ghost" disabled={busy || (!comment.trim() && !voice)} title={!comment.trim() && !voice ? 'Write something or record a voice note' : undefined} onClick={addComment}>
                Add comment
              </button>
              {drafts > 0 && (
                <button className="btn" disabled={busy} onClick={() => run(() => content.sendFeedback(id, version!._id), 'Feedback sent to the agency.')}>
                  Send feedback ({drafts})
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {item.decisions.length > 0 && (
        <div className="card section">
          <h3>History</h3>
          {item.decisions.map((d) => (
            <div className="msg" key={d._id}>
              <b>{d.by.name}</b>
              <span className="side">{d.decision.replace(/_/g, ' ')} · V{d.versionNumber} · {fmt(d.createdAt)}</span>
              {d.note && <div>{d.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ReplyBox({ onSend, busy }: { onSend: (body: string) => void; busy: boolean }) {
  const [body, setBody] = useState('')
  return (
    <div className="reply">
      <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply…" />
      <button
        className="btn ghost sm"
        disabled={busy || !body.trim()}
        onClick={() => {
          onSend(body.trim())
          setBody('')
        }}
      >
        Reply
      </button>
    </div>
  )
}
