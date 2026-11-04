import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Columns2, Upload } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Details } from '@/components/ui/Details'
import { Pill } from '@/components/ui/Pill'
import { Select } from '@/components/ui/Field'
import { contentApi, contentKey, type Anchor, type ContentRecord, type Version } from '@/features/content/api'
import { ChecklistPanel } from '@/features/content/ChecklistPanel'
import { ContentActions } from '@/features/content/ContentActions'
import { ContentFormDialog } from '@/features/content/ContentFormDialog'
import { useClientPeople } from '@/features/content/useClientPeople'
import { CreativeViewer } from '@/features/content/CreativeViewer'
import { FeedbackPanel } from '@/features/content/FeedbackPanel'
import { formatLabel, platformLabel, priorityLabel, versionLabel } from '@/features/content/labels'
import { ApprovalPill, StatePill } from '@/features/content/pills'
import { VersionUploadDialog } from '@/features/content/VersionUploadDialog'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatDateTime, timeAgo } from '@/lib/format'
import { formatInZone } from '@/lib/zonedTime'

/** P47/P53: one content item: the creative and its feedback, the next step, the checklist, the brief and history. */
export function ContentDetailPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: contentKey(id), queryFn: () => contentApi.get(id) })
  const threads = useQuery({ queryKey: ['agency', 'content', 'threads', id], queryFn: () => contentApi.threads(id), enabled: query.isSuccess })
  const [viewing, setViewing] = useState<string | null>(null)
  const [compareWith, setCompareWith] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [annotating, setAnnotating] = useState(false)
  const [draft, setDraft] = useState<Anchor | null>(null)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState(false)

  const back = { to: '/app/content', label: 'Content' }
  if (query.isPending) return <PageHeader title="Content" back={back} />
  if (query.isError) {
    return (
      <>
        <PageHeader title="Content" back={back} />
        <EmptyState title="Couldn’t open this content">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }

  const c = query.data.content
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['agency', 'content'] })
    void qc.invalidateQueries({ queryKey: ['agency', 'clients'] })
  }
  const current = c.versions.find((v) => v._id === c.currentVersion) ?? null
  const shown = c.versions.find((v) => v._id === viewing) ?? current
  const compare = c.versions.find((v) => v._id === compareWith) ?? null
  const isCurrent = !!shown && shown._id === current?._id
  const allThreads = threads.data?.items ?? []
  const { revisions, timing } = c.derived

  return (
    <>
      <PageHeader
        back={back}
        title={c.title}
        meta={
          <>
            <StatePill state={c.state} />
            {c.state !== 'cancelled' && <ApprovalPill status={c.derived.approvalStatus} />}
            {revisions.used > 0 && (
              <Pill tone={revisions.over ? 'red' : 'gray'} dot={false}>
                Revisions {revisions.used} of {revisions.included}
              </Pill>
            )}
            {timing?.overdueForApproval && <Pill tone="red">Overdue for approval</Pill>}
            {timing?.atRisk && <Pill tone="amber">At risk</Pill>}
          </>
        }
        description={
          <>
            <Link to={`/app/clients/${c.client._id}`} className="font-medium text-text-2 hover:underline">
              {c.client.brandName}
            </Link>{' '}
            · {platformLabel[c.platform]} · {formatLabel[c.format]}
            {c.publishDate && <> · publishes {formatInZone(c.publishDate, c.client.timezone)}</>}
          </>
        }
        actions={<ContentActions content={c} onChanged={refresh} onUpload={() => setUploading(true)} onEdit={() => setEditing(true)} />}
      />

      {revisions.over && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-amber-soft bg-[#fdf8f1] px-4 py-2.5 text-[13px] text-amber-ink">
          <AlertTriangle size={16} /> Over the contract: {revisions.used} rounds of changes against {revisions.included} included. Flagged for you only; nothing is blocked.
        </p>
      )}

      {!shown ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-6 py-14 text-center">
          <Upload size={24} className="text-text-3" />
          <h2 className="text-sm font-semibold">No creative yet</h2>
          <p className="max-w-sm text-[13px] text-text-3">Upload V01: the images or video, with the caption and hashtags. Your team and then the client review it.</p>
          {!['published', 'cancelled', 'publishing'].includes(c.state) && (
            <Button variant="primary" onClick={() => setUploading(true)}>
              <Upload size={15} /> Upload V01
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-4">
            <VersionBar
              content={c}
              shown={shown}
              compare={compare}
              onView={(vid) => {
                setViewing(vid)
                setAnnotating(false)
                setDraft(null)
              }}
              onCompare={setCompareWith}
            />
            {compare ? (
              <div className="grid gap-4 md:grid-cols-2">
                {[shown, compare].map((v) => (
                  <div key={v._id} className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-text-2">{versionLabel(v.number)}</span>
                    <CreativeViewer version={v} format={c.format} threads={allThreads.filter((t) => t.version === v._id)} compact />
                  </div>
                ))}
              </div>
            ) : (
              <CreativeViewer
                version={shown}
                format={c.format}
                threads={allThreads.filter((t) => t.version === shown._id)}
                selected={selected}
                onSelect={setSelected}
                annotating={annotating && isCurrent}
                draft={draft}
                onDraft={setDraft}
              />
            )}
            <VersionInfo version={shown} content={c} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <FeedbackPanel
              content={c}
              threads={allThreads}
              selected={selected}
              onSelect={(tid) => {
                setSelected(tid)
                const t = allThreads.find((x) => x._id === tid)
                // Show the version the comment was made on.
                if (t?.version && t.version !== shown._id) {
                  setViewing(t.version)
                  setCompareWith(null)
                }
              }}
              viewingCurrent={isCurrent && !compare}
              annotating={annotating}
              onAnnotate={(on) => {
                setAnnotating(on)
                if (on) {
                  setViewing(null)
                  setCompareWith(null)
                  setSelected(null)
                }
              }}
              draft={draft}
              onClearDraft={() => setDraft(null)}
            />
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          {allThreads.some((t) => t.visibility === 'client' && t.kind === 'feedback') && <ChecklistPanel content={c} />}
          <BriefCard content={c} />
        </div>
        <History content={c} />
      </div>

      {uploading && (
        <VersionUploadDialog
          content={c}
          threads={allThreads}
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false)
            setViewing(null)
            refresh()
          }}
        />
      )}
      {editing && (
        <ContentFormDialog
          content={c}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            refresh()
          }}
          onReload={() => {
            setEditing(false)
            refresh()
          }}
        />
      )}
    </>
  )
}

function VersionBar({ content: c, shown, compare, onView, onCompare }: { content: ContentRecord; shown: Version; compare: Version | null; onView: (id: string | null) => void; onCompare: (id: string | null) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Versions">
        {c.versions.map((v) => {
          const isCurrent = v._id === c.currentVersion
          return (
            <button
              key={v._id}
              type="button"
              role="tab"
              aria-selected={v._id === shown._id}
              onClick={() => onView(isCurrent ? null : v._id)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full px-3 text-xs',
                v._id === shown._id ? 'bg-brand font-medium text-white' : 'bg-surface-input text-text-2 hover:bg-border-strong',
              )}
            >
              {versionLabel(v.number)}
              {isCurrent && <span className={v._id === shown._id ? 'text-white/70' : 'text-text-4'}>current</span>}
              {v._id === c.approvedVersion && <span className={v._id === shown._id ? 'text-white/80' : 'text-positive'}>✓</span>}
            </button>
          )
        })}
      </div>
      {c.versions.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-text-3">
          <Columns2 size={15} /> Compare with
          <Select value={compare?._id ?? ''} onChange={(e) => onCompare(e.target.value || null)} className="h-8 w-28 text-xs">
            <option value="">—</option>
            {c.versions
              .filter((v) => v._id !== shown._id)
              .map((v) => (
                <option key={v._id} value={v._id}>
                  {versionLabel(v.number)}
                </option>
              ))}
          </Select>
        </label>
      )}
    </div>
  )
}

function VersionInfo({ version: v, content: c }: { version: Version; content: ContentRecord }) {
  const isCurrent = v._id === c.currentVersion
  return (
    <Card>
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
          <span className="font-semibold text-text">{versionLabel(v.number)}</span>
          <span>
            by {v.createdBy.name} · {timeAgo(v.createdAt)}
          </span>
          {v.sentToClientAt && <span>Sent to client {timeAgo(v.sentToClientAt)}</span>}
          {v.firstViewedAt && <span>Opened by {v.firstViewedBy?.name ?? 'the client'} {timeAgo(v.firstViewedAt)}</span>}
          {v.withdrawnAt && <Pill tone="gray" dot={false}>Withdrawn</Pill>}
          {!isCurrent && <Pill tone="gray" dot={false}>Older version · read only</Pill>}
        </div>
        {v.changeNote && <p className="rounded-lg bg-surface-input px-3 py-2 text-[13px] text-text-2">{v.changeNote}</p>}
        <div>
          <h3 className="text-xs text-text-3">Caption</h3>
          <p className="mt-1 text-[13px] whitespace-pre-line">{v.caption || <span className="text-text-4">No caption</span>}</p>
          {v.hashtags.length > 0 && <p className="mt-1.5 text-[13px] text-blue-ink">{v.hashtags.join(' ')}</p>}
        </div>
      </div>
    </Card>
  )
}

function BriefCard({ content: c }: { content: ContentRecord }) {
  const people = useClientPeople(c.client._id)
  const name = (id: string | null) => (id ? (people.data?.find((u) => u._id === id)?.name ?? '…') : '')
  return (
    <Card title="Brief and details">
      <Details
        rows={[
          { label: 'Brief', value: c.brief, wide: true },
          ...(c.idea ? [{ label: 'Idea', value: c.idea }] : []),
          ...(c.concept ? [{ label: 'Concept', value: c.concept }] : []),
          ...(c.objective ? [{ label: 'Objective', value: c.objective, wide: true }] : []),
          { label: 'Owner', value: name(c.owner) },
          { label: 'Reviewer', value: name(c.reviewer) || 'Any manager' },
          { label: 'Production deadline', value: c.due ? formatDate(c.due) : '' },
          { label: 'Publish date', value: c.publishDate ? formatInZone(c.publishDate, c.client.timezone) : 'Not set' },
          { label: 'Priority', value: priorityLabel[c.priority] },
          { label: 'Internal review', value: c.client.contract.internalReview ? 'On for this client' : 'Off for this client' },
        ]}
      />
    </Card>
  )
}

/** P84 approval history and the version trail. */
function History({ content: c }: { content: ContentRecord }) {
  const label = { approved: 'approved', changes_requested: 'requested changes on', pulled: 'pulled the approval of' }
  const events = [
    ...c.decisions.map((d) => ({
      at: d.createdAt,
      text: `${d.by.name} ${label[d.decision]} ${versionLabel(d.versionNumber)}`,
      scope: d.scope,
      note: d.note,
      tone: d.decision === 'approved' ? 'text-positive' : 'text-negative',
    })),
    ...c.versions.map((v) => ({ at: v.createdAt, text: `${v.createdBy.name} uploaded ${versionLabel(v.number)}`, scope: null, note: '', tone: 'text-text-2' })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <Card title="History">
      {events.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-text-3">Nothing yet.</p>
      ) : (
        <ol className="flex flex-col gap-3 px-5 py-4">
          {events.map((e, i) => (
            <li key={i} className="flex gap-3">
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full bg-current', e.tone)} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[13px]">
                  {e.text}
                  {e.scope && <span className="ml-1.5 text-xs text-text-4">{e.scope === 'internal' ? '· internal' : '· client'}</span>}
                </p>
                {e.note && <p className="mt-0.5 text-xs whitespace-pre-line text-text-3">“{e.note}”</p>}
                <time className="text-xs text-text-4" title={formatDateTime(e.at)}>
                  {timeAgo(e.at)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
