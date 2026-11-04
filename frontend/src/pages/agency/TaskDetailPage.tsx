import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, EllipsisVertical, Link2, Pencil, Send, Trash2, Unlock } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Details } from '@/components/ui/Details'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { isManagerPlus } from '@/features/agency/roles'
import { useAgencySession } from '@/features/agency/session'
import { clientsApi } from '@/features/clients/api'
import { priorityLabel } from '@/features/content/labels'
import { useClientPeople } from '@/features/content/useClientPeople'
import { BOARD_STATUSES, taskKey, tasksApi, type Dependency, type TaskDetail, type TaskStatus } from '@/features/tasks/api'
import { isOverdue, taskSourceLabel, taskStatusLabel, todayString } from '@/features/tasks/labels'
import { BlockedBadge, TaskStatusPill } from '@/features/tasks/pills'
import { TaskFormDialog } from '@/features/tasks/TaskFormDialog'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatDateTime, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

/** P87: one task: status, block, what it waits on (D38), what waits on it, and the team's comments. */
export function TaskDetailPage() {
  const { id = '' } = useParams()
  const s = useAgencySession()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const query = useQuery({ queryKey: taskKey(id), queryFn: () => tasksApi.get(id) })
  const [dialog, setDialog] = useState<'edit' | 'block' | 'deps' | 'delete' | null>(null)
  const [today] = useState(todayString)

  const refresh = () => void qc.invalidateQueries({ queryKey: ['agency', 'tasks'] })
  const move = useMutation({
    mutationFn: ({ to, from }: { to: TaskStatus; from: TaskStatus }) => tasksApi.move(id, { status: to, expectedStatus: from }),
    onSuccess: (_, { to }) => toast(`Moved to ${taskStatusLabel[to]}`),
    onError: (err) => toast(errorMessage(err), 'error'),
    onSettled: refresh,
  })
  const unblock = useMutation({
    mutationFn: (t: TaskDetail) => tasksApi.update(t._id, { rev: t.rev, blocked: { manual: false, reason: '' } }),
    onSuccess: () => toast('Unblocked'),
    onError: (err) => toast(errorMessage(err), 'error'),
    onSettled: refresh,
  })

  const back = { to: '/app/tasks', label: 'Tasks' }
  if (query.isPending) return <PageHeader title="Task" back={back} />
  if (query.isError) {
    return (
      <>
        <PageHeader title="Task" back={back} />
        <EmptyState title="Couldn’t open this task">{errorMessage(query.error)}</EmptyState>
      </>
    )
  }
  const t = query.data.task
  const canDelete = isManagerPlus(s.role) || t.owner === s.user.id || t.createdBy === s.user.id

  const menu: MenuItem[] = [
    { label: 'Edit', icon: Pencil, onSelect: () => setDialog('edit') },
    t.blocked.manual
      ? { label: 'Unblock', icon: Unlock, onSelect: () => unblock.mutate(t) }
      : { label: 'Mark blocked…', icon: Ban, onSelect: () => setDialog('block') },
    { label: 'What it waits on…', icon: Link2, onSelect: () => setDialog('deps') },
    ...(t.status !== 'cancelled' ? [{ label: 'Cancel task', onSelect: () => move.mutate({ to: 'cancelled', from: t.status }) }] : []),
    ...(canDelete ? [{ label: 'Delete', icon: Trash2, tone: 'danger' as const, onSelect: () => setDialog('delete'), separated: true }] : []),
  ]

  return (
    <>
      <PageHeader
        back={back}
        title={t.title}
        meta={
          <>
            <TaskStatusPill status={t.status} />
            <BlockedBadge blocked={t.blocked} />
          </>
        }
        description={<ClientLink clientId={t.client} />}
        actions={
          <>
            <Select
              aria-label="Status"
              value={t.status}
              disabled={move.isPending}
              onChange={(e) => move.mutate({ to: e.target.value as TaskStatus, from: t.status })}
              className="w-40"
            >
              {[...BOARD_STATUSES, 'cancelled' as const].map((st) => (
                <option key={st} value={st}>
                  {taskStatusLabel[st]}
                </option>
              ))}
            </Select>
            <Menu label="Task actions" heading={t.title} items={menu} className="grid size-9 place-items-center rounded-lg border border-[#e6e5e8] bg-white hover:bg-[#f6f6f7]">
              <EllipsisVertical size={17} />
            </Menu>
          </>
        }
      />

      {t.blocked.isBlocked && (
        <p className="mb-5 flex items-start gap-2 rounded-lg border border-red-soft bg-[#fdf3f3] px-4 py-3 text-[13px] text-red-ink">
          <Ban size={16} className="mt-px shrink-0" />
          <span>
            {t.blocked.manual ? <>Blocked: {t.blocked.reason}</> : 'Blocked until what it waits on is finished. It unblocks on its own and the owner is told.'}
          </span>
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Card title="Details" action={<Button size="sm" onClick={() => setDialog('edit')}><Pencil size={13} /> Edit</Button>}>
            <TaskDetails task={t} overdue={isOverdue(t, today)} />
          </Card>
          <Comments taskId={t._id} />
        </div>
        <div className="flex flex-col gap-6">
          <Dependencies task={t} onEdit={() => setDialog('deps')} />
        </div>
      </div>

      {dialog === 'edit' && (
        <TaskFormDialog
          task={t}
          onClose={() => setDialog(null)}
          onSaved={() => {
            toast('Task saved')
            setDialog(null)
            refresh()
          }}
          onReload={() => {
            setDialog(null)
            refresh()
          }}
        />
      )}
      {dialog === 'block' && <BlockDialog task={t} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'deps' && <DependenciesDialog task={t} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={`Delete “${t.title}”?`}
          confirm="Delete"
          variant="danger"
          action={() => tasksApi.remove(t._id)}
          onClose={() => setDialog(null)}
          onDone={() => {
            toast('Task deleted')
            refresh()
            navigate('/app/tasks', { replace: true })
          }}
        >
          <p>It disappears from the board and lists. Tasks that waited on it stop waiting.</p>
        </ConfirmDialog>
      )}
    </>
  )
}

function ClientLink({ clientId }: { clientId: string }) {
  const client = useQuery({ queryKey: ['agency', 'clients', 'detail', clientId], queryFn: () => clientsApi.get(clientId), retry: false })
  return (
    <Link to={`/app/clients/${clientId}`} className="font-medium text-text-2 hover:underline">
      {client.data?.client.brandName ?? 'Client'}
    </Link>
  )
}

function TaskDetails({ task: t, overdue }: { task: TaskDetail; overdue: boolean }) {
  const people = useClientPeople(t.client)
  const name = (uid: string | null) => (uid ? (people.data?.find((u) => u._id === uid)?.name ?? '…') : '')
  return (
    <Details
      rows={[
        { label: 'Description', value: t.description, wide: true },
        { label: 'Owner', value: name(t.owner) || 'No one' },
        { label: 'Due', value: t.due ? <span className={overdue ? 'font-medium text-negative' : undefined}>{formatDate(t.due)}{overdue ? ' · overdue' : ''}</span> : '' },
        { label: 'Priority', value: priorityLabel[t.priority] },
        {
          label: 'Came from',
          value: (
            <>
              {taskSourceLabel[t.source]}
              {t.content && (
                <>
                  {' · '}
                  <Link to={`/app/content/${t.content}`} className="text-brand hover:underline">
                    open the content
                  </Link>
                </>
              )}
            </>
          ),
        },
        { label: 'Created', value: formatDateTime(t.createdAt) },
        ...(t.completedAt ? [{ label: 'Done', value: formatDateTime(t.completedAt) }] : []),
      ]}
    />
  )
}

function Dependencies({ task: t, onEdit }: { task: TaskDetail; onEdit: () => void }) {
  const requests = useQuery({ queryKey: ['agency', 'requests', 'refs', t.client], queryFn: () => tasksApi.requests(t.client), enabled: t.dependencies.some((d) => d.type === 'request') })
  const reqDeps = t.dependencies.filter((d) => d.type === 'request')
  const done = (st: string) => ['done', 'completed', 'cancelled'].includes(st)
  const row = (key: string, to: string | null, title: string, status: string, label: string) => (
    <li key={key} className="flex items-center gap-2 px-5 py-2.5 text-[13px]">
      <span className={cn('size-2 shrink-0 rounded-full', done(status) ? 'bg-positive' : 'bg-amber-dot')} aria-hidden="true" />
      {to ? (
        <Link to={to} className="flex-1 truncate hover:underline">
          {title}
        </Link>
      ) : (
        <span className="flex-1 truncate">{title}</span>
      )}
      <span className="text-xs text-text-4">{label}</span>
    </li>
  )

  return (
    <>
      <Card title="Waits on" description="It’s blocked until each of these is finished or cancelled." action={<Button size="sm" onClick={onEdit}><Link2 size={13} /> Change</Button>}>
        {t.dependencies.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-text-3">Nothing. Add a task or a client request it can’t start without.</p>
        ) : (
          <ul className="divide-y divide-border">
            {t.dependencyTasks.map((d) => row(d._id, `/app/tasks/${d._id}`, d.title, d.status, `Task · ${taskStatusLabel[d.status]}`))}
            {reqDeps.map((d) => {
              const r = requests.data?.items.find((x) => x._id === d.id)
              return row(d.id, null, r?.title ?? 'Client request', r?.status ?? 'open', `Request · ${r?.status ?? '…'}`)
            })}
          </ul>
        )}
      </Card>
      {t.dependents.length > 0 && (
        <Card title="Waiting on this">
          <ul className="divide-y divide-border">{t.dependents.map((d) => row(d._id, `/app/tasks/${d._id}`, d.title, d.status, taskStatusLabel[d.status]))}</ul>
        </Card>
      )}
    </>
  )
}

function Comments({ taskId }: { taskId: string }) {
  const qc = useQueryClient()
  const key = ['agency', 'tasks', 'comments', taskId]
  const comments = useQuery({ queryKey: key, queryFn: () => tasksApi.comments(taskId) })
  const [body, setBody] = useState('')
  const post = useMutation({
    mutationFn: () => tasksApi.comment(taskId, body.trim()),
    onSuccess: () => {
      setBody('')
      void qc.invalidateQueries({ queryKey: key })
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  return (
    <Card title="Comments" description="Your team only. The owner and collaborators are notified.">
      <div className="flex flex-col gap-3 px-5 py-4">
        {comments.data?.items.length === 0 && <p className="text-[13px] text-text-3">No comments yet.</p>}
        {comments.data?.items.map((m) => (
          <div key={m._id} className="text-[13px]">
            <span className="font-medium">{m.author.name}</span> <span className="text-xs text-text-4">{timeAgo(m.createdAt)}</span>
            <p className="mt-0.5 whitespace-pre-line text-text-2">{m.body}</p>
          </div>
        ))}
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (body.trim()) post.mutate()
          }}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" maxLength={5000} aria-label="Comment" className="min-h-16" />
          <Button type="submit" size="sm" variant="primary" className="self-end" loading={post.isPending} disabled={!body.trim()}>
            <Send size={13} /> Comment
          </Button>
        </form>
      </div>
    </Card>
  )
}

/** D37: a manual block always says why. */
function BlockDialog({ task, onClose, onDone }: { task: TaskDetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => tasksApi.update(task._id, { rev: task.rev, blocked: { manual: true, reason: reason.trim() } }),
    onSuccess: () => {
      toast('Marked blocked')
      onDone()
      onClose()
    },
  })
  return (
    <Dialog
      title="Mark blocked"
      description="It keeps its place on the board, with the reason shown."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!reason.trim()} onClick={() => m.mutate()}>
            Mark blocked
          </Button>
        </>
      }
    >
      <Field label="Why is it blocked?" htmlFor="block-reason">
        <Textarea id="block-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Waiting for product photos" />
      </Field>
      {m.isError && <p className="mt-2 text-[13px] text-negative">{errorMessage(m.error)}</p>}
    </Dialog>
  )
}

/** D38: tasks or requests of the same client. While any is unfinished the task is blocked; cycles are refused. */
function DependenciesDialog({ task, onClose, onDone }: { task: TaskDetail; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<Dependency[]>(task.dependencies)
  const tasks = useQuery({ queryKey: ['agency', 'tasks', 'list', 'deps', task.client], queryFn: () => tasksApi.list(`client=${task.client}&pageSize=100`) })
  const requests = useQuery({ queryKey: ['agency', 'requests', 'refs', task.client], queryFn: () => tasksApi.requests(task.client) })
  const has = (d: Dependency) => picked.some((p) => p.type === d.type && p.id === d.id)
  const toggle = (d: Dependency) => setPicked((p) => (has(d) ? p.filter((x) => !(x.type === d.type && x.id === d.id)) : [...p, d]))
  const save = useMutation({
    mutationFn: () => tasksApi.setDependencies(task._id, picked),
    onSuccess: () => {
      toast('Saved')
      onDone()
      onClose()
    },
  })

  const option = (d: Dependency, title: string, detail: string) => (
    <li key={`${d.type}:${d.id}`}>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-[13px] hover:bg-surface-input">
        <input type="checkbox" className="size-4 accent-brand" checked={has(d)} onChange={() => toggle(d)} />
        <span className="flex-1 truncate">{title}</span>
        <span className="text-xs text-text-4">{detail}</span>
        {has(d) && <Check size={14} className="text-brand" />}
      </label>
    </li>
  )

  return (
    <Dialog
      title="What does it wait on?"
      description="Pick tasks or client requests. When each is finished or cancelled, it unblocks on its own."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <section>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-text-3 uppercase">Tasks</h3>
          <ul className="flex max-h-52 flex-col overflow-y-auto">
            {tasks.data?.items.filter((x) => x._id !== task._id).map((x) => option({ type: 'task', id: x._id }, x.title, taskStatusLabel[x.status]))}
            {tasks.data?.items.length === 1 && <li className="px-1.5 text-xs text-text-4">No other tasks for this client.</li>}
          </ul>
        </section>
        <section>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-text-3 uppercase">Client requests</h3>
          <ul className="flex max-h-52 flex-col overflow-y-auto">
            {requests.data?.items.map((r) => option({ type: 'request', id: r._id }, r.title, r.status))}
            {requests.data?.items.length === 0 && <li className="px-1.5 text-xs text-text-4">No requests for this client yet.</li>}
          </ul>
        </section>
        {save.isError && <p className="text-[13px] text-negative">{errorMessage(save.error)}</p>}
      </div>
    </Dialog>
  )
}
