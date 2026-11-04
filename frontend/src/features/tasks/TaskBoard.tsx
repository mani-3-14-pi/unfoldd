import { useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, EllipsisVertical } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { Menu } from '@/components/ui/Menu'
import { Pill } from '@/components/ui/Pill'
import { priorityLabel, priorityTone } from '@/features/content/labels'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { BOARD_STATUSES, tasksApi, type Task, type TaskStatus } from './api'
import { isOverdue, taskStatusLabel, todayString } from './labels'
import { BlockedBadge } from './pills'

/**
 * P88: the board. Columns are the working statuses; a blocked card stays in its column with a flag (D37).
 * Drag a card or use its menu to move it. If someone moved it first, the server answers 409 and the board reloads.
 */
export function TaskBoard({ query }: { query: string }) {
  const qc = useQueryClient()
  const key = ['agency', 'tasks', 'board', query]
  const board = useQuery({ queryKey: key, queryFn: () => tasksApi.board(query) })
  const [over, setOver] = useState<TaskStatus | null>(null)
  const [today] = useState(todayString)

  const move = useMutation({
    mutationFn: ({ task, to }: { task: Task; to: TaskStatus }) => tasksApi.move(task._id, { status: to, expectedStatus: task.status }),
    onMutate: async ({ task, to }) => {
      // Show the move at once; the refetch afterwards settles the real order.
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData<Awaited<ReturnType<typeof tasksApi.board>>>(key, (old) =>
        old && {
          columns: old.columns.map((c) => ({
            ...c,
            items: c.status === to ? [...c.items.filter((t) => t._id !== task._id), { ...task, status: to }] : c.items.filter((t) => t._id !== task._id),
          })),
        },
      )
    },
    onError: (err) => toast(errorMessage(err), 'error'),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['agency', 'tasks'] }),
  })

  if (board.isPending) return <div className="h-64" />
  if (board.isError) return <EmptyState title="Couldn’t load the board">{errorMessage(board.error)}</EmptyState>

  const all = board.data.columns.flatMap((c) => c.items)
  const drop = (e: DragEvent, to: TaskStatus) => {
    e.preventDefault()
    setOver(null)
    const task = all.find((t) => t._id === e.dataTransfer.getData('text/plain'))
    if (task && task.status !== to) move.mutate({ task, to })
  }

  return (
    <div className="grid gap-4 overflow-x-auto pb-2 md:grid-cols-2 xl:grid-cols-4">
      {board.data.columns.map((col) => (
        <section
          key={col.status}
          aria-label={taskStatusLabel[col.status]}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(col.status)
          }}
          onDragLeave={() => setOver((s) => (s === col.status ? null : s))}
          onDrop={(e) => drop(e, col.status)}
          className={cn('flex min-h-48 min-w-64 flex-col gap-2 rounded-xl p-2 transition-colors', over === col.status ? 'bg-green-soft' : 'bg-surface-input')}
        >
          <h2 className="flex items-center justify-between px-1.5 pt-1 text-xs font-semibold text-text-2">
            {taskStatusLabel[col.status]}
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-text-3">{col.items.length}</span>
          </h2>
          {col.items.map((t) => (
            <article
              key={t._id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', t._id)}
              className="group flex cursor-grab flex-col gap-2 rounded-lg border border-border-strong bg-white p-3 shadow-sm active:cursor-grabbing"
            >
              <div className="flex items-start gap-2">
                <Link to={`/app/tasks/${t._id}`} className="flex-1 text-[13px] font-medium hover:underline">
                  {t.title}
                </Link>
                <Menu
                  label={`Move ${t.title}`}
                  heading="Move to"
                  items={BOARD_STATUSES.filter((s) => s !== t.status).map((s) => ({ label: taskStatusLabel[s], onSelect: () => move.mutate({ task: t, to: s }) }))}
                  className="grid size-6 shrink-0 place-items-center rounded text-text-4 hover:bg-black/5"
                >
                  <EllipsisVertical size={14} />
                </Menu>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-3">
                {t.clientInfo && <span>{t.clientInfo.brandName}</span>}
                {t.ownerInfo && <span>· {t.ownerInfo.name}</span>}
              </div>
              {(t.due || t.priority !== 'normal' || t.blocked.isBlocked) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <BlockedBadge blocked={t.blocked} />
                  {t.priority !== 'normal' && (
                    <Pill tone={priorityTone[t.priority]} dot={false}>
                      {priorityLabel[t.priority]}
                    </Pill>
                  )}
                  {t.due && (
                    <span className={cn('inline-flex items-center gap-1 text-[11px]', isOverdue(t, today) ? 'font-medium text-negative' : 'text-text-3')}>
                      <CalendarDays size={11} /> {formatDate(t.due)}
                    </span>
                  )}
                </div>
              )}
            </article>
          ))}
          {col.items.length === 0 && <p className="px-1.5 py-4 text-center text-xs text-text-4">Drop tasks here</p>}
        </section>
      ))}
    </div>
  )
}
