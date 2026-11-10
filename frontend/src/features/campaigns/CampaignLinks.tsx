import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { contentApi, type ContentRow } from '@/features/content/api'
import { formatLabel, platformLabel } from '@/features/content/labels'
import { tasksApi } from '@/features/tasks/api'
import { isOverdue, todayString } from '@/features/tasks/labels'
import { BlockedBadge, TaskStatusPill } from '@/features/tasks/pills'
import { TaskFormDialog } from '@/features/tasks/TaskFormDialog'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import type { Campaign } from './api'

/** List rows carry the whole document; these are the fields the picker needs beyond `ContentRow`. */
type Row = ContentRow & { campaign?: string | null; rev: number }

/** Puts existing content of the campaign's client into the campaign. Published and cancelled content can't change. */
export function AddContentDialog({ campaign, onClose, onDone }: { campaign: Campaign; onClose: () => void; onDone: () => void }) {
  const list = useQuery({
    queryKey: ['agency', 'content', 'list', 'campaign-picker', campaign.client],
    queryFn: () => contentApi.list(`client=${campaign.client}&pageSize=100&sort=title`),
  })
  const rows = ((list.data?.items ?? []) as Row[]).filter((c) => c.campaign !== campaign._id && !['published', 'cancelled'].includes(c.state))
  const [picked, setPicked] = useState<string[]>([])
  const save = useMutation({
    mutationFn: async () => {
      for (const c of rows.filter((r) => picked.includes(r._id))) await contentApi.update(c._id, { campaign: campaign._id, rev: c.rev })
    },
    onSuccess: () => {
      toast(`Added ${picked.length} to ${campaign.name}`)
      onDone()
      onClose()
    },
    onError: () => {
      // Some may have saved before the error: show what's there now.
      onDone()
      void list.refetch()
    },
  })

  return (
    <Dialog
      title="Add content to the campaign"
      description="Pick content of this client. Content in another campaign moves to this one."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!picked.length} onClick={() => save.mutate()}>
            Add {picked.length || ''}
          </Button>
        </>
      }
    >
      {list.isPending ? (
        <div className="h-24" />
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-text-3">No other content for this client yet. Create content, or add items to a content plan, then add them here.</p>
      ) : (
        <ul className="flex max-h-80 flex-col overflow-y-auto">
          {rows.map((c) => {
            const on = picked.includes(c._id)
            return (
              <li key={c._id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-[13px] hover:bg-surface-input">
                  <input type="checkbox" className="size-4 accent-brand" checked={on} onChange={() => setPicked((p) => (on ? p.filter((x) => x !== c._id) : [...p, c._id]))} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.title}</span>
                    <span className="block truncate text-xs text-text-4">
                      {platformLabel[c.platform]} · {formatLabel[c.format]}
                      {c.campaign && ' · in another campaign'}
                    </span>
                  </span>
                  {on && <Check size={14} className="text-brand" />}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {save.isError && <p className="mt-2 text-[13px] text-negative">{errorMessage(save.error)}</p>}
    </Dialog>
  )
}

/** Takes one piece out of the campaign (the content itself stays). */
export function useRemoveFromCampaign(onDone: () => void) {
  return useMutation({
    mutationFn: async (id: string) => {
      const { content } = await contentApi.get(id)
      return contentApi.update(id, { campaign: null, rev: content.rev })
    },
    onSuccess: () => {
      toast('Removed from the campaign')
      onDone()
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
}

/** The team's tasks for the campaign, with a shortcut to add one already linked. */
export function CampaignTasks({ campaign, canAdd }: { campaign: Campaign; canAdd: boolean }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [today] = useState(todayString)
  const query = `campaign=${campaign._id}&pageSize=100`
  const tasks = useQuery({ queryKey: ['agency', 'tasks', 'list', query], queryFn: () => tasksApi.list(query) })
  const items = tasks.data?.items ?? []
  const open = items.filter((t) => t.status !== 'done').length

  return (
    <Card
      title="Tasks"
      description={items.length ? `${open} of ${items.length} still to do` : 'Your team’s work for this campaign.'}
      action={
        canAdd && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> New task
          </Button>
        )
      }
    >
      {items.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-text-3">{tasks.isError ? errorMessage(tasks.error) : 'No tasks yet. Pick this campaign on a task, or add one here.'}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((t) => (
            <li key={t._id}>
              <Link to={`/app/tasks/${t._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#f6f5f6]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{t.title}</span>
                  <span className="block truncate text-xs text-text-3">
                    {t.ownerInfo?.name ?? 'No owner'}
                    {t.due && <span className={isOverdue(t, today) ? 'text-negative' : undefined}> · due {formatDate(t.due)}</span>}
                  </span>
                </span>
                <BlockedBadge blocked={t.blocked} />
                <TaskStatusPill status={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <TaskFormDialog
          clientId={campaign.client}
          campaignId={campaign._id}
          onClose={() => setAdding(false)}
          onSaved={(t) => {
            toast(`Task added: ${t.title}`)
            setAdding(false)
            void qc.invalidateQueries({ queryKey: ['agency', 'tasks'] })
          }}
        />
      )}
    </Card>
  )
}
