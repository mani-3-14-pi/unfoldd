import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlarmClock, ChevronDown, Eye, ListTodo, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Card, EmptyState, StatCard } from '@/components/ui/Card'
import { dashboardApi } from '@/features/dashboard/api'
import { cn } from '@/lib/cn'
import { initials } from '@/lib/format'
import { tasksApi, type Task } from './api'
import { isOverdue } from './labels'

/**
 * A native select dressed as the toolbar's buttons. It stays a real <select>, so keyboards, screen readers and
 * the tests drive it as before.
 */
export function FilterSelect({
  label,
  icon: Icon,
  value,
  onChange,
  children,
}: {
  label: string
  icon: LucideIcon
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'relative flex h-9 items-center rounded-lg border border-[#eceaeb] bg-surface text-xs font-medium hover:bg-surface-input focus-within:border-brand-border focus-within:ring-4 focus-within:ring-brand/10',
        value && 'border-brand-border bg-green-soft/60',
      )}
    >
      <Icon size={15} strokeWidth={1.7} className="pointer-events-none absolute left-3 text-text-2" aria-hidden="true" />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full max-w-48 cursor-pointer appearance-none truncate rounded-lg bg-transparent pr-8 pl-9 outline-none"
      >
        {children}
      </select>
      <ChevronDown size={15} strokeWidth={1.8} className="pointer-events-none absolute right-2.5 text-text-2" aria-hidden="true" />
    </span>
  )
}

/**
 * The four numbers above the tasks. They come from the board endpoint (every task that isn't cancelled, with the same
 * client, owner, search and toggle filters), which the board view shares from the cache. `query` is the board's query.
 */
export function TaskStats({ query, today, onStatus }: { query: string; today: string; onStatus: (status: string) => void }) {
  const board = useQuery({ queryKey: ['agency', 'tasks', 'board', query], queryFn: () => tasksApi.board(query) })
  if (!board.data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-2xl bg-surface-input" />
        ))}
      </div>
    )
  }
  const all: Task[] = board.data.columns.flatMap((c) => c.items)
  const open = all.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
  const clients = new Set(open.map((t) => t.client)).size
  const dueToday = open.filter((t) => t.due === today).length
  const overdue = open.filter((t) => isOverdue(t, today)).length
  const inReview = open.filter((t) => t.status === 'in_review').length

  return (
    <section aria-label="Task overview" className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatButton onClick={() => onStatus('todo,in_progress,in_review')}>
        <StatCard label="Open tasks" value={open.length} icon={ListTodo} tone="green" note={clients === 1 ? 'across 1 client' : `across ${clients} clients`} />
      </StatButton>
      <StatCard label="Due today" value={dueToday} icon={AlarmClock} tone={dueToday ? 'amber' : 'gray'} note="needs to ship today" />
      <StatCard label="Overdue" value={overdue} icon={TriangleAlert} tone={overdue ? 'red' : 'gray'} note="past their due date" />
      <StatButton onClick={() => onStatus('in_review')}>
        <StatCard label="In review" value={inReview} icon={Eye} tone="indigo" note="waiting on a sign-off" />
      </StatButton>
    </section>
  )
}

/** Makes a stat card a button that sets the status tab, keeping the other filters (a link would drop them). */
function StatButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl text-left transition-colors [&>article]:h-full hover:[&>article]:border-border-strong hover:[&>article]:bg-[#f6f5f6]">
      {children}
    </button>
  )
}

/** Open tasks per teammate, against their capacity. Picking someone filters the list to their tasks. */
export function WorkloadPanel({ owner, onOwner }: { owner: string; onOwner: (userId: string) => void }) {
  const workload = useQuery({ queryKey: ['agency', 'dashboard', 'workload'], queryFn: () => dashboardApi.workload() })
  const people = workload.data?.items ?? []
  return (
    <Card title="Team workload" description="Active tasks against each person’s capacity.">
      {workload.isPending ? (
        <div className="m-5 h-40 animate-pulse rounded-lg bg-surface-input" />
      ) : people.length === 0 ? (
        <EmptyState title="No one on the team yet" />
      ) : (
        <ul className="max-h-[480px] overflow-y-auto py-1.5">
          {people.map((w) => {
            const selected = owner === w.user._id
            return (
              <li key={w.user._id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onOwner(selected ? '' : w.user._id)}
                  className={cn('flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-[#f6f5f6]', selected && 'bg-green-soft/60')}
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-input text-[10px] font-semibold text-text-3">{initials(w.user.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{w.user.name}</span>
                      <span className="shrink-0 text-xs text-text-2">
                        {w.activeTasks} / {w.capacity}
                      </span>
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-input" role="img" aria-label={`${w.load}% of capacity`}>
                      <span
                        className={cn('block h-full rounded-full', w.status === 'overloaded' ? 'bg-red-dot' : w.status === 'at_capacity' ? 'bg-amber-dot' : 'bg-green-dot')}
                        style={{ width: `${Math.min(100, w.load)}%` }}
                      />
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
