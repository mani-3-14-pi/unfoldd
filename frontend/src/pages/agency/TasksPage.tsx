import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Columns3, List, Plus, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { CellText, DataTable, type Column } from '@/components/list/DataTable'
import type { FilterDef } from '@/components/list/filters'
import { ListToolbar } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Card'
import { Pill } from '@/components/ui/Pill'
import { clientsApi } from '@/features/clients/api'
import { priorityLabel, priorityTone } from '@/features/content/labels'
import { tasksApi, TASK_STATUSES, type Task } from '@/features/tasks/api'
import { isOverdue, taskStatusLabel, todayString } from '@/features/tasks/labels'
import { BlockedBadge, TaskStatusPill } from '@/features/tasks/pills'
import { TaskBoard } from '@/features/tasks/TaskBoard'
import { TaskFormDialog } from '@/features/tasks/TaskFormDialog'
import { FilterSelect, TaskStats, WorkloadPanel } from '@/features/tasks/TaskOverview'
import { activeTeamQuery } from '@/features/team/api'
import { apiQuery, useListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'

const FILTERS: FilterDef[] = [
  { kind: 'toggle', key: 'mine', label: 'Mine', description: 'I own or collaborate on it' },
  { kind: 'toggle', key: 'blocked', label: 'Blocked only', description: 'Waiting on a reason or a dependency' },
]

/** P85–P88: every task the person can see, as a list or as the board. */
export function TasksPage() {
  const state = useListState()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [today] = useState(todayString)
  const board = state.get('view') === 'board'
  const clients = useQuery({ queryKey: ['agency', 'clients', 'list', 'picker'], queryFn: () => clientsApi.list('pageSize=100&sort=name') })
  const team = useQuery(activeTeamQuery)

  // The API filters, without the view switch and (for the board) paging and status tabs.
  const params = new URLSearchParams(state.params)
  params.delete('view')
  // The board and the numbers on top see every status, and no paging.
  const boardParams = new URLSearchParams(params)
  ;['page', 'pageSize', 'status'].forEach((k) => boardParams.delete(k))
  const boardQuery = apiQuery(boardParams)
  const query = board ? boardQuery : apiQuery(params)

  const list = useQuery({
    queryKey: ['agency', 'tasks', 'list', query],
    queryFn: () => tasksApi.list(query),
    placeholderData: keepPreviousData,
    enabled: !board,
  })
  const data = list.data

  const columns: Column<Task>[] = [
    {
      key: 'title',
      header: 'Task',
      className: 'w-[34%]',
      cell: (t) => (
        <CellText
          primary={
            <Link to={`/app/tasks/${t._id}`} className="hover:underline">
              {t.title}
            </Link>
          }
          secondary={t.clientInfo?.brandName}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (t) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <TaskStatusPill status={t.status} />
          <BlockedBadge blocked={t.blocked} />
        </div>
      ),
    },
    { key: 'owner', header: 'Owner', cell: (t) => <span className="text-text-2">{t.ownerInfo?.name ?? '—'}</span> },
    {
      key: 'due',
      header: 'Due',
      cell: (t) => <span className={isOverdue(t, today) ? 'font-medium text-negative' : 'text-text-2'}>{t.due ? formatDate(t.due) : '—'}</span>,
    },
    {
      key: 'priority',
      header: 'Priority',
      cell: (t) =>
        t.priority === 'normal' ? (
          <span className="text-text-4">—</span>
        ) : (
          <Pill tone={priorityTone[t.priority]} dot={false}>
            {priorityLabel[t.priority]}
          </Pill>
        ),
    },
  ]

  const anyFilter = [...state.params.keys()].some((k) => !['page', 'pageSize', 'sort', 'view'].includes(k))

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Your team’s work. Blocked tasks keep their place and show why."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New task
          </Button>
        }
      />

      <TaskStats query={boardQuery} today={today} onStatus={(status) => state.update({ status, view: null })} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="View" className="flex rounded-lg border border-border-strong bg-white p-0.5">
          {[
            { v: false, label: 'List', icon: List },
            { v: true, label: 'Board', icon: Columns3 },
          ].map(({ v, label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={board === v}
              onClick={() => state.update({ view: v ? 'board' : null })}
              className={cn('flex h-8 items-center gap-1.5 rounded-md px-3 text-xs', board === v ? 'bg-brand text-white' : 'text-text-2 hover:bg-black/5')}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <FilterSelect label="Client" icon={Building2} value={state.get('client')} onChange={(client) => state.update({ client })}>
          <option value="">All clients</option>
          {clients.data?.items.map((c) => (
            <option key={c._id} value={c._id}>
              {c.brandName}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Owner" icon={UserRound} value={state.get('owner')} onChange={(owner) => state.update({ owner })}>
          <option value="">Anyone</option>
          {team.data?.items.map((m) => (
            <option key={m.user._id} value={m.user._id}>
              {m.user.name}
            </option>
          ))}
        </FilterSelect>
      </div>

      {board ? (
        <div className="flex flex-col gap-4">
          <ListToolbar state={state} searchPlaceholder="Search tasks…" filters={FILTERS} sorts={[{ value: 'due', label: 'Board order' }]} defaultSort="due" noun="task" />
          <TaskBoard query={query} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ListToolbar
            state={state}
            searchPlaceholder="Search tasks…"
            filters={FILTERS}
            sorts={[{ value: 'due', label: 'Due date' }]}
            defaultSort="due"
            total={data?.total}
            noun="task"
            tabs={{
              key: 'status',
              allLabel: 'All',
              options: TASK_STATUSES.map((s) => ({ value: s, label: taskStatusLabel[s] })),
            }}
          />
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              <DataTable
                label="Tasks"
                columns={columns}
                rows={data?.items}
                rowKey={(t) => t._id}
                loading={list.isPending}
                fetching={list.isPlaceholderData}
                onRowClick={(t) => navigate(`/app/tasks/${t._id}`)}
                empty={
                  list.isError ? (
                    <EmptyState title="Couldn’t load tasks">{errorMessage(list.error)}</EmptyState>
                  ) : anyFilter ? (
                    <EmptyState title="No tasks match" action={<Button onClick={() => state.clear([...state.params.keys()].filter((k) => k !== 'view'))}>Clear filters</Button>} />
                  ) : (
                    <EmptyState
                      title="No tasks yet"
                      action={
                        <Button variant="primary" onClick={() => setCreating(true)}>
                          <Plus size={16} /> New task
                        </Button>
                      }
                    >
                      Add tasks here, or turn client feedback into tasks from a content page.
                    </EmptyState>
                  )
                }
                footer={
                  data &&
                  data.total > 0 && (
                    <Pagination
                      {...data}
                      noun="tasks"
                      onPage={(page) => state.update({ page })}
                      onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
                    />
                  )
                }
              />
            </div>
            <aside className="xl:sticky xl:top-6">
              <WorkloadPanel owner={state.get('owner')} onOwner={(owner) => state.update({ owner })} />
            </aside>
          </div>
        </div>
      )}

      {creating && (
        <TaskFormDialog
          clientId={state.get('client') || undefined}
          onClose={() => setCreating(false)}
          onSaved={(t) => {
            void qc.invalidateQueries({ queryKey: ['agency', 'tasks'] })
            navigate(`/app/tasks/${t._id}`)
          }}
        />
      )}
    </>
  )
}
