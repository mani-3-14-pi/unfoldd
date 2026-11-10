import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { Link } from 'react-router'
import type { FilterDef } from '@/components/list/filters'
import { ListToolbar } from '@/components/list/ListToolbar'
import { Pagination } from '@/components/list/Pagination'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Pill } from '@/components/ui/Pill'
import { adminApi, TICKET_STATUSES } from '@/features/admin/api'
import { describeAgent } from '@/features/account/api'
import { TICKET_CATEGORIES, type TicketStatus } from '@/features/support/api'
import { categoryLabel, ticketStatusTone } from '@/features/support/labels'
import { apiQuery, useListState } from '@/hooks/useListState'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

/** The support team's side of the statuses (the agency sees "Waiting on you"). */
const statusLabel: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_user: 'Waiting on them',
  resolved: 'Resolved',
}
const StatusPill = ({ status }: { status: TicketStatus }) => <Pill tone={ticketStatusTone[status]}>{statusLabel[status]}</Pill>

const FILTERS: FilterDef[] = [{ kind: 'multi', key: 'category', label: 'Category', options: TICKET_CATEGORIES.map((c) => ({ value: c, label: categoryLabel[c] })) }]

/** Tickets raised from the agency portals and client apps (their Support pages): read, reply, resolve. */
export function SupportPage() {
  const state = useListState()
  // The open ticket lives in the URL too, but isn't a list filter.
  const listParams = new URLSearchParams(state.params)
  listParams.delete('ticket')
  const query = useQuery({
    queryKey: ['admin', 'support', 'list', apiQuery(listParams)],
    queryFn: () => adminApi.tickets(apiQuery(listParams)),
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const current = state.get('ticket') || data?.items[0]?._id || null
  const anyFilter = [...listParams.keys()].some((k) => !['page', 'pageSize'].includes(k))

  return (
    <>
      <PageHeader title="Support" description="Tickets from agency teams and their clients. Your reply is shown in their Support page and emailed to them." />
      <div className="flex flex-col gap-4">
        <ListToolbar
          state={state}
          searchPlaceholder="Search subjects, names, emails…"
          filters={FILTERS}
          sorts={[{ value: 'latest', label: 'Latest message first' }]}
          defaultSort="latest"
          total={data?.total}
          noun="ticket"
          tabs={{ key: 'status', allLabel: 'Needs an answer', options: TICKET_STATUSES.map((s) => ({ value: s, label: statusLabel[s] })) }}
        />
        {query.isPending ? (
          <div className="h-48" />
        ) : query.isError ? (
          <EmptyState title="Couldn’t load tickets">{errorMessage(query.error)}</EmptyState>
        ) : data!.items.length === 0 ? (
          anyFilter ? (
            <EmptyState title="No tickets match" action={<Button onClick={() => state.clear([...listParams.keys()])}>Clear filters</Button>} />
          ) : (
            <EmptyState title="You’re all caught up">No tickets are waiting for an answer.</EmptyState>
          )
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card>
              <ul className="divide-y divide-border" aria-label="Tickets">
                {data!.items.map((t) => (
                  <li key={t._id}>
                    <button
                      type="button"
                      onClick={() => state.update({ ticket: t._id, page: state.get('page') || null })}
                      aria-current={t._id === current ? 'true' : undefined}
                      className={cn('flex w-full items-start gap-3 px-5 py-3 text-left', t._id === current ? 'bg-surface-input' : 'hover:bg-[#f6f5f6]')}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{t.subject}</span>
                        <span className="block truncate text-xs text-text-3">
                          {t.user.name} · {t.agencyName ?? 'No agency'}
                          {t.clientName && ` · ${t.clientName}`} · {timeAgo(t.lastMessageAt)}
                        </span>
                      </span>
                      <StatusPill status={t.status} />
                    </button>
                  </li>
                ))}
              </ul>
              {data!.total > 10 && (
                <Pagination
                  {...data!}
                  noun="tickets"
                  onPage={(page) => state.update({ page })}
                  onPageSize={(pageSize) => state.update({ pageSize: pageSize === 25 ? null : pageSize })}
                />
              )}
            </Card>
            {current && <TicketThread key={current} id={current} />}
          </div>
        )}
      </div>
    </>
  )
}

function TicketThread({ id }: { id: string }) {
  const qc = useQueryClient()
  const key = ['admin', 'support', 'ticket', id]
  const ticket = useQuery({ queryKey: key, queryFn: () => adminApi.ticket(id) })
  const [body, setBody] = useState('')
  const [after, setAfter] = useState<TicketStatus>('waiting_on_user')
  const done = (message: string) => {
    void qc.invalidateQueries({ queryKey: ['admin', 'support'] })
    // The sidebar badge counts open tickets.
    void qc.invalidateQueries({ queryKey: ['admin', 'overview'] })
    toast(message)
  }
  const reply = useMutation({
    mutationFn: () => adminApi.replyTicket(id, { body: body.trim(), status: after }),
    onSuccess: () => {
      setBody('')
      done('Reply sent')
    },
  })
  const setStatus = useMutation({
    mutationFn: (status: TicketStatus) => adminApi.setTicketStatus(id, status),
    onSuccess: (_, status) => done(`Marked ${statusLabel[status].toLowerCase()}`),
    onError: (err) => toast(errorMessage(err), 'error'),
  })

  if (ticket.isPending) return <Card><div className="h-48" /></Card>
  if (ticket.isError) return <EmptyState title="Couldn’t open this ticket">{errorMessage(ticket.error)}</EmptyState>
  const t = ticket.data.ticket
  const from = t.clientName ? `${t.clientName} (client of ${t.agencyName ?? 'an agency'})` : (t.agencyName ?? 'No agency')

  return (
    <Card
      title={t.subject}
      description={`${categoryLabel[t.category]} · opened ${formatDateTime(t.createdAt)}`}
      action={
        <Select aria-label="Ticket status" value={t.status} disabled={setStatus.isPending} onChange={(e) => setStatus.mutate(e.target.value as TicketStatus)} className="w-40">
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </Select>
      }
    >
      <dl className="grid gap-x-6 gap-y-2 border-b border-border px-5 py-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-text-3">From</dt>
          <dd className="mt-0.5 text-[13px]">
            {t.user.name}
            {t.user.email && <span className="text-text-3"> · {t.user.email}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-text-3">{t.client ? 'Client space' : 'Agency'}</dt>
          <dd className="mt-0.5 text-[13px]">
            {t.agency ? (
              <Link to={`/admin/agencies/${t.agency}`} className="hover:underline">
                {from}
              </Link>
            ) : (
              from
            )}
          </dd>
        </div>
        {t.context.url && (
          <div className="min-w-0">
            <dt className="text-text-3">Page</dt>
            <dd className="mt-0.5 truncate font-mono text-xs">{t.context.url}</dd>
          </div>
        )}
        {t.context.userAgent && (
          <div>
            <dt className="text-text-3">Browser</dt>
            <dd className="mt-0.5 text-[13px]">{describeAgent(t.context.userAgent)}</dd>
          </div>
        )}
      </dl>
      <ol className="flex flex-col gap-3 px-5 py-4">
        {t.messages.map((m, i) => (
          <li key={i} className={cn('max-w-[85%] rounded-xl px-4 py-3', m.from === 'support' ? 'self-end bg-green-soft' : 'self-start bg-surface-input')}>
            <div className="text-xs text-text-3">
              {m.from === 'support' ? `${m.author.name} · Unfoldd support` : m.author.name} · {timeAgo(m.at)}
            </div>
            <p className="mt-1 text-[13px] whitespace-pre-line">{m.body}</p>
          </li>
        ))}
      </ol>
      <form
        className="flex flex-col gap-3 border-t border-border px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (body.trim()) reply.mutate()
        }}
      >
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={10_000} placeholder={`Reply to ${t.user.name}…`} aria-label="Reply" />
        <div className="flex flex-wrap items-end justify-end gap-3">
          {reply.isError && <span className="mr-auto text-[13px] text-negative">{errorMessage(reply.error)}</span>}
          <Field label="Then mark it" htmlFor="ticket-after">
            <Select id="ticket-after" value={after} onChange={(e) => setAfter(e.target.value as TicketStatus)} className="w-40">
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="primary" loading={reply.isPending} disabled={!body.trim()}>
            <Send size={14} /> Send reply
          </Button>
        </div>
      </form>
    </Card>
  )
}
