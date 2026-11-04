import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Circle, Columns2, ExternalLink } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import { useClientSession } from '@/features/agency/session'
import { clientContentApi, clientContentKey, clientThreadsKey, toViewer, type ClientContentDetail, type ClientVersion } from '@/features/client-app/content/api'
import { DecisionBar } from '@/features/client-app/content/DecisionBar'
import { ClientStatusPill } from '@/features/client-app/content/pills'
import { ReviewFeedback } from '@/features/client-app/content/ReviewFeedback'
import { useClientSpace } from '@/features/client-app/space'
import type { Anchor, Thread } from '@/features/content/api'
import { CreativeViewer } from '@/features/content/CreativeViewer'
import { formatLabel, platformLabel, versionLabel } from '@/features/content/labels'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { formatInZone } from '@/lib/zonedTime'

/**
 * F22 content detail and F23–F45 review: the creative in its frame, the caption that gets approved with it,
 * feedback, the revision checklist, history, and the decision bar.
 */
export function ClientContentDetailPage() {
  const { id = '' } = useParams()
  const tz = useClientSession().client.timezone
  const space = useClientSpace()
  const query = useQuery({ queryKey: clientContentKey(id), queryFn: () => clientContentApi.get(id) })
  const threads = useQuery({ queryKey: clientThreadsKey(id), queryFn: () => clientContentApi.threads(id), enabled: query.isSuccess })
  const [viewing, setViewing] = useState<string | null>(null)
  const [compareWith, setCompareWith] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [annotating, setAnnotating] = useState(false)
  const [draft, setDraft] = useState<Anchor | null>(null)

  const c = query.data?.content
  const shownId = viewing ?? c?.version?._id ?? null
  // Loading the version through its own endpoint is what records "viewed" for Admins and Approvers (D04).
  const shown = useQuery({ queryKey: ['client', 'content', 'version', id, shownId], queryFn: () => clientContentApi.version(id, shownId!), enabled: !!shownId })
  const compare = useQuery({ queryKey: ['client', 'content', 'version', id, compareWith], queryFn: () => clientContentApi.version(id, compareWith!), enabled: !!compareWith })

  if (query.isPending) return <Back />
  if (query.isError || !c) {
    return (
      <>
        <Back />
        <EmptyState title="Couldn’t open this">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }

  const allThreads = threads.data?.items ?? []
  const version = shown.data?.version
  const isCurrent = !!version?.isCurrent
  const canDraw = isCurrent && c.can.comment && !compareWith

  return (
    <>
      <Back />
      <header className="flex flex-col gap-2">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight">{c.title}</h1>
        <p className="text-[13px] text-text-3">
          {platformLabel[c.platform]} · {formatLabel[c.format]}
        </p>
        <ClientStatusPill status={c.status} />
        <StatusLines content={c} tz={tz} />
      </header>

      {!c.version ? (
        <EmptyState title="Nothing to look at yet">Your agency is still working on the creative.</EmptyState>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          {c.versions.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Versions">
                {c.versions.map((v) => {
                  const active = v.id === shownId
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        setViewing(v.id === c.version?._id ? null : v.id)
                        setAnnotating(false)
                        setDraft(null)
                      }}
                      className={cn('h-9 rounded-full px-3.5 text-xs', active ? 'bg-brand font-medium text-white' : 'bg-white text-text-2 ring-1 ring-border-strong')}
                    >
                      {versionLabel(v.number)}
                      {v.id === c.version?._id && c.version.isCurrent && <span className={active ? 'text-white/70' : 'text-text-4'}> · latest</span>}
                    </button>
                  )
                })}
              </div>
              <label className="flex items-center gap-2 text-xs text-text-3">
                <Columns2 size={15} /> Compare
                <Select value={compareWith ?? ''} onChange={(e) => setCompareWith(e.target.value || null)} className="h-9 w-24 text-xs" aria-label="Compare with version">
                  <option value="">—</option>
                  {c.versions
                    .filter((v) => v.id !== shownId)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {versionLabel(v.number)}
                      </option>
                    ))}
                </Select>
              </label>
            </div>
          )}

          {!version ? (
            <div className="aspect-square animate-pulse rounded-xl bg-surface-input" />
          ) : compareWith ? (
            <div className="grid grid-cols-2 gap-2">
              {[version, compare.data?.version].map((v, i) =>
                v ? (
                  <div key={v.id} className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-xs font-semibold text-text-2">{versionLabel(v.number)}</span>
                    <Viewer v={v} format={c.format} threads={allThreads} compact />
                  </div>
                ) : (
                  <div key={i} className="aspect-square animate-pulse rounded-xl bg-surface-input" />
                ),
              )}
            </div>
          ) : (
            <Viewer
              v={version}
              format={c.format}
              threads={allThreads}
              selected={selected}
              onSelect={setSelected}
              annotating={annotating && canDraw}
              draft={draft}
              onDraft={setDraft}
            />
          )}

          {version && !isCurrent && (
            <p className="rounded-lg bg-surface-input px-3 py-2 text-xs text-text-2">
              {versionLabel(version.number)} is an older version. You can look, but comments and decisions go on the latest one.
              {version.withdrawnAt && ' Your agency replaced it with a newer version.'}
            </p>
          )}

          {version && (
            <section className="rounded-xl border border-border bg-white px-4 py-3">
              <h2 className="text-xs text-text-3">Caption</h2>
              <p className="mt-1 text-[15px] whitespace-pre-line">{version.caption || <span className="text-text-4">No caption</span>}</p>
              {version.hashtags.length > 0 && <p className="mt-1.5 text-[14px] text-blue-ink">{version.hashtags.join(' ')}</p>}
              {isCurrent && c.can.decide && <p className="mt-2 text-[11px] text-text-4">The caption is part of what you approve.</p>}
            </section>
          )}

          <Revisions content={c} />
          <Checklist id={c.id} />

          <ReviewFeedback
            content={c}
            threads={allThreads}
            canFeedback={!!space.data?.can.feedback}
            selected={selected}
            onSelect={(tid) => {
              setSelected(tid)
              const t = allThreads.find((x) => x._id === tid)
              if (t?.version && t.version !== shownId) {
                setViewing(t.version === c.version?._id ? null : t.version)
                setCompareWith(null)
              }
            }}
            annotating={annotating}
            onAnnotate={(on) => {
              setAnnotating(on)
              if (on) {
                setViewing(null)
                setCompareWith(null)
                setSelected(null)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }
            }}
            draft={draft}
            onClearDraft={() => setDraft(null)}
          />

          <History content={c} tz={tz} />
        </div>
      )}

      <DecisionBar content={c} threads={allThreads} />
    </>
  )
}

function Back() {
  return (
    <Link to="/c/content" className="mb-3 inline-flex h-9 items-center gap-1.5 text-[13px] text-text-3 hover:text-text">
      <ArrowLeft size={16} /> Content
    </Link>
  )
}

function Viewer({
  v,
  format,
  threads,
  ...rest
}: {
  v: ClientVersion
  format: ClientContentDetail['format']
  threads: Thread[]
  compact?: boolean
  selected?: string | null
  onSelect?: (id: string) => void
  annotating?: boolean
  draft?: Anchor | null
  onDraft?: (a: Anchor | null) => void
}) {
  const { version, media } = toViewer(v)
  // Drafts on this version show their pins too, so the person sees what they've marked.
  return <CreativeViewer version={version} media={media} format={format} threads={threads.filter((t) => t.version === v.id)} {...rest} />
}

/** Neutral delay signals (D29): no "at risk", no blame. */
function StatusLines({ content: c, tz }: { content: ClientContentDetail; tz: string }) {
  const lines: string[] = []
  if (c.approved) lines.push(`Approved by ${c.approved.by} · ${formatInZone(c.approved.at, tz, { withViewer: false })}`)
  if (c.status.bucket === 'scheduled' && c.publishDate) lines.push(`Goes live ${formatInZone(c.publishDate, tz)}`)
  if (c.published) lines.push(`Published ${formatInZone(c.published.at, tz, { withViewer: false })}`)
  if (c.delay.approvalNeededBy) lines.push(`Approval needed by ${formatInZone(c.delay.approvalNeededBy, tz, { withViewer: false })}`)
  else if (c.delay.reviewPendingSince) lines.push(`Review pending since ${formatInZone(c.delay.reviewPendingSince, tz, { withViewer: false })}`)
  if (c.delay.shiftedDays) lines.push(`Schedule shifted · ${Math.abs(c.delay.shiftedDays)} day${Math.abs(c.delay.shiftedDays) === 1 ? '' : 's'}`)
  if (!lines.length && !c.published?.url) return null
  return (
    <div className="flex flex-col gap-1 text-[13px] text-text-2">
      {lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
      {c.published?.url && (
        <a href={c.published.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start font-medium text-brand">
          <ExternalLink size={14} /> See the post
        </a>
      )}
    </div>
  )
}

/** F45: rounds of changes against the contract (D09). Shown plainly; going over is the agency's concern. */
function Revisions({ content: c }: { content: ClientContentDetail }) {
  if (!c.revisions.used) return null
  return (
    <p className="text-[13px] text-text-2">
      Rounds of changes: {c.revisions.used} of {c.revisions.included} included
    </p>
  )
}

/** The revision checklist your agency accepted from your feedback (D21: never suggestions, never raw AI). */
function Checklist({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['client', 'content', 'checklist', id], queryFn: () => clientContentApi.checklist(id) })
  const items = query.data?.items ?? []
  if (!items.length) return null
  return (
    <section className="rounded-xl border border-border bg-white px-4 py-3">
      <h2 className="text-sm font-semibold">What your agency is changing</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {items.map((i) => (
          <li key={i._id} className="flex items-start gap-2.5 text-[14px]">
            {i.done ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-positive" /> : <Circle size={17} className="mt-0.5 shrink-0 text-text-4" />}
            <span className={cn('flex-1', i.done && 'text-text-3 line-through')}>
              {i.text}
              {i.pins.length > 0 && <span className="ml-1.5 text-xs text-text-4 no-underline">from {i.pins.map((p) => `#${p}`).join(', ')}</span>}
            </span>
            <span className="shrink-0 text-[11px] text-text-4">{versionLabel(i.versionNumber)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Who decided what, on which version. */
function History({ content: c, tz }: { content: ClientContentDetail; tz: string }) {
  const verb = { approved: 'approved', changes_requested: 'requested changes on', pulled: 'withdrew the approval of' }
  if (!c.decisions.length && c.versions.length <= 1) return null
  const events = [
    ...c.decisions.map((d) => ({ at: d.createdAt, text: `${d.by.name} ${verb[d.decision]} ${versionLabel(d.versionNumber)}`, note: d.note })),
    ...c.versions.map((v) => ({ at: v.sentToClientAt, text: `${versionLabel(v.number)} shared with you`, note: '' })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  return (
    <section className="rounded-xl border border-border bg-white px-4 py-3">
      <h2 className="text-sm font-semibold">History</h2>
      <ol className="mt-2 flex flex-col gap-2.5">
        {events.map((e, i) => (
          <li key={i} className="text-[13px]">
            <span>{e.text}</span>
            <time className="ml-2 text-xs text-text-4" title={formatInZone(e.at, tz, { withViewer: false })}>
              {timeAgo(e.at)}
            </time>
            {e.note && <p className="mt-0.5 text-xs text-text-3">“{e.note}”</p>}
          </li>
        ))}
      </ol>
    </section>
  )
}
