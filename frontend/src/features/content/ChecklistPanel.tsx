import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, ListTodo, LoaderCircle, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { contentApi, type ChecklistItem, type ContentRecord } from './api'
import { versionLabel } from './labels'

/**
 * The revision checklist (Flow 7, P72–P75). AI suggestions are agency-only until someone accepts them; only
 * accepted items are shown to the client (D21). AI runs in the background and never blocks the work.
 */
export function ChecklistPanel({ content }: { content: ContentRecord }) {
  const qc = useQueryClient()
  const key = ['agency', 'content', 'checklist', content._id, content.currentVersion]
  const query = useQuery({
    queryKey: key,
    queryFn: () => contentApi.checklist(content._id),
    enabled: !!content.currentVersion,
    // While the AI works, check back every few seconds.
    refetchInterval: (q) => (['queued', 'running'].includes(q.state.data?.ai.run?.status ?? '') ? 3000 : false),
  })
  const [text, setText] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: key })
  const onError = (err: unknown) => toast(errorMessage(err), 'error')

  const run = useMutation({ mutationFn: () => contentApi.runChecklist(content._id), onSuccess: refresh, onError })
  const add = useMutation({
    mutationFn: () => contentApi.addChecklistItem(content._id, text.trim()),
    onSuccess: () => {
      setText('')
      refresh()
    },
    onError,
  })

  if (!content.currentVersion || query.isPending) return null
  if (query.isError) return null
  const { ai, items, version } = query.data
  const suggested = items.filter((i) => i.status === 'suggested')
  const accepted = items.filter((i) => i.status === 'accepted')
  const running = ['queued', 'running'].includes(ai.run?.status ?? '')
  const writable = !['published', 'cancelled'].includes(content.state)
  // Finished content with no checklist has nothing to show.
  if (!writable && items.length === 0) return null

  return (
    <Card
      title="Revision checklist"
      description={`Feedback on ${versionLabel(version.number)} as a list of changes. The client sees accepted items only.`}
      action={
        ai.enabled &&
        writable && (
          <Button size="sm" onClick={() => run.mutate()} loading={run.isPending} disabled={running}>
            {running ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {running ? 'AI is reading…' : ai.run ? 'Run AI again' : 'Suggest with AI'}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        {ai.run?.status === 'failed' && (
          <p className="rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber-ink">
            The AI couldn’t read the feedback this time{ai.run.error ? ` (${ai.run.error})` : ''}. The feedback is all still here; try again or add items yourself.
          </p>
        )}
        {ai.run?.status === 'done' && suggested.length === 0 && accepted.length === 0 && <p className="text-xs text-text-3">The AI found nothing actionable in the open feedback.</p>}

        {suggested.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-indigo-ink uppercase">
              <Sparkles size={13} /> {suggested.length} suggestion{suggested.length === 1 ? '' : 's'} · only your team sees these
            </h3>
            <ul className="flex flex-col gap-1.5">
              {suggested.map((i) => (
                <Item key={i._id} content={content} item={i} onChanged={refresh} writable={writable} />
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {accepted.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {accepted.map((i) => (
                <Item key={i._id} content={content} item={i} onChanged={refresh} writable={writable} />
              ))}
            </ul>
          ) : (
            !suggested.length && <p className="text-[13px] text-text-3">No items yet.{ai.enabled ? ' Let the AI suggest some from the client’s feedback, or add your own.' : ' Add the changes you’ll make.'}</p>
          )}
          {writable && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (text.trim()) add.mutate()
              }}
            >
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a change, e.g. Make the logo bigger" maxLength={1000} aria-label="New checklist item" />
              <Button type="submit" loading={add.isPending} disabled={!text.trim()}>
                <Plus size={15} /> Add
              </Button>
            </form>
          )}
        </div>
      </div>
    </Card>
  )
}

function Item({ content, item: i, onChanged, writable }: { content: ContentRecord; item: ChecklistItem; onChanged: () => void; writable: boolean }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(i.text)
  const onError = (err: unknown) => toast(errorMessage(err), 'error')
  const update = useMutation({
    mutationFn: (body: { text?: string; status?: ChecklistItem['status'] }) => contentApi.updateChecklistItem(content._id, i._id, body),
    onSuccess: () => {
      setEditing(false)
      onChanged()
    },
    onError,
  })
  const task = useMutation({
    mutationFn: () => contentApi.checklistToTask(content._id, i._id),
    onSuccess: ({ task: t }) => {
      toast(`Task created: ${t.title}`)
      onChanged()
    },
    onError,
  })
  const suggestion = i.status === 'suggested'

  return (
    <li className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2', suggestion ? 'border-dashed border-indigo-soft bg-[#faf9ff]' : 'border-border-strong bg-white')}>
      {suggestion ? <Sparkles size={15} className="mt-0.5 shrink-0 text-indigo-ink" /> : <CheckCircle2 size={15} className={cn('mt-0.5 shrink-0', i.done ? 'text-positive' : 'text-text-4')} />}
      {editing ? (
        <form
          className="flex flex-1 gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) update.mutate({ text: text.trim() })
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus maxLength={1000} className="h-8" />
          <Button size="sm" type="submit" variant="primary" loading={update.isPending} aria-label="Save">
            <Check size={14} />
          </Button>
          <Button size="sm" onClick={() => setEditing(false)} aria-label="Cancel">
            <X size={14} />
          </Button>
        </form>
      ) : (
        <span className={cn('flex-1 text-[13px]', i.done && 'text-text-3 line-through')}>
          {i.text}
          {i.task && <span className="ml-2 text-[11px] text-text-4 no-underline">· task</span>}
        </span>
      )}
      {writable && !editing && (
        <span className="flex shrink-0 items-center gap-0.5">
          {suggestion && (
            <Button size="sm" variant="ghost" aria-label="Accept" title="Accept" loading={update.isPending} onClick={() => update.mutate({ status: 'accepted' })}>
              <Check size={14} />
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-label="Edit" title="Edit" onClick={() => setEditing(true)}>
            <Pencil size={13} />
          </Button>
          {!suggestion && !i.task && (
            <Button size="sm" variant="ghost" aria-label="Make a task" title="Make a task" loading={task.isPending} onClick={() => task.mutate()}>
              <ListTodo size={14} />
            </Button>
          )}
          {!i.task && (
            <Button size="sm" variant="ghost" aria-label="Remove" title="Remove" onClick={() => update.mutate({ status: 'removed' })}>
              <Trash2 size={13} />
            </Button>
          )}
        </span>
      )}
    </li>
  )
}
